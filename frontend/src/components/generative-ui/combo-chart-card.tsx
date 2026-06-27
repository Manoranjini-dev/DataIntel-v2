'use client';

import { useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { QueryExecutionResult } from '@/lib/types';

const BAR_COLOR = '#6366f1';
const LINE_COLOR = '#f59e0b';

interface ComboChartCardProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
  /** Defaults to true (existing behavior) when unset. */
  showLegend?: boolean;
}

function isNumeric(rows: Record<string, unknown>[], col: string): boolean {
  return rows.slice(0, 20).filter((r) => r[col] != null).every((r) => !isNaN(Number(r[col])));
}

function truncate(label: string, max = 14): string {
  return label != null && String(label).length > max
    ? String(label).slice(0, max) + '…'
    : String(label ?? '');
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2.5 text-xs shadow-md">
      <p className="mb-1.5 font-medium text-zinc-800">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }} className="flex gap-2">
          <span className="text-zinc-500">{p.name}:</span>
          <span className="font-medium text-zinc-800">{p.value?.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
};

/**
 * Dual-axis combo chart: the first numeric measure renders as bars against
 * the left axis, the second as a line against an independent right axis —
 * the standard pattern for comparing two metrics on different scales
 * (e.g. revenue bars vs. conversion-rate line).
 */
export function ComboChartCard({ execution, title, compact, showLegend = true }: ComboChartCardProps) {
  const { rows, columns } = execution;

  const schema = useMemo(() => {
    if (!rows || rows.length === 0 || columns.length < 2) return null;
    const numericCols = columns.filter((c) => isNumeric(rows, c));
    if (numericCols.length < 2) return null;
    const labelCol = columns.find((c) => !numericCols.includes(c)) || columns[0];
    const [barCol, lineCol] = numericCols;
    const data = rows.map((row) => ({
      _label: truncate(String(row[labelCol] ?? '')),
      [barCol]: Number(row[barCol]),
      [lineCol]: Number(row[lineCol]),
    }));
    return { barCol, lineCol, data };
  }, [rows, columns]);

  if (!schema) return null;

  const axisStyle = { fill: '#71717a', fontSize: 11 };
  const xLabelsCount = schema.data.length;
  const safeInterval = xLabelsCount > 20 ? 'preserveEnd' : 0;

  return (
    <div className={`w-full flex flex-col bg-white ${compact ? 'h-full p-1' : 'rounded-xl border border-zinc-200 p-3 shadow-sm'}`}>
      {title && (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">
          {title}
        </p>
      )}
      <div className={`w-full ${compact ? 'flex-1 min-h-0' : ''}`} style={{ height: compact ? '100%' : 260 }}>
        <ResponsiveContainer width="99%" height="100%">
          <ComposedChart data={schema.data} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
            <XAxis
              dataKey="_label"
              tick={axisStyle}
              interval={safeInterval}
              axisLine={{ stroke: '#d4d4d8' }}
              tickLine={false}
            />
            <YAxis yAxisId="left" tick={axisStyle} axisLine={{ stroke: '#d4d4d8' }} tickLine={false} />
            <YAxis yAxisId="right" orientation="right" tick={axisStyle} axisLine={{ stroke: '#d4d4d8' }} tickLine={false} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f4f4f5' }} />
            {showLegend && <Legend wrapperStyle={{ fontSize: 11, color: '#71717a', paddingTop: '10px' }} />}
            <Bar yAxisId="left" dataKey={schema.barCol} fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={50} />
            <Line yAxisId="right" type="monotone" dataKey={schema.lineCol} stroke={LINE_COLOR} strokeWidth={2.5} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
