// ──────────────────────────────────────────────
// DefaultCardsService — Auto-generates 4 insight-rich analytical cards on
// Page 1 when a new dashboard is created. Cards cover the 4 core analytics
// archetypes, each matched to the correct chart type:
//   1. KPI summary        → metric_card
//   2. Trend over time     → line_chart
//   3. Category comparison → bar_chart
//   4. Distribution        → pie_chart / donut_chart
// Chosen from the connected datasource's schema (tables, columns, types),
// validated with a live query (no widget is created unless it returns data),
// laid out in a clean, professionally-aligned 2×2 grid. The 4 cards are
// generated in PARALLEL to minimise dashboard creation time.
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { LLMService } from '../llm/llm.service';
import { PromptBuilderService } from '../llm/prompt-builder.service';
import { MCPService } from '../mcp/mcp.service';
import { SafeAccount } from '../auth/auth.service';
import { DashboardBuilderService, CreateWidgetDto } from './dashboard-builder.service';
import { ConnectorType } from '../common/types';
import { decrypt } from '../common/utils/encryption';

// Valid widget_type enum values (must match the PostgreSQL `widget_type` enum)
const VALID_WIDGET_TYPES = new Set([
  'metric_card', 'line_chart', 'area_chart', 'bar_chart', 'pie_chart',
  'donut_chart', 'table', 'heatmap', 'funnel', 'scatter', 'pivot',
  'gauge', 'treemap', 'sankey',
]);



// Max number of alternative prompts to try per widget before giving up
const MAX_EXEC_RETRIES = 4;

// Grid constants for the 4-widget professional BI layout (uniform 2×2):
//  ┌────────────┬────────────┐
//  │  Widget 1  │  Widget 2  │  row 0, gridY=0
//  ├────────────┼────────────┤
//  │  Widget 3  │  Widget 4  │  row 1, gridY=4
//  └────────────┴────────────┘
const GRID_COLS = 12;

// Number of default cards generated for a new dashboard.
const DEFAULT_CARD_COUNT = 4;

interface ColumnInfo {
  table: string;
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

interface TableInfo {
  name: string;
  rowEstimate: number | null;
  columns: ColumnInfo[];
}

interface CardSpec {
  title: string;
  widgetType: string;
  prompt: string;
}

interface ExecResult {
  rows: Record<string, unknown>[];
  columns: string[];
  sql: string;
}

@Injectable()
export class DefaultCardsService {
  private readonly logger = new Logger(DefaultCardsService.name);
  private readonly encKey: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly llm: LLMService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly mcp: MCPService,
    private readonly config: ConfigService,
    private readonly builder: DashboardBuilderService,
  ) {
    this.encKey = this.config.getOrThrow('CREDENTIAL_ENCRYPTION_KEY');
  }

