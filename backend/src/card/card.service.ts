// ──────────────────────────────────────────────
// Analytics Card Service — Core CRUD + version management
// ──────────────────────────────────────────────

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { SafeAccount } from '../auth/auth.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface CreateCardDto {
  name: string;
  description?: string;
  folderId?: string;
  datasourceContextType: 'connection' | 'combo';
  datasourceContextId: string;
  queryDefinition: Record<string, unknown>;
  rawQuery?: string;
  queryLanguage?: string;
  chartType?: string;
  visualizationConfig?: Record<string, unknown>;
  visibility?: 'private' | 'org_shared' | 'public';
  tags?: string[];
}

export interface UpdateCardDto {
  name?: string;
  description?: string;
  folderId?: string;
  queryDefinition?: Record<string, unknown>;
  rawQuery?: string;
  queryLanguage?: string;
  chartType?: string;
  visualizationConfig?: Record<string, unknown>;
  visibility?: 'private' | 'org_shared' | 'public';
  tags?: string[];
  changeSummary?: string;
}

export interface CardListOptions {
  folderId?: string;
  tags?: string[];
  visibility?: string;
  status?: string;
  datasourceContextType?: string;
  datasourceContextId?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'updated_at' | 'created_at' | 'name';
  sortDir?: 'asc' | 'desc';
}

