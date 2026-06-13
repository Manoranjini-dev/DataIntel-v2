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
           (widget_id, org_id, dashboard_id, page_id, triggered_by, account_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'running')
         RETURNING id`,
        [widgetId, orgId, widget.dash_id, widget.page_id, forceRefresh ? 'manual' : 'refresh', user.id],
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

      // Resolve the natural-language prompt: the analytical question stored in
      // query_definition.prompt. Empty drag-and-drop widgets have no prompt and
      // must NOT be auto-executed — bail out instead of fabricating a chart.
      const queryPrompt = this.resolveWidgetPrompt(widget);
      if (!queryPrompt) {
        // No query to run — the outer catch marks this execution failed.
        throw new Error('Widget has no query to execute — generate one in the widget editor first.');
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
          queryPrompt,
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
          let validationFeedback: string | undefined = undefined;
          let mcpResult: any;
          let llmResponse: any;

          for (let attempt = 1; attempt <= 3; attempt++) {
            const llmContext = this.promptBuilder.assembleContext({
              compressedSchema: schemaContext,
              conversationSummary: null,
              recentMessages: [],
              userPrompt: queryPrompt,
              connectorFamily: conn.connector_type === 'elasticsearch' ? 'elasticsearch' : conn.connector_type === 'mongodb' ? 'document' : 'sql',
            });
            if (validationFeedback) {
              llmContext.validationFeedback = validationFeedback;
            }

            llmResponse = await this.llm.generateSQL(llmContext);
            mcpResult = await this.mcp.executeReadQuery(session.sessionId, llmResponse.sql);

            if (mcpResult.success) {
              break;
            }

            this.logger.warn(`Widget query attempt ${attempt} failed: ${mcpResult.error}`);
            validationFeedback = mcpResult.error || 'Query failed';
          }

          if (!mcpResult.success) throw new Error(mcpResult.error || 'Widget query failed after retries');
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
        `UPDATE widget_executions SET status = 'success', completed_at = NOW() WHERE id = $1`,
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

  /**
   * AI assist — rephrase a user's analytics question into a clearer, more
   * specific analytical request that a text-to-SQL engine can answer well.
   * Pure LLM rewrite: does NOT execute anything. Returns the original prompt
   * unchanged if the LLM is unavailable.
   */
  async improvePrompt(rawPrompt: string): Promise<string> {
    const cleaned = (rawPrompt || '').trim();
    if (!cleaned) return cleaned;

    const system = `You are a senior BI analyst. Rewrite the user's data question into ONE clear, specific, self-contained analytical request suitable for a text-to-SQL engine.
Rules:
- Keep it to a single sentence.
- Make the metric, dimension, grouping and time range explicit when implied.
- Do NOT answer the question, do NOT write SQL, do NOT add commentary.
- Return ONLY the rephrased question text, with no surrounding quotes.`;

    try {
      const improved = await this.llm.generateFreeText(system, cleaned, 120);
      const out = (improved || '').trim().replace(/^["']|["']$/g, '').trim();
      if (!out || out.toLowerCase().includes('ai service error')) return cleaned;
      return out;
    } catch {
      return cleaned;
    }
  }

  /**
   * AI assist — suggest a single high-value analytics question for a widget
   * based on its chart type and the connected datasource's schema. Used when
   * the user clicks Generate with an empty prompt field. Does NOT execute
   * anything; just returns a question string for the user to review.
   */
  async suggestQuestion(widgetId: string, orgId: string): Promise<string> {
    const widget = await this.db.queryOne<any>(
      `SELECT w.*, d.context_type as dash_context_type, d.context_id as dash_context_id
       FROM dashboard_widgets_v2 w
       JOIN dashboard_pages p ON p.id = w.page_id
       JOIN dashboards d ON d.id = p.dashboard_id
       WHERE w.id = $1 AND w.deleted_at IS NULL AND d.org_id = $2`,
      [widgetId, orgId],
    );
    if (!widget) throw new NotFoundException('Widget not found');

    const connId = await this.resolveWidgetConnectionId(widget);
    const schema = connId ? await this.buildSchemaContext(connId) : '-- No schema available';

    const widgetType = String(widget.widget_type || 'table');
    const guidance = this.chartTypeGuidance(widgetType);

    const system = `You are a senior BI analyst proposing the single most useful analytics question for one dashboard card.
