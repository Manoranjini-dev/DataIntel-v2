// ──────────────────────────────────────────────
// Chat Service — Persistent chat threads & messages
// ──────────────────────────────────────────────

import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { SafeAccount } from '../auth/auth.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** List chats owned by the requester, optionally filtered by connection or combo */
  async list(
    accountId: string,
    filter: { connectionId?: string; comboId?: string; isArchived?: boolean } = {},
  ) {
    let sql = `SELECT c.*, COUNT(m.id) AS message_count
               FROM chats c
               LEFT JOIN chat_messages m ON m.chat_id = c.id
               WHERE c.created_by = $1 AND c.deleted_at IS NULL`;
    const params: any[] = [accountId];

    if (filter.isArchived !== undefined) {
      params.push(filter.isArchived);
      sql += ` AND c.is_archived = $${params.length}`;
    } else {
      sql += ` AND c.is_archived = false`;
    }

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
    user: SafeAccount,
    data: { connectionId?: string; comboId?: string; title?: string },
  ) {
    if (!data.connectionId && !data.comboId) {
      throw new ForbiddenException('Chat must be scoped to a connection or combo');
    }

    const chat = await this.db.queryOne(
      `INSERT INTO chats (connection_id, combo_id, title, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.connectionId || null, data.comboId || null,
       data.title || 'New Chat', user.id],
    );

    await this.audit.log({
      accountId: user.id,
      eventType: 'chat_created',
      resourceType: 'chat', resourceId: chat!.id,
    });

    return chat;
  }

  /** Get a single chat with messages */
  async get(chatId: string, accountId: string) {
    const chat = await this.db.queryOne<any>(
      'SELECT * FROM chats WHERE id = $1 AND deleted_at IS NULL',
      [chatId],
    );
    if (!chat) throw new NotFoundException('Chat not found');
    if (chat.created_by !== accountId) {
      throw new ForbiddenException('You do not have access to this chat');
    }
    return chat;
  }

  /** Get messages for a chat */
  async getMessages(chatId: string, accountId: string) {
    await this.get(chatId, accountId);
    const messages = await this.db.queryMany<any>(
      `SELECT m.*, qe.generated_query, qe.status AS exec_status,
              qe.row_count, qe.execution_time_ms, qe.error_message,
              qe.result_preview, qe.result_columns, qe.insight
       FROM chat_messages m
       LEFT JOIN query_executions qe ON qe.id = m.execution_id
       WHERE m.chat_id = $1
       ORDER BY m.created_at ASC`,
      [chatId],
    );

    return messages.map((m) => {
      let followUpQuestions: string[] | undefined;
      if (m.follow_up_questions) {
        try {
          followUpQuestions = typeof m.follow_up_questions === 'string'
            ? JSON.parse(m.follow_up_questions)
            : m.follow_up_questions;
        } catch {
          followUpQuestions = undefined;
        }
      }
      return {
        ...m,
        followUpQuestions: Array.isArray(followUpQuestions) ? followUpQuestions : undefined,
      };
    });
  }

  /** Add a message to a chat */
  async addMessage(
    chatId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    executionId?: string,
    uiHint?: string,
    followUpQuestions?: string[] | null,
  ) {
    const msg = await this.db.queryOne(
      `INSERT INTO chat_messages (chat_id, role, content, execution_id, ui_hint, follow_up_questions)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        chatId,
        role,
        content,
        executionId || null,
        uiHint || null,
        followUpQuestions && followUpQuestions.length > 0 ? JSON.stringify(followUpQuestions) : null,
      ],
    );

    // Update chat's updated_at
    await this.db.query(
      'UPDATE chats SET updated_at = NOW() WHERE id = $1',
      [chatId],
    );

    return msg;
  }

  /** Update follow-up questions for a specific message */
  async updateFollowUps(messageId: string, followUpQuestions: string[]) {
    await this.db.query(
      'UPDATE chat_messages SET follow_up_questions = $2 WHERE id = $1',
      [
        messageId,
        followUpQuestions && followUpQuestions.length > 0 ? JSON.stringify(followUpQuestions) : null,
      ],
    );
  }

  /** Archive a chat */
  async archive(chatId: string, user: SafeAccount) {
    await this.get(chatId, user.id);

    await this.db.query(
      'UPDATE chats SET is_archived = true, updated_at = NOW() WHERE id = $1',
      [chatId],
    );

    await this.audit.log({
      accountId: user.id,
      eventType: 'chat_archived',
      resourceType: 'chat', resourceId: chatId,
    });
  }

  /** Unarchive a chat */
  async unarchive(chatId: string, user: SafeAccount) {
    await this.get(chatId, user.id);

    await this.db.query(
      'UPDATE chats SET is_archived = false, updated_at = NOW() WHERE id = $1',
      [chatId],
    );

    await this.audit.log({
      accountId: user.id,
      eventType: 'chat_unarchived',
      resourceType: 'chat', resourceId: chatId,
    });
  }

  /** Delete a chat (soft-delete) */
  async delete(chatId: string, user: SafeAccount) {
    await this.get(chatId, user.id);

    await this.db.query(
      'UPDATE chats SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
      [chatId],
    );

    await this.audit.log({
      accountId: user.id,
      eventType: 'chat_deleted',
      resourceType: 'chat', resourceId: chatId,
    });
  }

  /** Update chat title */
  async updateTitle(chatId: string, accountId: string, title: string) {
    await this.get(chatId, accountId);
    return this.db.queryOne(
      'UPDATE chats SET title = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
      [chatId, title],
    );
  }
}
