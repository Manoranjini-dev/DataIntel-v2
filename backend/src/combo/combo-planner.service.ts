// ──────────────────────────────────────────────
// Combo Query Planner
// Sends merged schema + combo system prompt to LLM
// Returns a multi-step execution plan with merge strategy
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { LLMService } from '../llm/llm.service';
import { SchemaMergerService } from './schema-merger.service';
import { ComboQueryPlan, ComboSchemaSource, MergeStrategy } from './combo.types';

const COMBO_SYSTEM_PROMPT = `You are a multi-datasource query planner for DataIntel.
You are given a merged schema from MULTIPLE data sources. Each table is prefixed with [alias:database].

Your task:
1. Analyze the user's question
2. Determine which tables/sources are needed
3. Generate a SEPARATE query for EACH source
4. Choose the best merge strategy

Return a JSON object (no markdown, just JSON) with this exact structure:
{
  "steps": [
    {
      "source": "alias:database",
      "connectionId": "uuid-of-connection",
      "query": "SELECT ...",
      "alias": "descriptive_result_name"
    }
  ],
  "merge": {
    "strategy": "join" | "union" | "append" | "independent",
    "joinKey": "column_name",
    "outputColumns": ["col1", "col2", ...]
  },
  "explanation": "Brief explanation of the plan",
  "ui_hint": "bar_chart" // Choose from: bar_chart, line_chart, pie_chart, data_table, metric_card, stat_grid, list
}

Merge strategy guidelines:
- "join": Use when sources share a common dimension key (e.g., region, user_id, date). Specify joinKey.
- "union": Use when sources have the SAME schema shape (e.g., orders from two DBs).
- "append": Use when sources have DIFFERENT shapes but should be shown together.
- "independent": Use when results are unrelated (show side by side, no merging).

CRITICAL RULES:
- Only generate READ-ONLY queries (SELECT only)
- Respect each source's SQL dialect (MySQL vs PostgreSQL vs Elasticsearch DSL)
- For Elasticsearch, generate ES query DSL JSON not SQL
- Keep queries simple - avoid complex subqueries
- Do not JOIN across different sources in a single query - that's what the merge step is for`;

@Injectable()
export class ComboPlannerService {
  private readonly logger = new Logger(ComboPlannerService.name);

  constructor(
    private readonly llmService: LLMService,
    private readonly schemaMerger: SchemaMergerService,
  ) {}

  async plan(
    comboId: string,
    prompt: string,
    sources: ComboSchemaSource[],
    mergedContext: string,
  ): Promise<ComboQueryPlan> {
    // Build source map for the LLM to reference connectionIds
    const sourceMap = sources.map(s => ({
      alias: s.alias,
      connectionId: s.connectionId,
      connectorType: s.connectorType,
      database: s.databaseName,
    }));

    const userMessage = `
MERGED SCHEMA:
${mergedContext}

SOURCE MAP (alias → connectionId):
${JSON.stringify(sourceMap, null, 2)}

USER QUESTION: "${prompt}"

Generate the multi-step query plan JSON:`;

    let planJson: string;
    try {
      planJson = await this.llmService.generateFreeText(
        COMBO_SYSTEM_PROMPT,
        userMessage,
        2000,
      );
    } catch (err: any) {
      throw new Error(`LLM planning failed: ${err.message}`);
    }

    // Extract JSON from LLM response (handle potential markdown wrapping)
    const jsonMatch = planJson.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('LLM returned invalid plan — no JSON found');
    }

    let plan: ComboQueryPlan;
    try {
      plan = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('LLM returned malformed JSON plan');
    }

    // Validate structure
    if (!plan.steps?.length) {
      throw new Error('Combo plan has no steps');
    }
    if (!plan.merge?.strategy) {
      plan.merge = { strategy: 'independent' };
    }

    // Fill in missing connectionIds from sourceMap
    for (const step of plan.steps) {
      if (!step.connectionId) {
        const src = sources.find(s => s.alias === step.source.split(':')[0] || step.source.includes(s.alias));
        if (src) step.connectionId = src.connectionId;
      }
    }

    this.logger.log(`Combo plan for ${comboId}: ${plan.steps.length} steps, strategy=${plan.merge.strategy}`);
    return plan;
  }
}
