// ──────────────────────────────────────────────
// Frontend Type Contracts
// ──────────────────────────────────────────────

export type ConnectorType = 'mysql' | 'postgres' | 'mongodb' | 'elasticsearch';

/** Connector family — determines validation engine & prompt strategy */
export type ConnectorFamily = 'sql' | 'elasticsearch' | 'document';

/** Generative UI hint — which component the LLM recommends rendering */
export type UIHint =
  | 'metric_card'
  | 'bar_chart'
  | 'line_chart'
  | 'pie_chart'
  | 'area_chart'
  | 'data_table'
  | 'list'
  | 'stat_grid'
  | 'heatmap'
  | 'donut_chart'
  | 'stacked_bar'
  | 'horizontal_bar'
  | 'scatter'
  | 'scatter_plot'
  | 'radar_chart'
  | 'gauge'
  | 'number_trend'
  | 'comparison_card'
  | 'funnel_chart'
  | 'timeline'
  | 'treemap';

/** Map a ConnectorType to its family */
export function getConnectorFamily(type: ConnectorType): ConnectorFamily {
  switch (type) {
    case 'mysql':
    case 'postgres':
      return 'sql';
    case 'elasticsearch':
      return 'elasticsearch';
    case 'mongodb':
      return 'document';
    default:
      return 'sql';
  }
}

export interface ConnectionParams {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  connectorType: ConnectorType;
}

export interface ConnectionResponse {
  sessionId: string;
  connectorType: ConnectorType;
  database: string;
  host: string;
  port: number;
  capabilities: {
    readOnly: boolean;
    maxResultRows: number;
  };
  tables: {
    name: string;
    columnCount: number;
    primaryKeys: string[];
    foreignKeyCount: number;
  }[];
}

export interface TableInfo {
  name: string;
  columnCount: number;
  primaryKeys: string[];
  foreignKeyCount: number;
}

export interface QueryPlanResult {
  sql: string;
  explanation: string;
  tables_used: string[];
  confidence: number;
  validationVerdict: 'ACCEPT' | 'REJECT' | 'CONVERSATIONAL';
  validationReasons: string[];
  requiresApproval: boolean;
  ui_hint?: UIHint;
  follow_up_questions?: string[];
}

export interface QueryExecutionResult {
  sql: string;
  explanation: string;
  tables_used: string[];
  confidence: number;
  executionTime: number;
  rowCount: number;
  totalHits?: number;
  rows: Record<string, unknown>[];
  columns: string[];
  insight?: string;
  ui_hint?: UIHint;
  follow_up_questions?: string[];
}

export interface QueryAskResult {
  plan: QueryPlanResult;
  execution?: QueryExecutionResult;
}

export interface StreamEvent {
  type: 'explanation' | 'plan' | 'validation' | 'executing' | 'result' | 'error' | 'done';
  data: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  plan?: QueryPlanResult;
  execution?: QueryExecutionResult;
  isStreaming?: boolean;
  /** True when the plan is awaiting explicit user approval before execution */
  pendingApproval?: boolean;
}

export interface StructuredError {
  type: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

// ── Schema Topology ────────────────────────

export interface SchemaColumn {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  nullable: boolean;
}

export interface SchemaForeignKey {
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface SchemaReferencedBy {
  fromTable: string;
  fromColumn: string;
  toColumn: string;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
  primaryKeys: string[];
  foreignKeys: SchemaForeignKey[];
  referencedBy: SchemaReferencedBy[];
}

export interface SchemaTopology {
  database: string;
  hash: string;
  extractedAt: string;
  tables: SchemaTable[];
  relationships: { from: string; to: string }[];
  stats: {
    totalTables: number;
    totalColumns: number;
    totalRelationships: number;
  };
}

// ── Dashboard Types ────────────────────────

export interface DashboardWidget {
  id: string;
  title: string;
  prompt: string;
  ui_hint: UIHint;
  size: 'sm' | 'md' | 'lg';
}

export interface DashboardWidgetResult extends DashboardWidget {
  loading: boolean;
  error?: string;
  execution?: QueryExecutionResult;
}
