'use client';

// ──────────────────────────────────────────────
// Generative UI Renderer — Maps ui_hint to components
// ──────────────────────────────────────────────
//
// This is the core of the Generative UI system.
// The LLM recommends a ui_hint, and this renderer
// picks the right component to display the data.
// Includes intelligent fallback detection.

import { useState } from 'react';
import type { QueryExecutionResult, UIHint } from '@/lib/types';
import { MetricCard } from './metric-card';
import { StatGrid } from './stat-grid';
import { BarChartCard } from './bar-chart-card';
import { LineChartCard } from './line-chart-card';
import { PieChartCard } from './pie-chart-card';
import { AreaChartCard } from './area-chart-card';
import { ScatterChartCard } from './scatter-chart-card';
import { DataTableCard } from './data-table-card';
import { ListCard } from './list-card';

interface GenerativeUIRendererProps {
  execution: QueryExecutionResult;
  uiHint?: UIHint;
  title?: string;
  compact?: boolean;
}

/**
 * Intelligent fallback: if the LLM's hint doesn't match the data shape,
 * auto-detect the best component.
 */
function resolveComponent(
  execution: QueryExecutionResult,
  hint?: UIHint,
): UIHint {
  const { rows, columns } = execution;

  // No data → table (shows "no data" message)
  if (!rows || rows.length === 0) return 'data_table';

  const numericCols = columns.filter((c) =>
    rows.slice(0, 10).filter((r) => r[c] != null).every((r) => !isNaN(Number(r[c]))),
  );
  const hasNumeric = numericCols.length > 0;
  const isSingleRow = rows.length === 1;
  const isSingleCol = columns.length <= 2;

  // If LLM provided a hint, validate it's usable
  if (hint) {
    switch (hint) {
      case 'metric_card':
        if (isSingleRow && hasNumeric) return 'metric_card';
        break;

      case 'stat_grid':
        if (isSingleRow && numericCols.length >= 2) return 'stat_grid';
        break;

      case 'bar_chart':
        if (hasNumeric && rows.length >= 2 && columns.length >= 2) return 'bar_chart';
        break;

      case 'line_chart':
        if (hasNumeric && rows.length >= 3 && columns.length >= 2) return 'line_chart';
        break;

      case 'area_chart':
        if (hasNumeric && rows.length >= 3 && columns.length >= 2) return 'area_chart';
        break;

      case 'pie_chart':
        if (hasNumeric && rows.length >= 2 && rows.length <= 12 && columns.length >= 2)
          return 'pie_chart';
        break;

      case 'list':
        return 'list';

      case 'data_table':
        return 'data_table';

      case 'heatmap':
        return hasNumeric && columns.length >= 3 ? 'data_table' : 'data_table'; // Heatmap rendered as table for now

      // New extended types — map to closest existing renderer
      case 'donut_chart':
        if (hasNumeric && rows.length >= 2 && rows.length <= 12 && columns.length >= 2)
          return 'pie_chart';
        break;

      case 'stacked_bar':
      case 'horizontal_bar':
        if (hasNumeric && rows.length >= 2 && columns.length >= 2) return 'bar_chart';
        break;

      case 'scatter':
      case 'scatter_plot':
        // True scatter needs two numeric axes; otherwise fall back to a bar chart.
        if (numericCols.length >= 2 && rows.length >= 2) return 'scatter';
        if (hasNumeric && rows.length >= 3 && columns.length >= 2) return 'bar_chart';
        break;

      case 'radar_chart':
        if (hasNumeric && rows.length >= 3 && columns.length >= 2) return 'area_chart';
        break;

      case 'gauge':
      case 'number_trend':
        if (isSingleRow && hasNumeric) return 'metric_card';
        break;

      case 'comparison_card':
        if (isSingleRow && numericCols.length >= 2) return 'stat_grid';
        if (isSingleRow && hasNumeric) return 'metric_card';
        break;

      case 'funnel_chart':
        if (hasNumeric && rows.length >= 2 && columns.length >= 2) return 'bar_chart';
        break;

      case 'timeline':
        if (hasNumeric && rows.length >= 3 && columns.length >= 2) return 'line_chart';
        break;

      case 'treemap':
        return 'data_table';
    }
  }

  // Auto-detect from data shape
  if (isSingleRow && numericCols.length === 1 && columns.length <= 2) {
    return 'metric_card';
  }
  if (isSingleRow && numericCols.length >= 2) {
    return 'stat_grid';
  }
  if (!hasNumeric && isSingleCol) {
    return 'list';
  }
  if (!hasNumeric) {
    return columns.length <= 2 ? 'list' : 'data_table';
  }

  // ── Time-series auto-detection for ES aggregation results ──
  // If a column's values look like dates/timestamps, prefer line_chart
  if (hasNumeric && rows.length >= 3 && columns.length >= 2) {
    const hasDateCol = columns.some((c) => {
      // Check column name patterns
      if (/date|time|created|updated|_at$|year|month|day|period|week|daily|monthly|weekly|quarterly|histogram/i.test(c)) return true;
      // Check value patterns (ISO dates, YYYY-MM-DD)
      const v = rows[0]?.[c];
      if (typeof v === 'string' && /^\d{4}[-/]\d{2}/.test(v)) return true;
      return false;
    });
    if (hasDateCol) return 'line_chart';
  }

  // If multi-row, has numeric, likely categories → bar chart
  if (hasNumeric && rows.length >= 2 && columns.length >= 2 && rows.length <= 30) {
    return 'bar_chart';
  }

  // Default: data table for everything else
  return hint || 'data_table';
}

