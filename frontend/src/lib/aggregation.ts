// ──────────────────────────────────────────────
// Client-side aggregation/grouping for dashboard widgets
// ──────────────────────────────────────────────
//
// Widgets are populated by an LLM-generated SQL query — there is no manual
// query builder. This module lets a user reshape the *already-returned*
// rows (group by a dimension, aggregate a measure) purely client-side,
// without touching the SQL. It is a pure, deterministic transform so
// changing the config is reflected immediately and identically on every
// render/reload.

import { applyCustomMeasures, type CustomMeasure } from './custom-measures';
import { applyFilters, type FilterSet } from './filters';

export type { CustomMeasure };
export type { FilterSet };

export type AggregationFn = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'count_distinct' | 'median';

export const AGGREGATION_OPTIONS: { value: AggregationFn; label: string }[] = [
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'count', label: 'Count' },
  { value: 'count_distinct', label: 'Count (Distinct)' },
  { value: 'median', label: 'Median' },
];

export interface VisualizationConfig {
  /** Overrides the widget's stored chart type for rendering only. */
  vizType?: string;
  xAxis?: string;
  yAxis?: string;
  groupBy?: string;
  aggregation?: AggregationFn;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  /** Defaults to true (matches existing chart behavior) when unset. */
  showLegend?: boolean;

  /** User-defined calculated fields, computed as extra columns before render. */
  customMeasures?: CustomMeasure[];

  /**
   * Row filters applied to the returned data before measures/aggregation.
   * Operators are gated by the inferred column type (see ./filters).
   */
  filters?: FilterSet;

  // ── Gauge config ──
  /** Target/threshold the KPI is compared against. */
  gaugeTarget?: number;
  gaugeMin?: number;
  gaugeMax?: number;

  // ── Map config ──
  /** Column holding a country/region name (choropleth mode). */
  locationField?: string;
  /** Latitude / longitude columns (marker mode). */
  latField?: string;
  lonField?: string;
  /** Measure column shaded/sized on the map. */
  mapValueField?: string;

  // ── Matrix (pivot) config ──
  matrixRows?: string[];
  matrixCols?: string[];
  matrixMeasure?: string;
  matrixAggregation?: AggregationFn;
}

/** Aggregations that only make sense on numeric values. */
export const NUMERIC_ONLY_AGGREGATIONS: AggregationFn[] = ['sum', 'avg', 'min', 'max', 'median'];

export function isNumericColumn(rows: Record<string, unknown>[], col: string): boolean {
  const sample = rows.slice(0, 25).filter((r) => r[col] != null);
  if (sample.length === 0) return false;
  return sample.every((r) => !isNaN(Number(r[col])));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function aggregate(fn: AggregationFn, values: unknown[]): number {
  if (fn === 'count') return values.length;
  if (fn === 'count_distinct') return new Set(values.map((v) => String(v))).size;
  const nums = values.map((v) => Number(v)).filter((n) => !isNaN(n));
  if (nums.length === 0) return 0;
  switch (fn) {
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    case 'median': return median(nums);
    default: return 0;
  }
}

/**
 * Reshape rows according to a VisualizationConfig. Returns the rows
 * unchanged when the config has no grouping/aggregation set, so widgets
 * with no configuration (i.e. every widget today) render exactly as before.
 */
export function applyVisualizationConfig(
  rows: Record<string, unknown>[],
  columns: string[],
  config: VisualizationConfig | undefined | null,
): { rows: Record<string, unknown>[]; columns: string[] } {
  if (!rows || rows.length === 0 || !config) return { rows, columns };

  // Filters first — they act on the raw returned rows, before calculated
  // fields and aggregation reshape the data.
  const filteredRows = applyFilters(rows, config.filters);
  if (filteredRows.length === 0) return { rows: [], columns };

  // Calculated fields next, so they can be used as axes / aggregation targets.
  const withMeasures = applyCustomMeasures(filteredRows, columns, config.customMeasures);
  let outRows = withMeasures.rows;
  let outColumns = withMeasures.columns;

  const groupField = config.groupBy || config.xAxis;
  const hasAggregation = !!(groupField && config.aggregation && config.yAxis);

  if (hasAggregation) {
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of outRows) {
      const key = String(row[groupField!] ?? '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    outRows = Array.from(groups.entries()).map(([key, groupRows]) => ({
      [groupField!]: key,
      [config.yAxis!]: aggregate(config.aggregation!, groupRows.map((r) => r[config.yAxis!])),
    }));
    outColumns = [groupField!, config.yAxis!];
  }

  if (config.sortBy && outColumns.includes(config.sortBy)) {
    const dir = config.sortDir === 'desc' ? -1 : 1;
    outRows = [...outRows].sort((a, b) => {
      const aVal = a[config.sortBy!];
      const bVal = b[config.sortBy!];
      const aNum = Number(aVal), bNum = Number(bVal);
      if (!isNaN(aNum) && !isNaN(bNum)) return (aNum - bNum) * dir;
      return String(aVal ?? '').localeCompare(String(bVal ?? '')) * dir;
    });
  }

  return { rows: outRows, columns: outColumns };
}
