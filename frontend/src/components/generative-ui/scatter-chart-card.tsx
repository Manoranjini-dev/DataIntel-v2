'use client';

import { useMemo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { QueryExecutionResult } from '@/lib/types';

interface ScatterChartCardProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
}

function isNumeric(rows: Record<string, unknown>[], col: string): boolean {
  return rows.slice(0, 20).filter((r) => r[col] != null).every((r) => !isNaN(Number(r[col])));
}

const CustomTooltip = ({
  active,
  payload,
  xKey,
  yKey,
  labelKey,
}: {
  active?: boolean;
  payload?: { payload: Record<string, unknown> }[];
  xKey: string;
  yKey: string;
  labelKey?: string;
}) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2.5 text-xs shadow-md">
      {labelKey && p[labelKey] != null && (
        <p className="font-medium text-zinc-800 mb-1">{String(p[labelKey])}</p>
      )}
      <p className="text-zinc-500">{xKey}: <span className="text-zinc-800">{Number(p[xKey]).toLocaleString()}</span></p>
      <p className="text-zinc-500">{yKey}: <span className="text-zinc-800">{Number(p[yKey]).toLocaleString()}</span></p>
    </div>
  );
};

export function ScatterChartCard({ execution, title, compact }: ScatterChartCardProps) {
  const { rows, columns } = execution;

  const schema = useMemo(() => {
    if (!rows || rows.length < 2 || columns.length < 2) return null;
    const numericCols = columns.filter((c) => isNumeric(rows, c));
    if (numericCols.length < 2) return null;
    const [xKey, yKey] = numericCols;
    // First non-numeric column (if any) labels each point.
    const labelKey = columns.find((c) => !numericCols.includes(c));

    const data = rows.slice(0, 200).map((row) => ({
      ...(labelKey ? { [labelKey]: row[labelKey] } : {}),
      [xKey]: Number(row[xKey]),
      [yKey]: Number(row[yKey]),
    }));

    return { xKey, yKey, labelKey, data };
  }, [rows, columns]);

  if (!schema) return null;

  return (
    <div className={`w-full flex flex-col bg-white ${compact ? 'h-full p-1' : 'rounded-xl border border-zinc-200 p-3 shadow-sm'}`}>
      {title && (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">
          {title}
        </p>
      )}
      <div className={`w-full ${compact ? 'flex-1 min-h-0' : ''}`}>
        <ResponsiveContainer width="100%" height={compact ? '100%' : 240}>
          <ScatterChart margin={{ top: 10, right: 16, bottom: 16, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
            <XAxis
              type="number"
              dataKey={schema.xKey}
              name={schema.xKey}
              tick={{ fontSize: 10, fill: '#71717a' }}
              tickLine={false}
              axisLine={{ stroke: '#e4e4e7' }}
            />
            <YAxis
              type="number"
              dataKey={schema.yKey}
              name={schema.yKey}
              tick={{ fontSize: 10, fill: '#71717a' }}
              tickLine={false}
              axisLine={{ stroke: '#e4e4e7' }}
              width={44}
            />
            <ZAxis range={[40, 40]} />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={
                <CustomTooltip xKey={schema.xKey} yKey={schema.yKey} labelKey={schema.labelKey} />
              }
            />
            <Scatter data={schema.data} fill="#6366f1" fillOpacity={0.7} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
