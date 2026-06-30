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
  async executeSync(widgetId: string, user: SafeAccount, forceRefresh = false) {
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
       WHERE w.id = $1 AND w.deleted_at IS NULL`,
      [widgetId],
    );
    if (!widget) throw new NotFoundException('Widget not found');

    // 3. Stampede prevention
    const lockAcquired = await this.cache.acquireWidgetExecutionLock(widgetId, 30000);
    if (!lockAcquired) {
      // If someone else is refreshing, we can either wait or just queue this request
      // Let's queue it so we don't block the UI indefinitely
      await this.dispatchToQueue(widgetId, user);
      return { status: 'queued', message: 'Widget is currently refreshing, queued for update' };
    }

    try {
      // 4. Log execution start
      const execRecord = await this.db.queryOne(
        `INSERT INTO widget_executions
           (widget_id, dashboard_id, page_id, triggered_by, account_id, status)
         VALUES ($1, $2, $3, $4, $5, 'running')
         RETURNING id`,
        [widgetId, widget.dash_id, widget.page_id, forceRefresh ? 'manual' : 'refresh', user.id],
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
  async dispatchToQueue(widgetId: string, user?: SafeAccount) {
    // Execute asynchronously instead of BullMQ
    setTimeout(() => {
      this.executeSync(widgetId, user || { id: 'system' } as SafeAccount, true)
        .catch(err => this.logger.error(`Widget refresh failed for ${widgetId}`, err));
    }, 100);
    return { status: 'queued' };
  }

  /**
   * AI assist — rephrase a user's analytics question into a clearer, more
   * specific analytical request that a text-to-SQL engine can answer well.
   * When widgetId is supplied the schema is fetched and used to ground the
   * rewrite in real table/column names. Falls back to the original prompt if
   * the LLM is unavailable.
   */
  async improvePrompt(rawPrompt: string, widgetId?: string): Promise<string> {
    const cleaned = (rawPrompt || '').trim();
    if (!cleaned) return cleaned;

    let schemaBlock = '';
    if (widgetId) {
      try {
        const widget = await this.db.queryOne<any>(
          `SELECT w.*, d.context_type as dash_context_type, d.context_id as dash_context_id
           FROM dashboard_widgets_v2 w
           JOIN dashboard_pages p ON p.id = w.page_id
           JOIN dashboards d ON d.id = p.dashboard_id
           WHERE w.id = $1 AND w.deleted_at IS NULL`,
          [widgetId],
        );
        if (widget) {
          const connId = await this.resolveWidgetConnectionId(widget);
          if (connId) {
            const schema = await this.buildSchemaContext(connId);
            schemaBlock = `\n\nDatabase schema (use ONLY these real table/column names in the rewrite):\n${schema}`;
          }
        }
      } catch { /* schema fetch is best-effort */ }
    }

    const system = `You are a senior BI analyst. Rewrite the user's data question into ONE clear, specific, self-contained analytical request suitable for a text-to-SQL engine.
Rules:
- Keep it to a single sentence.
- Make the metric, dimension, grouping and time range explicit when implied.
- Reference real table and column names from the schema when they match the user's intent — do NOT invent table or column names that are not in the schema.
- Do NOT answer the question, do NOT write SQL, do NOT add commentary.
- Return ONLY the rephrased question text, with no surrounding quotes.
- If the question asks for a percentage, ratio, share, or proportion: rewrite it to ask for the raw count or sum instead (the chart handles percentage display). Example: "What percentage of revenue comes from each region?" → "Show total revenue by region ordered by revenue descending, top 10."
- If the question compares periods (month-over-month, year-over-year): rewrite to ask for a simple time-series grouped by month or year, no comparison.`;

    try {
      this.logger.log(`[improvePrompt] widget=${widgetId ?? 'n/a'} input="${cleaned}" schema=${schemaBlock ? 'yes' : 'no'}`);
      // reasoningEffort:'low' stops the reasoning model from spending the whole
      // token budget on hidden chain-of-thought (which leaks into the answer).
      const improved = await this.llm.generateFreeText(system, cleaned + schemaBlock, 512, { reasoningEffort: 'low' });
      const out = this.cleanAssistText(improved);
      if (!out || out.toLowerCase().includes('ai service error')) {
        this.logger.warn(`[improvePrompt] empty/failed AI response — falling back to original prompt`);
        return cleaned;
      }
      this.logger.log(`[improvePrompt] refined="${out}"`);
      return out;
    } catch (err: any) {
      this.logger.warn(`[improvePrompt] failed: ${err?.message} — falling back to original prompt`);
      return cleaned;
    }
  }

  /**
   * Normalize a free-text AI answer that should be a single short question/
   * request. Reasoning models occasionally emit their chain-of-thought instead
   * of a clean answer; extract the best single line and reject obvious
   * reasoning dumps so callers can fall back deterministically.
   */
  private cleanAssistText(raw: string | null | undefined): string {
    let s = (raw || '').trim();
    if (!s) return '';
    // Strip surrounding quotes/markdown.
    s = s.replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '').trim();

    // A reasoning dump is multi-line and/or contains first-person planning
    // language. Prefer the last line that looks like an actual question/request.
    if (s.includes('\n') || /\b(we need|let me|i should|must (be|not)|could be|the user|first[- ]person)\b/i.test(s)) {
      const lines = s.split('\n').map(l => l.trim()).filter(Boolean);
      const candidate = [...lines].reverse().find(l =>
        (l.endsWith('?') || /^(show|list|count|display|what|how many|which|find|get|sum|total|average)\b/i.test(l))
        && l.length <= 200
        && !/\b(we need|let me|i should|could be|the user)\b/i.test(l),
      );
      if (candidate) return candidate.replace(/^["']|["']$/g, '').trim();
      // No clean candidate found — signal failure so the caller uses its fallback.
      return '';
    }

    s = s.replace(/^["']|["']$/g, '').trim();
    // Single overly-long blob is almost certainly not a clean question.
    return s.length <= 240 ? s : '';
  }

  /**
   * AI assist — suggest a single high-value analytics question for a widget
   * based on its chart type, the connected datasource schema, and all other
   * widget prompts already on the same page (to avoid duplicate insights).
   * Does NOT execute anything; returns a question string for the user to review.
   */
  async suggestQuestion(widgetId: string, providedConnectionId?: string, providedVizType?: string): Promise<string> {
    const widget = await this.db.queryOne<any>(
      `SELECT w.*, p.id as page_id_val,
              d.context_type as dash_context_type, d.context_id as dash_context_id
       FROM dashboard_widgets_v2 w
       JOIN dashboard_pages p ON p.id = w.page_id
       JOIN dashboards d ON d.id = p.dashboard_id
       WHERE w.id = $1 AND w.deleted_at IS NULL`,
      [widgetId],
    );
    if (!widget) throw new NotFoundException('Widget not found');

    const connId = providedConnectionId || await this.resolveWidgetConnectionId(widget);
    const schema = connId ? await this.buildSchemaContext(connId) : '-- No schema available';

    // Fetch sibling widgets on the same page to enable deduplication.
    // NOTE: dashboard_widgets_v2 has NO top-level `prompt` column — the prompt
    // lives inside the query_definition JSONB. Selecting a non-existent `prompt`
    // column was throwing `column "prompt" does not exist`, which surfaced to the
    // user as the misleading "Could not suggest a question" error.
    const siblings = await this.db.queryMany<any>(
      `SELECT query_definition, title FROM dashboard_widgets_v2
       WHERE page_id = $1 AND id != $2 AND deleted_at IS NULL`,
      [widget.page_id_val, widgetId],
    );
    const siblingPrompts = siblings
      .map((s: any) => {
        let qd = s.query_definition;
        if (typeof qd === 'string') { try { qd = JSON.parse(qd); } catch { qd = {}; } }
        return (qd?.prompt || '').trim();
      })
      .filter(Boolean);

    const widgetType = providedVizType || widget.widget_type || 'table';
    const guidance = this.chartTypeGuidance(widgetType);

    const dedupBlock = siblingPrompts.length
      ? `\nINSIGHTS ALREADY ON THIS DASHBOARD (propose something DIFFERENT from all of these):\n` +
        siblingPrompts.map((p, i) => `${i + 1}. ${p}`).join('\n') + '\n'
      : '';

    const categoryHint = this.nextCategoryHint(siblingPrompts.length);

    const system = `You are a senior BI analyst proposing the single most useful analytics question for one dashboard card.
You are given a database schema, the card's chart type, and the insights already shown on this dashboard.

Rules:
- Propose EXACTLY ONE concise, business-relevant question (one sentence, max 20 words).
- The question MUST fit the given chart type: ${guidance}
- Reference REAL table/column names from the schema so a text-to-SQL engine can answer it.
- The question MUST produce a non-empty result: use COUNT(*), SUM, or GROUP BY — avoid filters that might return 0 rows.
- Prefer high-value insights in the "${categoryHint}" category: ${this.categoryDescription(categoryHint)}.
- Do NOT suggest an insight that is already covered by a sibling widget (see list below).
- Return ONLY the question text, with no surrounding quotes and no commentary.

CRITICAL SQL COMPATIBILITY RULES (violations cause query failures):
- NEVER ask for percentages, ratios, shares, or proportions (e.g., "what percentage", "what share", "what fraction"). These require window functions or correlated subqueries that frequently fail. Instead ask for the raw sum or count: "Show total [measure] by [category], top 10."
- NEVER ask for period-over-period comparisons (e.g., "month-over-month", "year-over-year", "compared to last month"). These require CTEs which are not supported.
- Always keep the SQL answerable by: SELECT [col], [aggregate] FROM [table] GROUP BY [col] ORDER BY [aggregate] LIMIT N
- For pie_chart and donut_chart: ask for the raw SUM or COUNT by category — the chart handles percentage display automatically.
${dedupBlock}`;

    const userContent = `Chart type: ${widgetType}\n\nDatabase schema:\n${schema}\n\nReturn the single best question now.`;

    const FALLBACK_QUESTION = 'Show the total number of records grouped by the most relevant category.';
    try {
      this.logger.log(`[suggestQuestion] widget=${widgetId} type=${widgetType} conn=${connId ?? 'none'} siblings=${siblingPrompts.length}`);
      // reasoningEffort:'low' + a larger budget ensures the reasoning model
      // emits a clean one-line question instead of leaking its chain-of-thought.
      const q = await this.llm.generateFreeText(system, userContent, 512, { reasoningEffort: 'low' });
      const out = this.cleanAssistText(q);
      if (!out || out.toLowerCase().includes('ai service error')) {
        this.logger.warn(`[suggestQuestion] empty/unclean AI response — using deterministic fallback question`);
        return FALLBACK_QUESTION;
      }
      this.logger.log(`[suggestQuestion] suggested="${out}"`);
      return out;
    } catch (err: any) {
      this.logger.warn(`[suggestQuestion] failed: ${err?.message} — using deterministic fallback question`);
      return FALLBACK_QUESTION;
    }
  }

  /** Rotate through insight categories based on how many sibling widgets already exist. */
  private nextCategoryHint(siblingCount: number): string {
    const categories = ['kpi', 'trend', 'ranking', 'distribution', 'anomaly', 'operational'];
    return categories[siblingCount % categories.length];
  }

  private categoryDescription(category: string): string {
    const MAP: Record<string, string> = {
      kpi: 'a single high-level business number (total revenue, active users, order count)',
      trend: 'how a key metric changes over time, grouped by month or day',
      ranking: 'top N or bottom N entities ranked by a numeric measure',
      distribution: 'how a measure is distributed across segments or categories',
      anomaly: 'outliers, concentration risk, or underperforming segments',
      operational: 'recent activity, current status, or record-level detail',
    };
    return MAP[category] || 'a high-value business insight';
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

    const lines = tables.map((t: any) => `${t.table_name}(${t.columns})`);

    // Include foreign-key relationships so prompt-refinement / question
    // suggestion reference real join paths (matches the SQL-generation context).
    const fks = await this.db.queryMany<any>(
      `SELECT ct.table_name, cc.column_name, cc.fk_ref_table, cc.fk_ref_column
       FROM connection_schemas cs
       JOIN connection_tables ct ON ct.schema_id = cs.id
       JOIN connection_columns cc ON cc.table_id = ct.id
       WHERE cs.connection_id = $1
         AND cs.deleted_at IS NULL AND ct.deleted_at IS NULL AND cc.deleted_at IS NULL
         AND cc.is_foreign_key = TRUE
         AND cc.fk_ref_table IS NOT NULL AND cc.fk_ref_column IS NOT NULL
       ORDER BY ct.table_name, cc.column_name`,
      [connectionId],
    );
    if (fks.length) {
      lines.push('', 'RELATIONSHIPS (use these for JOINs):',
        ...fks.map((r: any) => `${r.table_name}.${r.column_name} -> ${r.fk_ref_table}.${r.fk_ref_column}`));
    }

    return lines.join('\n');
  }
}
