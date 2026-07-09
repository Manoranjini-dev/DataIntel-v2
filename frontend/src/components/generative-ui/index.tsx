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
import dynamic from 'next/dynamic';
import type { QueryExecutionResult, UIHint } from '@/lib/types';
import type { VisualizationConfig } from '@/lib/aggregation';
import { measureColumns } from '@/lib/chart-format';
import { MetricCard } from './metric-card';
import { StatGrid } from './stat-grid';
import { BarChartCard } from './bar-chart-card';
import { LineChartCard } from './line-chart-card';
import { PieChartCard } from './pie-chart-card';
import { AreaChartCard } from './area-chart-card';
import { ComboChartCard } from './combo-chart-card';
import { ScatterChartCard } from './scatter-chart-card';
import { FunnelChartCard } from './funnel-chart-card';
import { GaugeChartCard } from './gauge-chart-card';
// Map uses react-simple-maps (browser-only geo rendering) — load client-side.
const MapChartCard = dynamic(() => import('./map-chart-card').then((m) => m.MapChartCard), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center text-xs text-zinc-400">Loading map…</div>,
});
import { MatrixCard } from './matrix-card';
import { DataTableCard } from './data-table-card';
import { ListCard } from './list-card';

interface GenerativeUIRendererProps {
  execution: QueryExecutionResult;
  uiHint?: UIHint;
  title?: string;
  compact?: boolean;
  /** Defaults to true (existing behavior) when unset. */
  showLegend?: boolean;
  /** Per-widget visualization config (gauge target, map fields, matrix dims…). */
  config?: VisualizationConfig;
}

/**
 * Normalize the canonical DB widget_type vocabulary (e.g. 'funnel', 'pivot')
 * and legacy aliases onto the UIHint values resolveComponent understands.
 */
const HINT_ALIASES: Record<string, UIHint> = {
  funnel: 'funnel_chart',
  pivot: 'matrix',
  scatter_plot: 'scatter',
  gauge_chart: 'gauge',
  donut: 'donut_chart',
};

/**
 * Intelligent fallback: if the LLM's hint doesn't match the data shape,
 * auto-detect the best component.
 */