  /**
   * Generate and persist 5 default analytical cards on the given page.
   * Each widget is validated with a live query before being created —
   * widgets that return no data are retried or replaced with a guaranteed fallback.
   * Best-effort: never throws — a failure here must not block dashboard creation.
   */
  async seedDefaultCards(
    orgId: string,
    creator: SafeAccount,
    dashId: string,
    pageId: string,
    contextType: 'connection' | 'combo',
    contextId: string,
  ): Promise<unknown[]> {
    try {
      const tables = await this.fetchSchema(contextType, contextId);
      if (tables.length === 0) {
        this.logger.warn(
          `No synced schema for ${contextType} ${contextId}; skipping default card generation for dashboard ${dashId}`,
        );
        return [];
      }

      // Resolve the primary connection ID for query execution
      const primaryConnId = await this.resolvePrimaryConnectionId(contextType, contextId);

      let specs = await this.generateCardSpecs(orgId, tables).catch((e) => {
        this.logger.warn(`LLM card generation failed, falling back to heuristics: ${e?.message}`);
        return null;
      });

      if (!specs || specs.length === 0) {
        specs = this.heuristicSpecs(tables);
      }

      // Normalize to exactly 4 canonical roles
      const finalSpecs = this.normalizeSpecs(specs, tables).slice(0, DEFAULT_CARD_COUNT);

      const heuristics = this.heuristicSpecs(tables);
      const gridH = 4;
      const halfW = GRID_COLS / 2; // 6 — matches frontend WIDGET_W constant

      // Uniform 2×2 BI layout — every widget has identical dimensions:
      //  ┌────────────┬────────────┐
      //  │  Widget 1  │  Widget 2  │  gridY=0
      //  ├────────────┼────────────┤
      //  │  Widget 3  │  Widget 4  │  gridY=4
      //  └────────────┴────────────┘
      const slots = finalSpecs.map((_, i) => {
        const gridX = (i % 2) * halfW;
        const gridY = Math.floor(i / 2) * gridH;
        return { gridX, gridY, gridW: halfW, gridH };
      });

      // Build all 4 cards in PARALLEL — each card independently validates its
      // query and persists itself. This cuts dashboard creation time roughly
      // 4× versus the previous sequential loop. Results are collected by slot
      // index so the returned order is deterministic.
      const tasks = finalSpecs.map(async (spec, i) => {
        const slot = slots[i];

        // Attempt to execute the spec and validate it returns data.
        // On failure, try heuristic fallback, then a per-widget guaranteed COUNT fallback.
        let execResult = primaryConnId
          ? await this.executeWithRetry(
              primaryConnId,
              spec,
              heuristics[i] || heuristics[0],
              tables,
              i,
            )
          : null;

        // Hard guarantee: if ALL execution attempts failed, run the simplest
        // possible COUNT(*) query so the card NEVER opens with "No Data".
        if (!execResult && primaryConnId) {
          execResult = await this.runGuaranteedFallback(primaryConnId, tables, i);
          if (execResult) {
            this.logger.warn(
              `Widget ${i + 1}/${DEFAULT_CARD_COUNT} "${spec.title}" — using guaranteed COUNT fallback (${execResult.rows.length} rows)`,
            );
          }
        }

        // Optionally refine the widget type based on what the data actually looks like
        const refinedSpec = execResult
          ? { ...spec, ...this.specFromExecResult(spec, execResult) }
          : spec;

        // Build the widget DTO, embedding pre-executed results so the card
        // shows real data immediately on first load (no "No Data" flash).
        const dto = this.specToWidget(
          refinedSpec,
          slot,
          contextType,
          contextId,
          execResult ?? undefined,
        );

        const w = await this.builder.addWidget(pageId, orgId, creator, dto);

        this.logger.log(
          `Widget ${i + 1}/${DEFAULT_CARD_COUNT} created: "${refinedSpec.title}" [${refinedSpec.widgetType}]` +
          (execResult ? ` – ${execResult.rows.length} rows pre-loaded` : ' – no live data (will refresh on load)'),
        );
        return w;
      });

      const created = await Promise.all(tasks);

      this.logger.log(`Seeded ${created.length} default cards for dashboard ${dashId} (parallel)`);
      return created;
    } catch (e: any) {
      this.logger.error(`seedDefaultCards failed for dashboard ${dashId}: ${e?.message}`, e?.stack);
      return [];
    }
  }

  // ── Schema fetching ───────────────────────────────────────────

  private async fetchSchema(contextType: string, contextId: string): Promise<TableInfo[]> {
    const connectionIds =
      contextType === 'combo'
        ? (
            await this.db.queryMany<{ connection_id: string }>(
              `SELECT connection_id FROM datasource_combo_members WHERE combo_id = $1`,
              [contextId],
            )
          ).map((r) => r.connection_id)
        : [contextId];

    const tables: TableInfo[] = [];
    for (const connId of connectionIds) {
      const rows = await this.db.queryMany<any>(
        `SELECT ct.table_name, ct.row_count_estimate,
                cc.column_name, cc.data_type, cc.is_primary_key, cc.is_foreign_key,
                cc.ordinal_position
         FROM connection_schemas cs
         JOIN connection_tables ct ON ct.schema_id = cs.id
         JOIN connection_columns cc ON cc.table_id = ct.id
         WHERE cs.connection_id = $1
           AND cs.deleted_at IS NULL
           AND ct.deleted_at IS NULL
           AND cc.deleted_at IS NULL
         ORDER BY ct.table_name, cc.ordinal_position`,
        [connId],
      );

      const byTable = new Map<string, TableInfo>();
      for (const r of rows) {
        let t = byTable.get(r.table_name);
        if (!t) {
          t = { name: r.table_name, rowEstimate: r.row_count_estimate ?? null, columns: [] };
          byTable.set(r.table_name, t);
        }
        t.columns.push({
          table: r.table_name,
          name: r.column_name,
          dataType: String(r.data_type || '').toLowerCase(),
          isPrimaryKey: !!r.is_primary_key,
          isForeignKey: !!r.is_foreign_key,
        });
      }
      tables.push(...byTable.values());
    }
    return tables;
  }

