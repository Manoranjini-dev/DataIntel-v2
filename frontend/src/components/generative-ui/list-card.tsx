'use client';

import type { QueryExecutionResult } from '@/lib/types';

interface ListCardProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
}

export function ListCard({ execution, title, compact }: ListCardProps) {
  const { rows, columns } = execution;
  if (!rows || rows.length === 0) return null;

  // Use first 1-2 columns for the list display
  const primaryCol = columns[0];
  const secondaryCol = columns.length > 1 ? columns[1] : null;

  return (
    <div className={`w-full flex flex-col overflow-hidden bg-white ${compact ? 'h-full p-1' : 'rounded-xl border border-zinc-200 p-3 shadow-sm'}`}>
      {title && (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">
          {title} <span className="text-zinc-400">· {rows.length} items</span>
        </p>
      )}
      <div className={`space-y-0.5 overflow-y-auto ${compact ? 'flex-1 min-h-0' : 'max-h-[300px]'}`}>
        {rows.map((row, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-zinc-50"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-medium text-zinc-500">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-zinc-800">
                {String(row[primaryCol] ?? '—')}
              </p>
              {secondaryCol && (
                <p className="truncate text-[11px] text-zinc-500">
                  {String(row[secondaryCol] ?? '')}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
