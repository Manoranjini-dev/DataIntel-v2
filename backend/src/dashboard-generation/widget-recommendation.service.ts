import { Injectable, Logger } from '@nestjs/common';
import { LLMService } from '../llm/llm.service';

export interface WidgetRecommendation {
  widgetType: string;
  title: string;
  queryPrompt: string;
  priority: number;
}

export interface RichSchemaContext {
  schema: string;   // "table(col type PK, col type, ...)\n..." one line per table
  tables: string[]; // table names for fallback
}

@Injectable()
export class WidgetRecommendationService {
  private readonly logger = new Logger(WidgetRecommendationService.name);

  constructor(private readonly llm: LLMService) {}

  /**
   * Recommend dashboard widgets using LLM with full schema awareness,
   * category diversity enforcement, and deduplication against existing widgets.
   *
   * @param intent        User-provided natural language intent
   * @param schemaContext Rich schema with column details; falls back to table names
   * @param existingPrompts Prompts already used in widgets on this dashboard (dedup)
   */
  async recommendWidgets(
    intent: string,
    schemaContext: RichSchemaContext | { tables: string[] },
    existingPrompts: string[] = [],
  ): Promise<WidgetRecommendation[]> {
    const rich = schemaContext as RichSchemaContext;
    const schema = rich.schema?.trim() || rich.tables.join(', ');
    const tables = rich.tables;

    if (!tables.length) {
      return [];
    }

    try {
      const recs = await this.llmRecommendations(intent, schema, existingPrompts);
      if (recs.length) return recs;
    } catch (err: any) {
      this.logger.warn(`LLM widget recommendation failed: ${err.message}`);
    }

    return this.fallbackRecommendations(tables);
  }

  private async llmRecommendations(
    intent: string,
    schema: string,
    existingPrompts: string[],
  ): Promise<WidgetRecommendation[]> {
    const dedupBlock = existingPrompts.length
      ? `\nALREADY COVERED INSIGHTS — do NOT generate questions that overlap with these:\n` +
        existingPrompts.map((p, i) => `${i + 1}. ${p}`).join('\n') + '\n'
      : '';

    const systemPrompt = `You are a senior BI analyst generating 4 diverse, high-value dashboard widget recommendations for a business intelligence platform.

Your job is to propose exactly 4 analytics questions that collectively give the user a complete, highly meaningful picture of their data. Each question must be unique, actionable, and answerable from the provided schema.

CATEGORY COVERAGE — include at least one insight from 4 of these categories:
1. TREND       — how a key metric changes over time (requires a date column); use line_chart or area_chart
2. RANKING     — top N or bottom N entities ranked by a numeric measure; use bar_chart
3. DISTRIBUTION — how a measure is split across segments (share/breakdown); use pie_chart, donut_chart, or bar_chart
4. KPI         — a single high-level business aggregate (total, average, max); use metric_card
5. ANOMALY     — identify outliers, concentration risk, or underperformers; use bar_chart or table
6. OPERATIONAL — recent activity, current status, or record-level detail; use table

SCHEMA GROUNDING RULES:
- Every queryPrompt MUST reference real table and column names from the schema below
- Prefer queries that always return data: use COUNT(*), SUM, GROUP BY rather than filters that might return 0 rows
- ABSOLUTELY FORBIDDEN: You must NEVER use any column with "id" or "by" in its name (e.g., account_id, user_id, clinic_id, created_by, updated_by) for grouping or axes. This is a strict requirement. If you group by an ID, the dashboard will crash.
- ABSOLUTELY FORBIDDEN: You must NEVER use any unique identifier or time column (e.g., license_no, phone, email, ssn, code, website, url, clinic_name, name, time, date) for grouping or categories, because it produces a meaningless chart.
- MANDATORY: You MUST use meaningful low-cardinality business categories for grouping/axes (e.g., status, type, category, tier, role). DO NOT group by geographical columns (city, prefecture, region) as they often produce cluttered and unhelpful insights.
- For TREND widgets: use an existing date/timestamp column grouped by MONTH or DAY
- For RANKING widgets: use a numeric column for sorting (revenue, count, amount, total)
- For DISTRIBUTION widgets: use a low-cardinality categorical column (status, category, type, tier, role)
- For KPI widgets: produce exactly one number (SUM, COUNT, AVG, MAX of a key metric)
- When counting records, explicitly alias the count column using the entity name (e.g., "clinic_count" instead of "record_count" or "count") so it is easily understandable for users.
- queryPrompt must be specific enough that a text-to-SQL engine can generate valid SQL with no ambiguity
${dedupBlock}
OUTPUT FORMAT — return ONLY a JSON array of exactly 4 objects (no markdown, no code fences):
[
  {
    "title": "short business title (max 6 words)",
    "queryPrompt": "precise natural-language question referencing real table/column names",
    "widgetType": "metric_card|bar_chart|line_chart|area_chart|pie_chart|donut_chart|table",
    "category": "trend|ranking|distribution|kpi|anomaly|operational",
    "priority": 1
  },
  ...
]`;

    const userContent = `Business intent: "${intent || 'general analytics overview'}"\n\nDatabase schema:\n${schema}\n\nReturn the JSON array of 4 diverse widget recommendations now.`;

    const raw = await this.llm.generateFreeText(systemPrompt, userContent, 1500);
    return this.parseRecommendations(raw) ?? [];
  }

  private parseRecommendations(raw: string): WidgetRecommendation[] | null {
    if (!raw) return null;
    let text = raw.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
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

    const results: WidgetRecommendation[] = [];
    for (const item of parsed as Record<string, unknown>[]) {
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      const queryPrompt = typeof item.queryPrompt === 'string' ? item.queryPrompt.trim() : '';
      const widgetType = typeof item.widgetType === 'string' ? item.widgetType.trim() : 'table';
      const priority = typeof item.priority === 'number' ? item.priority : results.length + 1;
      if (!title || !queryPrompt) continue;
      results.push({ title, queryPrompt, widgetType, priority });
    }
    return results.length ? results : null;
  }

  private fallbackRecommendations(tables: string[]): WidgetRecommendation[] {
    const primary = tables[0] || 'records';
    const second = tables[1];
    const recs: WidgetRecommendation[] = [
      {
        widgetType: 'metric_card',
        title: `Total ${primary} Count`,
        queryPrompt: `Count the total number of records in the ${primary} table.`,
        priority: 1,
      },
      {
        widgetType: 'table',
        title: 'Recent Activity',
        queryPrompt: `Show the 10 most recent records from ${primary} ordered by the latest date or ID column descending.`,
        priority: 2,
      },
    ];
    if (second) {
      recs.push({
        widgetType: 'bar_chart',
        title: `${primary} by Category`,
        queryPrompt: `Show ${primary} grouped by the most relevant categorical column from ${second}, ordered by count descending, top 10.`,
        priority: 3,
      });
    }
    return recs;
  }
}
