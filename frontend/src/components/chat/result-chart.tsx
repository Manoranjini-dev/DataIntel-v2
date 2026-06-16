'use client';

// ──────────────────────────────────────────────
// ResultChart — smart chart type selection based
// on data characteristics (date→line, proportional→pie,
// categorical→bar, single metric→number card)
// ──────────────────────────────────────────────

import { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { BarChart2, LineChart as LineIcon, PieChart as PieIcon, Hash } from 'lucide-react';
import type { QueryExecutionResult } from '@/lib/types';

// ── Colour palette ──────────────────────────────

const CHART_COLORS = [
  '#6366f1', // indigo-500
  '#22d3ee', // cyan-400
  '#f59e0b', // amber-400
  '#10b981', // emerald-500
  '#f43f5e', // rose-500
  '#a78bfa', // violet-400
  '#34d399', // emerald-400
  '#fb923c', // orange-400
];

// ── Helpers ─────────────────────────────────────

function isNumericCol(rows: Record<string, unknown>[], col: string): boolean {
  const sample = rows.slice(0, 20).filter((r) => r[col] != null);
  if (sample.length === 0) return false;
  return sample.every((r) => !isNaN(Number(r[col])));
}

function isDateLike(col: string): boolean {
  return /date|time|created|updated|_at$|year|month|day|period|week/i.test(col);
}

function isDateValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // Matches ISO dates, YYYY-MM-DD, YYYY/MM/DD, date-time patterns
  return /^\d{4}[-/]\d{2}[-/]\d{2}/.test(value) || !isNaN(Date.parse(value));
}

function isProportional(rows: Record<string, unknown>[], numCol: string): boolean {
  const values = rows.map((r) => Number(r[numCol])).filter((v) => !isNaN(v));
  if (values.length === 0) return false;
  const total = values.reduce((a, b) => a + b, 0);
  // Check if values look like percentages or proportional shares
  const allPositive = values.every((v) => v >= 0);
  const totalIsRound = Math.abs(total - 100) < 1 || Math.abs(total - 1) < 0.01;
  return allPositive && (totalIsRound || values.length <= 8);
}

function hasCountOrSumPattern(cols: string[]): boolean {
  return cols.some((c) => /count|total|sum|amount|revenue|sales|quantity|num_|number/i.test(c));
}

function truncateLabel(label: string, max = 14): string {
  return label != null && String(label).length > max
    ? String(label).slice(0, max) + '…'
    : String(label ?? '');
}

type ChartType = 'bar' | 'line' | 'pie' | 'number';

interface DetectedSchema {
  labelCol: string;
  numericCols: string[];
  preferredType: ChartType;
  data: Record<string, unknown>[];
}

function detectSchema(execution: QueryExecutionResult): DetectedSchema | null {
  const { rows, columns } = execution;
  if (!rows || rows.length === 0 || columns.length < 1) return null;

  const numericCols = columns.filter((c) => isNumericCol(rows, c));
  if (numericCols.length === 0) return null;

  // Single row, single numeric column → number card
  if (rows.length === 1 && numericCols.length === 1 && columns.length <= 2) {
    return {
      labelCol: columns[0],
      numericCols: numericCols.slice(0, 1),
      preferredType: 'number',
      data: rows.map((row) => {
        const point: Record<string, unknown> = { _label: String(row[columns[0]] ?? '') };
        numericCols.forEach((c) => { point[c] = Number(row[c]); });
        return point;
      }),
    };
  }

  const stringCols = columns.filter((c) => !numericCols.includes(c));
  const dateCols = stringCols.filter((col) => {
    if (isDateLike(col)) return true;
    // Check first value to see if it looks like a date
    const firstVal = rows[0]?.[col];
    return isDateValue(firstVal);
  });
  const labelCol = dateCols[0] ?? stringCols[0] ?? columns[0];

  // Choose up to 4 numeric columns for readability
  const chosenNumeric = numericCols.slice(0, 4);

  const data = rows.slice(0, 50).map((row) => {
    const point: Record<string, unknown> = { _label: truncateLabel(String(row[labelCol] ?? '')) };
    chosenNumeric.forEach((c) => {
      point[c] = Number(row[c]);
    });
    return point;
  });

  // Smart chart type selection logic
  let preferredType: ChartType;

  if (dateCols.length > 0 && rows.length >= 3) {
    // Time-series data → line chart
    preferredType = 'line';
  } else if (
    numericCols.length === 1 &&
    rows.length >= 2 &&
    rows.length <= 10 &&
    isProportional(rows, numericCols[0])
  ) {
    // Few categories with a single proportional/percentage metric → pie chart
    preferredType = 'pie';
  } else if (rows.length === 1 && numericCols.length >= 2) {
    // Single row with multiple metrics → horizontal bar
    preferredType = 'bar';
  } else if (hasCountOrSumPattern(numericCols) && rows.length <= 20) {
    // Count/sum aggregations → bar chart
    preferredType = 'bar';
  } else if (rows.length > 20) {
    // Many data points → line chart for trends
    preferredType = 'line';
  } else {
    // Default to bar chart for categorical data
    preferredType = 'bar';
  }

  return { labelCol, numericCols: chosenNumeric, preferredType, data };
}