You are given a database schema and the card's chart type.
Rules:
- Propose EXACTLY ONE concise, business-relevant question (one sentence).
- The question MUST fit the given chart type: ${guidance}
- Reference REAL table/column names from the schema so a text-to-SQL engine can answer it.
- Prefer high-value insights (revenue, counts, trends, rankings, distributions) over trivial lookups.
- Return ONLY the question text, with no surrounding quotes and no commentary.`;

    const userContent = `Chart type: ${widgetType}\n\nDatabase schema:\n${schema}\n\nReturn the single best question now.`;

    try {
      const q = await this.llm.generateFreeText(system, userContent, 120);
      const out = (q || '').trim().replace(/^["']|["']$/g, '').trim();
      if (!out || out.toLowerCase().includes('ai service error')) {
        return 'Show the total number of records grouped by the most relevant category.';
      }
      return out;
    } catch {
      return 'Show the total number of records grouped by the most relevant category.';
    }
  }

  /** Map a widget chart type to a short instruction describing the question shape. */
  private chartTypeGuidance(widgetType: string): string {
    switch (widgetType) {
      case 'metric_card':
        return 'a single key number (a total, count, sum, or average).';
      case 'line_chart':
      case 'area_chart':
        return 'a trend over time, grouping a measure by a date/period column.';
      case 'bar_chart':
      case 'funnel':
        return 'a ranking or comparison of a measure across a categorical column (top N).';
      case 'pie_chart':
      case 'donut_chart':
        return 'a distribution or share of a total broken down by a categorical column.';
      case 'scatter':
        return 'a correlation between two numeric columns from the same table.';
      case 'table':
      case 'pivot':
        return 'a set of detailed records or a multi-dimensional breakdown.';
      default:
        return 'a clear, high-value analytical question matching the data.';
    }
  }

  /**
   * Resolve the direct connection id backing a widget for schema lookups
   * (widget override → linked card → dashboard context; combos use their
   * first member connection).
   */
  private async resolveWidgetConnectionId(widget: any): Promise<string | null> {
    let contextType = widget.datasource_context_type;
    let contextId = widget.datasource_context_id;

    if (!contextId && widget.card_id) {
      const card = await this.db.queryOne<any>(
        'SELECT datasource_context_type, datasource_context_id FROM analytics_cards WHERE id = $1 AND deleted_at IS NULL',
        [widget.card_id],
      );
      if (card) {
        contextType = card.datasource_context_type;
        contextId = card.datasource_context_id;
      }
    }
    if (!contextId) {
      contextType = widget.dash_context_type;
      contextId = widget.dash_context_id;
    }
    if (!contextId) return null;

    if (contextType === 'combo') {
      const rows = await this.db.queryMany<{ connection_id: string }>(
        `SELECT connection_id FROM datasource_combo_members WHERE combo_id = $1 LIMIT 1`,
        [contextId],
      );
      return rows[0]?.connection_id ?? null;
    }
    return contextId;
  }

  /**
   * Resolve the NL prompt used to (re)generate a widget's query. Uses the
   * analytical question persisted in query_definition.prompt (set when the
   * widget is created/edited or auto-seeded), or an explicit widget.prompt.
   *
   * IMPORTANT: we deliberately do NOT fall back to the widget TITLE here.
   * Empty drag-and-drop widgets only have a placeholder title (e.g. "Bar
   * Chart"); falling back to it caused the system to fabricate a chart from
   * the title on refresh. A widget with no real prompt has nothing to execute.
   */
  private resolveWidgetPrompt(widget: any): string {
    let qd = widget.query_definition;
    if (typeof qd === 'string') {
      try { qd = JSON.parse(qd); } catch { qd = {}; }
    }
    const prompt = qd && typeof qd === 'object' ? (qd.prompt as string | undefined) : undefined;
    return ((prompt && prompt.trim()) || (widget.prompt && String(widget.prompt).trim()) || '').trim();
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
         AND cs.deleted_at IS NULL
         AND ct.deleted_at IS NULL
         AND cc.deleted_at IS NULL
       GROUP BY ct.table_name
       ORDER BY ct.table_name`,
      [connectionId],
    );
    if (!tables.length) return '-- No schema available';
    return tables.map((t: any) => `${t.table_name}(${t.columns})`).join('\n');
  }
}