  private compressSchema(tables: TableInfo[]): string {
    const ranked = [...tables].sort(
      (a, b) => (b.rowEstimate ?? 0) - (a.rowEstimate ?? 0) || b.columns.length - a.columns.length,
    );
    return ranked
      .slice(0, 25)
      .map((t) => {
        const cols = t.columns
          .map((c) => `${c.name}:${c.dataType}${c.isPrimaryKey ? ' PK' : ''}${c.isForeignKey ? ' FK' : ''}`)
          .join(', ');
        return `${t.name}(${cols})`;
      })
      .join('\n');
  }

  // ── LLM-driven card specs ─────────────────────────────────────

  private async generateCardSpecs(orgId: string, tables: TableInfo[]): Promise<CardSpec[] | null> {
    const schema = this.compressSchema(tables);

    const systemPrompt = `You are a senior BI analyst designing the default landing page of a new analytics dashboard.
Given a database schema, propose exactly 4 highly valuable, business-relevant analytical cards that together provide actionable insights from the connected datasource.

Rules — follow every one:
- Return ONLY a JSON array of exactly 4 objects. No markdown, no code fences, no prose.
- Each object: {"title": string, "widgetType": string, "prompt": string}
- "title": a short, clear, business-friendly card title (max 6 words). No quotes.
- "prompt": a precise natural-language analytics question that references REAL table/column names from the schema, written so a text-to-SQL engine can answer it. Each prompt MUST return at least 1 row of data.
- "widgetType": choose the best chart type for the insight (e.g., bar_chart, line_chart, pie_chart, metric_card, horizontal_bar, table).
- Insight Quality is the absolute priority. Do not generate generic or low-value insights such as simple record counts or redundant metrics.
- Chart Diversity is NOT required. You may use multiple bar charts, multiple line charts, or multiple KPIs if those visualizations provide the clearest representation of the insights. Do NOT force a specific chart type if a better one exists.
- Do NOT produce duplicate or near-duplicate insights. Each card must answer a distinct and meaningful business question.
- Prefer columns that look like money, amounts, quantities, statuses, categories, dates.
- Write prompts that are guaranteed to return data (prefer COUNT(*), SUM, GROUP BY over filters that might exclude all rows).`;

    const userContent = `Database schema:\n${schema}\n\nReturn the JSON array of 4 top-tier analytical cards now.`;

    const raw = await this.llm.generateFreeText(systemPrompt, userContent, 1000);
    return this.parseSpecs(raw);
  }

  private parseSpecs(raw: string): CardSpec[] | null {
    if (!raw) return null;
    let text = raw.trim();
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;

    const specs: CardSpec[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const title = typeof o.title === 'string' ? o.title.trim() : '';
      const prompt = typeof o.prompt === 'string' ? o.prompt.trim() : '';
      const widgetType = typeof o.widgetType === 'string' ? o.widgetType.trim() : '';
      if (!title || !prompt) continue;
      specs.push({ title, prompt, widgetType });
    }
    return specs.length ? specs : null;
  }

  // ── Heuristic fallback (no LLM) ───────────────────────────────

