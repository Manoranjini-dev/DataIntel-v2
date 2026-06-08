'use client';

import { useMemo, useState } from 'react';
import type { QueryExecutionResult } from '@/lib/types';

interface DataTableCardProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
}

export function DataTableCard({ execution, title, compact }: DataTableCardProps) {
  const { rows, columns } = execution;
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sortedRows = useMemo(() => {
    if (!sortCol || !rows) return rows;
    return [...rows].sort((a, b) => {
      const aVal = a[sortCol];
      const bVal = b[sortCol];
      const aNum = Number(aVal);
      const bNum = Number(bVal);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
      }
      const aStr = String(aVal ?? '');
      const bStr = String(bVal ?? '');
      return sortDir === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  }, [rows, sortCol, sortDir]);

  if (!rows || rows.length === 0 || columns.length === 0) {
    return (
      <div className={`w-full flex items-center justify-center text-center text-sm text-zinc-500 ${compact ? 'h-full' : 'rounded-2xl border border-zinc-200 bg-white p-6'}`}>
        No data returned
      </div>
    );
  }

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const maxRows = 500;
  const displayRows = sortedRows.slice(0, maxRows);

  return (
    <div className={`w-full flex flex-col overflow-hidden bg-white ${compact ? 'h-full' : 'rounded-xl border border-zinc-200 shadow-sm'}`}>
      {title && (
        <div className="border-b border-zinc-200 px-4 py-3 shrink-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            {title} <span className="text-zinc-400">· {rows.length} rows</span>
          </p>
        </div>
      )}
      <div className={`w-full overflow-auto ${compact ? 'flex-1 min-h-0' : 'max-h-[300px]'}`}>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-zinc-200">
              {columns.map((col) => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className="cursor-pointer whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-700 bg-zinc-50/50 sticky top-0 z-10"
                >
                  <span className="flex items-center gap-1">
                    {col.replace(/_/g, ' ')}
                    {sortCol === col && (
                      <span className="text-zinc-800">
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-zinc-100 transition-colors hover:bg-zinc-50"
              >
                {columns.map((col) => {
                  const val = row[col];
                  const display =
                    val === null || val === undefined
                      ? '—'
                      : typeof val === 'object'
                        ? JSON.stringify(val)
                        : String(val);
                  return (
                    <td
                      key={col}
                      className="whitespace-nowrap px-4 py-2 text-[13px] text-zinc-800"
                      title={display.length > 40 ? display : undefined}
                    >
                      {display.length > 50 ? display.slice(0, 50) + '…' : display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > maxRows && (
        <div className="border-t border-zinc-200 bg-white px-4 py-2 text-center text-[11px] text-zinc-500 shrink-0 sticky bottom-0">
          Showing {maxRows} of {rows.length} rows
        </div>
      )}
    </div>
  );
}
