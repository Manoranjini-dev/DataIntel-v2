// ──────────────────────────────────────────────
// Widget Execution Service — Synchronous and queue-based execution
// ──────────────────────────────────────────────

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

import { SafeAccount } from '../auth/auth.service';
import { DashboardCacheService } from './dashboard-cache.service';
import { MCPService } from '../mcp/mcp.service';
import { LLMService } from '../llm/llm.service';
import { PromptBuilderService } from '../llm/prompt-builder.service';
import { ConnectorType } from '../common/types';
import { decrypt } from '../common/utils/encryption';
import { ComboService } from '../combo/combo.service';

@Injectable()
export class WidgetExecutionService {
  private readonly logger = new Logger(WidgetExecutionService.name);

  private readonly encKey: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly cache: DashboardCacheService,
    private readonly mcp: MCPService,
    private readonly llm: LLMService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly config: ConfigService,
    private readonly comboService: ComboService,
  ) {
    this.encKey = this.config.getOrThrow('CREDENTIAL_ENCRYPTION_KEY');
  }

  /**
   * Execute widget query synchronously (for interactive UI loads).
   * Fallback to queue if timeout occurs.
   */
  async executeSync(widgetId: string, orgId: string, user: SafeAccount, forceRefresh = false) {
    // 1. Check cache if not forced
    if (!forceRefresh) {
      const cached = await this.cache.getCachedWidgetResult(widgetId);
      if (cached) {
        return { ...cached, isCached: true };
      }
    }

    // 2. Fetch widget config with dashboard context columns
    const widget = await this.db.queryOne(
      `SELECT w.*, d.id as dash_id, d.context_type as dash_context_type, d.context_id as dash_context_id
       FROM dashboard_widgets_v2 w
       JOIN dashboard_pages p ON p.id = w.page_id
       JOIN dashboards d ON d.id = p.dashboard_id
       WHERE w.id = $1 AND w.deleted_at IS NULL AND d.org_id = $2`,
      [widgetId, orgId],
    );
    if (!widget) throw new NotFoundException('Widget not found');

    // 3. Stampede prevention
    const lockAcquired = await this.cache.acquireWidgetExecutionLock(widgetId, 30000);
    if (!lockAcquired) {
      // If someone else is refreshing, we can either wait or just queue this request
      // Let's queue it so we don't block the UI indefinitely
      await this.dispatchToQueue(widgetId, orgId, user);
      return { status: 'queued', message: 'Widget is currently refreshing, queued for update' };
    }

    try {
      // 4. Log execution start
      const execRecord = await this.db.queryOne(
        `INSERT INTO widget_executions
           (widget_id, org_id, dashboard_id, triggered_by, account_id, status)
         VALUES ($1, $2, $3, $4, $5, 'running')
         RETURNING id`,
        [widgetId, orgId, widget.dash_id, forceRefresh ? 'manual' : 'refresh', user.id],
      );

      // 5. Resolve datasource context (override -> card -> dashboard fallback)
      let contextType = widget.datasource_context_type;
      let contextId = widget.datasource_context_id;

      // Fallback to linked card context if present
      if (!contextId && widget.card_id) {
        const card = await this.db.queryOne<any>(
          'SELECT * FROM analytics_cards WHERE id = $1 AND deleted_at IS NULL',
          [widget.card_id],
        );
        if (card) {
          contextType = card.datasource_context_type;
          contextId = card.datasource_context_id;
        }
      }

      // Fallback to dashboard context if still empty
      if (!contextId) {
        contextType = widget.dash_context_type;
        contextId = widget.dash_context_id;
      }

      if (!contextId) {
        throw new Error('Widget context connection not found');
      }

      const start = Date.now();
      let rows: any[] = [];
      let columns: any[] = [];

      if (contextType === 'combo') {
        // Run combo execution
        const comboResult = await this.comboService.executeQuery(
          orgId,
          contextId,
          user,
          widget.prompt || widget.title,
        );
        rows = comboResult.rows || [];
        columns = comboResult.columns || [];
      } else {
        // Run single connection execution
        const conn = await this.db.queryOne<any>(
          'SELECT * FROM datasource_connections WHERE id = $1',
          [contextId],
        );
        if (!conn) throw new Error('Widget connection not found');

        const password = decrypt(conn.encrypted_password, this.encKey);
        const session = await this.mcp.createSession({
          host: conn.host,
          port: conn.port,
          username: conn.username,
          password,
          database: conn.database_name,
          connectorType: conn.connector_type as ConnectorType,
        });

        try {
          const schemaContext = await this.buildSchemaContext(conn.id);
          const llmContext = this.promptBuilder.assembleContext({
            compressedSchema: schemaContext,
            conversationSummary: null,
            recentMessages: [],
            userPrompt: widget.prompt || widget.title,
            connectorFamily: conn.connector_type === 'elasticsearch' ? 'elasticsearch' : conn.connector_type === 'mongodb' ? 'document' : 'sql',
          });
          const llmResponse = await this.llm.generateSQL(llmContext);
          const mcpResult = await this.mcp.executeReadQuery(session.sessionId, llmResponse.sql);
          if (!mcpResult.success) throw new Error(mcpResult.error || 'Widget query failed');
          rows = mcpResult.data?.rows || [];
          columns = mcpResult.data?.columns || [];
        } finally {
          await this.mcp.destroySession(session.sessionId).catch(() => {});
        }
      }

      const execTime = Date.now() - start;
      const result = { rows, columns, executionTimeMs: execTime, status: 'success' };

      // 6. Cache the result
      await this.cache.setCachedWidgetResult(widgetId, result, widget.cache_ttl_sec || 300);

      // 7. Update execution log
      await this.db.query(
        `UPDATE widget_executions SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [execRecord!.id],
      );

      return { ...result, isCached: false };

    } catch (e: any) {
      this.logger.error(`Failed to execute widget ${widgetId}`, e.stack);
      
      // Update execution log
      await this.db.query(
        `UPDATE widget_executions SET status = 'failed', completed_at = NOW() WHERE widget_id = $1 AND status = 'running'`,
        [widgetId],
      );
      
      throw e;
    } finally {
      // 8. Release lock
      await this.cache.releaseWidgetExecutionLock(widgetId);
    }
  }

  /**
   * Dispatch widget execution to background queue
   */
  async dispatchToQueue(widgetId: string, orgId: string, user?: SafeAccount) {
    // Execute asynchronously instead of BullMQ
    setTimeout(() => {
      this.executeSync(widgetId, orgId, user || { id: 'system' } as SafeAccount, true)
        .catch(err => this.logger.error(`Widget refresh failed for ${widgetId}`, err));
    }, 100);
    return { status: 'queued' };
  }

  private async buildSchemaContext(connectionId: string): Promise<string> {
    const tables = await this.db.queryMany<any>(
      `SELECT ct.table_name, string_agg(
         cc.column_name || ' ' || cc.data_type ||
         CASE WHEN cc.is_primary_key THEN ' PK' ELSE '' END ||
         CASE WHEN NOT cc.is_nullable THEN ' NOT NULL' ELSE '' END,
         ', ' ORDER BY cc.ordinal_position
       ) AS columns
       FROM connection_schemas cs
       JOIN connection_tables ct ON ct.schema_id = cs.id
       JOIN connection_columns cc ON cc.table_id = ct.id
       WHERE cs.connection_id = $1
       GROUP BY ct.table_name
       ORDER BY ct.table_name`,
      [connectionId],
    );
    if (!tables.length) return '-- No schema available';
    return tables.map((t: any) => `${t.table_name}(${t.columns})`).join('\n');
  }
}
