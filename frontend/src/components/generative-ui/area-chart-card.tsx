'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { QueryExecutionResult } from '@/lib/types';

const COLORS = [
  { stroke: '#6366f1', fill: '#6366f130' },
  { stroke: '#22d3ee', fill: '#22d3ee30' },
  { stroke: '#f59e0b', fill: '#f59e0b30' },
  { stroke: '#10b981', fill: '#10b98130' },
];

interface AreaChartCardProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
}

function isNumeric(rows: Record<string, unknown>[], col: string): boolean {
  return rows.slice(0, 20).filter((r) => r[col] != null).every((r) => !isNaN(Number(r[col])));
}

function truncate(label: string, max = 12): string {
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

const CustomTick = (props: any) => {
  const { x, y, payload, angle } = props;
  const rawText = payload.value;
  const maxChars = 14;
  const text = rawText.length > maxChars ? rawText.substring(0, maxChars) + '…' : rawText;
  
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={12}
        dx={angle === -90 ? -5 : 0}
        textAnchor={angle === 0 ? 'middle' : 'end'}
        fill="#71717a"
        fontSize={11}
        transform={`rotate(${angle})`}
      >
        <title>{rawText}</title>
        {text}
      </text>
    </g>
  );
};

export function AreaChartCard({ execution, title, compact }: AreaChartCardProps) {
  const { rows, columns } = execution;

  const schema = useMemo(() => {
    if (!rows || rows.length < 2 || columns.length < 2) return null;
    const numericCols = columns.filter((c) => isNumeric(rows, c));
    if (numericCols.length === 0) return null;
    const labelCol = columns.find((c) => !numericCols.includes(c)) || columns[0];
    const chosen = numericCols.slice(0, 4);
    const data = rows.slice(0, 100).map((row) => {
      const point: Record<string, unknown> = { _label: truncate(String(row[labelCol] ?? ''), 40) };
      chosen.forEach((c) => { point[c] = Number(row[c]); });
      return point;
    });
    return { numericCols: chosen, data };
  }, [rows, columns]);

  if (!schema) return null;

  const axisStyle = { fill: '#71717a', fontSize: 11 };

  const xLabelsCount = schema.data.length;
  const maxLabelLength = Math.max(...schema.data.map((d: any) => String(d._label).length));
  const isHorizontal = xLabelsCount > 10 || maxLabelLength > 12;

  // Calculate Y-axis width dynamically based on max value length
  const maxValLength = Math.max(...schema.data.map((d: any) => String(d[schema.numericCols[0]] || '').length));
  const yAxisWidth = Math.max(maxValLength * 8 + 16, 40);

  const needsRotation = !isHorizontal && maxLabelLength > 8;
  const rotationAngle = xLabelsCount > 10 ? -90 : (needsRotation ? -45 : 0);
  const xAxisHeight = rotationAngle === -90 ? 100 : (rotationAngle === -45 ? 70 : 30);
  const safeInterval = xLabelsCount > 20 ? 'preserveEnd' : 0;

  return (
    <div className={`w-full flex flex-col bg-white ${compact ? 'h-full p-1' : 'rounded-xl border border-zinc-200 p-3 shadow-sm'}`}>
      {title && (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">
          {title}
        </p>
      )}
      <div className={`w-full ${compact ? 'flex-1 min-h-0' : ''}`}>
        <ResponsiveContainer width="100%" height={compact ? "100%" : 220 + xAxisHeight - 30}>
          <AreaChart data={schema.data} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
            <XAxis 
              dataKey="_label" 
              tick={<CustomTick angle={rotationAngle} />}
              height={xAxisHeight}
              interval={safeInterval}
              axisLine={{ stroke: '#d4d4d8' }} 
              tickLine={false} 
            />
            <YAxis tick={axisStyle} axisLine={{ stroke: '#d4d4d8' }} tickLine={false} width={yAxisWidth} />
            <Tooltip content={<CustomTooltip />} />
            {schema.numericCols.length > 1 && (
              <Legend wrapperStyle={{ fontSize: 11, color: '#71717a', paddingTop: '10px' }} />
            )}
            {schema.numericCols.map((col, i) => (
              <Area
                key={col}
                type="monotone"
                dataKey={col}
                stroke={COLORS[i % COLORS.length].stroke}
                fill={COLORS[i % COLORS.length].fill}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