@Injectable()
export class CardService {
  private readonly logger = new Logger(CardService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  async list(requesterId: string, opts: CardListOptions = {}) {
    const {
      folderId,
      tags,
      visibility,
      status,
      datasourceContextType,
      datasourceContextId,
      search,
      limit = 50,
      offset = 0,
      sortBy = 'updated_at',
      sortDir = 'desc',
    } = opts;

    const conditions: string[] = ['c.created_by = $1', 'c.deleted_at IS NULL'];
    const params: unknown[] = [requesterId];
    let p = 2;

    if (folderId) {
      conditions.push(`c.folder_id = $${p++}`);
      params.push(folderId);
    }
    if (visibility) {
      conditions.push(`c.visibility = $${p++}`);
      params.push(visibility);
    }
    if (status) {
      conditions.push(`c.status = $${p++}`);
      params.push(status);
    }
    if (datasourceContextType) {
      conditions.push(`c.datasource_context_type = $${p++}`);
      params.push(datasourceContextType);
    }
    if (datasourceContextId) {
      conditions.push(`c.datasource_context_id = $${p++}`);
      params.push(datasourceContextId);
    }
    if (tags && tags.length > 0) {
      conditions.push(`c.tags && $${p++}::text[]`);
      params.push(tags);
    }
    if (search) {
      conditions.push(`(c.name ILIKE $${p} OR c.description ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }

    const allowedSortCols = { updated_at: 'c.updated_at', created_at: 'c.created_at', name: 'c.name' };
    const orderClause = `${allowedSortCols[sortBy]} ${sortDir === 'asc' ? 'ASC' : 'DESC'}`;

    params.push(limit, offset);
    const query = `
      SELECT
        c.*,
        a.display_name AS created_by_name,
        a.avatar_url AS created_by_avatar,
        cf.name AS folder_name,
        qe.result_preview AS last_result_preview,
        qe.result_columns AS last_result_columns
      FROM analytics_cards c
      JOIN accounts a ON a.id = c.created_by
      LEFT JOIN card_folders cf ON cf.id = c.folder_id AND cf.deleted_at IS NULL
      LEFT JOIN query_executions qe ON qe.id = c.last_execution_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderClause}
      LIMIT $${p} OFFSET $${p + 1}
    `;

    const [rows, countRow] = await Promise.all([
      this.db.queryMany(query, params),
      this.db.queryOne<{ count: string }>(
        `SELECT COUNT(*) FROM analytics_cards c WHERE ${conditions.join(' AND ')}`,
        params.slice(0, -2),
      ),
    ]);

    return { cards: rows, total: parseInt(countRow?.count || '0', 10) };
  }

  /** Fetch a card and verify the requester owns it */
  private async requireOwnedCard(cardId: string, requesterId: string) {
    const card = await this.db.queryOne<{ id: string; created_by: string }>(
      `SELECT id, created_by FROM analytics_cards WHERE id = $1 AND deleted_at IS NULL`,
      [cardId],
    );
    if (!card) throw new NotFoundException('Card not found');
    if (card.created_by !== requesterId) {
      throw new ForbiddenException('You do not have access to this card');
    }
    return card;
  }

  async getById(cardId: string, requesterId: string) {
    await this.requireOwnedCard(cardId, requesterId);
    const card = await this.db.queryOne(
      `SELECT c.*, a.display_name AS created_by_name
       FROM analytics_cards c
       JOIN accounts a ON a.id = c.created_by
       WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [cardId],
    );
    if (!card) throw new NotFoundException('Card not found');
    return card;
  }

  async create(creator: SafeAccount, dto: CreateCardDto) {
    const card = await this.db.transaction(async (query) => {
      // Create the card
      const result = await query(
        `INSERT INTO analytics_cards
           (folder_id, name, description,
            datasource_context_type, datasource_context_id,
            query_definition, raw_query, query_language,
            chart_type, visualization_config, visibility, tags,
            created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
         RETURNING *`,
        [
          dto.folderId || null,
          dto.name,
          dto.description || null,
          dto.datasourceContextType,
          dto.datasourceContextId,
          JSON.stringify(dto.queryDefinition),
          dto.rawQuery || null,
          dto.queryLanguage || 'sql',
          dto.chartType || 'table',
          JSON.stringify(dto.visualizationConfig || {}),
          dto.visibility || 'private',
          dto.tags || [],
          creator.id,
        ],
      );
      const card = result.rows[0];

      // Create version 1
      await query(
        `INSERT INTO analytics_card_versions
           (card_id, version, query_definition, raw_query, chart_type,
            visualization_config, query_language, created_by)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
        [
          card.id,
          JSON.stringify(dto.queryDefinition),
          dto.rawQuery || null,
          dto.chartType || 'table',
          JSON.stringify(dto.visualizationConfig || {}),
          dto.queryLanguage || 'sql',
          creator.id,
        ],
      );

      return card;
    });

    await this.audit.log({
      accountId: creator.id,
      eventType: 'card_created',
      resourceType: 'card',
      resourceId: card.id,
      details: { name: card.name },
    });

    return card;
  }

  async update(cardId: string, updater: SafeAccount, dto: UpdateCardDto) {
    const existing = await this.requireOwnedCard(cardId, updater.id);

    const full = await this.db.queryOne<{
      id: string;
      current_version: number;
      query_definition: Record<string, unknown>;
      raw_query: string;
      chart_type: string;
      visualization_config: Record<string, unknown>;
      query_language: string;
    }>(
      `SELECT id, current_version, query_definition, raw_query, chart_type, visualization_config, query_language
       FROM analytics_cards WHERE id = $1 AND deleted_at IS NULL`,
      [existing.id],
    );
    if (!full) throw new NotFoundException('Card not found');

    const newVersion = full.current_version + 1;

    const card = await this.db.transaction(async (query) => {
      // Update the card
      const result = await query(
        `UPDATE analytics_cards
         SET name                    = COALESCE($2, name),
             description             = COALESCE($3, description),
             folder_id               = COALESCE($4, folder_id),
             query_definition        = CASE WHEN $5::jsonb IS NULL THEN query_definition ELSE $5::jsonb END,
             raw_query               = COALESCE($6, raw_query),
             query_language          = COALESCE($7, query_language),
             chart_type              = COALESCE($8::chart_type, chart_type),
             visualization_config    = CASE WHEN $9::jsonb IS NULL THEN visualization_config ELSE $9::jsonb END,
             visibility              = COALESCE($10::card_visibility, visibility),
             tags                    = COALESCE($11, tags),
             current_version         = $12,
             status                  = 'draft',
             updated_by              = $13,
             updated_at              = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          cardId,
          dto.name || null,
          dto.description !== undefined ? dto.description : null,
          dto.folderId || null,
          dto.queryDefinition ? JSON.stringify(dto.queryDefinition) : null,
          dto.rawQuery || null,
          dto.queryLanguage || null,
          dto.chartType || null,
          dto.visualizationConfig ? JSON.stringify(dto.visualizationConfig) : null,
          dto.visibility || null,
          dto.tags || null,
          newVersion,
          updater.id,
        ],
      );
      const updated = result.rows[0];

      // Snapshot new version
      await query(
        `INSERT INTO analytics_card_versions
           (card_id, version, query_definition, raw_query, chart_type,
            visualization_config, query_language, change_summary, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          cardId,
          newVersion,
          JSON.stringify(dto.queryDefinition || full.query_definition),
          dto.rawQuery !== undefined ? dto.rawQuery : full.raw_query,
          dto.chartType || full.chart_type,
          JSON.stringify(dto.visualizationConfig || full.visualization_config),
          dto.queryLanguage || full.query_language,
          dto.changeSummary || null,
          updater.id,
        ],
      );

      return updated;
    });

    await this.audit.log({
      accountId: updater.id,
      eventType: 'card_updated',
      resourceType: 'card',
      resourceId: cardId,
      details: { version: newVersion, changeSummary: dto.changeSummary },
    });

    return card;
  }

  async publish(cardId: string, publisher: SafeAccount) {
    const card = await this.requireOwnedCard(cardId, publisher.id);

    const full = await this.db.queryOne<{ id: string; current_version: number; status: string }>(
      `SELECT id, current_version, status FROM analytics_cards
       WHERE id = $1 AND deleted_at IS NULL`,
      [card.id],
    );
    if (!full) throw new NotFoundException('Card not found');

    await this.db.transaction(async (query) => {
      await query(
        `UPDATE analytics_cards SET status = 'published', updated_at = NOW(), updated_by = $2
         WHERE id = $1`,
        [cardId, publisher.id],
      );
      await query(
        `UPDATE analytics_card_versions
         SET published_at = NOW(), published_by = $2
         WHERE card_id = $1 AND version = $3`,
        [cardId, publisher.id, full.current_version],
      );
    });

    // Invalidate all widget caches that use this card
    this.events.emit('card.published', { cardId });

    await this.audit.log({
      accountId: publisher.id,
      eventType: 'card_published',
      resourceType: 'card',
      resourceId: cardId,
      details: { version: full.current_version },
    });

    return this.getById(cardId, publisher.id);
  }

  async rollback(cardId: string, roller: SafeAccount, targetVersion: number) {
    const card = await this.requireOwnedCard(cardId, roller.id);

    const version = await this.db.queryOne<{
      query_definition: unknown;
      raw_query: string;
      chart_type: string;
      visualization_config: unknown;
      query_language: string;
    }>(
      `SELECT query_definition, raw_query, chart_type, visualization_config, query_language
       FROM analytics_card_versions WHERE card_id = $1 AND version = $2`,
      [cardId, targetVersion],
    );
    if (!version) throw new NotFoundException(`Version ${targetVersion} not found`);

    const existing = await this.db.queryOne<{ current_version: number }>(
      `SELECT current_version FROM analytics_cards WHERE id = $1 AND deleted_at IS NULL`,
      [card.id],
    );
    if (!existing) throw new NotFoundException('Card not found');

    const newVersion = existing.current_version + 1;

    await this.db.transaction(async (query) => {
      await query(
        `UPDATE analytics_cards
         SET query_definition     = $2,
             raw_query            = $3,
             chart_type           = $4::chart_type,
             visualization_config = $5,
             query_language       = $6,
             current_version      = $7,
             status               = 'draft',
             updated_by           = $8,
             updated_at           = NOW()
         WHERE id = $1`,
        [
          cardId,
          JSON.stringify(version.query_definition),
          version.raw_query,
          version.chart_type,
          JSON.stringify(version.visualization_config),
          version.query_language,
          newVersion,
          roller.id,
        ],
      );

      await query(
        `INSERT INTO analytics_card_versions
           (card_id, version, query_definition, raw_query, chart_type,
            visualization_config, query_language, change_summary, is_rollback, rollback_from_version, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, $10)`,
        [
          cardId, newVersion,
          JSON.stringify(version.query_definition),
          version.raw_query,
          version.chart_type,
          JSON.stringify(version.visualization_config),
          version.query_language,
          `Rolled back to version ${targetVersion}`,
          targetVersion,
          roller.id,
        ],
      );
    });

    await this.audit.log({
      accountId: roller.id,
      eventType: 'card_version_rollback',
      resourceType: 'card',
      resourceId: cardId,
      details: { fromVersion: existing.current_version, toVersion: targetVersion, newVersion },
    });

    return this.getById(cardId, roller.id);
  }

  async softDelete(cardId: string, deleter: SafeAccount) {
    await this.requireOwnedCard(cardId, deleter.id);
    await this.db.query(
      `UPDATE analytics_cards SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [cardId, deleter.id],
    );
    await this.audit.log({
      accountId: deleter.id,
      eventType: 'card_deleted',
      resourceType: 'card',
      resourceId: cardId,
    });
  }

  async listVersions(cardId: string, requesterId: string) {
    await this.requireOwnedCard(cardId, requesterId);
    return this.db.queryMany(
      `SELECT v.*, a.display_name AS created_by_name
       FROM analytics_card_versions v
       JOIN accounts a ON a.id = v.created_by
       WHERE v.card_id = $1
       ORDER BY v.version DESC`,
      [cardId],
    );
  }
}
