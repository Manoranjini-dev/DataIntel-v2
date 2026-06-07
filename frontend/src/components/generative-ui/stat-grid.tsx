'use client';

import type { QueryExecutionResult } from '@/lib/types';

interface StatGridProps {
  execution: QueryExecutionResult;
  title?: string;
}

export function StatGrid({ execution, title }: StatGridProps) {
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

  const COLORS = [
    'from-indigo-500/10 border-indigo-500/20 text-indigo-400',
    'from-emerald-500/10 border-success/20 text-success',
    'from-amber-500/10 border-amber-500/20 text-amber-400',
    'from-rose-500/10 border-rose-500/20 text-rose-400',
    'from-cyan-500/10 border-cyan-500/20 text-cyan-400',
    'from-violet-500/10 border-primary/20 text-primary',
  ];

  return (
    <div className="space-y-3">
      {title && (
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {title}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.slice(0, 6).map((stat, i) => (
          <div
            key={stat.label}
            className={`rounded-xl border bg-gradient-to-br to-transparent p-4 ${COLORS[i % COLORS.length]}`}
          >
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              {stat.label}
            </p>
            <p className="mt-1 text-2xl font-bold">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
