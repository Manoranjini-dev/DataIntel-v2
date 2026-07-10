'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import type { QueryExecutionResult } from '@/lib/types';

interface DataTableCardProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
}

import { formatDisplayCell } from '@/lib/utils';

const PAGE_SIZE = 25;
const MAX_ROWS = 500;

function formatCell(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number' && isFinite(val)) return val.toLocaleString();
  const str = formatDisplayCell(val);
  return str || '—';
}

export function DataTableCard({ execution, title, compact }: DataTableCardProps) {
  const { rows, columns } = execution;
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const filteredRows = useMemo(() => {
    if (!rows) return rows;
    const capped = rows.slice(0, MAX_ROWS);
    const q = search.trim().toLowerCase();
    if (!q) return capped;
    return capped.filter((row) =>
      columns.some((c) => formatCell(row[c]).toLowerCase().includes(q)),
    );
  }, [rows, columns, search]);

  const sortedRows = useMemo(() => {
    if (!sortCol || !filteredRows) return filteredRows;
    return [...filteredRows].sort((a, b) => {
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
  }, [filteredRows, sortCol, sortDir]);

  const pageCount = Math.max(1, Math.ceil((sortedRows?.length || 0) / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const displayRows = useMemo(
    () => (sortedRows || []).slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [sortedRows, safePage],
  );

  // Reset to page 1 whenever the search/sort changes the result set.
  useEffect(() => { setPage(0); }, [search, sortCol, sortDir]);

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

  return (
    <div className={`w-full flex flex-col overflow-hidden bg-white ${compact ? 'h-full' : 'rounded-xl border border-zinc-200 shadow-sm'}`}>
      {(title || rows.length > PAGE_SIZE) && (
        <div className="border-b border-zinc-200 px-4 py-2.5 shrink-0 flex items-center gap-3">
          {title && (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 whitespace-nowrap">
              {title} <span className="text-zinc-400">· {rows.length} rows</span>
            </p>
          )}
          <div className="relative ml-auto w-40">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full pl-6 pr-2 py-1 text-xs bg-zinc-50 border border-zinc-200 rounded-md text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
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
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-xs text-zinc-400">
                  No rows match &ldquo;{search}&rdquo;
                </td>
              </tr>
            ) : displayRows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-zinc-100 transition-colors hover:bg-zinc-50"
              >
                {columns.map((col) => {
                  const display = formatCell(row[col]);
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
      {pageCount > 1 && (
        <div className="border-t border-zinc-200 bg-white px-4 py-2 flex items-center justify-between text-[11px] text-zinc-500 shrink-0 sticky bottom-0">
          <span>
            Page {safePage + 1} of {pageCount}
            {sortedRows && sortedRows.length !== rows.length ? ` · ${sortedRows.length} matching` : ''}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="p-1 rounded-md border border-zinc-200 text-zinc-500 disabled:opacity-40 hover:bg-zinc-50 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              className="p-1 rounded-md border border-zinc-200 text-zinc-500 disabled:opacity-40 hover:bg-zinc-50 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
      {rows.length > MAX_ROWS && (
        <div className="border-t border-zinc-200 bg-white px-4 py-1.5 text-center text-[10px] text-zinc-400 shrink-0">
          Showing first {MAX_ROWS} of {rows.length} rows
        </div>
      )}
    </div>
  );
}