// ── Custom Tooltip ──────────────────────────────

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
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-2.5 text-xs shadow-xl">
      <p className="mb-1.5 font-medium text-zinc-300">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }} className="flex gap-2">
          <span className="text-zinc-400">{p.name}:</span>
          <span className="font-medium">{p.value?.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
};

// ── Number Card — for single-value metrics ──────

function NumberCard({ schema }: { schema: DetectedSchema }) {
  const value = schema.data[0]?.[schema.numericCols[0]];
  const label = schema.numericCols[0]
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-6 mt-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 mb-2">{label}</p>
      <p className="text-4xl font-bold text-indigo-400">
        {typeof value === 'number' ? value.toLocaleString() : String(value)}
      </p>
    </div>
  );
}

// ── Component ───────────────────────────────────

export function ResultChart({ execution }: { execution: QueryExecutionResult }) {
  const schema = useMemo(() => detectSchema(execution), [execution]);
  const [chartType, setChartType] = useState<ChartType | null>(null);

  if (!schema) return null;

  const activeType = chartType ?? schema.preferredType;

  // Number card has no chart toggle
  if (activeType === 'number' && chartType === null) {
    return <NumberCard schema={schema} />;
  }

  const sharedAxisProps = {
    tick: { fill: '#71717a', fontSize: 11 },
    axisLine: { stroke: '#3f3f46' },
    tickLine: false,
  };

  const chartTypes: ChartType[] = schema.data.length === 1 && schema.numericCols.length <= 1
    ? ['bar', 'number'] // single-value results
    : schema.data.length <= 10
      ? ['bar', 'line', 'pie'] // few rows — all types valid
      : ['bar', 'line']; // many rows — pie not useful

  const iconMap: Record<ChartType, React.ComponentType<{ className?: string }>> = {
    bar: BarChart2,
    line: LineIcon,
    pie: PieIcon,
    number: Hash,
  };

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-4 mt-1">
      {/* Toolbar */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          {schema.preferredType === 'line' ? 'Trend' : schema.preferredType === 'pie' ? 'Distribution' : 'Chart'} view · {execution.rowCount} rows
        </p>
        <div className="flex gap-1">
          {chartTypes.map((t) => {
            const Icon = iconMap[t];
            return (
              <button
                key={t}
                onClick={() => setChartType(t)}
                className={`rounded-md p-1.5 transition-colors ${
                  activeType === t
                    ? 'bg-indigo-600/30 text-indigo-300'
                    : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                }`}
                title={`${t === 'number' ? 'Number card' : t.charAt(0).toUpperCase() + t.slice(1) + ' chart'}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Number card if selected */}
      {activeType === 'number' ? (
        <NumberCard schema={schema} />
      ) : (
        /* Chart */
        <ResponsiveContainer width="99%" height={240}>
          {activeType === 'bar' ? (
            <BarChart data={schema.data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="_label" {...sharedAxisProps} />
              <YAxis {...sharedAxisProps} />
              <Tooltip content={<CustomTooltip />} />
              {schema.numericCols.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: '#71717a' }} />}
              {schema.numericCols.map((col, i) => (
                <Bar
                  key={col}
                  dataKey={col}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  radius={[3, 3, 0, 0]}
                />
              ))}
            </BarChart>
          ) : activeType === 'line' ? (
            <LineChart data={schema.data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="_label" {...sharedAxisProps} />
              <YAxis {...sharedAxisProps} />
              <Tooltip content={<CustomTooltip />} />
              {schema.numericCols.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: '#71717a' }} />}
              {schema.numericCols.map((col, i) => (
                <Line
                  key={col}
                  type="monotone"
                  dataKey={col}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              ))}
            </LineChart>
          ) : (
            <PieChart>
              <Pie
                data={schema.data}
                dataKey={schema.numericCols[0]}
                nameKey="_label"
                cx="50%"
                cy="50%"
                outerRadius={90}
                innerRadius={40}
                paddingAngle={2}
              >
                {schema.data.map((_entry, index) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#71717a' }} />
            </PieChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  );
}
