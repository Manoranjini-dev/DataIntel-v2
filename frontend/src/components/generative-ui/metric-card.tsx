'use client';

import type { QueryExecutionResult } from '@/lib/types';

interface MetricCardProps {
  execution: QueryExecutionResult;
  title?: string;
}

export function MetricCard({ execution, title }: MetricCardProps) {
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

  // Format the displayed value
  const formatted = !isNaN(numValue)
    ? numValue >= 1_000_000
      ? `${(numValue / 1_000_000).toFixed(1)}M`
      : numValue >= 1_000
        ? `${(numValue / 1_000).toFixed(1)}K`
        : numValue % 1 !== 0
          ? numValue.toFixed(2)
          : numValue.toLocaleString()
    : String(value ?? '—');

  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800/50 p-5">
      <div className="absolute -right-3 -top-3 h-20 w-20 rounded-full bg-indigo-500/5" />
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-white">
        {formatted}
      </p>
      {execution.rowCount > 0 && (
        <p className="mt-1.5 text-[11px] text-zinc-600">
          {execution.executionTime}ms
        </p>
      )}
    </div>
  );
}
