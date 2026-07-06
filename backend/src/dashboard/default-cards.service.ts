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
  'gauge', 'treemap', 'sankey', 'map', 'matrix',
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
  insightSummary?: string;
  metricContext?: string;
  businessSignificance?: string;
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
   * Seed 4 static placeholder widgets for manual dashboards that have no data
   * source connection. Widgets are empty but sized/positioned in the standard
   * 2×2 BI grid so users can immediately start editing.
   * Best-effort: never throws.
   */
  async seedPlaceholderCards(
    creator: SafeAccount,
    dashId: string,
    pageId: string,
  ): Promise<unknown[]> {
    const PLACEHOLDERS = [
      { title: 'Key Metric', widgetType: 'metric_card' },
      { title: 'Category Overview', widgetType: 'bar_chart' },
      { title: 'Trend Analysis', widgetType: 'line_chart' },
      { title: 'Distribution', widgetType: 'pie_chart' },
    ] as const;

    const gridH = 4;
    const halfW = GRID_COLS / 2; // 6

    try {
      const created = await Promise.all(
        PLACEHOLDERS.map(async (spec, i) => {
          const gridX = (i % 2) * halfW;
          const gridY = Math.floor(i / 2) * gridH;
          const dto: CreateWidgetDto = {
            widgetType: spec.widgetType,
            title: spec.title,
            gridX,
            gridY,
            gridW: halfW,
            gridH,
            layoutDesktop: { x: gridX, y: gridY, w: halfW, h: gridH },
            queryDefinition: {},
            visualizationConfig: {},
          };
          return this.builder.addWidget(pageId, creator, dto);
        }),
      );
      this.logger.log(`Seeded ${created.length} placeholder cards for manual dashboard ${dashId}`);
      return created.filter(Boolean);
    } catch (e: any) {
      this.logger.error(`seedPlaceholderCards failed for dashboard ${dashId}: ${e?.message}`, e?.stack);
      return [];
    }
  }

  /**
   * Generate and persist 5 default analytical cards on the given page.
   * Each widget is validated with a live query before being created —
   * widgets that return no data are retried or replaced with a guaranteed fallback.
   * Best-effort: never throws — a failure here must not block dashboard creation.
   */
  async seedDefaultCards(
    creator: SafeAccount,
    dashId: string,
    pageId: string,
    contextType: 'connection' | 'combo',
    contextId: string,
  ): Promise<unknown[]> {
    try {
      let tables = await this.fetchSchema(contextType, contextId);
      if (tables.length === 0) {
        this.logger.log(`No synced schema for ${contextType} ${contextId}; attempting auto-sync.`);
        if (contextType === 'connection') {
          await this.autoSyncSchema(contextId);
        } else if (contextType === 'combo') {
          const members = await this.db.queryMany<{ connection_id: string }>(
            `SELECT connection_id FROM datasource_combo_members WHERE combo_id = $1`,
            [contextId],
          );
          for (const m of members) {
            await this.autoSyncSchema(m.connection_id);
          }
        }
        tables = await this.fetchSchema(contextType, contextId);
      }

      if (tables.length === 0) {
        this.logger.warn(
          `No synced schema for ${contextType} ${contextId} even after auto-sync; skipping default card generation for dashboard ${dashId}`,
        );
        return [];
      }

      // Resolve the primary connection ID for query execution
      const primaryConnId = await this.resolvePrimaryConnectionId(contextType, contextId);

      let specs = await this.generateCardSpecs(tables).catch((e) => {
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

      const tasks = finalSpecs.map(async (spec, i) => {
        const slot = slots[i];

        try {
          let execResult = null;
          if (primaryConnId) {
            try {
              execResult = await this.executeWithRetry(
                primaryConnId,
                spec,
                heuristics[i] || heuristics[0],
                tables,
                i,
              );
            } catch (err: any) {
              this.logger.warn(`executeWithRetry failed for widget ${i + 1}: ${err?.message}`);
            }

            if (!execResult) {
              try {
                execResult = await this.runGuaranteedFallback(primaryConnId, tables, i);
              } catch (err: any) {
                this.logger.warn(`runGuaranteedFallback failed for widget ${i + 1}: ${err?.message}`);
              }
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

          const w = await this.builder.addWidget(pageId, creator, dto);

          this.logger.log(
            `Widget ${i + 1}/${DEFAULT_CARD_COUNT} created: "${refinedSpec.title}" [${refinedSpec.widgetType}]` +
            (execResult ? ` – ${execResult.rows.length} rows pre-loaded` : ' – no live data (will refresh on load)'),
          );
          return w;
        } catch (err: any) {
          this.logger.error(`Failed to create default widget ${i + 1}: ${err?.message}`, err?.stack);
          // Try absolute fallback: create a static placeholder card so we always get 4 cards!
          try {
            const dto: CreateWidgetDto = {
              widgetType: spec.widgetType,
              title: spec.title,
              gridX: slot.gridX,
              gridY: slot.gridY,
              gridW: slot.gridW,
              gridH: slot.gridH,
              layoutDesktop: { x: slot.gridX, y: slot.gridY, w: slot.gridW, h: slot.gridH },
              datasourceContextType: contextType,
              datasourceContextId: contextId,
              queryDefinition: {
                prompt: spec.prompt,
                ui_hint: spec.widgetType,
              },
              visualizationConfig: {},
            };
            const w = await this.builder.addWidget(pageId, creator, dto);
            this.logger.log(`Created static placeholder fallback for widget ${i + 1}`);
            return w;
          } catch (e2: any) {
            this.logger.error(`Absolute fallback widget creation failed: ${e2?.message}`);
            return null;
          }
        }
      });

      const createdResults = await Promise.all(tasks);
      const created = createdResults.filter(Boolean);

      this.logger.log(`Seeded ${created.length} default cards for dashboard ${dashId} (parallel with error isolation)`);
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

  private async generateCardSpecs(tables: TableInfo[]): Promise<CardSpec[] | null> {
    const schema = this.compressSchema(tables);

    const systemPrompt = `You are a senior data analyst embedded in a business intelligence platform.
Your primary goal is to identify and surface the most valuable insights from the dataset.

Insight Selection Process:
1. Analyze the schema.
2. Identify measures and dimensions.
3. Detect date/time fields.
4. Determine the most important metrics.
5. Rank potential insights by usefulness.
6. Generate the top 4 highest-value insights.

Requirements:
1. Generate exactly 4 default insight cards.
2. Select insights based on business value, not chart variety.
3. You may use the same chart type multiple times if it is the best visualization for different insights.
4. Do not force one Line Chart, one Bar Chart, one Pie Chart, etc.
5. Every card should answer a meaningful question about the data.
6. Prefer insights that reveal:
   - Trends over time
   - Top-performing categories
   - Bottom-performing categories
   - Growth or decline patterns
   - Distribution of key metrics
   - Outliers and anomalies
   - Correlations between important measures
   - Concentration and contribution analysis
   - Operational bottlenecks
   - Revenue, usage, performance, or activity drivers

Quality Rules:
- A card should only be generated if it answers a meaningful question such as: What is trending upward or downward? Which category contributes the most? Which segment is underperforming? Where are anomalies occurring? What factors drive the primary metric? Which entities dominate the dataset? How has performance changed over time? What deserves immediate attention?
- Avoid generic cards such as: Record counts with no context, Random distributions that provide no business value, Charts created solely to fill space, Duplicate insights expressed differently.

Chart Selection Rules:
- Choose the visualization after determining the insight.
- Examples: If the insight is a trend, use a line_chart. If the insight is a ranking, use a bar_chart. If the insight is contribution analysis, use a pie_chart or bar_chart. If the insight is correlation, use a scatter. If the insight is a key metric summary, use a metric_card.
- The chart must serve the insight, not the other way around.

Data-shape rules for the "prompt" field — violating these produces a chart that
renders but is meaningless, which is worse than not generating the card at all:
- TREND (line_chart/area_chart): the prompt MUST ask for exactly one combined,
  already-aggregated chronological period label (e.g. "month" formatted as a
  single date or "YYYY-MM" string, ALIASED as "period" since "year_month" is a reserved SQL keyword) and exactly one aggregated numeric measure
  for that period. NEVER ask for separate day/month/year/quarter columns side
  by side — that produces unrelated numeric series instead of one trend line.
  Good: "Show total revenue grouped by month for the last 12 months, ordered
  chronologically. Alias the month column as period." Bad: "Show revenue, month, and year for each order."
- DISTRIBUTION (pie_chart/donut_chart): the grouping dimension MUST be a true
  bounded category with a small number of distinct values — status, type,
  category, tier, plan, region, country, gender, role, or a boolean/enum flag.
  NEVER group by a free-text, description, biography, notes, comment, summary,
  or any column likely to hold long prose or near-unique values per row — that
  produces one tiny meaningless slice per row instead of a real distribution.
  If the table has no such bounded categorical column, choose a different
  insight or chart type (e.g. a ranking bar_chart on a foreign-key category,
  or a metric_card) rather than forcing a pie chart on unsuitable data.

Technical formatting rules — follow every one strictly:
- Return ONLY a JSON array of exactly 4 objects. No markdown, no code fences, no prose.
- Each object: {"title": string, "insightSummary": string, "metricContext": string, "businessSignificance": string, "widgetType": string, "prompt": string}
- "title": a short, clear, business-friendly card title (max 6 words). No quotes.
- "insightSummary": a concise summary of the primary insight this card reveals (max 2 sentences).
- "metricContext": brief context about the metric being measured (e.g. "Total revenue across all regions").
- "businessSignificance": why this insight matters for business decisions (max 1 sentence).
- "prompt": a precise natural-language analytics question that references REAL table/column names from the schema, written so a text-to-SQL engine can answer it. Each prompt MUST return at least 1 row of data.
- "widgetType": choose the best chart type for the insight (e.g., bar_chart, line_chart, pie_chart, metric_card, horizontal_bar, table).
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
      const insightSummary = typeof o.insightSummary === 'string' ? o.insightSummary.trim() : undefined;
      const metricContext = typeof o.metricContext === 'string' ? o.metricContext.trim() : undefined;
      const businessSignificance = typeof o.businessSignificance === 'string' ? o.businessSignificance.trim() : undefined;
      if (!title || !prompt) continue;
      specs.push({ title, prompt, widgetType, insightSummary, metricContext, businessSignificance });
    }
    return specs.length ? specs : null;
  }

  // ── Heuristic fallback (no LLM) ───────────────────────────────

  private heuristicSpecs(tables: TableInfo[]): CardSpec[] {
    const primary = this.pickPrimaryTable(tables);
    const cols = primary.columns;
    // Business numeric = not a PK or FK (IDs must never become chart axes)
    const businessNumeric = cols.filter((c) => this.isBusinessNumeric(c));
    const dates = cols.filter((c) => this.isDate(c));
    const categories = cols.filter((c) => this.isCategorical(c));
    const measure = businessNumeric[0];
    const measure2 = businessNumeric[1];
    // Exclude free-text/description-like columns and prefer columns that look
    // like true bounded categories — picking one of those as a pie/bar
    // dimension is exactly what produced a meaningless "one sliver per row"
    // chart (e.g. grouping by a free-text "about" column).
    const cat0 = this.pickCategoricalDimension(categories);
    const cat1 = this.pickCategoricalDimension(categories, cat0);
    const P = primary.name;

    // ── Slot 1: KPI metric ────────────────────────────────────────
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

    // ── Slot 2: Trend over time or top-category ranking ───────────
    let trend: CardSpec;
    if (dates[0] && measure) {
      trend = {
        title: `${this.humanize(measure.name)} Over Time`,
        widgetType: 'line_chart',
        prompt: `Show the total ${measure.name} from the ${P} table grouped by month using the ${dates[0].name} column, for the most recent 12 months, ordered chronologically. Return exactly two columns: a single combined date/month label (aliased as "period") and the total ${measure.name} — do not return separate day, month, and year columns.`,
      };
    } else if (dates[0]) {
      trend = {
        title: `${this.humanize(P)} Over Time`,
        widgetType: 'line_chart',
        prompt: `Show the count of records in the ${P} table grouped by month using the ${dates[0].name} column, for the most recent 12 months, ordered chronologically. Return exactly two columns: a single combined date/month label (aliased as "period") and the record count — do not return separate day, month, and year columns.`,
      };
    } else if (cat0) {
      trend = {
        title: `Top ${this.humanize(cat0.name)}`,
        widgetType: 'bar_chart',
        prompt: `Show the count of records in the ${P} table grouped by ${cat0.name}, ordered from highest to lowest, limited to the top 10.`,
      };
    } else {
      trend = {
        title: `${this.humanize(P)} Volume`,
        widgetType: 'metric_card',
        prompt: `Count the total number of records in the ${P} table.`,
      };
    }

    // ── Slot 3: Category ranking by business measure ──────────────
    // GUARD: use only true bounded categorical columns as the grouping dimension
    // — never a primary key, foreign key, or numeric column — to prevent
    // charts like "total_budget by id" which have zero business value.
    let comparison: CardSpec;
    if (cat0 && measure) {
      comparison = {
        title: `Top ${this.humanize(cat0.name)} by ${this.humanize(measure.name)}`,
        widgetType: 'bar_chart',
        prompt: `Show the top 10 ${cat0.name} groups from the ${P} table ranked by total ${measure.name}, ordered from highest to lowest. Group by ${cat0.name} and sum ${measure.name}.`,
      };
    } else if (cat1 && measure) {
      // Try the second categorical dimension
      comparison = {
        title: `Top ${this.humanize(cat1.name)} by ${this.humanize(measure.name)}`,
        widgetType: 'bar_chart',
        prompt: `Show the top 10 ${cat1.name} groups from the ${P} table ranked by total ${measure.name}, ordered from highest to lowest. Group by ${cat1.name} and sum ${measure.name}.`,
      };
    } else if (cat0) {
      // Category exists but no numeric measure — rank by record count
      comparison = {
        title: `Top ${this.humanize(cat0.name)}`,
        widgetType: 'bar_chart',
        prompt: `Show the top 10 most frequent ${cat0.name} values in the ${P} table, ordered by count from highest to lowest. Return ${cat0.name} and COUNT(*).`,
      };
    } else if (measure2) {
      // No categories at all — show a second metric
      comparison = {
        title: `Average ${this.humanize(measure.name)}`,
        widgetType: 'metric_card',
        prompt: `Calculate the average value of ${measure.name} across all records in the ${P} table.`,
      };
    } else {
      // Last resort: recent records table
      comparison = {
        title: `Recent ${this.humanize(P)}`,
        widgetType: 'table',
        prompt: `Show the 10 most recent records from the ${P} table ordered by the first available date or id column descending.`,
      };
    }

    // ── Slot 4: Distribution or second insight ────────────────────
    // Use a bounded categorical column for pie/donut distribution.
    // For scatter: ONLY use two genuine business numeric columns — never PKs
    // or FKs — because scatter(id, foreign_key) produces a meaningless blob.
    // If no good scatter candidates exist, produce a second ranking or table.
    const distCol = cat1 || cat0;
    let distribution: CardSpec;
    if (distCol && distCol !== cat0) {
      // Second distinct category → pie distribution
      distribution = {
        title: `${this.humanize(P)} by ${this.humanize(distCol.name)}`,
        widgetType: 'pie_chart',
        prompt: `Show the count of records in the ${P} table grouped by ${distCol.name}, limited to the top 8 groups, ordered from highest to lowest.`,
      };
    } else if (distCol && measure) {
      // Use same category but as a donut for visual variety
      distribution = {
        title: `${this.humanize(measure.name)} Share by ${this.humanize(distCol.name)}`,
        widgetType: 'donut_chart',
        prompt: `Show the percentage share of total ${measure.name} grouped by ${distCol.name} in the ${P} table, limited to the top 8 groups.`,
      };
    } else if (businessNumeric.length >= 2 && measure && measure2) {
      // Only produce a scatter when BOTH columns are true business measures
      distribution = {
        title: `${this.humanize(measure.name)} vs ${this.humanize(measure2.name)}`,
        widgetType: 'scatter',
        prompt: `Show the relationship between ${measure.name} and ${measure2.name} from the ${P} table, returning ${measure.name} as x and ${measure2.name} as y for up to 200 records.`,
      };
    } else if (measure2) {
      // Second business metric card
      distribution = {
        title: `Average ${this.humanize(measure2.name)}`,
        widgetType: 'metric_card',
        prompt: `Calculate the average value of ${measure2.name} across all records in the ${P} table.`,
      };
    } else {
      // Nothing better available — show a data table of recent records
      distribution = {
        title: `Recent ${this.humanize(P)}`,
        widgetType: 'table',
        prompt: `Show the 10 most recent records from the ${P} table.`,
      };
    }

    return [kpi, trend, comparison, distribution];
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
    if (spec.insightSummary) queryDefinition.insightSummary = spec.insightSummary;
    if (spec.metricContext) queryDefinition.metricContext = spec.metricContext;
    if (spec.businessSignificance) queryDefinition.businessSignificance = spec.businessSignificance;

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

  /** Raw date-FRAGMENT column names — the smoking gun for an un-aggregated time series
   *  (e.g. separate "mo"/"yr" integer columns instead of one combined period label). */
  private readonly DATE_FRAGMENT_NAME = /^(yrs?|years?|mos?|mons?|months?|days?|qtrs?|quarters?|wks?|weeks?)$/i;

  private specFromExecResult(spec: CardSpec, execResult: ExecResult): Partial<CardSpec> {
    // After execution we may want to refine widget type based on data shape —
    // a chart that "renders" but tells no real story is worse than a plain
    // table, so these checks catch shapes that look fine on paper but are
    // meaningless once plotted.
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

    // Trend charts need ONE combined period label, not separate date-part
    // columns (e.g. "mo" + "yr" alongside the measure) — that shape renders
    // each fragment as its own mismatched-scale line instead of a real trend.
    if (spec.widgetType === 'line_chart' || spec.widgetType === 'area_chart') {
      const dateFragmentCols = columns.filter((c) => this.DATE_FRAGMENT_NAME.test(c.trim()));
      if (dateFragmentCols.length >= 2 || (dateFragmentCols.length >= 1 && numericCols.length > 2)) {
        return { widgetType: 'table' };
      }
    }

    // Distribution/comparison charts need a genuinely short, bounded category
    // label — not free-running text. The result is already GROUP-BY'd (so
    // every returned row is necessarily a distinct label), which means
    // distinct-value-ratio is useless as a post-aggregation signal; average
    // label length/word-count is the reliable tell for "this is prose, not a
    // category" (e.g. a clinic's long "about" description vs. "Active").
    if (spec.widgetType === 'pie_chart' || spec.widgetType === 'donut_chart' || spec.widgetType === 'bar_chart') {
      const nonNumericCols = columns.filter((c) => !numericCols.includes(c));
      const labelCol = nonNumericCols[0] || columns[0];
      const labelValues = rows.map((r) => String(r[labelCol] ?? '')).filter(Boolean);
      if (labelValues.length > 0) {
        const avgLen = labelValues.reduce((s, v) => s + v.length, 0) / labelValues.length;
        const avgWords = labelValues.reduce((s, v) => s + v.trim().split(/\s+/).length, 0) / labelValues.length;
        if (avgLen > 40 || avgWords > 6) {
          return { widgetType: 'table' };
        }
        // Detect raw numeric IDs as axis labels — all values are integers with
        // no semantic meaning (e.g. "35699", "71228" as bar X-axis) — this
        // produces a chart that looks like a histogram of arbitrary surrogate
        // keys and has zero business value. Downgrade to table.
        const allNumericLabels = labelValues.every((v) => /^-?\d+(\.\d+)?$/.test(v.trim()));
        if (allNumericLabels && nonNumericCols.length === 0) {
          // Every "category" label is a number and no non-numeric col exists —
          // this is almost certainly an ID being used as a dimension.
          return { widgetType: 'table' };
        }
        if (allNumericLabels && rows.length > 20) {
          // High-cardinality purely-numeric labels are very likely IDs.
          return { widgetType: 'table' };
        }
      }
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
        await this.mcp.destroySession(session.sessionId).catch(() => { });
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
        await this.mcp.destroySession(session.sessionId).catch(() => { });
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

  /**
   * A column is a true *business* numeric measure — not a surrogate key or
   * foreign-key reference. Only these columns should be used as scatter-plot
   * axes or aggregation measures where IDs would produce meaningless charts.
   */
  private isBusinessNumeric(c: ColumnInfo): boolean {
    return this.isNumeric(c) && !c.isPrimaryKey && !c.isForeignKey;
  }

  private isDate(c: ColumnInfo): boolean {
    return /(date|time|timestamp)/.test(c.dataType);
  }

  private isCategorical(c: ColumnInfo): boolean {
    if (c.isPrimaryKey) return false;
    return /(char|text|varchar|enum|bool|uuid)/.test(c.dataType) || c.isForeignKey;
  }

  /** Column names that almost always hold free-running prose, not a bounded category. */
  private readonly FREE_TEXT_NAME_PATTERN =
    /(description|about|bio|notes?|comment|summary|content|message|body|details?|remarks?|narrative|overview|address)/i;

  /** Column names that strongly suggest a true bounded category. */
  private readonly CATEGORICAL_NAME_HINT =
    /(status|type|category|kind|gender|sex|role|tier|plan|region|country|state|province|city|level|grade|segment|^group$|class|stage|priority|department|brand|channel)/i;

  /**
   * A column is "free text" — and therefore unsuitable as a pie/bar chart
   * dimension — if its name matches common prose-field patterns, or its type
   * is an unbounded `text` column (as opposed to a length-bounded varchar,
   * which is far more likely to hold a real category like "active"/"pending").
   */
  private isFreeTextColumn(c: ColumnInfo): boolean {
    if (this.FREE_TEXT_NAME_PATTERN.test(c.name)) return true;
    if (c.dataType === 'text') return true;
    return false;
  }

  /**
   * Pick the best categorical dimension for a distribution/comparison chart:
   * excludes free-text columns entirely (grouping by one of those is what
   * produced a meaningless "one sliver per row" pie chart), then prefers
   * columns whose name looks like a genuine bounded category.
   */
  private pickCategoricalDimension(categories: ColumnInfo[], exclude?: ColumnInfo): ColumnInfo | undefined {
    const candidates = categories.filter((c) => c !== exclude && !this.isFreeTextColumn(c));
    if (candidates.length === 0) return undefined;
    const scored = candidates.map((c) => ({ c, score: this.CATEGORICAL_NAME_HINT.test(c.name) ? 1 : 0 }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].c;
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

  private async autoSyncSchema(connectionId: string): Promise<void> {
    try {
      const conn = await this.db.queryOne<any>(
        'SELECT * FROM datasource_connections WHERE id = $1',
        [connectionId],
      );
      if (!conn) return;

      const password = decrypt(conn.encrypted_password, this.encKey);
      const schemaResult = await this.mcp.getSchema({
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password,
        database: conn.database_name,
        connectorType: conn.connector_type as ConnectorType,
      });

      await this.db.transaction(async (query) => {
        // Remove old schema
        await query(
          'DELETE FROM connection_schemas WHERE connection_id = $1',
          [connectionId],
        );

        const schemaName = conn.database_name || 'default';
        const schemaRow = await query(
          `INSERT INTO connection_schemas (connection_id, schema_name)
           VALUES ($1, $2) RETURNING id`,
          [connectionId, schemaName],
        );
        const schemaId = schemaRow.rows[0].id;

        const tables = schemaResult?.tables || [];
        if (tables.length > 0) {
          const tableValues: any[] = [];
          const tablePlaceholders: string[] = [];
          let paramIdx = 1;

          for (const table of tables) {
            tablePlaceholders.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, 'table', $${paramIdx++})`);
            tableValues.push(schemaId, connectionId, table.name, table.rowCountEstimate || null);
          }

          const tablesRow = await query(
            `INSERT INTO connection_tables
               (schema_id, connection_id, table_name, table_type, row_count_estimate)
             VALUES ${tablePlaceholders.join(', ')} RETURNING id, table_name`,
            tableValues
          );

          const tableIdMap = new Map<string, string>();
          for (const row of tablesRow.rows) {
            tableIdMap.set(row.table_name, row.id);
          }

          const colValues: any[] = [];
          const colPlaceholders: string[] = [];

          for (const table of tables) {
            const tableId = tableIdMap.get(table.name);
            if (!tableId) continue;

            for (let i = 0; i < (table.columns || []).length; i++) {
              const col = table.columns[i];
              const fk = (table.foreignKeys || []).find(f => f.columnName === col.name);

              colPlaceholders.push('');
              colValues.push(
                tableId, connectionId, col.name, col.type, col.nullable ?? true,
                col.isPrimaryKey ?? false, !!fk, fk ? fk.referencedTable : null, fk ? fk.referencedColumn : null,
                i, col.comment || null
              );
            }
          }

          if (colValues.length > 0) {
            const colsPerChunk = 5000;
            const paramsPerCol = 11;

            for (let i = 0; i < colPlaceholders.length; i += colsPerChunk) {
              const chunkEnd = Math.min(i + colsPerChunk, colPlaceholders.length);
              const chunkValues = colValues.slice(i * paramsPerCol, chunkEnd * paramsPerCol);

              const chunkPlaceholders = [];
              for (let j = 0; j < chunkEnd - i; j++) {
                const base = j * paramsPerCol;
                chunkPlaceholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`);
              }

              await query(
                `INSERT INTO connection_columns
                   (table_id, connection_id, column_name, data_type, is_nullable,
                    is_primary_key, is_foreign_key, fk_ref_table, fk_ref_column,
                    ordinal_position, description)
                 VALUES ${chunkPlaceholders.join(', ')}`,
                chunkValues
              );
            }
          }
        }

        await query(
          'UPDATE datasource_connections SET schema_synced_at = NOW(), status = $1 WHERE id = $2',
          ['active', connectionId],
        );
      });
      this.logger.log(`Auto synced schema for connection ${connectionId}`);
    } catch (e: any) {
      this.logger.error(`autoSyncSchema failed for connection ${connectionId}: ${e?.message}`, e?.stack);
    }
  }
}
