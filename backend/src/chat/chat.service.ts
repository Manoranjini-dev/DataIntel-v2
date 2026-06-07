// ──────────────────────────────────────────────
// Chat Service — Persistent chat threads & messages
// ──────────────────────────────────────────────

import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OrgService } from '../org/org.service';
import { SafeAccount } from '../auth/auth.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orgService: OrgService,
  ) {}

  /** List chats for an org, optionally filtered by connection or combo */
  async list(
    orgId: string,
    accountId: string,
    filter: { connectionId?: string; comboId?: string } = {},
  ) {
    await this.orgService.requireMember(orgId, accountId);

    let sql = `SELECT c.*, COUNT(m.id) AS message_count
               FROM chats c
               LEFT JOIN chat_messages m ON m.chat_id = c.id
               WHERE c.org_id = $1 AND c.created_by = $2 AND c.is_archived = false`;
    const params: any[] = [orgId, accountId];

    if (filter.connectionId) {
      params.push(filter.connectionId);
      sql += ` AND c.connection_id = $${params.length}`;
    }
    if (filter.comboId) {
      params.push(filter.comboId);
      sql += ` AND c.combo_id = $${params.length}`;
    }

    sql += ' GROUP BY c.id ORDER BY c.updated_at DESC';
    return this.db.queryMany(sql, params);
  }

  /** Create a new chat thread */
  async create(
    orgId: string,
    user: SafeAccount,
    data: { connectionId?: string; comboId?: string; title?: string },
  ) {
    await this.orgService.requireMember(orgId, user.id);

    if (!data.connectionId && !data.comboId) {
      throw new ForbiddenException('Chat must be scoped to a connection or combo');
    }

    const chat = await this.db.queryOne(
      `INSERT INTO chats (org_id, connection_id, combo_id, title, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [orgId, data.connectionId || null, data.comboId || null,
       data.title || 'New Chat', user.id],
    );

    await this.audit.log({
      orgId, accountId: user.id,
      eventType: 'chat_created',
      resourceType: 'chat', resourceId: chat!.id,
    });

    return chat;
  }

  /** Get a single chat with messages */
  async get(orgId: string, chatId: string, accountId: string) {
    await this.orgService.requireMember(orgId, accountId);

    const chat = await this.db.queryOne(
      'SELECT * FROM chats WHERE id = $1 AND org_id = $2',
      [chatId, orgId],
    );
    if (!chat) throw new NotFoundException('Chat not found');
    return chat;
  }

  /** Get messages for a chat */
  async getMessages(orgId: string, chatId: string, accountId: string) {
    await this.get(orgId, chatId, accountId);
    return this.db.queryMany(
      `SELECT m.*, qe.generated_query, qe.status AS exec_status,
              qe.row_count, qe.execution_time_ms, qe.error_message,
              qe.result_preview, qe.result_columns, qe.insight
       FROM chat_messages m
       LEFT JOIN query_executions qe ON qe.id = m.execution_id
       WHERE m.chat_id = $1
       ORDER BY m.created_at ASC`,
      [chatId],
    );
  }

  /** Add a message to a chat */
  async addMessage(
    chatId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    executionId?: string,
    uiHint?: string,
  ) {
    const msg = await this.db.queryOne(
      `INSERT INTO chat_messages (chat_id, role, content, execution_id, ui_hint)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [chatId, role, content, executionId || null, uiHint || null],
    );

    // Update chat's updated_at
    await this.db.query(
      'UPDATE chats SET updated_at = NOW() WHERE id = $1',
      [chatId],
    );

    return msg;
  }

  /** Archive a chat */
  async archive(orgId: string, chatId: string, user: SafeAccount) {
    const chat = await this.get(orgId, chatId, user.id);
    if ((chat as any).created_by !== user.id) {
      await this.orgService.requireRole(orgId, user.id, 'admin');
    }

    await this.db.query(
      'UPDATE chats SET is_archived = true, updated_at = NOW() WHERE id = $1',
      [chatId],
    );

    await this.audit.log({
      orgId, accountId: user.id,
      eventType: 'chat_archived',
      resourceType: 'chat', resourceId: chatId,
    });
  }

  /** Update chat title */
  async updateTitle(orgId: string, chatId: string, accountId: string, title: string) {
    await this.get(orgId, chatId, accountId);
    return this.db.queryOne(
      'UPDATE chats SET title = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
      [chatId, title],
    );
  }
}
