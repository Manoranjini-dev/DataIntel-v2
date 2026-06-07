// ──────────────────────────────────────────────
// ChatPromotionService — Promotes a chat message visualization to a Card
// ──────────────────────────────────────────────

import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OrgPermissionsService } from '../org/org-permissions.service';
import { CardService } from '../card/card.service';
import { SafeAccount } from '../auth/auth.service';

export interface PromoteToCardDto {
  messageId: string;
  executionId?: string;
  cardName: string;
  description?: string;
  folderId?: string;
  chartType?: string;
  visualizationConfig?: Record<string, unknown>;
  tags?: string[];
  visibility?: 'private' | 'org_shared' | 'public';
  // Where to place the card (optional)
  dashboardId?: string;
  pageId?: string;
}

@Injectable()
export class ChatPromotionService {
  private readonly logger = new Logger(ChatPromotionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orgPermissions: OrgPermissionsService,
    private readonly cardService: CardService,
  ) {}

  /**
   * Promote a chat message execution result to a reusable Analytics Card.
   *
   * Flow:
   * 1. Load message + execution to get the SQL, query language, and datasource context
   * 2. Create an Analytics Card using the execution's query
   * 3. Record the promotion in chat_card_promotions
   * 4. (Optional) Place the card on a dashboard widget
   */
  async promote(
    chatId: string,
    orgId: string,
    promoter: SafeAccount,
    dto: PromoteToCardDto,
  ) {
    await this.orgPermissions.requireMember(orgId, promoter.id);

    // 1. Load chat (to get datasource context)
    const chat = await this.db.queryOne<{
      id: string;
      org_id: string;
      connection_id: string | null;
      combo_id: string | null;
    }>(
      `SELECT id, org_id, connection_id, combo_id FROM chats
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [chatId, orgId],
    );
    if (!chat) throw new NotFoundException('Chat not found');

    // 2. Load the message
    const message = await this.db.queryOne<{
      id: string;
      execution_id: string | null;
    }>(
      `SELECT id, execution_id FROM chat_messages WHERE id = $1 AND chat_id = $2`,
      [dto.messageId, chatId],
    );
    if (!message) throw new NotFoundException('Message not found');

    const executionId = dto.executionId || message.execution_id;

    // 3. Load execution to get the query
    let queryDefinition: Record<string, unknown> = {};
    let rawQuery = '';
    let queryLanguage = 'sql';

    if (executionId) {
      const execution = await this.db.queryOne<{
        generated_query: string;
        tables_used: string[];
        confidence: number;
      }>(
        `SELECT generated_query, tables_used, confidence FROM query_executions WHERE id = $1`,
        [executionId],
      );

      if (execution) {
        rawQuery = execution.generated_query;
        queryLanguage = 'sql';
        queryDefinition = {
          sql: execution.generated_query,
          tablesUsed: execution.tables_used,
          confidence: execution.confidence,
        };
      }
    }

    // 4. Determine datasource context
    const datasourceContextType = chat.connection_id ? 'connection' : 'combo';
    const datasourceContextId = (chat.connection_id || chat.combo_id)!;

    // 5. Create the card
    const card = await this.cardService.create(orgId, promoter, {
      name: dto.cardName,
      description: dto.description,
      folderId: dto.folderId,
      datasourceContextType,
      datasourceContextId,
      queryDefinition,
      rawQuery,
      queryLanguage,
      chartType: dto.chartType || 'table',
      visualizationConfig: dto.visualizationConfig,
      visibility: dto.visibility || 'private',
      tags: dto.tags,
    });

    // 6. Record the promotion
    await this.db.query(
      `INSERT INTO chat_card_promotions
         (org_id, chat_id, message_id, execution_id, card_id, promoted_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orgId, chatId, dto.messageId, executionId || null, card.id, promoter.id],
    );

    // 7. Optionally place on a dashboard widget
    let widget = null;
    if (dto.dashboardId && dto.pageId) {
      widget = await this.placeOnDashboard(
        card.id, dto.pageId, orgId, promoter,
      );
    }

    await this.audit.log({
      orgId,
      accountId: promoter.id,
      eventType: 'chat_message_promoted',
      resourceType: 'card',
      resourceId: card.id,
      details: {
        chatId,
        messageId: dto.messageId,
        executionId,
        cardName: dto.cardName,
        dashboardId: dto.dashboardId,
      },
    });

    return { card, widget };
  }

  /**
   * Places a card as a new widget on a dashboard page.
   * The widget is added at the bottom of the current layout.
   */
  private async placeOnDashboard(
    cardId: string,
    pageId: string,
    orgId: string,
    creator: SafeAccount,
  ) {
    // Find the next available Y position
    const maxY = await this.db.queryOne<{ max_y: number }>(
      `SELECT COALESCE(MAX(grid_y + grid_h), 0) AS max_y
       FROM dashboard_widgets_v2
       WHERE page_id = $1 AND deleted_at IS NULL`,
      [pageId],
    );

    // Load the card to determine default widget type
    const card = await this.db.queryOne<{ chart_type: string; query_definition: unknown; query_language: string }>(
      `SELECT chart_type, query_definition, query_language FROM analytics_cards WHERE id = $1`,
      [cardId],
    );

    const widget = await this.db.queryOne(
      `INSERT INTO dashboard_widgets_v2
         (page_id, card_id, widget_type, grid_x, grid_y, grid_w, grid_h,
          query_definition, query_language, created_by, updated_by)
       VALUES ($1, $2, $3::widget_type, 0, $4, 6, 4, $5, $6, $7, $7)
       RETURNING *`,
      [
        pageId, cardId,
        card?.chart_type || 'table',
        maxY?.max_y || 0,
        JSON.stringify(card?.query_definition || {}),
        card?.query_language || 'sql',
        creator.id,
      ],
    );

    // Record card-widget placement
    await this.db.query(
      `INSERT INTO widget_card_placements (widget_id, card_id, card_version, pinned_version, added_by)
       SELECT $1, $2, current_version, FALSE, $3 FROM analytics_cards WHERE id = $2`,
      [widget!.id, cardId, creator.id],
    );

    return widget;
  }

  /** Get promotion history for a chat */
  async listPromotions(chatId: string, orgId: string, requesterId: string) {
    await this.orgPermissions.requireMember(orgId, requesterId);
    return this.db.queryMany(
      `SELECT p.*, c.name AS card_name, c.status AS card_status, c.chart_type,
              a.display_name AS promoted_by_name
       FROM chat_card_promotions p
       JOIN analytics_cards c ON c.id = p.card_id
       JOIN accounts a ON a.id = p.promoted_by
       WHERE p.chat_id = $1 AND p.org_id = $2
       ORDER BY p.promoted_at DESC`,
      [chatId, orgId],
    );
  }
}
