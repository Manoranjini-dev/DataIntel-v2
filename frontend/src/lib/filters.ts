// ──────────────────────────────────────────────
// Filter engine (Supported Filters & Operators)
// ──────────────────────────────────────────────
//
// Widgets/cards are populated by an LLM-generated query — there is no manual
// query builder. This module lets a user filter the *already-returned* rows
// purely client-side, with the operator set gated by the data type inferred
// from the returned data (numeric / string / date). It is a pure, deterministic
// transform: the same filter + the same rows always yields the same output, so
// filtering is reflected identically on every render/reload and works uniformly
// across SQL, combo, Elasticsearch and Mongo widgets.

export type ColumnType = 'numeric' | 'string' | 'date';

export type FilterOperator =
  // numeric
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_null' | 'is_not_null'
  // string (eq/neq/is_null/is_not_null are shared with numeric)
  | 'contains' | 'not_contains' | 'starts_with' | 'not_starts_with'
  | 'ends_with' | 'not_ends_with' | 'in' | 'not_in'
  // date/time
  | 'relative' | 'today' | 'current_week' | 'current_month' | 'custom_range';

export type RelativeUnit = 'minute' | 'hour' | 'day' | 'month';

export interface FilterCondition {
  /** Stable id (React key + delete handle). */
  id: string;
  /** Target column/dimension name. */
  column: string;
  /** Inferred data type of the column (drives the operator set). */
  colType: ColumnType;
  operator: FilterOperator;
  /** Single-value operators (eq/neq/gt/…, contains/starts_with/…). */
  value?: string | number;
  /** Multi-value operators (in / not_in). */
  values?: (string | number)[];
  /** relative: "Last N <unit>". */
  relativeN?: number;
  relativeUnit?: RelativeUnit;
  /** custom_range: ISO datetime bounds (at least one required). */
  from?: string;
  to?: string;
  /** DC-04 — when true, viewers cannot modify or remove this filter; only
   *  editors can toggle the lock. Enforced read-only in view/published/embed. */
  locked?: boolean;
}

export interface FilterSet {
  /** How multiple conditions combine. Defaults to 'and'. */
  conjunction: 'and' | 'or';
  conditions: FilterCondition[];
}

// ── Operator catalogue ──────────────────────────

const NUMERIC_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'eq', label: 'Equal to' },
  { value: 'neq', label: 'Not equal to' },
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'Greater than or equal to' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'Less than or equal to' },
  { value: 'is_null', label: 'Null' },
  { value: 'is_not_null', label: 'Not null' },
];

const STRING_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'eq', label: 'Equal to' },
  { value: 'neq', label: 'Not equal to' },
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Does not contain' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'not_starts_with', label: 'Does not start with' },
  { value: 'ends_with', label: 'Ends with' },
  { value: 'not_ends_with', label: 'Does not end with' },
  { value: 'in', label: 'In' },
  { value: 'not_in', label: 'Not in' },
];

const DATE_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'relative', label: 'Last N…' },
  { value: 'today', label: 'Today' },
  { value: 'current_week', label: 'Current week' },
  { value: 'current_month', label: 'Current month' },
  { value: 'custom_range', label: 'Custom' },
];

export function operatorsForType(type: ColumnType): { value: FilterOperator; label: string }[] {
  switch (type) {
    case 'numeric': return NUMERIC_OPERATORS;
    case 'date': return DATE_OPERATORS;
    default: return STRING_OPERATORS;
  }
}

export const RELATIVE_UNITS: { value: RelativeUnit; label: string }[] = [
  { value: 'minute', label: 'minute(s)' },
  { value: 'hour', label: 'hour(s)' },
  { value: 'day', label: 'day(s)' },
  { value: 'month', label: 'month(s)' },
];

/** Operators that take no value input. */
export function operatorNeedsNoValue(op: FilterOperator): boolean {
  return op === 'is_null' || op === 'is_not_null'
    || op === 'today' || op === 'current_week' || op === 'current_month';
}

// ── Type inference (single source of truth) ─────

/** A column is numeric when every sampled non-null value parses as a number. */
export function isNumericColumn(rows: Record<string, unknown>[], col: string): boolean {
  const sample = rows.slice(0, 25).filter((r) => r[col] != null);
  if (sample.length === 0) return false;
  return sample.every((r) => !isNaN(Number(r[col])));
}

/** Heuristic: does the column *name* look date-ish? */
export function isDateLikeName(col: string): boolean {
  return /date|time|created|updated|_at$|year|month|day|period|week/i.test(col);
}

