'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { QueryExecutionResult } from '@/lib/types';
import {
  xAxisLabel, yAxisLabel, X_TITLE_SPACE, Y_TITLE_SPACE,
  humanizeField, measureColumns, pickLabelColumn, isIdentifierColumn,
} from '@/lib/chart-format';

/** Prefix for identifier values carried on each data point for the tooltip only (never plotted). */
const META_PREFIX = '__meta_';

const COLORS = [
  '#6366f1', '#22d3ee', '#f59e0b', '#10b981',
  '#f43f5e', '#a78bfa', '#34d399', '#fb923c',
];

interface BarChartCardProps {
  execution: QueryExecutionResult;
  title?: string;
  compact?: boolean;
  /** Stack all measure series into a single bar per category instead of grouping them side by side. */
  stacked?: boolean;
  /** Defaults to true (existing behavior) when unset. */
  showLegend?: boolean;
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
  payload?: { name: string; value: number; color: string; payload?: Record<string, unknown> }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  // Identifier fields (clinic_id, …) travel on the point as `__meta_*` — shown
  // here as reference context but never plotted as a bar.
  const point = payload[0]?.payload ?? {};
  const metaEntries = Object.keys(point)
    .filter((k) => k.startsWith(META_PREFIX))
    .map((k) => [humanizeField(k.slice(META_PREFIX.length)), point[k]] as const);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2.5 text-xs shadow-md">
      <p className="mb-1.5 font-medium text-zinc-800">{label}</p>
      {metaEntries.map(([name, value]) => (
        <p key={name} className="flex gap-2">
          <span className="text-zinc-500">{name}:</span>
          <span className="font-medium text-zinc-800">{String(value ?? '')}</span>
        </p>
      ))}
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }} className="flex gap-2">
          <span className="text-zinc-500">{humanizeField(p.name)}:</span>
          <span className="font-medium text-zinc-800">{p.value?.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
};

const CustomTick = (props: any) => {
  const { x, y, payload, angle } = props;
  const rawText = payload.value;
  // Truncate logic for labels
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

const CustomYAxisTick = (props: any) => {
  const { x, y, payload, maxLabelLength } = props;
  const text = payload.value;
  const fontSize = maxLabelLength > 20 ? 10 : 11;

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={4}
        dx={-10}
        textAnchor="end"
        fill="#71717a"
        fontSize={fontSize}
      >
        <title>{text}</title>
        {text}
      </text>
    </g>
  );
};