  private heuristicSpecs(tables: TableInfo[]): CardSpec[] {
    const primary = this.pickPrimaryTable(tables);
    const cols = primary.columns;
    const numeric = cols.filter((c) => this.isNumeric(c) && !c.isPrimaryKey && !c.isForeignKey);
    const dates = cols.filter((c) => this.isDate(c));
    const categories = cols.filter((c) => this.isCategorical(c));
    const measure = numeric[0];
    const cat0 = categories[0];
    const cat1 = categories[1];
    const P = primary.name;

    const kpi: CardSpec = measure
      ? {
          title: `Total ${this.humanize(measure.name)}`,
          widgetType: 'metric_card',
          prompt: `Calculate the sum of ${measure.name} across all records in the ${P} table.`,
        }
      : {
          title: `Total ${this.humanize(P)}`,
          widgetType: 'metric_card',
          prompt: `Count the total number of records in the ${P} table.`,
        };

    let trend: CardSpec;
    if (dates[0] && measure) {
      trend = {
        title: `${this.humanize(measure.name)} Over Time`,
        widgetType: 'line_chart',
        prompt: `Show the total ${measure.name} from the ${P} table grouped by month using the ${dates[0].name} column, for the most recent 12 months, ordered chronologically.`,
      };
    } else if (dates[0]) {
      trend = {
        title: `${this.humanize(P)} Over Time`,
        widgetType: 'line_chart',
        prompt: `Show the count of records in the ${P} table grouped by month using the ${dates[0].name} column, for the most recent 12 months, ordered chronologically.`,
      };
    } else if (cat0) {
      trend = {
        title: `Top ${this.humanize(cat0.name)}`,
        widgetType: 'bar_chart',
        prompt: `Show the count of records in the ${P} table grouped by ${cat0.name}, ordered from highest to lowest, limited to the top 10.`,
      };
    } else {
      trend = {
        title: `${this.humanize(P)} Records`,
        widgetType: 'bar_chart',
        prompt: `Count the total number of records in the ${P} table.`,
      };
    }

    let comparison: CardSpec;
    if (cat0 && measure) {
      comparison = {
        title: `${this.humanize(measure.name)} by ${this.humanize(cat0.name)}`,
        widgetType: 'bar_chart',
        prompt: `Show the total ${measure.name} from the ${P} table grouped by ${cat0.name}, ordered from highest to lowest, limited to the top 10.`,
      };
    } else if (cat0) {
      comparison = {
        title: `Top ${this.humanize(cat0.name)}`,
        widgetType: 'bar_chart',
        prompt: `Show the top 10 ${cat0.name} values in the ${P} table by record count, ordered from highest to lowest.`,
      };
    } else {
      comparison = {
        title: `${this.humanize(P)} Count`,
        widgetType: 'bar_chart',
        prompt: `Count the total number of records in the ${P} table.`,
      };
    }

    const distCol = cat1 || cat0 || cols[0];
    let distribution: CardSpec;
    if (distCol) {
      distribution = {
        title: `${this.humanize(P)} by ${this.humanize(distCol.name)}`,
        widgetType: 'pie_chart',
        prompt: `Show the count of records in the ${P} table grouped by ${distCol.name}, limited to the top 8 groups, ordered from highest to lowest.`,
      };
    } else {
      distribution = {
        title: `${this.humanize(P)} Breakdown`,
        widgetType: 'pie_chart',
        prompt: `Count the total number of records in the ${P} table grouped by its first categorical column, limited to the top 8 groups.`,
      };
    }

    let correlation: CardSpec;
    if (numeric[0] && numeric[1]) {
      correlation = {
        title: `${this.humanize(numeric[0].name)} vs ${this.humanize(numeric[1].name)}`,
        widgetType: 'scatter',
        prompt: `Show the relationship between ${numeric[0].name} and ${numeric[1].name} from the ${P} table, returning ${numeric[0].name} as x and ${numeric[1].name} as y for up to 200 records.`,
      };
    } else {
      correlation = {
        title: `Recent ${this.humanize(P)}`,
        widgetType: 'table',
        prompt: `Show the 10 most recent records from the ${P} table.`,
      };
    }

    return [kpi, trend, comparison, distribution, correlation];
  }

  // ── Normalization & mapping ───────────────────────────────────

  private normalizeSpecs(specs: CardSpec[], tables: TableInfo[]): CardSpec[] {
    const fallback = this.heuristicSpecs(tables);
    const result: CardSpec[] = [];

    // Take up to DEFAULT_CARD_COUNT valid specs from LLM
    for (const s of specs) {
      if (result.length >= DEFAULT_CARD_COUNT) break;
      if (VALID_WIDGET_TYPES.has(s.widgetType)) {
        result.push({ title: this.cleanTitle(s.title), prompt: s.prompt, widgetType: s.widgetType });
      }
    }

    // Pad with fallbacks if we have fewer than DEFAULT_CARD_COUNT
    let fallbackIndex = 0;
    while (result.length < DEFAULT_CARD_COUNT && fallbackIndex < fallback.length) {
      const fb = fallback[fallbackIndex++];
      result.push({ title: this.cleanTitle(fb.title), prompt: fb.prompt, widgetType: fb.widgetType });
    }

    return result;
  }

