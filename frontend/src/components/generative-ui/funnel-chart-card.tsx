'use client';

import { useMemo } from 'react';
import {
  FunnelChart,
  Funnel,
  LabelList,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import type { QueryExecutionResult } from '@/lib/types';

const COLORS = [
  '#6366f1', '#22d3ee', '#f59e0b', '#10b981',
  '#f43f5e', '#a78bfa', '#34d399', '#fb923c',
];

interface FunnelChartCardProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
}

function isNumeric(rows: Record<string, unknown>[], col: string): boolean {
  return rows.slice(0, 20).filter((r) => r[col] != null).every((r) => !isNaN(Number(r[col])));
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2.5 text-xs shadow-md">
      <p className="font-medium text-zinc-800">{item.payload?.name}</p>
      <p className="text-zinc-500 mt-1">{Number(item.value)?.toLocaleString()}</p>
    </div>
  );
};

export function FunnelChartCard({ execution, title, compact }: FunnelChartCardProps) {
  const { rows, columns } = execution;

  const data = useMemo(() => {
    if (!rows || rows.length < 1 || columns.length < 2) return null;
    const numericCols = columns.filter((c) => isNumeric(rows, c));
    if (numericCols.length === 0) return null;
    const labelCol = columns.find((c) => !numericCols.includes(c)) || columns[0];
    const valueCol = numericCols[0];

    // Funnels read top-to-bottom widest-to-narrowest — sort descending.
    return rows
      .map((r) => ({ name: String(r[labelCol] ?? ''), value: Number(r[valueCol]) }))
      .filter((d) => !isNaN(d.value))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }, [rows, columns]);

  if (!data || data.length === 0) return null;

  return (
    <div className={`w-full flex flex-col bg-white ${compact ? 'h-full p-1' : 'rounded-xl border border-zinc-200 p-3 shadow-sm'}`}>
      {title && (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">{title}</p>
      )}
      <div className={`w-full ${compact ? 'flex-1 min-h-0' : ''}`}>
        <ResponsiveContainer width="99%" height={compact ? '100%' : 240}>
          <FunnelChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Tooltip content={<CustomTooltip />} />
            <Funnel dataKey="value" data={data} isAnimationActive lastShapeType="rectangle">
              <LabelList position="right" fill="#52525b" stroke="none" dataKey="name" className="text-[11px]" />
              <LabelList position="left" fill="#a1a1aa" stroke="none" dataKey="value" className="text-[10px]" />
              {data.map((_e, i) => (
                <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
              ))}
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