/** Does a scalar value parse as a date? */
export function isDateValue(value: unknown): boolean {
  if (value instanceof Date) return !isNaN(value.getTime());
  if (typeof value !== 'string') return false;
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(value)) return true;
  // Guard Date.parse: bare numbers ("2024") and short strings would misparse.
  if (value.length < 6) return false;
  return !isNaN(Date.parse(value));
}

/**
 * Infer the filter data type of a column from returned rows. Numeric wins first
 * (so numeric year columns get numeric operators); then a date is detected when
 * the name looks date-ish OR the sampled values parse as dates; otherwise string.
 */
export function inferColumnType(rows: Record<string, unknown>[], col: string): ColumnType {
  if (isNumericColumn(rows, col)) return 'numeric';
  const sample = rows.slice(0, 25).filter((r) => r[col] != null);
  if (sample.length > 0) {
    const allDates = sample.every((r) => isDateValue(r[col]));
    if (allDates) return 'date';
  }
  if (isDateLikeName(col)) return 'date';
  return 'string';
}

/** Default (blank) operator for a freshly-added condition of a given type. */
export function defaultOperatorForType(type: ColumnType): FilterOperator {
  switch (type) {
    case 'numeric': return 'eq';
    case 'date': return 'relative';
    default: return 'contains';
  }
}

// ── Evaluation ──────────────────────────────────

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (value == null) return null;
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? null : d;
}

/** Start of today in local time. */
function startOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Start of the current week (Monday) in local time. */
function startOfWeek(now: Date): Date {
  const d = startOfToday(now);
  const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - dow);
  return d;
}

/** Start of the current month in local time. */
function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function subtractRelative(now: Date, n: number, unit: RelativeUnit): Date {
  const d = new Date(now.getTime());
  switch (unit) {
    case 'minute': d.setMinutes(d.getMinutes() - n); break;
    case 'hour': d.setHours(d.getHours() - n); break;
    case 'day': d.setDate(d.getDate() - n); break;
    case 'month': d.setMonth(d.getMonth() - n); break;
  }
  return d;
}

function evalDate(cond: FilterCondition, cellVal: unknown, now: Date): boolean {
  const cell = toDate(cellVal);
  if (!cell) return false;
  switch (cond.operator) {
    case 'today': {
      const start = startOfToday(now);
      return cell >= start && cell <= now;
    }
    case 'current_week': {
      const start = startOfWeek(now);
      return cell >= start && cell <= now;
    }
    case 'current_month': {
      const start = startOfMonth(now);
      return cell >= start && cell <= now;
    }
    case 'relative': {
      const n = Number(cond.relativeN);
      if (!Number.isFinite(n) || n <= 0 || !cond.relativeUnit) return true;
      const start = subtractRelative(now, n, cond.relativeUnit);
      return cell >= start && cell <= now;
    }
    case 'custom_range': {
      const from = cond.from ? toDate(cond.from) : null;
      const to = cond.to ? toDate(cond.to) : null;
      if (from && cell < from) return false;
      if (to && cell > to) return false;
      // "at least 1 required" — if neither bound is set the condition is inert.
      return true;
    }
    default:
      return true;
  }
}

function evalNumeric(cond: FilterCondition, cellVal: unknown): boolean {
  if (cond.operator === 'is_null') return cellVal == null || cellVal === '';
  if (cond.operator === 'is_not_null') return cellVal != null && cellVal !== '';
  if (cellVal == null || cellVal === '') return false;
  const cell = Number(cellVal);
  const target = Number(cond.value);
  if (isNaN(cell) || isNaN(target)) return false;
  switch (cond.operator) {
    case 'eq': return cell === target;
    case 'neq': return cell !== target;
    case 'gt': return cell > target;
    case 'gte': return cell >= target;
    case 'lt': return cell < target;
    case 'lte': return cell <= target;
    default: return true;
  }
}

function evalString(cond: FilterCondition, cellVal: unknown): boolean {
  if (cond.operator === 'is_null') return cellVal == null || cellVal === '';
  if (cond.operator === 'is_not_null') return cellVal != null && cellVal !== '';

  const cell = cellVal == null ? '' : String(cellVal);
  const cellLc = cell.toLowerCase();

  if (cond.operator === 'in' || cond.operator === 'not_in') {
    const set = (cond.values ?? []).map((v) => String(v).toLowerCase());
    const isIn = set.includes(cellLc);
    return cond.operator === 'in' ? isIn : !isIn;
  }

  const target = (cond.value == null ? '' : String(cond.value)).toLowerCase();
  switch (cond.operator) {
    case 'eq': return cellLc === target;
    case 'neq': return cellLc !== target;
    case 'contains': return cellLc.includes(target);
    case 'not_contains': return !cellLc.includes(target);
    case 'starts_with': return cellLc.startsWith(target);
    case 'not_starts_with': return !cellLc.startsWith(target);
    case 'ends_with': return cellLc.endsWith(target);
    case 'not_ends_with': return !cellLc.endsWith(target);
    default: return true;
  }
}

