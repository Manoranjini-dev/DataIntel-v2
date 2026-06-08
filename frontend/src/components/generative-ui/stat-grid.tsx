'use client';

import type { QueryExecutionResult } from '@/lib/types';

interface StatGridProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
}

export function StatGrid({ execution, title, compact }: StatGridProps) {
  const { rows, columns } = execution;
  if (!rows || rows.length === 0) return null;

  const row = rows[0];

  // Extract numeric and label values
  const stats = columns
    .map((col) => {
      const val = row[col];
      const num = Number(val);
      return {
        label: String(col)
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        value: !isNaN(num)
          ? num >= 1_000_000
            ? `${(num / 1_000_000).toFixed(1)}M`
            : num >= 1_000
              ? `${(num / 1_000).toFixed(1)}K`
              : num % 1 !== 0
                ? num.toFixed(2)
                : num.toLocaleString()
          : String(val ?? '—'),
        isNumeric: !isNaN(num),
      };
    })
    .filter((s) => s.isNumeric);

  if (stats.length === 0) return null;

  return (
    <div className={`w-full flex flex-col space-y-3 overflow-y-auto bg-white ${compact ? 'h-full p-1' : 'rounded-xl border border-zinc-200 p-3 shadow-sm'}`}>
      {title && (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">
          {title}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm"
          >
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              {stat.label}
            </p>
            <p className="mt-1 text-2xl font-bold text-zinc-800">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
