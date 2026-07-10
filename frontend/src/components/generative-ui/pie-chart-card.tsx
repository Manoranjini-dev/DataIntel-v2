'use client';

import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { QueryExecutionResult } from '@/lib/types';
import { measureColumns, pickLabelColumn, formatDisplayCell, humanizeField } from '@/lib/chart-format';

const COLORS = [
  '#6366f1', '#22d3ee', '#f59e0b', '#10b981',
  '#f43f5e', '#a78bfa', '#34d399', '#fb923c',
];

interface PieChartCardProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
  /** Defaults to true (existing behavior) when unset. */
  showLegend?: boolean;
  /** Render as a donut (larger hollow center) instead of the default pie. */
  donut?: boolean;
}

function isNumeric(rows: Record<string, unknown>[], col: string): boolean {
  return rows.slice(0, 20).filter((r) => r[col] != null).every((r) => !isNaN(Number(r[col])));
}

const CustomTooltip = ({
  active,
  payload,
  metricName,
}: {
  active?: boolean;
  payload?: { name: string; value: number; payload: { _label: string } }[];
  metricName: string;
}) => {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2.5 text-xs shadow-md">
      <p className="font-medium text-zinc-800">{item.payload._label}</p>
      <p className="text-zinc-500 mt-1">
        <span className="font-medium text-zinc-600">{metricName}:</span> {item.value?.toLocaleString()}
      </p>
    </div>
  );
};

export function PieChartCard({ execution, title, compact, showLegend = true, donut = false }: PieChartCardProps) {
  const { rows, columns } = execution;

  const schema = useMemo(() => {
    if (!rows || rows.length < 2 || columns.length < 2) return null;
    // Slice by a real measure only — identifier columns are never a pie metric.
    const numericCols = measureColumns(rows, columns);
    if (numericCols.length === 0) return null;
    const metricCol = numericCols[0];
    const labelCol = pickLabelColumn(columns, [metricCol]);

    const data = rows.slice(0, 10).map((row) => ({
      _label: formatDisplayCell(row[labelCol]),
      [metricCol]: Number(row[metricCol]),
    }));

    return { metricCol, data };
  }, [rows, columns]);

  const legendPayload = useMemo(() => {
    if (!schema) return [];
    return schema.data.map((entry, index) => ({
      id: entry._label,
      type: 'square' as const,
      value: entry._label,
      color: COLORS[index % COLORS.length],
    }));
  }, [schema]);

  if (!schema) return null;

  return (
    <div className={`w-full flex flex-col bg-white ${compact ? 'h-full p-1' : 'rounded-xl border border-zinc-200 p-3 shadow-sm'}`}>
      {title && (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">
          {title}
        </p>
      )}
      <div className={`w-full ${compact ? 'flex-1 min-h-0' : ''}`}>
        <ResponsiveContainer width="99%" height={compact ? "100%" : 220}>
          <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
            <Pie
              data={schema.data}
              dataKey={schema.metricCol}
              nameKey="_label"
              cx="50%"
              cy="45%"
              outerRadius="80%"
              innerRadius={donut ? '62%' : 0}
              paddingAngle={donut ? 2 : 0}
            >
              {schema.data.map((_entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip metricName={humanizeField(schema.metricCol)} />} />
            {showLegend && <Legend payload={legendPayload} wrapperStyle={{ fontSize: 11, color: '#71717a' }} />}
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