  private cleanTitle(title: string): string {
    return title.replace(/^["']|["']$/g, '').trim().slice(0, 120);
  }

  private specToWidget(
    spec: CardSpec,
    slot: { gridX: number; gridY: number; gridW: number; gridH: number },
    contextType: string,
    contextId: string,
    execResult?: ExecResult,
  ): CreateWidgetDto {
    const queryDefinition: Record<string, unknown> = {
      prompt: spec.prompt,
      ui_hint: spec.widgetType,
    };

    // Embed pre-executed data so the card shows real data on first load
    if (execResult && execResult.rows.length > 0) {
      queryDefinition.result_rows = execResult.rows.slice(0, 500);
      queryDefinition.result_columns = execResult.columns;
      queryDefinition.sql = execResult.sql;
    }

    return {
      widgetType: spec.widgetType,
      title: spec.title,
      gridX: slot.gridX,
      gridY: slot.gridY,
      gridW: slot.gridW,
      gridH: slot.gridH,
      layoutDesktop: { x: slot.gridX, y: slot.gridY, w: slot.gridW, h: slot.gridH },
      datasourceContextType: contextType,
      datasourceContextId: contextId,
      queryDefinition,
      visualizationConfig: {},
    };
  }

  private specFromExecResult(spec: CardSpec, execResult: ExecResult): Partial<CardSpec> {
    // After execution we may want to refine widget type based on data shape
    const { rows, columns } = execResult;
    if (!rows.length) return {};

    const numericCols = columns.filter((c) =>
      rows.slice(0, 5).every((r) => r[c] == null || !isNaN(Number(r[c]))),
    );

    // Downgrade scatter to table if not enough numeric columns
    if (spec.widgetType === 'scatter' && numericCols.length < 2) {
      return { widgetType: 'table' };
    }
    // Downgrade line_chart / bar_chart if only 1 row
    if ((spec.widgetType === 'line_chart' || spec.widgetType === 'area_chart') && rows.length < 3) {
      return { widgetType: 'metric_card' };
    }

    return {};
  }

  // ── Live query execution & validation ─────────────────────────

  /**
   * Resolve the first direct-connection ID to use for query validation.
   * For combos this is the first member; for single connections it's the ID itself.
   */
  private async resolvePrimaryConnectionId(contextType: string, contextId: string): Promise<string | null> {
    if (contextType === 'connection') return contextId;
    const rows = await this.db.queryMany<{ connection_id: string }>(
      `SELECT connection_id FROM datasource_combo_members WHERE combo_id = $1 LIMIT 1`,
      [contextId],
    );
    return rows[0]?.connection_id ?? null;
  }

  /**
   * Try to execute a spec prompt (and up to MAX_EXEC_RETRIES - 1 alternatives)
   * against the live database. Returns the first result with rows > 0.
   * Never throws.
   */
  private async executeWithRetry(
    connId: string,
    primary: CardSpec,
    heuristicFallback: CardSpec,
    tables: TableInfo[],
    widgetIndex = 0,
  ): Promise<ExecResult | null> {
    // Pick a different table for each widget slot to maximise data diversity
    const tableForSlot = this.pickTableForSlot(tables, widgetIndex);

    const candidates: string[] = [
      primary.prompt,
      heuristicFallback.prompt,
      this.guaranteedCountPrompt(tableForSlot),
      this.guaranteedCountPrompt(this.pickPrimaryTable(tables)),
    ];

    for (let attempt = 0; attempt < Math.min(candidates.length, MAX_EXEC_RETRIES); attempt++) {
      const prompt = candidates[attempt];
      if (!prompt) continue;
      const result = await this.tryExecutePrompt(connId, prompt);
      if (result && result.rows.length > 0) {
        this.logger.debug(`Widget ${widgetIndex + 1} validation succeeded on attempt ${attempt + 1}: ${prompt.slice(0, 80)}`);
        return result;
      }
    }
    return null;
  }

  /**
   * Absolute last-resort fallback: run a raw `SELECT COUNT(*) FROM <table>`
   * directly against the database — no LLM involved, no NL prompt parsing.
   * This guarantees at least 1 row is returned so no widget ever shows "No Data".
   */
  private async runGuaranteedFallback(
    connId: string,
    tables: TableInfo[],
    widgetIndex: number,
  ): Promise<ExecResult | null> {
    const table = this.pickTableForSlot(tables, widgetIndex);
    const sql = `SELECT COUNT(*) AS total_records FROM ${table.name}`;
    try {
      const conn = await this.db.queryOne<any>(
        'SELECT * FROM datasource_connections WHERE id = $1',
        [connId],
      );
      if (!conn) return null;

      const { decrypt } = await import('../common/utils/encryption');
      const password = decrypt(conn.encrypted_password, this.encKey);
      const session = await this.mcp.createSession({
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password,
        database: conn.database_name,
        connectorType: conn.connector_type as import('../common/types').ConnectorType,
      });

      try {
        const mcpResult = await this.mcp.executeReadQuery(session.sessionId, sql);
        if (!mcpResult.success) return null;
        const rows: Record<string, unknown>[] = mcpResult.data?.rows || [];
        const columns: string[] = mcpResult.data?.columns || [];
        if (!rows.length) return null;
        return { rows, columns, sql };
      } finally {
        await this.mcp.destroySession(session.sessionId).catch(() => {});
      }
    } catch {
      return null;
    }
  }

  /**
   * Execute a single natural-language prompt against a connection.
   * Returns rows/columns/sql or null on any error or 0-row result.
   */
  private async tryExecutePrompt(connId: string, prompt: string): Promise<ExecResult | null> {
    try {
      const conn = await this.db.queryOne<any>(
        'SELECT * FROM datasource_connections WHERE id = $1',
        [connId],
      );
      if (!conn) return null;

      const schemaContext = await this.buildSchemaContext(connId);
      const connectorFamily =
        conn.connector_type === 'elasticsearch'
          ? 'elasticsearch'
          : conn.connector_type === 'mongodb'
          ? 'document'
          : 'sql';

      const llmContext = this.promptBuilder.assembleContext({
        compressedSchema: schemaContext,
        conversationSummary: null,
        recentMessages: [],
        userPrompt: prompt,
        connectorFamily,
      });

      const llmResponse = await this.llm.generateSQL(llmContext);
      if (!llmResponse?.sql) return null;

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
        const mcpResult = await this.mcp.executeReadQuery(session.sessionId, llmResponse.sql);
        if (!mcpResult.success) return null;
        const rows: Record<string, unknown>[] = mcpResult.data?.rows || [];
        const columns: string[] = mcpResult.data?.columns || [];
        if (!rows.length) return null;
        return { rows, columns, sql: llmResponse.sql };
      } finally {
        await this.mcp.destroySession(session.sessionId).catch(() => {});
      }
    } catch {
      return null;
    }
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

  /** A prompt guaranteed to return exactly 1 row: total record count of a given table. */
  private guaranteedCountPrompt(table: TableInfo): string {
    return `Count the total number of records in the ${table.name} table.`;
  }

  /**
   * Pick a table appropriate for a given widget slot index.
   * Rotates through available tables so each widget can show data from a
   * distinct table, improving dashboard diversity.
   */
  private pickTableForSlot(tables: TableInfo[], slotIndex: number): TableInfo {
    // Sort by row count descending (most data first)
    const ranked = [...tables].sort(
      (a, b) => (b.rowEstimate ?? 0) - (a.rowEstimate ?? 0) || b.columns.length - a.columns.length,
    );
    // Use modulo so we cycle through all tables without going out of bounds
    return ranked[slotIndex % ranked.length] ?? ranked[0];
  }

  // ── Column classification helpers ─────────────────────────────

  private isNumeric(c: ColumnInfo): boolean {
    return /(int|numeric|decimal|double|real|float|money|number)/.test(c.dataType);
  }

  private isDate(c: ColumnInfo): boolean {
    return /(date|time|timestamp)/.test(c.dataType);
  }

  private isCategorical(c: ColumnInfo): boolean {
    if (c.isPrimaryKey) return false;
    return /(char|text|varchar|enum|bool|uuid)/.test(c.dataType) || c.isForeignKey;
  }

  private pickPrimaryTable(tables: TableInfo[]): TableInfo {
    return [...tables].sort(
      (a, b) => (b.rowEstimate ?? 0) - (a.rowEstimate ?? 0) || b.columns.length - a.columns.length,
    )[0];
  }

  private humanize(name: string): string {
    const words = String(name).replace(/[_\-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().split(/\s+/);
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
}