export function GenerativeUIRenderer({
  execution,
  uiHint,
  title,
  compact,
}: GenerativeUIRendererProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const resolved = resolveComponent(execution, uiHint);

  // Pure table — no toggle needed
  if (resolved === 'data_table') {
    return <DataTableCard execution={execution} title={title} compact={compact} />;
  }

  // Build the visualization node
  let viz;
  switch (resolved) {
    case 'metric_card':
      viz = <MetricCard execution={execution} title={title} compact={compact} />;
      break;
    case 'stat_grid':
      viz = <StatGrid execution={execution} title={title} compact={compact} />;
      break;
    case 'bar_chart':
      viz = <BarChartCard execution={execution} title={title} compact={compact} />;
      break;
    case 'line_chart':
      viz = <LineChartCard execution={execution} title={title} compact={compact} />;
      break;
    case 'area_chart':
      viz = <AreaChartCard execution={execution} title={title} compact={compact} />;
      break;
    case 'pie_chart':
      viz = <PieChartCard execution={execution} title={title} compact={compact} />;
      break;
    case 'scatter':
      viz = <ScatterChartCard execution={execution} title={title} compact={compact} />;
      break;
    case 'list':
      viz = <ListCard execution={execution} title={title} compact={compact} />;
      break;
    default:
      viz = <DataTableCard execution={execution} title={title} compact={compact} />;
  }

  return (
    <div className={`flex flex-col w-full ${compact ? 'h-full' : 'space-y-2'}`}>
      {/* Toggle tabs */}
      <div 
        className={`relative z-30 flex gap-1 rounded-lg bg-white border border-zinc-200 p-1 w-fit shadow-sm pointer-events-auto ${compact ? 'mb-2 shrink-0' : ''}`}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={() => setView('chart')}
          title="Chart view"
          className={`rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-all ${view === 'chart'
            ? 'bg-white text-zinc-800 shadow-sm border border-zinc-200'
            : 'bg-white text-zinc-500 hover:text-zinc-700 border border-transparent'
            }`}
        >
          Chart
        </button>
        <button
          onClick={() => setView('table')}
          title="Table view"
          className={`rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-all ${view === 'table'
            ? 'bg-white text-zinc-800 shadow-sm border border-zinc-200'
            : 'bg-white text-zinc-500 hover:text-zinc-700 border border-transparent'
            }`}
        >
          Table
        </button>
      </div>

      {/* Content */}
      <div className={`w-full ${compact ? 'flex-1 min-h-0' : ''}`}>
        {view === 'chart' ? viz : <DataTableCard execution={execution} compact={compact} />}
      </div>
    </div>
  );
}

export { resolveComponent };
