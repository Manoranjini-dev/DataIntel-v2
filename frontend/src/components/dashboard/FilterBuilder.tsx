'use client';

// ──────────────────────────────────────────────
// FilterBuilder — authoring UI for row filters
// ──────────────────────────────────────────────
//
// Reusable editor for a FilterSet. Given the available columns and a sample of
// returned rows, it infers each dimension's data type and offers only the
// operators valid for that type (numeric / string / date). Used both in the
// widget editor (per-card filters) and the dashboard filter manager (global
// filters). Pure controlled component — the parent owns the FilterSet.

import { Trash2, Plus, Lock, Unlock } from 'lucide-react';
import {
  inferColumnType,
  operatorsForType,
  operatorNeedsNoValue,
  defaultOperatorForType,
  RELATIVE_UNITS,
  type ColumnType,
  type FilterCondition,
  type FilterOperator,
  type FilterSet,
  type RelativeUnit,
} from '@/lib/filters';

const inputCls =
  'px-2 py-1.5 bg-muted/50 border border-border rounded-lg text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';

interface Props {
  value: FilterSet | undefined | null;
  onChange: (fs: FilterSet) => void;
  columns: string[];
  /** Sample rows used to infer each column's data type. */
  rows: Record<string, unknown>[];
  /** Compact single-line layout (dashboard filter bar) vs stacked (editor). */
  compact?: boolean;
  /** DC-04 — editor context: show per-filter lock/unlock toggles. Viewers omit
   *  this, so locked filters render read-only and cannot be unlocked. */
  canLock?: boolean;
}

function emptySet(): FilterSet {
  return { conjunction: 'and', conditions: [] };
}

export function FilterBuilder({ value, onChange, columns, rows, compact, canLock }: Props) {
  const fs = value && value.conditions ? value : emptySet();

  function patch(next: Partial<FilterSet>) {
    onChange({ ...fs, ...next });
  }

  function updateCond(id: string, changes: Partial<FilterCondition>) {
    patch({ conditions: fs.conditions.map((c) => (c.id === id ? { ...c, ...changes } : c)) });
  }

  function removeCond(id: string) {
    patch({ conditions: fs.conditions.filter((c) => c.id !== id) });
  }

  function addCond() {
    const firstCol = columns[0] || '';
    const colType: ColumnType = firstCol ? inferColumnType(rows, firstCol) : 'string';
    const cond: FilterCondition = {
      id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      column: firstCol,
      colType,
      operator: defaultOperatorForType(colType),
    };
    patch({ conditions: [...fs.conditions, cond] });
  }

  // Changing the column re-infers the type and resets the operator/value.
  function changeColumn(id: string, column: string) {
    const colType = inferColumnType(rows, column);
    updateCond(id, {
      column,
      colType,
      operator: defaultOperatorForType(colType),
      value: undefined,
      values: undefined,
      relativeN: undefined,
      relativeUnit: undefined,
      from: undefined,
      to: undefined,
    });
  }

  function changeOperator(id: string, operator: FilterOperator) {
    // Reset value payloads that don't apply to the new operator.
    updateCond(id, { operator, value: undefined, values: undefined, relativeN: undefined, relativeUnit: undefined, from: undefined, to: undefined });
  }

  return (
    <div className={compact ? 'flex flex-wrap items-end gap-2' : 'space-y-2'}>
      {fs.conditions.length > 1 && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>Match</span>
          <select
            value={fs.conjunction}
            onChange={(e) => patch({ conjunction: e.target.value as 'and' | 'or' })}
            className={inputCls}
          >
            <option value="and">ALL conditions (AND)</option>
            <option value="or">ANY condition (OR)</option>
          </select>
        </div>
      )}

      {fs.conditions.map((c) => (
        <ConditionRow
          key={c.id}
          cond={c}
          columns={columns}
          canLock={canLock}
          onColumn={(col) => changeColumn(c.id, col)}
          onOperator={(op) => changeOperator(c.id, op)}
          onChange={(changes) => updateCond(c.id, changes)}
          onToggleLock={() => updateCond(c.id, { locked: !c.locked })}
          onRemove={() => removeCond(c.id)}
        />
      ))}

      <button
        type="button"
        onClick={addCond}
        disabled={columns.length === 0}
        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40"
      >
        <Plus className="w-3 h-3" /> Add filter
      </button>
    </div>
  );
}

