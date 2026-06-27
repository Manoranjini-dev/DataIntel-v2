'use client';

import { ArrowUp, ArrowDown } from 'lucide-react';
import type { QueryExecutionResult } from '@/lib/types';

interface MetricCardProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
}

function formatNumber(numValue: number, raw: unknown): string {
  return !isNaN(numValue)
    ? numValue >= 1_000_000
      ? `${(numValue / 1_000_000).toFixed(1)}M`
      : numValue >= 1_000
        ? `${(numValue / 1_000).toFixed(1)}K`
        : numValue % 1 !== 0
          ? numValue.toFixed(2)
          : numValue.toLocaleString()
    : String(raw ?? '—');
}

export function MetricCard({ execution, title, compact }: MetricCardProps) {
  const { rows, columns } = execution;
  if (!rows || rows.length === 0) return null;

  // Extract the primary metric value
  const numericCols = columns.filter((c) => {
    const val = rows[0]?.[c];
    return val != null && !isNaN(Number(val));
  });

  const metricCol = numericCols[0] || columns[columns.length - 1];
  const value = rows[0]?.[metricCol];
  const numValue = Number(value);

  const label =
    title ||
    String(metricCol)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const formatted = formatNumber(numValue, value);

  // Optional comparison/trend indicator: a second numeric column (e.g. a
  // prior-period value) is treated as the comparison baseline.
  const comparisonCol = numericCols[1];
  const comparisonValue = comparisonCol ? Number(rows[0]?.[comparisonCol]) : NaN;
  const hasTrend = comparisonCol && !isNaN(numValue) && !isNaN(comparisonValue) && comparisonValue !== 0;
  const pctChange = hasTrend ? ((numValue - comparisonValue) / Math.abs(comparisonValue)) * 100 : 0;
  const isUp = pctChange >= 0;

  return (
    <div className={`relative overflow-hidden w-full flex flex-col justify-center bg-white ${compact ? 'h-full p-2' : 'rounded-xl border border-zinc-200 p-4 shadow-sm'}`}>
      <div className="absolute -right-3 -top-3 h-20 w-20 rounded-full bg-zinc-100" />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-zinc-800">
        {formatted}
      </p>
      {hasTrend && (
        <p className={`mt-1.5 flex items-center gap-1 text-xs font-semibold ${isUp ? 'text-emerald-600' : 'text-rose-600'}`}>
          {isUp ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
          {Math.abs(pctChange).toFixed(1)}%
          <span className="text-zinc-400 font-normal">vs {formatNumber(comparisonValue, comparisonValue)}</span>
        </p>
      )}
      {execution.rowCount > 0 && (
        <p className="mt-1.5 text-[11px] text-zinc-400">
          {execution.executionTime}ms
        </p>
      )}
    </div>
  );
}
