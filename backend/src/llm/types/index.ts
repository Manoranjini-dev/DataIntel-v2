// ──────────────────────────────────────────────
// LLM Types
// ──────────────────────────────────────────────

import { ConnectorFamily } from '../../common/types';

/**
 * Generative UI hint — tells the frontend which component to render.
 * The LLM selects this based on query intent and expected result shape.
 */
export type UIHint =
  | 'metric_card'   // Single KPI value (count, sum, avg)
  | 'bar_chart'     // Categorical comparisons
  | 'line_chart'    // Time-series / trends
  | 'pie_chart'     // Proportional distribution
  | 'area_chart'    // Accumulated / stacked trends
  | 'data_table'    // Raw data, multi-column results
  | 'list'          // Simple single-column lists (emails, names, IDs)
  | 'stat_grid'     // Multiple metrics side-by-side
  | 'heatmap';      // Matrix / correlation data

export interface LLMContext {
  systemPrompt: string;
  compressedSchema: string;
  conversationSummary: string | null;
  recentMessages: { role: 'user' | 'assistant'; content: string }[];
  userPrompt: string;
  connectorFamily: ConnectorFamily;
  /** When set, injected as a correction hint so the LLM can fix a validation error on retry */
  validationFeedback?: string;
}

/**
 * Unified LLM response — works for both SQL and ES DSL.
 *
 * For SQL connectors: `sql` contains the SQL query, `tables_used` contains table names.
 * For ES connectors: `sql` contains the stringified ES DSL JSON, `tables_used` contains index names.
 *
 * The field is named 'sql' for backward compatibility across the entire pipeline.
 * The LLM prompt instructs the model to use the right format per connector family.
 */
export interface LLMResponse {
  /** 'conversational' when the LLM answered analytically without generating a query */
  type?: 'data_query' | 'conversational' | 'schema_query';
  sql: string;
  explanation: string;
  tables_used: string[];
  confidence: number;
  intent?: string; // ES-specific: 'search' | 'aggregate' | 'count' | 'analyze'
  ui_hint?: UIHint; // Generative UI — recommended frontend component
  follow_up_questions?: string[]; // Suggested next questions for non-technical users
  schema_query_params?: { limit: number; offset: number }; // Used when type is 'schema_query'
}

export interface LLMStreamChunk {
  type: 'explanation' | 'complete';
  content: string;
  data?: LLMResponse;
}
