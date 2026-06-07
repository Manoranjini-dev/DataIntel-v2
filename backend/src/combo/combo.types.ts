// ──────────────────────────────────────────────
// Combo Query Types
// ──────────────────────────────────────────────

export interface ComboSchemaSource {
  connectionId: string;
  connectionName: string;
  alias: string;
  connectorType: string;
  databaseName: string;
  tables: ComboTable[];
}

export interface ComboTable {
  tableName: string;
  rowCountEstimate?: number;
  columns: ComboColumn[];
}

export interface ComboColumn {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export type MergeStrategy = 'join' | 'union' | 'append' | 'independent';

export interface ComboStep {
  source: string;          // alias like "mysql:ecommerce"
  connectionId: string;
  query: string;
  alias: string;           // result alias e.g. "revenue_by_region"
}

export interface MergePlan {
  strategy: MergeStrategy;
  joinKey?: string;        // for 'join' strategy
  outputColumns?: string[];
}

export interface ComboQueryPlan {
  steps: ComboStep[];
  merge: MergePlan;
  explanation?: string;
  ui_hint?: any;
}

export interface StepResult {
  step: ComboStep;
  rows: Record<string, any>[];
  columns: string[];
  rowCount: number;
  executionTimeMs: number;
  status: 'success' | 'failed';
  error?: string;
}

export interface ComboExecutionResult {
  plan: ComboQueryPlan;
  stepResults: StepResult[];
  mergedRows: Record<string, any>[];
  mergedColumns: string[];
  totalRows: number;
  totalExecutionTimeMs: number;
  mergeStrategy: MergeStrategy;
}