/** Evaluate a single condition against one row. */
export function evaluateCondition(cond: FilterCondition, row: Record<string, unknown>, now: Date): boolean {
  if (!cond.column) return true; // incomplete condition is inert
  const cell = row[cond.column];
  switch (cond.colType) {
    case 'numeric': return evalNumeric(cond, cell);
    case 'date': return evalDate(cond, cell, now);
    default: return evalString(cond, cell);
  }
}

/**
 * A condition is "actionable" once it has enough input to filter. Incomplete
 * conditions (no value typed yet) are ignored so a half-built filter never
 * blanks the widget.
 */
export function isConditionActive(cond: FilterCondition): boolean {
  if (!cond.column) return false;
  if (operatorNeedsNoValue(cond.operator)) return true;
  switch (cond.operator) {
    case 'in':
    case 'not_in':
      return (cond.values?.length ?? 0) > 0;
    case 'relative':
      return Number.isFinite(Number(cond.relativeN)) && Number(cond.relativeN) > 0 && !!cond.relativeUnit;
    case 'custom_range':
      return !!cond.from || !!cond.to;
    default:
      return cond.value !== undefined && cond.value !== null && String(cond.value) !== '';
  }
}

/**
 * Apply a filter set to rows. Returns rows unchanged when there are no active
 * conditions. Multiple conditions combine with AND (default) or OR.
 */
export function applyFilters(
  rows: Record<string, unknown>[],
  filterSet: FilterSet | undefined | null,
  now: Date = new Date(),
): Record<string, unknown>[] {
  if (!rows || rows.length === 0 || !filterSet) return rows;
  const active = (filterSet.conditions || []).filter(isConditionActive);
  if (active.length === 0) return rows;

  const or = filterSet.conjunction === 'or';
  return rows.filter((row) =>
    or
      ? active.some((c) => evaluateCondition(c, row, now))
      : active.every((c) => evaluateCondition(c, row, now)),
  );
}

/** Merge multiple filter sets (e.g. dashboard-global + per-widget) under AND. */
export function mergeFilterSets(...sets: (FilterSet | undefined | null)[]): FilterSet {
  const conditions: FilterCondition[] = [];
  for (const s of sets) {
    if (s?.conditions?.length) conditions.push(...s.conditions);
  }
  return { conjunction: 'and', conditions };
}

// ── Dashboard-global filter cascade ─────────────

/**
 * A dashboard_filters DB row. The structured columns carry the target/operator;
 * `config` holds the operator-specific payload (value/values/relativeN/…).
 */
export interface DashboardFilterRow {
  id: string;
  column_name: string;
  col_type?: ColumnType | null;
  operator: FilterOperator;
  config?: Partial<FilterCondition> | null;
  /** DC-04 — first-class lock column (falls back to config for older rows). */
  locked?: boolean | null;
}

/** Convert dashboard_filters rows into a client FilterSet (combined with AND). */
export function dashboardFiltersToSet(rows: DashboardFilterRow[] | undefined | null): FilterSet {
  const conditions: FilterCondition[] = (rows || []).map((r) => ({
    ...(r.config || {}),
    id: r.id,
    column: r.column_name,
    colType: (r.col_type || r.config?.colType || 'string') as ColumnType,
    operator: r.operator,
    locked: (r.locked ?? r.config?.locked) === true,
  }));
  return { conjunction: 'and', conditions };
}

/** Serialize a client FilterCondition into the DB payload for add/update. */
export function conditionToDbPayload(cond: FilterCondition): {
  column: string;
  colType: ColumnType;
  operator: FilterOperator;
  config: Partial<FilterCondition>;
  locked: boolean;
} {
  const { id: _id, column, colType, operator, locked, ...rest } = cond;
  void _id;
  // `locked` is promoted to a top-level column; keep it out of `config`.
  return { column, colType, operator, config: rest, locked: locked === true };
}

/**
 * Restrict a filter set to the conditions whose target column exists in
 * `columns` (case-insensitive). A dashboard-global filter only applies to a
 * widget that actually has the targeted dimension.
 */
export function scopeFilterSetToColumns(
  fs: FilterSet | undefined | null,
  columns: string[],
): FilterSet {
  if (!fs?.conditions?.length) return { conjunction: 'and', conditions: [] };
  const lc = new Set(columns.map((c) => c.toLowerCase()));
  return {
    conjunction: fs.conjunction,
    conditions: fs.conditions.filter((c) => lc.has((c.column || '').toLowerCase())),
  };
}
