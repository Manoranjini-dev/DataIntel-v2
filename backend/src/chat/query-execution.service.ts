// ──────────────────────────────────────────────
// Query Execution Service — Records every query lifecycle
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { SafeAccount } from '../auth/auth.service';

export type ExecutionStatus = 'pending' | 'running' | 'success' | 'failed' | 'timeout' | 'cancelled';

export interface CreateExecutionParams {
  orgId: string;
  chatId?: string;
  messageId?: string;
  connectionId?: string;
  comboId?: string;
  executedBy: string;
  prompt?: string;
  generatedQuery: string;
  queryExplanation?: string;
  tablesUsed?: string[];
  confidence?: number;
  validationVerdict?: string;
  validationReasons?: string[];
}

export interface CompleteExecutionParams {
  status: ExecutionStatus;
  executionTimeMs?: number;
  rowCount?: number;
  totalHits?: number;
  resultPreview?: any[];
  resultColumns?: string[];
  errorMessage?: string;
  errorCode?: string;
  insight?: string;
  subQueries?: any;
}

@Injectable()
export class QueryExecutionService {
  private readonly logger = new Logger(QueryExecutionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Create an execution record in 'pending' state */
  async create(params: CreateExecutionParams) {
    const exec = await this.db.queryOne(
      `INSERT INTO query_executions
         (org_id, chat_id, message_id, connection_id, combo_id, executed_by,
          prompt, generated_query, query_explanation, tables_used,
          confidence, validation_verdict, validation_reasons, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')
       RETURNING *`,
      [
        params.orgId,
        params.chatId || null,
        params.messageId || null,
        params.connectionId || null,
        params.comboId || null,
        params.executedBy,
        params.prompt || null,
        params.generatedQuery,
        params.queryExplanation || null,
        params.tablesUsed || null,
        params.confidence || null,
        params.validationVerdict || null,
        params.validationReasons || null,
      ],
    );

    await this.audit.log({
      orgId: params.orgId,
      accountId: params.executedBy,
      eventType: 'query_generated',
      resourceType: 'query_execution',
      resourceId: exec!.id,
      details: { prompt: params.prompt, tablesUsed: params.tablesUsed },
    });

    return exec;
  }

  /** Mark execution as running */
  async markRunning(execId: string) {
    return this.db.queryOne(
      `UPDATE query_executions SET status = 'running' WHERE id = $1 RETURNING *`,
      [execId],
    );
  }

  /** Complete an execution with results or error */
  async complete(execId: string, orgId: string, accountId: string, params: CompleteExecutionParams) {
    const exec = await this.db.queryOne(
      `UPDATE query_executions SET
         status = $2,
         execution_time_ms = $3,
         row_count = $4,
         total_hits = $5,
         result_preview = $6,
         result_columns = $7,
         error_message = $8,
         error_code = $9,
         insight = $10,
         sub_queries = $11,
         completed_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        execId, params.status,
        params.executionTimeMs || null,
        params.rowCount || null,
        params.totalHits || null,
        params.resultPreview ? JSON.stringify(params.resultPreview) : null,
        params.resultColumns || null,
        params.errorMessage || null,
        params.errorCode || null,
        params.insight || null,
        params.subQueries ? JSON.stringify(params.subQueries) : null,
      ],
    );

    const eventType = params.status === 'success' ? 'query_executed' : 'query_failed';
    await this.audit.log({
      orgId, accountId,
      eventType,
      resourceType: 'query_execution',
      resourceId: execId,
      details: {
        status: params.status,
        executionTimeMs: params.executionTimeMs,
        rowCount: params.rowCount,
        error: params.errorMessage,
      },
    });

    return exec;
  }

  /** Get execution history for a chat */
  async getByChatId(chatId: string, limit = 50) {
    return this.db.queryMany(
      `SELECT * FROM query_executions WHERE chat_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [chatId, limit],
    );
  }

  /** Get execution history for an org with filters */
  async getByOrg(
    orgId: string,
    filter: { connectionId?: string; accountId?: string; limit?: number; offset?: number } = {},
  ) {
    const { limit = 100, offset = 0 } = filter;
    const params: any[] = [orgId];
    let sql = `SELECT qe.*, a.display_name AS executor_name, a.email AS executor_email
               FROM query_executions qe
               JOIN accounts a ON a.id = qe.executed_by
               WHERE qe.org_id = $1`;

    if (filter.connectionId) {
      params.push(filter.connectionId);
      sql += ` AND qe.connection_id = $${params.length}`;
    }
    if (filter.accountId) {
      params.push(filter.accountId);
      sql += ` AND qe.executed_by = $${params.length}`;
    }

    params.push(limit, offset);
    sql += ` ORDER BY qe.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    return this.db.queryMany(sql, params);
  }

  /** Get performance stats for a connection */
  async getConnectionStats(connectionId: string) {
    return this.db.queryOne(
      `SELECT
         COUNT(*) AS total_queries,
         COUNT(*) FILTER (WHERE status = 'success') AS successful,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed,
         AVG(execution_time_ms) FILTER (WHERE status = 'success') AS avg_time_ms,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms)
           FILTER (WHERE status = 'success') AS p95_time_ms,
         MAX(execution_time_ms) AS max_time_ms
       FROM query_executions
       WHERE connection_id = $1`,
      [connectionId],
    );
  }
}
