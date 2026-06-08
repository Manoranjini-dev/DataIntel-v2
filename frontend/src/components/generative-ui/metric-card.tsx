'use client';

import type { QueryExecutionResult } from '@/lib/types';

interface MetricCardProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
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
    <div className={`relative overflow-hidden w-full flex flex-col justify-center bg-white ${compact ? 'h-full p-2' : 'rounded-xl border border-zinc-200 p-4 shadow-sm'}`}>
      <div className="absolute -right-3 -top-3 h-20 w-20 rounded-full bg-zinc-100" />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-zinc-800">
        {formatted}
      </p>
      {execution.rowCount > 0 && (
        <p className="mt-1.5 text-[11px] text-zinc-400">
          {execution.executionTime}ms
        </p>
      )}
    </div>
  );
}
