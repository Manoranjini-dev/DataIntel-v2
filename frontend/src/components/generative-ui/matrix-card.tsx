'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { QueryExecutionResult } from '@/lib/types';
import type { AggregationFn } from '@/lib/aggregation';

interface MatrixCardProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
  /** Hierarchical row dimensions (outer → inner) for drill-down. */
  rowDims?: string[];
  /** Single column dimension pivoted into columns. */
  colDim?: string;
  measure?: string;
  aggregation?: AggregationFn;
}

function isNumeric(rows: Record<string, unknown>[], col: string): boolean {
  return rows.slice(0, 20).filter((r) => r[col] != null).every((r) => !isNaN(Number(r[col])));
}

function aggregate(fn: AggregationFn, values: unknown[]): number {
  if (fn === 'count') return values.length;
  if (fn === 'count_distinct') return new Set(values.map(String)).size;
  const nums = values.map(Number).filter((n) => !isNaN(n));
  if (nums.length === 0) return 0;
  switch (fn) {
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    case 'median': {
      const s = [...nums].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    default: return nums.reduce((a, b) => a + b, 0); // sum
  }
}

interface RowNode {
  key: string;
  label: string;
  depth: number;
  rows: Record<string, unknown>[];
  children: RowNode[];
}

/** Recursively group rows by the ordered row dimensions. */
function buildTree(rows: Record<string, unknown>[], dims: string[], depth: number, prefix: string): RowNode[] {
  if (depth >= dims.length) return [];
  const dim = dims[depth];
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const k = String(r[dim] ?? '—');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return Array.from(groups.entries()).map(([label, groupRows]) => {
    const key = `${prefix}/${label}`;
    return { key, label, depth, rows: groupRows, children: buildTree(groupRows, dims, depth + 1, key) };
  });
}

export function MatrixCard({ execution, title, compact, rowDims, colDim, measure, aggregation }: MatrixCardProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const model = useMemo(() => {
    const { rows, columns } = execution;
    if (!rows || rows.length === 0) return null;
    const numericCols = columns.filter((c) => isNumeric(rows, c));
    const nonNumeric = columns.filter((c) => !numericCols.includes(c));

    const dims = (rowDims && rowDims.length ? rowDims : nonNumeric.slice(0, 1)).filter(Boolean);
    if (dims.length === 0) return null;
    const meas = measure || numericCols[0];
    if (!meas) return null;
    const agg: AggregationFn = aggregation || 'sum';

    // Column pivot values (single dimension), capped for readability.
    const cDim = colDim && !dims.includes(colDim) ? colDim : undefined;
    const colValues = cDim
      ? Array.from(new Set(rows.map((r) => String(r[cDim] ?? '—')))).slice(0, 12)
      : [];

    const tree = buildTree(rows, dims, 0, '');
    const cell = (nodeRows: Record<string, unknown>[], colVal?: string) => {
      const scoped = colVal != null ? nodeRows.filter((r) => String(r[cDim!] ?? '—') === colVal) : nodeRows;
      return aggregate(agg, scoped.map((r) => r[meas]));
    };

    return { dims, meas, agg, cDim, colValues, tree, cell, grandTotal: cell(rows) };
  }, [execution, rowDims, colDim, measure, aggregation]);

  if (!model) return null;

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const renderNode = (node: RowNode): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(node.key);
    return (
      <>
        <tr key={node.key} className="border-b border-zinc-100 hover:bg-zinc-50">
          <td className="py-1.5 pr-2 text-zinc-800" style={{ paddingLeft: 8 + node.depth * 16 }}>
            <span className="inline-flex items-center gap-1">
              {hasChildren ? (
                <button
                  onClick={() => setExpanded((prev) => {
                    const n = new Set(prev);
                    if (n.has(node.key)) n.delete(node.key); else n.add(node.key);
                    return n;
                  })}
                  className="text-zinc-400 hover:text-zinc-700"
                  aria-label={isOpen ? 'Collapse' : 'Expand'}
                >
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              ) : <span className="inline-block w-3.5" />}
              <span className={node.depth === 0 ? 'font-medium' : ''}>{node.label}</span>
            </span>
          </td>
          {model.colValues.map((cv) => (
            <td key={cv} className="py-1.5 px-2 text-right tabular-nums text-zinc-600">{fmt(model.cell(node.rows, cv))}</td>
          ))}
          <td className="py-1.5 px-2 text-right tabular-nums font-medium text-zinc-800">{fmt(model.cell(node.rows))}</td>
        </tr>
        {hasChildren && isOpen && node.children.map((c) => renderNode(c))}
      </>
    );
  };

  return (
    <div className={`w-full flex flex-col bg-white ${compact ? 'h-full p-1' : 'rounded-xl border border-zinc-200 p-3 shadow-sm'}`}>
      {title && (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">{title}</p>
      )}
      <div className={`w-full overflow-auto ${compact ? 'flex-1 min-h-0' : ''}`}>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-200 text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="py-1.5 pr-2 text-left font-semibold">{model.dims.join(' › ')}</th>
              {model.colValues.map((cv) => (
                <th key={cv} className="py-1.5 px-2 text-right font-semibold">{cv}</th>
              ))}
              <th className="py-1.5 px-2 text-right font-semibold">{model.agg} · {model.meas}</th>
            </tr>
          </thead>
          <tbody>
            {model.tree.map((n) => renderNode(n))}
            <tr className="border-t-2 border-zinc-300 font-semibold text-zinc-800">
              <td className="py-1.5 pr-2">Total</td>
              {model.colValues.map((cv) => (
                <td key={cv} className="py-1.5 px-2 text-right tabular-nums">{fmt(model.cell(execution.rows, cv))}</td>
              ))}
              <td className="py-1.5 px-2 text-right tabular-nums">{fmt(model.grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