export function BarChartCard({ execution, title, compact, stacked, showLegend = true }: BarChartCardProps) {
  const { rows, columns } = execution;

  const schema = useMemo(() => {
    if (!rows || rows.length === 0 || columns.length < 2) return null;
    // Plot real measures only — identifier columns (clinic_id, doctor_id, …) are
    // excluded from the bars and instead carried into the tooltip as context.
    const numericCols = measureColumns(rows, columns);
    if (numericCols.length === 0) return null;
    const chosen = numericCols.slice(0, 4);
    const labelCol = pickLabelColumn(columns, chosen);
    // Identifier columns become tooltip-only metadata (excluding the label col).
    const metaCols = columns.filter(
      (c) => isIdentifierColumn(c) && !chosen.includes(c) && c !== labelCol,
    );
    const data = rows.map((row) => {
      const point: Record<string, unknown> = { _label: String(row[labelCol] ?? '') };
      chosen.forEach((c) => { point[c] = Number(row[c]); });
      metaCols.forEach((c) => { point[`${META_PREFIX}${c}`] = row[c]; });
      return point;
    });
    return { labelCol, numericCols: chosen, data };
  }, [rows, columns]);

  if (!schema) return null;

  const axisStyle = { fill: '#71717a', fontSize: 11 };

  const xLabelsCount = schema.data.length;
  const maxLabelLength = Math.max(...schema.data.map((d: any) => String(d._label).length));
  
  // Auto-switch to horizontal if there are many categories or labels are long
  const isHorizontal = xLabelsCount > 5 || maxLabelLength > 12;

  // Axis titles derive from the plotted fields. The category/measure axes swap
  // between vertical and horizontal layouts, so the titles swap too. A single
  // Y/measure title is shown only when there's exactly one measure (otherwise
  // the legend names the series).
  const measureTitle = schema.numericCols.length === 1 ? schema.numericCols[0] : undefined;
  const xTitle = isHorizontal ? xAxisLabel(measureTitle) : xAxisLabel(schema.labelCol);
  const yTitle = isHorizontal ? yAxisLabel(schema.labelCol) : yAxisLabel(measureTitle);

  const needsRotation = !isHorizontal && maxLabelLength > 8;
  const rotationAngle = needsRotation ? -45 : 0;
  const baseXAxisHeight = isHorizontal ? 30 : (rotationAngle === -45 ? 70 : 30);
  const xAxisHeight = baseXAxisHeight + (xTitle ? X_TITLE_SPACE : 0);
  const safeInterval = xLabelsCount > 20 ? 'preserveEnd' : 0;

  // Calculate Y-axis width dynamically based on label length to prevent clipping
  const maxYValLength = Math.max(...schema.data.map((d: any) => String(d[schema.numericCols[0]] || '').length));
  const verticalYAxisWidth = Math.max(maxYValLength * 8 + 16, 40);
  const horizontalYAxisWidth = Math.min(Math.max(maxLabelLength * 6.5 + 16, 60), 300);
  const yAxisWidth = (isHorizontal ? horizontalYAxisWidth : verticalYAxisWidth) + (yTitle ? Y_TITLE_SPACE : 0);

  // Dynamic scaling for horizontal bars based on category count
  let barThickness = 30;
  let pxPerCategory = 40;

  if (isHorizontal) {
    if (xLabelsCount > 40) {
      barThickness = 10;
      pxPerCategory = 16;
    } else if (xLabelsCount > 20) {
      barThickness = 14;
      pxPerCategory = 20;
    } else if (xLabelsCount > 10) {
      barThickness = 18;
      pxPerCategory = 26;
    } else {
      barThickness = 28;
      pxPerCategory = 40;
    }
  }

  // Calculate chart height dynamically
  const calculatedHeight = isHorizontal 
    ? Math.max(250, xLabelsCount * pxPerCategory + 50)
    : 220 + xAxisHeight - 30;

  // Calculate chart width dynamically for vertical bar charts
  const calculatedWidth = !isHorizontal 
    ? Math.max(100, xLabelsCount * 40 + 60)
    : '100%';

  return (
      <div className={`w-full flex flex-col bg-white ${compact ? 'h-full p-1' : 'rounded-xl border border-zinc-200 p-3 shadow-sm'}`}>
      {title && (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">
          {title}
        </p>
      )}
      <div className={`w-full ${compact ? 'flex-1 min-h-0 overflow-auto' : ''}`}>
        <div style={{ 
          minHeight: compact ? (isHorizontal ? calculatedHeight : undefined) : undefined, 
          height: compact ? '100%' : calculatedHeight, 
          minWidth: compact && !isHorizontal ? calculatedWidth : undefined,
          width: '100%' 
        }}>
          <ResponsiveContainer width="99%" height="100%">
            <BarChart
              data={schema.data}
              layout={isHorizontal ? "vertical" : "horizontal"}
              margin={{ top: 10, right: 20, left: yTitle ? Y_TITLE_SPACE : 10, bottom: 0 }}
            >
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" horizontal={!isHorizontal} vertical={isHorizontal} />
            <XAxis
              type={isHorizontal ? "number" : "category"}
              dataKey={isHorizontal ? undefined : "_label"}
              tick={isHorizontal ? axisStyle : <CustomTick angle={rotationAngle} />}
              height={xAxisHeight}
              interval={safeInterval}
              axisLine={{ stroke: '#d4d4d8' }}
              tickLine={false}
              label={xTitle}
            />
            <YAxis
              type={isHorizontal ? "category" : "number"}
              dataKey={isHorizontal ? "_label" : undefined}
              tick={isHorizontal ? <CustomYAxisTick maxLabelLength={maxLabelLength} /> : axisStyle}
              axisLine={{ stroke: '#d4d4d8' }}
              tickLine={false}
              width={yAxisWidth}
              interval={isHorizontal ? 0 : 'preserveEnd'}
              label={yTitle}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f4f4f5' }} />
            {showLegend && schema.numericCols.length > 1 && (
              <Legend wrapperStyle={{ fontSize: 11, color: '#71717a', paddingTop: '10px' }} />
            )}
            {schema.numericCols.map((col, i) => (
              <Bar
                key={col}
                dataKey={col}
                fill={COLORS[i % COLORS.length]}
                radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                maxBarSize={isHorizontal ? barThickness : 50}
                stackId={stacked ? 'stack' : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