function ConditionRow({
  cond,
  columns,
  canLock,
  onColumn,
  onOperator,
  onChange,
  onToggleLock,
  onRemove,
}: {
  cond: FilterCondition;
  columns: string[];
  canLock?: boolean;
  onColumn: (col: string) => void;
  onOperator: (op: FilterOperator) => void;
  onChange: (changes: Partial<FilterCondition>) => void;
  onToggleLock: () => void;
  onRemove: () => void;
}) {
  const ops = operatorsForType(cond.colType);
  // DC-04 — a locked filter is read-only: fields disabled and removal blocked.
  // Only an editor (canLock) may unlock it (which re-enables editing).
  const locked = !!cond.locked;
  const disabled = locked;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${locked ? 'opacity-90' : ''}`}>
      <select value={cond.column} disabled={disabled} onChange={(e) => onColumn(e.target.value)} className={`${inputCls} min-w-[7rem] disabled:opacity-60 disabled:cursor-not-allowed`}>
        {!columns.includes(cond.column) && cond.column && <option value={cond.column}>{cond.column}</option>}
        {columns.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      <select value={cond.operator} disabled={disabled} onChange={(e) => onOperator(e.target.value as FilterOperator)} className={`${inputCls} disabled:opacity-60 disabled:cursor-not-allowed`}>
        {ops.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <ValueEditor cond={cond} onChange={onChange} disabled={disabled} />

      {/* DC-04 lock toggle — editors only. Viewers see a static lock badge. */}
      {canLock ? (
        <button
          type="button"
          onClick={onToggleLock}
          className={`px-1.5 py-1 transition-colors ${locked ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          title={locked ? 'Unlock filter (allow viewers to edit)' : 'Lock filter (viewers cannot edit)'}
        >
          {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
        </button>
      ) : locked ? (
        <span className="px-1.5 py-1 text-primary" title="Locked by an editor — read-only">
          <Lock className="w-3.5 h-3.5" />
        </span>
      ) : null}

      <button
        type="button"
        onClick={onRemove}
        disabled={locked}
        className="px-1.5 py-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
        title={locked ? 'Unlock to remove' : 'Remove filter'}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function ValueEditor({ cond, onChange, disabled }: { cond: FilterCondition; onChange: (changes: Partial<FilterCondition>) => void; disabled?: boolean }) {
  if (operatorNeedsNoValue(cond.operator)) return null;
  const dcls = `${inputCls} disabled:opacity-60 disabled:cursor-not-allowed`;

  // ── Date: relative ──
  if (cond.operator === 'relative') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        Last
        <input
          type="number"
          min={1}
          disabled={disabled}
          value={cond.relativeN ?? ''}
          onChange={(e) => onChange({ relativeN: e.target.value === '' ? undefined : Number(e.target.value) })}
          placeholder="N"
          className={`${dcls} w-16`}
        />
        <select
          value={cond.relativeUnit ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ relativeUnit: (e.target.value || undefined) as RelativeUnit | undefined })}
          className={dcls}
        >
          <option value="">unit…</option>
          {RELATIVE_UNITS.map((u) => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </select>
      </span>
    );
  }

  // ── Date: custom range ──
  if (cond.operator === 'custom_range') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        From
        <input
          type="datetime-local"
          disabled={disabled}
          value={cond.from ?? ''}
          onChange={(e) => onChange({ from: e.target.value || undefined })}
          className={dcls}
        />
        To
        <input
          type="datetime-local"
          disabled={disabled}
          value={cond.to ?? ''}
          onChange={(e) => onChange({ to: e.target.value || undefined })}
          className={dcls}
        />
      </span>
    );
  }

  // ── String: in / not_in (comma-separated multi-value) ──
  if (cond.operator === 'in' || cond.operator === 'not_in') {
    return (
      <input
        disabled={disabled}
        value={(cond.values ?? []).join(', ')}
        onChange={(e) =>
          onChange({ values: e.target.value.split(',').map((s) => s.trim()).filter((s) => s !== '') })
        }
        placeholder="value1, value2, …"
        className={`${dcls} min-w-[10rem]`}
      />
    );
  }

  // ── Single value (numeric / string comparisons) ──
  return (
    <input
      type={cond.colType === 'numeric' ? 'number' : 'text'}
      disabled={disabled}
      value={cond.value ?? ''}
      onChange={(e) => onChange({ value: cond.colType === 'numeric' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value })}
      placeholder="value"
      className={`${dcls} min-w-[8rem]`}
    />
  );
}