function resolveComponent(
  execution: QueryExecutionResult,
  rawHint?: UIHint,
): UIHint {
  const { rows, columns } = execution;
  const hint = rawHint ? (HINT_ALIASES[rawHint] ?? rawHint) : undefined;

  // No data → table (shows "no data" message)
  if (!rows || rows.length === 0) return 'data_table';

  // Measure columns only — identifier columns (clinic_id, doctor_id, …) are not
  // metrics, so they don't count toward "does this data have a plottable value?"
  // This keeps an id from mis-triggering multi-measure charts (combo/scatter/
  // stat_grid) or being counted as a series.
  const numericCols = measureColumns(rows, columns);
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
        if (hasNumeric && rows.length >= 1 && columns.length >= 2) return 'bar_chart';
        break;

      case 'line_chart':
        if (hasNumeric && rows.length >= 3 && columns.length >= 2) return 'line_chart';
        break;

      case 'area_chart':
        if (hasNumeric && rows.length >= 3 && columns.length >= 2) return 'area_chart';
        break;

      case 'stacked_area_chart':
        if (numericCols.length >= 2 && rows.length >= 3) return 'stacked_area_chart';
        if (hasNumeric && rows.length >= 3 && columns.length >= 2) return 'area_chart';
        break;

      case 'combo_chart':
        if (numericCols.length >= 2 && rows.length >= 1) return 'combo_chart';
        if (hasNumeric && rows.length >= 1 && columns.length >= 2) return 'bar_chart';
        break;

      case 'pie_chart':
        if (hasNumeric && rows.length >= 1 && rows.length <= 12 && columns.length >= 2)
          return 'pie_chart';
        break;

      case 'list':
        return 'list';

      case 'data_table':
        return 'data_table';

      case 'heatmap':
        return hasNumeric && columns.length >= 3 ? 'data_table' : 'data_table'; // Heatmap rendered as table for now

      case 'donut_chart':
        if (hasNumeric && rows.length >= 1 && rows.length <= 12 && columns.length >= 2)
          return 'donut_chart';
        break;

      case 'stacked_bar':
        if (numericCols.length >= 2 && rows.length >= 1) return 'stacked_bar';
        if (hasNumeric && rows.length >= 1 && columns.length >= 2) return 'bar_chart';
        break;

      case 'horizontal_bar':
        if (hasNumeric && rows.length >= 1 && columns.length >= 2) return 'bar_chart';
        break;

      case 'scatter':
      case 'scatter_plot':
        // True scatter needs two numeric axes; otherwise fall back to a bar chart.
        if (numericCols.length >= 2 && rows.length >= 1) return 'scatter';
        if (hasNumeric && rows.length >= 1 && columns.length >= 2) return 'bar_chart';
        break;

      case 'radar_chart':
        if (hasNumeric && rows.length >= 3 && columns.length >= 2) return 'area_chart';
        break;

      case 'gauge':
        if (hasNumeric) return 'gauge';
        break;

      case 'number_trend':
        if (isSingleRow && hasNumeric) return 'metric_card';
        break;

      case 'map':
        if (columns.length >= 2) return 'map';
        break;

      case 'matrix':
        if (columns.length >= 2) return 'matrix';
        break;

      case 'comparison_card':
        if (isSingleRow && numericCols.length >= 2) return 'stat_grid';
        if (isSingleRow && hasNumeric) return 'metric_card';
        break;

      case 'funnel_chart':
        if (hasNumeric && rows.length >= 1 && columns.length >= 2) return 'funnel_chart';
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
  showLegend,
  config,
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
      viz = <BarChartCard execution={execution} title={title} compact={compact} showLegend={showLegend} />;
      break;
    case 'stacked_bar':
      viz = <BarChartCard execution={execution} title={title} compact={compact} stacked showLegend={showLegend} />;
      break;
    case 'line_chart':
      viz = <LineChartCard execution={execution} title={title} compact={compact} showLegend={showLegend} />;
      break;
    case 'area_chart':
      viz = <AreaChartCard execution={execution} title={title} compact={compact} showLegend={showLegend} />;
      break;
    case 'stacked_area_chart':
      viz = <AreaChartCard execution={execution} title={title} compact={compact} stacked showLegend={showLegend} />;
      break;
    case 'combo_chart':
      viz = <ComboChartCard execution={execution} title={title} compact={compact} showLegend={showLegend} />;
      break;
    case 'pie_chart':
      viz = <PieChartCard execution={execution} title={title} compact={compact} showLegend={showLegend} />;
      break;
    case 'scatter':
      viz = <ScatterChartCard execution={execution} title={title} compact={compact} />;
      break;
    case 'donut_chart':
      viz = <PieChartCard execution={execution} title={title} compact={compact} showLegend={showLegend} donut />;
      break;
    case 'funnel_chart':
      viz = <FunnelChartCard execution={execution} title={title} compact={compact} />;
      break;
    case 'gauge':
      viz = (
        <GaugeChartCard
          execution={execution}
          title={title}
          compact={compact}
          target={config?.gaugeTarget}
          min={config?.gaugeMin}
          max={config?.gaugeMax}
        />
      );
      break;
    case 'map':
      viz = (
        <MapChartCard
          execution={execution}
          title={title}
          compact={compact}
          locationField={config?.locationField}
          latField={config?.latField}
          lonField={config?.lonField}
          valueField={config?.mapValueField}
        />
      );
      break;
    case 'matrix':
      viz = (
        <MatrixCard
          execution={execution}
          title={title}
          compact={compact}
          rowDims={config?.matrixRows}
          colDim={config?.matrixCols?.[0]}
          measure={config?.matrixMeasure}
          aggregation={config?.matrixAggregation}
        />
      );
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
        className={`relative z-30 flex gap-4 w-fit pointer-events-auto border-b border-border/50 ${compact ? 'mb-3 shrink-0' : 'mb-4'}`}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={() => setView('chart')}
          title="Chart view"
          className={`relative pb-2 px-1 text-[11px] uppercase tracking-wider transition-colors duration-200 ${
            view === 'chart'
              ? 'text-primary font-bold'
              : 'text-muted-foreground font-semibold hover:text-foreground'
          }`}
        >
          Chart
          <div className={`absolute bottom-[-1px] left-0 w-full h-[2px] rounded-t-full transition-all duration-300 ${view === 'chart' ? 'bg-primary scale-x-100 opacity-100' : 'bg-transparent scale-x-75 opacity-0'}`} />
        </button>
        <button
          onClick={() => setView('table')}
          title="Table view"
          className={`relative pb-2 px-1 text-[11px] uppercase tracking-wider transition-colors duration-200 ${
            view === 'table'
              ? 'text-primary font-bold'
              : 'text-muted-foreground font-semibold hover:text-foreground'
          }`}
        >
          Table
          <div className={`absolute bottom-[-1px] left-0 w-full h-[2px] rounded-t-full transition-all duration-300 ${view === 'table' ? 'bg-primary scale-x-100 opacity-100' : 'bg-transparent scale-x-75 opacity-0'}`} />
        </button>
      </div>

      {/* Content */}
      <div key={view} className={`w-full animate-in fade-in slide-in-from-bottom-1 duration-300 ${compact ? 'flex-1 min-h-0' : ''}`}>
        {view === 'chart' ? viz : <DataTableCard execution={execution} compact={compact} />}
      </div>
    </div>
  );
}

export { resolveComponent };
