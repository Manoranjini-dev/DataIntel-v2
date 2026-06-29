'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { dashboardApi, chatApi, cardApi } from '@/lib/api';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ResponsiveGridLayout = require('react-grid-layout').Responsive as React.ComponentType<any>;
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  Sparkles, Plus, History, Save, LayoutGrid, X, ChevronDown,
  MoreHorizontal, RefreshCw, Type, Trash2, Play, Check, GripHorizontal,
  MessageSquare, LayoutDashboard, Download, FileText, ImageDown, Edit3, GripVertical, Share2,
  Copy, ArrowRightLeft,
} from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, useDroppable,
  useDraggable, useSensor, useSensors, DragEndEvent, DragStartEvent,
  pointerWithin, rectIntersection, CollisionDetection, MeasuringStrategy,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext, horizontalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GenerativeUIRenderer } from '../generative-ui';
import { TextCard } from '../generative-ui/text-card';
import { ImageCard } from '../generative-ui/image-card';
import { useAuthStore } from '@/lib/auth-store';
import { ShareDashboardModal } from './ShareDashboardModal';
import { ShareResourceModal } from './ShareResourceModal';
import {
  applyVisualizationConfig, AGGREGATION_OPTIONS, NUMERIC_ONLY_AGGREGATIONS, isNumericColumn,
  type VisualizationConfig, type AggregationFn,
} from '@/lib/aggregation';
import { useUIStore } from '@/lib/ui-store';

// ── Grid geometry — MUST stay in sync with the ResponsiveGridLayout props
// below (cols=12, rowHeight=80, margin=[12,12], containerPadding=[0,0]).
const GRID_COLS = 12;
const GRID_ROW_H = 80;
const GRID_MARGIN = 12;

// Deterministic drop-target resolution for the grid: an existing card always
// wins (so it gets pushed forward), then an empty grid cell, then the canvas
// drop-zone. Uses pointer-within first, falling back to rect intersection.
const gridCollisionDetection: CollisionDetection = (args) => {
  const hits = (() => {
    const within = pointerWithin(args);
    return within.length ? within : rectIntersection(args);
  })();
  const widget = hits.find((h) => String(h.id).startsWith('drop-widget-'));
  if (widget) return [widget];
  const cell = hits.find((h) => String(h.id).startsWith('cell-'));
  if (cell) return [cell];
  return hits;
};

// ── Types ──────────────────────────────────────────────────────
interface WidgetData {
  id: string;
  sql?: string;
  title: string;
  widget_type: string;
  query_prompt: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  result_rows?: Record<string, unknown>[];
  result_columns?: string[];
  ui_hint?: string;
  isLoading?: boolean;
  isRenaming?: boolean;
  query_definition?: any;
  /** Static content for non-query widgets — Free Text card markdown body. */
  text_content?: string;
  /** Static content for non-query widgets — Image card source URL and caption. */
  image_url?: string;
  image_caption?: string;
  /** Client-side chart/aggregation settings (X/Y axis, group by, aggregation, sort, legend). */
  visualization_config?: VisualizationConfig;
}

// ── Map LLM ui_hint → valid widget_type / chart_type enum ──────
// The PostgreSQL enum has a fixed set of values. LLM can return extended
// hints like 'data_table', 'stat_grid', 'stacked_bar' which aren't valid.
function normalizeWidgetType(hint?: string | null): string {
  const MAP: Record<string, string> = {
    data_table: 'table',
    stat_grid: 'metric_card',
    horizontal_bar: 'bar_chart',
    scatter_plot: 'scatter',
    gauge_chart: 'gauge',
    funnel_chart: 'funnel',
    timeline: 'line_chart',
    radar_chart: 'bar_chart',
    comparison_card: 'metric_card',
    number_trend: 'metric_card',
    list: 'table',
  };
  const VALID = new Set([
    'metric_card', 'line_chart', 'area_chart', 'bar_chart', 'pie_chart',
    'donut_chart', 'table', 'heatmap', 'funnel', 'scatter', 'pivot',
    'gauge', 'treemap', 'sankey', 'text', 'image', 'divider', 'filter_control',
    'stacked_bar', 'stacked_area_chart', 'combo_chart',
  ]);
  const normalized = MAP[hint || ''] || hint || 'table';
  return VALID.has(normalized) ? normalized : 'table';
}



// ── Templates ──────────────────────────────────────────────────
const WIDGET_TEMPLATES = [
  { type: 'metric_card', name: 'KPI Card', icon: '▣', desc: 'Single key number' },
  { type: 'bar_chart', name: 'Bar Chart', icon: '▦', desc: 'Compare categories' },
  { type: 'line_chart', name: 'Line Chart', icon: '↗', desc: 'Trends over time' },
  { type: 'area_chart', name: 'Area Chart', icon: '◿', desc: 'Volume over time' },
  { type: 'stacked_area_chart', name: 'Stacked Area Chart', icon: '◣', desc: 'Stacked volume over time' },
  { type: 'pie_chart', name: 'Pie Chart', icon: '◑', desc: 'Part-to-whole' },
  { type: 'donut_chart', name: 'Donut Chart', icon: '◎', desc: 'Proportion rings' },
  { type: 'horizontal_bar', name: 'Horizontal Bar', icon: '▬', desc: 'Ranked comparison' },
  { type: 'stacked_bar', name: 'Stacked Bar Chart', icon: '▤', desc: 'Stacked category comparison' },
  { type: 'combo_chart', name: 'Line & Bar Combo', icon: '⌗', desc: 'Dual-axis bar + line' },
  { type: 'scatter_chart', name: 'Scatter Plot', icon: '⁝', desc: 'Correlation / clusters' },
  { type: 'funnel_chart', name: 'Funnel', icon: '▽', desc: 'Conversion stages' },
  { type: 'gauge_chart', name: 'Gauge', icon: '◐', desc: 'Single value vs target' },
  { type: 'waterfall_chart', name: 'Waterfall', icon: '⊟', desc: 'Running totals' },
  { type: 'stat_grid', name: 'Stat Grid', icon: '⊞', desc: 'Multiple metrics' },
  { type: 'table', name: 'Data Table', icon: '☰', desc: 'Raw row data' },
  { type: 'text', name: 'Free Text', icon: '✎', desc: 'Static note or annotation' },
  { type: 'image', name: 'Image', icon: '▢', desc: 'Picture or logo' },
];

const CHART_COLORS = ['#D97A1E', '#F5A623', '#50A0B4', '#6ECA97', '#E97B7B', '#9B8EF5'];

// ── Single source of truth for widget dimensions ───────────────
// ALL widget creation paths (auto-generated, Add to Dashboard,
// drag-and-drop, card click, GenerateDialog) MUST use these constants.
const WIDGET_W = 6;  // half of the 12-column grid = 2 columns
const WIDGET_H = 4;  // rows in react-grid-layout units
const GRID_COLS_COUNT = 2; // number of columns in the 2-col layout

/**
 * Finds the next available grid slot by scanning the 2-column grid
 * left-to-right, top-to-bottom. Skips occupied positions so new
 * widgets fill gaps instead of always appending to the bottom.
 */
function findNextSlot(currentWidgets: WidgetData[]): { x: number; y: number } {
  // Build a set of all occupied (x, y) top-left corners
  const occupied = new Set(
    currentWidgets.map(w => `${w.position_x ?? 0},${w.position_y ?? 0}`)
  );
  // Scan rows until we find a free slot
  for (let row = 0; row < 1000; row++) {
    for (let col = 0; col < GRID_COLS_COUNT; col++) {
      const x = col * WIDGET_W;
      const y = row * WIDGET_H;
      if (!occupied.has(`${x},${y}`)) {
        return { x, y };
      }
    }
  }
  // Absolute fallback (unreachable in practice)
  return { x: 0, y: currentWidgets.length * WIDGET_H };
}

/**
 * Inserts a new widget at the target grid position (targetX, targetY),
 * shifting every existing widget that occupies that slot or a later slot
 * forward by one position in the 2-column reading order.
 *
 * This produces the "push-forward" reflow behaviour:
 *   Before: [A] [B] [C] [D]
 *   Drop onto B’s slot:
 *   After:  [A] [NEW] [B] [C] [D]
 */
function insertAtSlot(
  currentWidgets: WidgetData[],
  targetX: number,
  targetY: number,
): { slotX: number; slotY: number; shiftedWidgets: WidgetData[] } {
  // Snap targetX/targetY to nearest valid slot boundary
  const col = Math.round(targetX / WIDGET_W);
  const row = Math.round(targetY / WIDGET_H);
  const snappedX = col * WIDGET_W;
  const snappedY = row * WIDGET_H;
  const targetIdx = row * GRID_COLS_COUNT + col;

  // Convert each widget to a linear slot index and shift those at or after target
  const shifted = currentWidgets.map(w => {
    const wCol = Math.round((w.position_x ?? 0) / WIDGET_W);
    const wRow = Math.round((w.position_y ?? 0) / WIDGET_H);
    const wIdx = wRow * GRID_COLS_COUNT + wCol;
    if (wIdx < targetIdx) return w; // before target — unchanged
    // Shift forward by one slot
    const newIdx = wIdx + 1;
    const newCol = newIdx % GRID_COLS_COUNT;
    const newRow = Math.floor(newIdx / GRID_COLS_COUNT);
    return { ...w, position_x: newCol * WIDGET_W, position_y: newRow * WIDGET_H };
  });

  return { slotX: snappedX, slotY: snappedY, shiftedWidgets: shifted };
}

/**
 * A widget is "executable" only if it already carries a real query — a saved
 * SQL statement or a user/AI-authored prompt. Empty drag-and-drop widgets have
 * neither, so they must NEVER be auto-executed on load, refresh, move, resize
 * or dashboard reopen (which would otherwise fabricate a chart from the title).
 * Charts for such widgets are only ever produced when the user explicitly
 * clicks Generate inside the widget editor.
 */
function widgetHasQuery(w: WidgetData): boolean {
  return Boolean((w.query_prompt && w.query_prompt.trim()) || (w.sql && w.sql.trim()));
}

/**
 * Highest "Page N" number among the given pages. Used to generate the next
 * sequential page name without duplicates (e.g. after deletions, refresh,
 * save, or reload). Non-matching custom names are ignored.
 */
function highestPageNumber(pages: { name?: unknown }[]): number {
  let max = 0;
  for (const p of pages) {
    const m = /^page\s+(\d+)$/i.exec(String(p?.name ?? '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

/**
 * Make a string safe to use as a download filename while PRESERVING spaces
 * (the export naming spec uses names verbatim, e.g. "Sales Dashboard_Revenue
 * Analysis.png"). Only characters illegal in filenames are stripped.
 */
function safeFilePart(s: string): string {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'Untitled';
}

// ── Mini widget renderers ──────────────────────────────────────
function BarWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <TableWidget title={title} rows={rows} columns={columns} />;
  const labelCol = columns[0], valueCol = columns[1];
  const maxVal = Math.max(...rows.map(r => Number(r[valueCol]) || 0)) || 1;
  return (
    <div className="h-full flex flex-col px-3 py-2.5">
      <p className="text-xs font-semibold text-foreground mb-3 truncate">{title}</p>
      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {rows.slice(0, 20).map((row, i) => {
          const val = Number(row[valueCol]) || 0;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground w-20 truncate shrink-0">{String(row[labelCol] ?? '')}</span>
              <div className="flex-1 bg-muted/40 rounded-full h-3.5 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(val / maxVal) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] + '99' }} />
              </div>
              <span className="text-[11px] text-foreground w-12 text-right shrink-0">{val.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LineWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <TableWidget title={title} rows={rows} columns={columns} />;
  const values = rows.map(r => Number(r[columns[1]]) || 0);
  const max = Math.max(...values) || 1, min = Math.min(...values), range = max - min || 1;
  const W = 280, H = 72;
  const pts = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * W},${H - ((v - min) / range) * H}`).join(' ');
  return (
    <div className="h-full flex flex-col px-3 py-2.5">
      <p className="text-xs font-semibold text-foreground mb-2 truncate">{title}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full flex-1 min-h-0" preserveAspectRatio="none">
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D97A1E" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#D97A1E" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polyline points={`0,${H} ${pts} ${W},${H}`} fill="url(#lg)" stroke="none" />
        <polyline points={pts} fill="none" stroke="#D97A1E" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
        <span className="truncate max-w-[45%]">{String(rows[0]?.[columns[0]] ?? '')}</span>
        <span className="truncate max-w-[45%] text-right">{String(rows[rows.length - 1]?.[columns[0]] ?? '')}</span>
      </div>
    </div>
  );
}

function PieWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <TableWidget title={title} rows={rows} columns={columns} />;
  const total = rows.reduce((s, r) => s + (Number(r[columns[1]]) || 0), 0) || 1;
  let cum = 0;
  const slices = rows.slice(0, 6).map((row, i) => {
    const val = Number(row[columns[1]]) || 0;
    const s = (cum / total) * 360, e = ((cum + val) / total) * 360;
    cum += val;
    const toRad = (deg: number) => (deg - 90) * Math.PI / 180;
    const x1 = 50 + 44 * Math.cos(toRad(s)), y1 = 50 + 44 * Math.sin(toRad(s));
    const x2 = 50 + 44 * Math.cos(toRad(e)), y2 = 50 + 44 * Math.sin(toRad(e));
    return { path: `M50,50 L${x1},${y1} A44,44 0 ${e - s > 180 ? 1 : 0},1 ${x2},${y2} Z`, color: CHART_COLORS[i % CHART_COLORS.length], label: String(row[columns[0]] ?? ''), pct: Math.round((val / total) * 100) };
  });
  return (
    <div className="h-full flex items-center gap-4 px-3 py-2.5">
      <svg viewBox="0 0 100 100" className="w-20 h-20 shrink-0"><circle cx="50" cy="50" r="26" fill="hsl(var(--card))" />{slices.map((s, i) => <path key={i} d={s.path} fill={s.color} />)}</svg>
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-xs font-semibold text-foreground truncate mb-2">{title}</p>
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-[11px] text-muted-foreground truncate flex-1">{s.label}</span>
            <span className="text-[11px] text-foreground font-medium shrink-0">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  const row = rows[0] || {};
  const value = row[columns[0]];
  return (
    <div className="h-full flex flex-col justify-center items-center p-4 text-center">
      <p className="text-xs text-muted-foreground mb-2 leading-tight">{title}</p>
      <p className="text-4xl font-bold text-foreground tracking-tight leading-none">
        {typeof value === 'number' ? value.toLocaleString() : String(value ?? '—')}
      </p>
      {columns[1] && <p className="text-xs text-muted-foreground mt-2">{String(row[columns[1]] ?? '')}</p>}
    </div>
  );
}

function TableWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  return (
    <div className="h-full flex flex-col">
      <p className="text-xs font-semibold text-foreground px-3 pt-2.5 pb-2 border-b border-border shrink-0 truncate">{title}</p>
      <div className="flex-1 overflow-auto min-h-0">
        <table className="text-xs w-full">
          <thead className="bg-muted/40 sticky top-0">
            <tr>{columns.map(c => <th key={c} className="px-3 py-2 text-left text-muted-foreground font-medium whitespace-nowrap">{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((row, i) => (
              <tr key={i} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                {columns.map(c => <td key={c} className="px-3 py-2 text-foreground whitespace-nowrap max-w-[120px] truncate">{String(row[c] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScatterWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <TableWidget title={title} rows={rows} columns={columns} />;
  const xCol = columns[0], yCol = columns[1];
  const xs = rows.map(r => Number(r[xCol]) || 0), ys = rows.map(r => Number(r[yCol]) || 0);
  const minX = Math.min(...xs), maxX = Math.max(...xs) || 1, minY = Math.min(...ys), maxY = Math.max(...ys) || 1;
  const W = 260, H = 80;
  const px = (v: number) => ((v - minX) / (maxX - minX || 1)) * W;
  const py = (v: number) => H - ((v - minY) / (maxY - minY || 1)) * H;
  return (
    <div className="h-full flex flex-col px-3 py-2.5">
      <p className="text-xs font-semibold text-foreground mb-2 truncate">{title}</p>
      <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} className="w-full flex-1 min-h-0">
        {rows.slice(0, 80).map((r, i) => (
          <circle key={i} cx={px(Number(r[xCol]) || 0)} cy={py(Number(r[yCol]) || 0)} r="3"
            fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity="0.7" />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
        <span>{xCol}</span><span>{yCol}</span>
      </div>
    </div>
  );
}

function FunnelWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <TableWidget title={title} rows={rows} columns={columns} />;
  const top = Math.max(...rows.map(r => Number(r[columns[1]]) || 0)) || 1;
  return (
    <div className="h-full flex flex-col px-3 py-2.5 gap-1.5">
      <p className="text-xs font-semibold text-foreground mb-1 truncate">{title}</p>
      {rows.slice(0, 6).map((row, i) => {
        const val = Number(row[columns[1]]) || 0;
        const pct = (val / top) * 100;
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-20 truncate shrink-0">{String(row[columns[0]] ?? '')}</span>
            <div className="flex-1 flex justify-center">
              <div className="h-5 rounded-sm" style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] + 'CC', minWidth: 2 }} />
            </div>
            <span className="text-[10px] text-foreground w-10 text-right shrink-0">{val.toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

function GaugeWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  const raw = rows[0] ? Number(rows[0][columns[0]]) || 0 : 0;
  const max = rows[0] && columns[1] ? Number(rows[0][columns[1]]) || 100 : 100;
  const pct = Math.min(1, raw / max);
  const angle = -135 + pct * 270;
  const r = 38, cx = 50, cy = 55;
  const arc = (start: number, end: number) => {
    const s = (start - 90) * Math.PI / 180, e = (end - 90) * Math.PI / 180;
    return `M${cx + r * Math.cos(s)},${cy + r * Math.sin(s)} A${r},${r} 0 ${end - start > 180 ? 1 : 0},1 ${cx + r * Math.cos(e)},${cy + r * Math.sin(e)}`;
  };
  return (
    <div className="h-full flex flex-col items-center justify-center p-3">
      <p className="text-xs font-semibold text-foreground mb-1 truncate">{title}</p>
      <svg viewBox="0 0 100 80" className="w-28 h-20">
        <path d={arc(-135, 135)} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" strokeLinecap="round" />
        <path d={arc(-135, -135 + pct * 270)} fill="none" stroke="#D97A1E" strokeWidth="8" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={cx + 26 * Math.cos((angle - 90) * Math.PI / 180)} y2={cy + 26 * Math.sin((angle - 90) * Math.PI / 180)}
          stroke="#2B2B2B" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="3" fill="#2B2B2B" />
        <text x={cx} y={cy + 18} textAnchor="middle" fontSize="10" fill="hsl(var(--foreground))" fontWeight="700">{raw.toLocaleString()}</text>
      </svg>
    </div>
  );
}

function WaterfallWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <TableWidget title={title} rows={rows} columns={columns} />;
  let running = 0;
  const bars = rows.slice(0, 8).map((row, i) => {
    const val = Number(row[columns[1]]) || 0;
    const base = running; running += val;
    return { label: String(row[columns[0]] ?? ''), val, base, pos: val >= 0 };
  });
  const minV = Math.min(0, ...bars.map(b => b.base)), maxV = Math.max(...bars.map(b => b.base + b.val));
  const H = 70, W = 260;
  const barW = Math.max(8, (W / bars.length) - 4);
  const py = (v: number) => H - ((v - minV) / (maxV - minV || 1)) * H;
  return (
    <div className="h-full flex flex-col px-3 py-2.5">
      <p className="text-xs font-semibold text-foreground mb-2 truncate">{title}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full flex-1 min-h-0">
        {bars.map((b, i) => {
          const x = (i / bars.length) * W + 2;
          const yTop = py(Math.max(b.base, b.base + b.val));
          const h = Math.abs(py(b.base) - py(b.base + b.val));
          return <rect key={i} x={x} y={yTop} width={barW} height={Math.max(2, h)} fill={b.pos ? '#6ECA97' : '#E97B7B'} rx="1" fillOpacity="0.85" />;
        })}
        <line x1="0" y1={py(0)} x2={W} y2={py(0)} stroke="hsl(var(--border))" strokeDasharray="3,3" strokeWidth="0.5" />
      </svg>
    </div>
  );
}

// ── Widget card ─────────────────────────────────────────────────
function Widget({
  widget, isEditing, isSelected, onSelect, onRemove, onInspect, onRename, onSuggestTitle, onEditQuery, otherPages, onMoveToPage, isGeneral, onFocus,
  canShare, onShare, onCopyToDashboard, onMoveToDashboard,
}: {
  widget: WidgetData;
  isEditing: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
  onRemove?: () => void;
  onInspect?: () => void;
  onRename?: (newTitle: string) => void;
  onSuggestTitle?: () => void;
  onEditQuery?: () => void;
  otherPages?: { id: string; name: string }[];
  onMoveToPage?: (pageId: string) => void;
  isGeneral?: boolean;
  /** Open this widget in full-screen focus mode (view mode only). */
  onFocus?: () => void;
  /** Card-level sharing is owner-only, mirrored from the parent's isOwner flag. */
  canShare?: boolean;
  onShare?: () => void;
  onCopyToDashboard?: () => void;
  onMoveToDashboard?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(widget.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  const rawRows = widget.result_rows || [];
  const rawColumns = widget.result_columns || [];
  const vizConfig = widget.visualization_config;
  // Pure, deterministic reshape (group by / aggregate) — a no-op when no
  // visualization config is set, so unconfigured widgets render unchanged.
  const { rows, columns } = useMemo(
    () => applyVisualizationConfig(rawRows, rawColumns, vizConfig),
    [rawRows, rawColumns, vizConfig],
  );
  const hint = vizConfig?.vizType || widget.ui_hint || widget.widget_type || 'table';
  const qd = typeof widget.query_definition === 'string' ? JSON.parse(widget.query_definition) : (widget.query_definition || {});

  const renderContent = () => {
    if (widget.isLoading) return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-4">
        <div className="w-7 h-7 border-[3px] border-border border-t-primary rounded-full animate-spin" />
        {widget.title && widget.title !== 'Generating insight…' && (
          <p className="text-xs text-muted-foreground/60 font-medium">{widget.title}</p>
        )}
      </div>
    );


    // Free Text and Image cards are static content, not query-driven — they
    // never have rows/columns, so they must bypass the rows-based branches
    // below entirely (otherwise they'd permanently show "no data").
    if (widget.widget_type === 'text' || widget.widget_type === 'image') {
      const isText = widget.widget_type === 'text';
      const content = String(widget.text_content ?? qd.text_content ?? '');
      const imageUrl = String(widget.image_url ?? qd.image_url ?? '');
      const caption = String(widget.image_caption ?? qd.image_caption ?? '');
      const hasContent = isText ? !!content.trim() : !!imageUrl.trim();

      if (!hasContent) {
        return (
          <div
            className="h-full flex flex-col p-3 transition-all duration-300 cursor-pointer group-hover/card:bg-muted/10"
            onClick={() => {
              if (isEditing) onSelect?.();
              if (!isGeneral) onEditQuery?.();
            }}
            title={!isGeneral ? `Click to add ${isText ? 'text' : 'an image'}` : ''}
          >
            {widget.title && <p className="text-xs font-semibold text-foreground mb-1 truncate">{widget.title}</p>}
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/50 text-xs gap-3">
              <div className="w-10 h-10 rounded-full bg-muted/40 border border-border/50 flex items-center justify-center text-muted-foreground transition-transform duration-300 group-hover/card:scale-105 group-hover/card:bg-primary/5 group-hover/card:text-primary/70 group-hover/card:border-primary/20">
                {isText
                  ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
                  : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>}
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="font-medium text-foreground/70">{isText ? 'Empty Text Card' : 'No Image Set'}</span>
                <span className="text-[10px] text-muted-foreground/60 max-w-[160px] text-center">
                  {isGeneral ? 'General dashboard widget' : `Click to ${isText ? 'write a note' : 'add an image URL'}`}
                </span>
                {!isGeneral && <span className="mt-1 text-[10px] px-2 py-1 bg-primary/10 text-primary rounded-md font-medium opacity-0 group-hover/card:opacity-100 transition-opacity duration-300">Configure</span>}
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="h-full w-full overflow-hidden" onClick={() => { if (isEditing) onSelect?.(); }}>
          {isText
            ? <TextCard content={content} title={widget.title} compact />
            : <ImageCard imageUrl={imageUrl} caption={caption} title={widget.title} compact />}
        </div>
      );
    }
    if (!rows.length) return (
      <div
        className="h-full flex flex-col p-3 transition-all duration-300 cursor-pointer group-hover/card:bg-muted/10"
        onClick={() => {
          if (isEditing) onSelect?.();
          if (!isGeneral) onEditQuery?.();
        }}
        title={!isGeneral ? "Click to configure widget data" : ""}
      >
        {widget.title && <p className="text-xs font-semibold text-foreground mb-1 truncate">{widget.title}</p>}
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/50 text-xs gap-3">
          <div className="w-10 h-10 rounded-full bg-muted/40 border border-border/50 flex items-center justify-center text-muted-foreground transition-transform duration-300 group-hover/card:scale-105 group-hover/card:bg-primary/5 group-hover/card:text-primary/70 group-hover/card:border-primary/20">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
          </div>
          {widget.query_prompt
            ? (
              <div className="flex flex-col items-center gap-1.5">
                <span className="font-medium text-foreground/70">No Data Returned</span>
                <span className="text-[10px] text-muted-foreground/60 text-center max-w-[180px] leading-relaxed line-clamp-2">{widget.query_prompt}</span>
                <span className="mt-1 text-[10px] px-2 py-1 bg-primary/10 text-primary rounded-md font-medium opacity-0 group-hover/card:opacity-100 transition-opacity">Edit Query</span>
              </div>
            )
            : (
              <div className="flex flex-col items-center gap-1">
                <span className="font-medium text-foreground/70">{isEditing ? 'Empty Widget' : 'Add Widget'}</span>
                <span className="text-[10px] text-muted-foreground/60 max-w-[160px] text-center">
                  {isEditing ? (isGeneral ? 'General dashboard widget' : 'Click to configure chart data') : 'Click to add a chart'}
                </span>
                {!isGeneral && <span className="mt-1 text-[10px] px-2 py-1 bg-primary/10 text-primary rounded-md font-medium opacity-0 group-hover/card:opacity-100 transition-opacity duration-300">Configure</span>}
              </div>
            )
          }
        </div>
      </div>
    );
    return (
      <div className="h-full w-full overflow-hidden flex flex-col p-1 gap-1">
        {qd.insightSummary && (
          <div className="px-2 pt-1 pb-1 shrink-0">
            <p className="text-[11px] font-medium text-foreground leading-snug">{qd.insightSummary}</p>
          </div>
        )}
        <div className="flex-1 min-h-0 relative">
          <GenerativeUIRenderer
            execution={{ rows, columns, rowCount: rows.length, executionTimeMs: 0 } as any}
            uiHint={hint as any}
            title={widget.title}
            compact={true}
            showLegend={vizConfig?.showLegend}
          />
        </div>
        {(qd.metricContext || qd.businessSignificance) && (
          <div className="mx-2 mb-1 px-2 py-1.5 bg-muted/30 rounded-lg shrink-0 space-y-1">
            {qd.metricContext && (
              <p className="text-[10px] text-muted-foreground leading-relaxed"><span className="font-semibold text-foreground/70">Context:</span> {qd.metricContext}</p>
            )}
            {qd.businessSignificance && (
              <p className="text-[10px] text-primary/80 font-medium leading-relaxed"><span className="font-semibold text-primary">Impact:</span> {qd.businessSignificance}</p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      onClick={() => {
        // Existing widgets are select-only on click (so they stay highlightable
        // for drag/resize). The Edit Query dialog must NOT open for a populated
        // widget — it is reserved for empty placeholders, whose own click
        // handler in renderContent's no-data branch opens it.
        if (isEditing) onSelect?.();
      }}
      className={`relative h-full flex flex-col bg-card border rounded-xl overflow-hidden transition-all duration-300 group/card ${
        isEditing
          ? isSelected
            ? 'border-primary ring-1 ring-primary/30 shadow-md shadow-primary/5'
            : 'border-primary/20 hover:border-primary/40 hover:shadow-md cursor-pointer'
          : 'border-border hover:border-border'
      }`}
      style={!isEditing || !isSelected ? { boxShadow: 'var(--shadow-soft)' } : undefined}
    >

      {/* Drag handle */}
      {isEditing && (
        <div className="widget-drag-handle absolute top-0 left-0 right-0 h-8 z-20 flex items-center justify-center cursor-grab active:cursor-grabbing opacity-0 group-hover/card:opacity-100 transition-all duration-200 hover:bg-primary/15 rounded-t-xl group/handle">
          <div className="w-12 h-1.5 bg-primary/40 rounded-full transition-all duration-200 group-hover/handle:bg-primary/80 group-hover/handle:w-16" />
        </div>
      )}

      {/* Edit menu */}
      {isEditing && (
        <div className="absolute top-2 right-2 bottom-2 z-30 flex flex-col items-end pointer-events-none" ref={menuRef}>
          {renaming ? (
            <div className="flex items-center gap-1 bg-card border border-border rounded-lg px-2 py-1 shadow-lg pointer-events-auto shrink-0">
              <input
                ref={inputRef}
                value={draftTitle}
                onChange={e => setDraftTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { onRename?.(draftTitle); setRenaming(false); }
                  if (e.key === 'Escape') { setDraftTitle(widget.title); setRenaming(false); }
                }}
                className="text-xs bg-transparent text-foreground outline-none w-32"
                onMouseDown={e => e.stopPropagation()}
              />
              <button onMouseDown={e => e.stopPropagation()} onClick={() => { onRename?.(draftTitle); setRenaming(false); }} className="text-success">
                <Check className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setMenuOpen(v => !v)}
              className="w-7 h-7 rounded-lg bg-card/80 border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition-colors opacity-0 group-hover/card:opacity-100 pointer-events-auto shrink-0"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          )}

          {menuOpen && !renaming && (
            <div className="mt-1 w-52 bg-card border border-border rounded-xl shadow-xl z-40 py-1 overflow-y-auto pointer-events-auto shrink" onMouseDown={e => e.stopPropagation()}>
              <button onClick={() => { setMenuOpen(false); setRenaming(true); setDraftTitle(widget.title); }}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors shrink-0">
                <Type className="w-3.5 h-3.5 text-muted-foreground" /> Rename
              </button>
              {!isGeneral && (
                <>
                  <button onClick={() => { setMenuOpen(false); onSuggestTitle?.(); }}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors shrink-0">
                    <Sparkles className="w-3.5 h-3.5 text-primary" /> AI suggest title
                  </button>
                  <button onClick={() => { setMenuOpen(false); onEditQuery?.(); }}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors shrink-0">
                    <Play className="w-3.5 h-3.5 text-primary" /> Edit query
                  </button>
                </>
              )}
              {otherPages && otherPages.length > 0 && (
                <>
                  <div className="mx-3 my-1 h-px bg-border shrink-0" />
                  <p className="px-3 py-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider shrink-0">Move to page</p>
                  {otherPages.map(p => (
                    <button key={p.id} onClick={() => { setMenuOpen(false); onMoveToPage?.(p.id); }}
                      className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors shrink-0">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /></svg>
                      {p.name}
                    </button>
                  ))}
                </>
              )}
              {(canShare || onCopyToDashboard || onMoveToDashboard) && (
                <>
                  <div className="mx-3 my-1 h-px bg-border shrink-0" />
                  {canShare && onShare && (
                    <button onClick={() => { setMenuOpen(false); onShare(); }}
                      className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors shrink-0">
                      <Share2 className="w-3.5 h-3.5 text-muted-foreground" /> Share card
                    </button>
                  )}
                  {onCopyToDashboard && (
                    <button onClick={() => { setMenuOpen(false); onCopyToDashboard(); }}
                      className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors shrink-0">
                      <Copy className="w-3.5 h-3.5 text-muted-foreground" /> Copy to dashboard…
                    </button>
                  )}
                  {onMoveToDashboard && (
                    <button onClick={() => { setMenuOpen(false); onMoveToDashboard(); }}
                      className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors shrink-0">
                      <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground" /> Move to dashboard…
                    </button>
                  )}
                </>
              )}
              <div className="mx-3 my-1 h-px bg-border shrink-0" />
              <button onClick={() => { setMenuOpen(false); onRemove?.(); }}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 transition-colors shrink-0">
                <Trash2 className="w-3.5 h-3.5" /> Remove widget
              </button>
            </div>
          )}
        </div>
      )}



      {/* Full-screen focus — view mode only (avoids clashing with the edit
          drag-handle/menu). Available to anyone viewing the dashboard. */}
      {!isEditing && onFocus && (rows.length > 0 || widget.widget_type === 'text' || widget.widget_type === 'image') && (
        <button
          onClick={(e) => { e.stopPropagation(); onFocus(); }}
          title="Expand to full screen"
          className="absolute top-2 right-2 z-30 w-7 h-7 rounded-lg bg-card/80 border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition-all opacity-0 group-hover/card:opacity-100"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        </button>
      )}

      <div className="h-full">{renderContent()}</div>
    </div>
  );
}

// ── Full-screen widget focus overlay ───────────────────────────
// Read-only expanded view of a single widget. Re-runs the same client-side
// visualization transform + renderer (non-compact) so the chart/table looks
// identical, just larger. Available in published/view mode to all roles.
function WidgetFocusOverlay({ widget, onClose }: { widget: WidgetData; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rawRows = widget.result_rows || [];
  const rawColumns = widget.result_columns || [];
  const { rows, columns } = applyVisualizationConfig(rawRows, rawColumns, widget.visualization_config);
  const hint = widget.visualization_config?.vizType || widget.ui_hint || widget.widget_type || 'table';
  const qd = typeof widget.query_definition === 'string' ? JSON.parse(widget.query_definition) : (widget.query_definition || {});

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{widget.title || 'Widget'}</h2>
          <button onClick={onClose} title="Close (Esc)" className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 p-4 overflow-auto">
          {widget.widget_type === 'text' ? (
            <TextCard content={String(widget.text_content ?? qd.text_content ?? '')} title={widget.title} />
          ) : widget.widget_type === 'image' ? (
            <ImageCard imageUrl={String(widget.image_url ?? qd.image_url ?? '')} caption={String(widget.image_caption ?? qd.image_caption ?? '')} title={widget.title} />
          ) : rows.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No data to display.</div>
          ) : (
            <div className="h-full">
              <GenerativeUIRenderer
                execution={{ rows, columns, rowCount: rows.length, executionTimeMs: 0 } as any}
                uiHint={hint as any}
                title={widget.title}
                showLegend={widget.visualization_config?.showLegend}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardWidgetDroppable({ widget, children }: { widget: WidgetData, children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-widget-${widget.id}`,
    data: { type: 'widget-drop', widget },
  });
  return (
    <div ref={setNodeRef} className="h-full w-full relative">
      {isOver && (
        <div className="absolute inset-0 bg-primary/20 z-50 border-2 border-primary border-dashed rounded-xl pointer-events-none" />
      )}
      {children}
    </div>
  );
}

// ── Grid overlay: visible grid + droppable / clickable empty slots ──
// Renders a light dashed grid over the canvas in edit mode, aligned to the
// 2-column slot system (each slot is WIDGET_W×WIDGET_H). Each EMPTY slot is
// both a dnd-kit droppable (a dragged widget snaps directly into it) and
// clickable (opens the Add Widget dialog seeded to that slot). Occupied
// slots are skipped so cells never overlap a widget — keeping drop-target
// resolution unambiguous. Dropping onto an existing CARD still pushes that
// card forward (handled separately in handleDragEnd via insertAtSlot).
function GridCell({
  gridX, gridY, left, top, width, height, onClickCell,
}: {
  gridX: number; gridY: number; left: number; top: number; width: number; height: number;
  onClickCell: (x: number, y: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell-${gridX}-${gridY}`,
    data: { type: 'grid-cell', x: gridX, y: gridY },
  });
  return (
    <div
      ref={setNodeRef}
      onClick={() => onClickCell(gridX, gridY)}
      title="Drop or click to add a widget here"
      className={`absolute rounded-xl border-2 border-dashed transition-colors pointer-events-auto cursor-pointer flex items-center justify-center group/cell ${
        isOver
          ? 'border-primary bg-primary/15'
          : 'border-border/40 hover:border-primary/50 hover:bg-primary/5'
      }`}
      style={{ left, top, width, height }}
    >
      <Plus className={`w-5 h-5 transition-opacity ${isOver ? 'text-primary opacity-100' : 'text-muted-foreground/30 opacity-0 group-hover/cell:opacity-100'}`} />
    </div>
  );
}

function GridOverlay({
  containerWidth, widgets, onClickCell,
}: {
  containerWidth: number;
  widgets: WidgetData[];
  onClickCell: (x: number, y: number) => void;
}) {
  // Pixel width of one 12-col unit (must match RGL geometry).
  const colUnit = (containerWidth - GRID_MARGIN * (GRID_COLS - 1)) / GRID_COLS;
  if (!(colUnit > 0)) return null;

  // Pixel size of a single slot (WIDGET_W cols × WIDGET_H rows).
  const slotW = WIDGET_W * colUnit + (WIDGET_W - 1) * GRID_MARGIN;
  const slotH = WIDGET_H * GRID_ROW_H + (WIDGET_H - 1) * GRID_MARGIN;

  // Occupied slots keyed by their top-left grid position "x,y".
  const occupied = new Set(widgets.map(w => `${w.position_x ?? 0},${w.position_y ?? 0}`));

  // Show enough rows to cover existing widgets plus one empty row to drop into.
  let maxRow = 0;
  for (const w of widgets) maxRow = Math.max(maxRow, Math.round((w.position_y ?? 0) / WIDGET_H) + 1);
  const rows = Math.max(maxRow + 1, 2);

  const cells: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < GRID_COLS_COUNT; c++) {
      const gx = c * WIDGET_W;
      const gy = r * WIDGET_H;
      if (occupied.has(`${gx},${gy}`)) continue;
      cells.push(
        <GridCell
          key={`${gx}-${gy}`}
          gridX={gx}
          gridY={gy}
          left={gx * (colUnit + GRID_MARGIN)}
          top={gy * (GRID_ROW_H + GRID_MARGIN)}
          width={slotW}
          height={slotH}
          onClickCell={onClickCell}
        />,
      );
    }
  }

  return (
    <div
      className="absolute inset-x-0 top-0 pointer-events-none z-0"
      style={{ height: rows * slotH + (rows - 1) * GRID_MARGIN }}
    >
      {cells}
    </div>
  );
}

function DraggableTemplateItem({ template, onClick }: { template: any, onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `template-${template.type}`,
    data: { type: 'template', template },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-2.5 p-2.5 bg-muted/30 border border-border/50 rounded-xl cursor-grab active:cursor-grabbing hover:bg-muted/60 hover:border-primary/20 transition-all select-none ${isDragging ? 'opacity-50' : ''}`}
      onClick={onClick}
    >
      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">{template.icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-foreground">{template.name}</p>
        <p className="text-[10px] text-muted-foreground truncate">{template.desc}</p>
      </div>
    </div>
  );
}

function DraggableCardItem({ card, onClick }: { card: any, onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `card-${card.id}`,
    data: { type: 'card', card },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-2.5 p-2.5 bg-muted/30 border border-border/50 rounded-xl cursor-grab active:cursor-grabbing hover:bg-muted/60 hover:border-primary/20 transition-all select-none ${isDragging ? 'opacity-50' : ''}`}
      onClick={onClick}
    >
      <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center shrink-0 text-[11px] font-bold text-accent/70">{(card.chart_type || 'C').slice(0, 1).toUpperCase()}</div>
      <p className="text-[11px] font-medium text-foreground truncate">{card.name}</p>
    </div>
  );
}

// ── Widget Sidebar ─────────────────────────────────────────────
function WidgetSidebar({ onCardClick, onTemplateClick }: {
  onCardClick?: (c: any) => void;
  onTemplateClick?: (t: string) => void;
}) {
  const [cards, setCards] = useState<any[]>([]);
  const [tab, setTab] = useState<'templates' | 'cards'>('templates');

  useEffect(() => {
    cardApi.list({ limit: 50 }).then(res => setCards(res.cards)).catch(console.error);
  }, []);

  return (
    <div className="w-56 bg-card border-l border-border flex flex-col shrink-0 h-full overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">Add Widget</h3>
        <div className="flex bg-muted/50 p-0.5 rounded-lg border border-border">
          {(['templates', 'cards'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 text-[11px] py-1.5 rounded-md font-medium transition-all ${tab === t ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'}`}>
              {t === 'templates' ? 'Widgets' : 'Cards'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {tab === 'templates' && WIDGET_TEMPLATES.map(w => (
          <DraggableTemplateItem key={w.type} template={w} onClick={() => onTemplateClick?.(w.type)} />
        ))}

        {tab === 'cards' && (
          cards.length === 0
            ? <p className="text-[11px] text-muted-foreground text-center mt-6 leading-relaxed">No cards in library yet</p>
            : cards.map(c => (
              <DraggableCardItem key={c.id} card={c} onClick={() => onCardClick?.(c)} />
            ))
        )}
      </div>
    </div>
  );
}

// ── Add Widget Dialog ──────────────────────────────────────────
function AddWidgetDialog({ dashId, pageId, chatId, connectionId, onChatCreated, onAdd, onClose, defaultHint, defaultPosition, isGeneral }: {
  dashId: string; pageId: string; chatId?: string; connectionId?: string;
  onChatCreated?: (id: string) => void;
  onAdd: (widget: Record<string, unknown>) => void; onClose: () => void;
  defaultHint?: string; defaultPosition?: { x: number; y: number; w: number; h: number };
  isGeneral?: boolean;
}) {
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      let activeChatId = chatId;
      if (!activeChatId && connectionId) {
        const { chat } = await chatApi.create({ connectionId });
        activeChatId = chat.id;
        onChatCreated?.(chat.id);
      }
      if (!activeChatId) return;
      const p = defaultHint ? `${prompt} (format for a ${defaultHint.replace(/_/g, ' ')})` : prompt;
      const data = await chatApi.ask(activeChatId, p, true);
      setPreview(data as Record<string, unknown>);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleAdd() {
    if (!isGeneral && !preview) return;
    setLoading(true);
    try {
      const exec = preview ? (preview as any).execution as Record<string, unknown> : null;
      const llmHint = preview ? ((preview as any).assistantMessage?.ui_hint || exec?.ui_hint) : null;
      const rawHint = defaultHint || llmHint || 'table';
      const widgetType = normalizeWidgetType(rawHint as string);
      // defaultPosition is ALWAYS set before this dialog opens (callers use findNextSlot).
      // Use it for both the backend and the frontend state so positions are consistent
      // across add, save, and reload cycles.
      const posX = defaultPosition?.x ?? 0;
      const posY = defaultPosition?.y ?? 0;
      const widget = await dashboardApi.addWidget(dashId, pageId, {
        title: title || prompt,
        widget_type: widgetType,
        queryPrompt: prompt,
        sql: String(exec?.generated_query || ''),
        datasourceScopeType: 'connection',
        resultRows: (exec?.rows as Record<string, unknown>[]) || [],
        resultColumns: (exec?.columns as string[]) || [],
        uiHint: widgetType,
        gridX: posX, gridY: posY,
        gridW: WIDGET_W, gridH: WIDGET_H,
      });
      onAdd({
        id: widget.widget.id, title: widget.widget.title, widget_type: widget.widget.widget_type,
        query_prompt: widget.widget.query_prompt,
        position_x: posX, position_y: posY,
        width: WIDGET_W,
        height: WIDGET_H,
        result_rows: (exec?.rows as Record<string, unknown>[]) || [],
        result_columns: exec?.columns as string[] || [],
        ui_hint: widgetType,
        // Always true — defaultPosition is pre-computed before the dialog opens,
        // so handleWidgetAdded should use it directly without calling findNextSlot again.
        is_dropped: true,
      });
      onClose();
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  const exec = preview ? (preview as any).execution as Record<string, unknown> : null;
  const llmSuggestedHint = preview ? ((preview as any).assistantMessage?.ui_hint || exec?.ui_hint as string | undefined) : undefined;
  const inputCls = 'w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all';

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()} style={{ boxShadow: 'var(--shadow-elevated)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Add Widget</h2>
            {defaultHint && <p className="text-xs text-muted-foreground mt-0.5">Type: {defaultHint.replace(/_/g, ' ')}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Widget Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Monthly Revenue" className={inputCls} />
          </div>
          
          {!isGeneral && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Data Query</label>
                <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
                  placeholder="e.g., Show total revenue by month for the last 12 months"
                  rows={3} className={`${inputCls} resize-none`} />
              </div>

              {!chatId && !connectionId && (
                <div className="text-xs text-yellow-600 dark:text-yellow-400 bg-warning/5 border border-warning/20 rounded-xl px-3 py-2">
                  No linked chat. Connect a data source to this dashboard first.
                </div>
              )}

              <button onClick={handleGenerate} disabled={!prompt.trim() || loading || (!chatId && !connectionId)}
                className="w-full py-2.5 bg-primary/10 border border-primary/20 hover:bg-primary/20 rounded-xl text-sm text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-semibold">
                {loading ? <span className="flex items-center justify-center gap-2"><span className="w-3.5 h-3.5 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />Generating…</span> : 'Preview Data'}
              </button>
            </>
          )}

          {exec && (
            exec.status === 'failed'
              ? (
                <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-3">
                  <p className="text-xs flex items-start gap-2">
                    <span className="text-destructive shrink-0 mt-0.5">✗</span>
                    <span className="text-destructive/90">{String(exec.error_message || 'Query failed — schema may not be synced yet')}</span>
                  </p>
                </div>
              )
              : (
                <div className="bg-success/5 border border-success/20 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className="text-success">✓</span>
                    {String(exec.row_count ?? 0)} rows returned
                    {defaultHint && llmSuggestedHint && normalizeWidgetType(defaultHint) !== normalizeWidgetType(llmSuggestedHint) && (
                      <span className="ml-2 text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        💡 AI suggests: {normalizeWidgetType(llmSuggestedHint).replace(/_/g, ' ')}
                      </span>
                    )}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="text-xs w-full">
                      <thead><tr>{(exec.columns as string[] || []).map((c: string) => <th key={c} className="px-2 py-1 text-left text-muted-foreground">{c}</th>)}</tr></thead>
                      <tbody>{((exec.rows as any[] || []).slice(0, 5)).map((row: any, i: number) => (
                        <tr key={i}>{(exec.columns as string[]).map((c: string) => <td key={c} className="px-2 py-1 text-foreground truncate max-w-[80px]">{String(row[c] ?? '')}</td>)}</tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )
          )}
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button onClick={handleAdd} disabled={(!isGeneral && !preview) || loading}
            className="flex-1 py-2.5 bg-primary text-white hover:opacity-90 rounded-xl text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
            Add to Dashboard
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-muted/50 hover:bg-muted rounded-xl text-sm text-muted-foreground transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── AI Generate Dashboard Dialog ───────────────────────────────
function GenerateDialog({ chatId, connectionId, onChatCreated, onWidgetAdded, dashId, pageId, onClose }: {
  chatId?: string; connectionId?: string;
  onChatCreated?: (id: string) => void;
  onWidgetAdded: (w: Record<string, unknown>) => void;
  dashId: string; pageId: string; onClose: () => void;
}) {
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  async function handleGenerate() {
    if (!description.trim() || (!chatId && !connectionId)) return;
    setGenerating(true);
    setProgress([]);

    // Split by comma or newline into individual widget prompts
    const prompts = description.split(/[,\n]/).map(p => p.trim()).filter(Boolean);
    // Fallback hints — used only if the LLM doesn't return a ui_hint
    const fallbackHints = ['bar_chart', 'line_chart', 'metric_card', 'pie_chart', 'bar_chart', 'line_chart'];

    let activeChatId = chatId;
    if (!activeChatId && connectionId) {
      try {
        const { chat } = await chatApi.create({ connectionId });
        activeChatId = chat.id;
        onChatCreated?.(chat.id);
      } catch (e) { console.error(e); setGenerating(false); return; }
    }
    if (!activeChatId) { setGenerating(false); return; }

    // Track grid positions claimed in this generation pass so findNextSlot
    // can account for widgets added earlier in the same loop
    const existingWidgetPositions: { x: number; y: number }[] = [];

    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      const fallbackHint = fallbackHints[i % fallbackHints.length];
      setProgress(p => [...p, `⏳ ${prompt}`]);

      let rows: Record<string, unknown>[] = [];
      let columns: string[] = [];
      let resolvedHint = fallbackHint;

      try {
        const result = await chatApi.ask(activeChatId, prompt, true);
        const exec = (result as any).execution;
        // ui_hint lives on assistantMessage, NOT on execution record
        const llmHint = (result as any).assistantMessage?.ui_hint || exec?.ui_hint;
        resolvedHint = normalizeWidgetType(llmHint || fallbackHint);
        rows = (exec?.rows || []);
        columns = exec?.columns || [];
        // Mark as done in progress
        setProgress(p => p.map((line, idx) => idx === i ? `✓ ${prompt}` : line));
      } catch (e) {
        console.error(`Widget "${prompt}" failed:`, e);
        setProgress(p => p.map((line, idx) => idx === i ? `✗ ${prompt} (query failed — widget added, click Execute to retry)` : line));
      }

      // Always add the widget — even if the query failed, the user can re-execute it
      // from the dashboard. Empty result_rows will show "No data" with an Execute button.
      try {
        // Compute the next available slot given widgets already added in this batch
        // We track a running list of positions added so far in this generation pass
        const existingPositions = existingWidgetPositions.map((pos, idx) => ({
          position_x: pos.x, position_y: pos.y, width: WIDGET_W, height: WIDGET_H,
          id: `gen-${idx}`, title: '', widget_type: '', query_prompt: '',
        } as WidgetData));
        const slot = findNextSlot(existingPositions);
        existingWidgetPositions.push(slot);

        const widget = await dashboardApi.addWidget(dashId, pageId, {
          title: prompt.slice(0, 60),
          widget_type: resolvedHint,
          queryPrompt: prompt,
          datasourceScopeType: 'connection',
          resultRows: rows,
          resultColumns: columns,
          uiHint: resolvedHint,
          gridX: slot.x,
          gridY: slot.y,
          gridW: WIDGET_W, gridH: WIDGET_H,
        });
        onWidgetAdded({
          id: widget.widget.id, title: widget.widget.title,
          widget_type: resolvedHint,
          query_prompt: prompt,
          position_x: slot.x, position_y: slot.y,
          width: WIDGET_W, height: WIDGET_H,
          result_rows: rows,
          result_columns: columns,
          ui_hint: resolvedHint,
        });
      } catch (e) {
        console.error(`Failed to add widget "${prompt}" to dashboard:`, e);
        setProgress(p => p.map((line, idx) => idx === i ? `✗ ${prompt} (could not save widget)` : line));
      }
    }
    setGenerating(false);
    setDone(true);
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={!generating ? onClose : undefined}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()} style={{ boxShadow: 'var(--shadow-elevated)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Generate Dashboard with AI</h2>
              <p className="text-xs text-muted-foreground">Describe what you want — AI builds the widgets</p>
            </div>
          </div>
          {!generating && <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"><X className="w-4 h-4" /></button>}
        </div>

        <div className="p-5 space-y-4">
          {!done ? (
            <>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Describe the widgets you want <span className="text-muted-foreground/60">(separate multiple by comma or newline)</span>
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  disabled={generating}
                  placeholder="e.g., total revenue this month, revenue by region, top 10 products, monthly trend line"
                  rows={4}
                  className="w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none disabled:opacity-50 transition-all"
                />
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Will generate {description.split(/[,\n]/).filter(p => p.trim()).length || 0} widget{description.split(/[,\n]/).filter(p => p.trim()).length !== 1 ? 's' : ''}
                </p>
              </div>

              {!chatId && !connectionId && (
                <div className="text-xs text-yellow-600 dark:text-yellow-400 bg-warning/5 border border-warning/20 rounded-xl px-3 py-2.5">
                  No data connection linked. Go to dashboard settings and connect a data source first.
                </div>
              )}

              {(generating || done) && progress.length > 0 && (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {progress.map((p, i) => {
                    const isDone = p.startsWith('✓');
                    const isFail = p.startsWith('✗');
                    const isPending = p.startsWith('⏳');
                    const label = p.replace(/^[✓✗⏳]\s*/, '');
                    return (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        {isPending && <span className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin shrink-0 mt-0.5" />}
                        {isDone && <span className="text-success shrink-0">✓</span>}
                        {isFail && <span className="text-destructive shrink-0">✗</span>}
                        <span className={`${isDone ? 'text-foreground' : isFail ? 'text-destructive/80' : 'text-muted-foreground'} leading-tight`}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <button onClick={handleGenerate} disabled={!description.trim() || generating || (!chatId && !connectionId)}
                className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}>
                {generating
                  ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Generating widgets…</span>
                  : <span className="flex items-center justify-center gap-2"><Sparkles className="w-4 h-4" /> Generate Dashboard</span>}
              </button>
            </>
          ) : (
            <div className="text-center py-6">
              <div className="w-14 h-14 rounded-2xl bg-success/10 border border-success/20 flex items-center justify-center mx-auto mb-4">
                <Check className="w-7 h-7 text-success" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">Dashboard generated!</p>
              <p className="text-xs text-muted-foreground mb-5">{progress.length} widget{progress.length !== 1 ? 's' : ''} added to your page</p>
              <button onClick={onClose}
                className="px-6 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity">
                View Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Query Inspector ─────────────────────────────────────────────
function QueryInspectorModal({ widgetId, dashId, pageId, onClose }: {
  widgetId: string; dashId: string; pageId: string; onClose: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi.inspect(dashId, pageId, widgetId)
      .then(res => setData(res.execution))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [widgetId, dashId, pageId]);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()} style={{ boxShadow: 'var(--shadow-elevated)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Query Inspector</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 min-h-[280px] flex flex-col">
          {loading ? <div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
            : data ? (
              <div className="space-y-5">
                <div className="grid grid-cols-3 gap-3">
                  {[['Status', data.status, data.status === 'success' ? 'text-success' : 'text-destructive'], ['Duration', `${data.duration_ms}ms`, ''], ['Rows', data.rows_returned, '']].map(([l, v, cls]) => (
                    <div key={String(l)} className="p-3 bg-muted/40 rounded-xl border border-border">
                      <p className="text-xs text-muted-foreground mb-1">{l}</p>
                      <p className={`text-sm font-semibold text-foreground ${cls}`}>{v}</p>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Executed SQL</p>
                  <pre className="bg-muted/40 border border-border rounded-xl p-4 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap">
                    {data.raw_query || 'No SQL generated'}
                  </pre>
                </div>
                {data.error && (
                  <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 text-xs font-mono text-destructive">{data.error}</div>
                )}
              </div>
            ) : <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No execution data</div>}
        </div>
      </div>
    </div>
  );
}

// ── Edit Query Dialog ──────────────────────────────────────────
// Shows BOTH the natural-language prompt and the generated SQL so
// the user can edit either and re-run. Apply persists to the DB.
function EditQueryDialog({ widget, dashId, pageId, chatId, connectionId, onUpdate, onClose, isGeneral }: {
  widget: WidgetData;
  dashId: string;
  pageId: string;
  chatId?: string;
  connectionId?: string;
  onUpdate: (patch: Partial<WidgetData>) => void;
  onClose: () => void;
  isGeneral?: boolean;
}) {
  const [prompt, setPrompt] = useState(widget.query_prompt || '');
  // Seed from widget.sql immediately (set during addWidget / previous handleApply)
  const [sql, setSql] = useState(widget.sql || '');
  const [sqlLoading, setSqlLoading] = useState(false);
  // 'prompt' = last ran via prompt, 'sql' = last ran via sql
  const [lastRanVia, setLastRanVia] = useState<'prompt' | 'sql' | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  // AI-assist state: rephrasing/suggesting in progress, and whether the prompt
  // was just auto-suggested (so we ask the user to review before generating).
  const [assisting, setAssisting] = useState(false);
  const [justSuggested, setJustSuggested] = useState(false);
  const [assistNote, setAssistNote] = useState('');
  const [preview, setPreview] = useState<{ rows: Record<string, unknown>[]; fullRows: Record<string, unknown>[]; columns: string[]; ui_hint: string; llm_suggested_hint?: string } | null>(null);
  const [error, setError] = useState('');

  // ── Visualization Settings — chart type, axes, group by, aggregation,
  // sort, legend. Purely client-side: reshapes the already-returned rows,
  // never touches the SQL. Seeded from the widget's saved config so it's
  // automatically restored when the dialog is reopened.
  const vc = widget.visualization_config;
  const [vizType, setVizType] = useState(vc?.vizType || widget.widget_type || 'bar_chart');
  const [xAxis, setXAxis] = useState(vc?.xAxis || '');
  const [yAxis, setYAxis] = useState(vc?.yAxis || '');
  const [groupBy, setGroupBy] = useState(vc?.groupBy || '');
  const [aggregation, setAggregation] = useState<AggregationFn | ''>(vc?.aggregation || '');
  const [sortBy, setSortBy] = useState(vc?.sortBy || '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(vc?.sortDir || 'asc');
  const [showLegendSetting, setShowLegendSetting] = useState(vc?.showLegend !== false);
  const [vizSaving, setVizSaving] = useState(false);
  const [vizSaved, setVizSaved] = useState(false);
  const [vizError, setVizError] = useState('');

  // Prefer the freshest preview's columns/rows; fall back to the widget's
  // last-saved result so the section is usable without re-running anything.
  const availableColumns = preview?.columns?.length ? preview.columns : (widget.result_columns || []);
  const sampleRows = preview?.fullRows?.length ? preview.fullRows : (widget.result_rows || []);
  const yAxisIsNumeric = !yAxis || isNumericColumn(sampleRows, yAxis);

  async function handleSaveVisualization() {
    setVizSaving(true); setVizError(''); setVizSaved(false);
    try {
      const visualization_config: VisualizationConfig = {
        vizType: vizType || undefined,
        xAxis: xAxis || undefined,
        yAxis: yAxis || undefined,
        groupBy: groupBy || undefined,
        aggregation: (aggregation || undefined) as AggregationFn | undefined,
        sortBy: sortBy || undefined,
        sortDir,
        showLegend: showLegendSetting,
      };
      await dashboardApi.updateWidget(dashId, pageId, widget.id, { ...widget, visualization_config });
      onUpdate({ visualization_config });
      setVizSaved(true);
      setTimeout(() => setVizSaved(false), 2500);
    } catch (e: any) {
      setVizError('Failed to save: ' + (e?.message || 'unknown error'));
    } finally {
      setVizSaving(false);
    }
  }

  // Load the current SQL from the widget's last execution on mount.
  // widget.sql is the immediate fallback (seeded from query_definition.sql above).
  // The inspect call may find a more-recent SQL from a widget_execution record.
  useEffect(() => {
    setSqlLoading(true);
    dashboardApi.inspect(dashId, pageId, widget.id)
      .then(res => {
        // Prefer the execution's generated_query (most recent run) over the stored prompt-sql
        const execSql = res.execution?.generated_query;
        if (execSql) setSql(execSql);
        // else: keep widget.sql that was seeded into state above
      })
      .catch(() => {/* no execution record — widget.sql from query_definition is used */ })
      .finally(() => setSqlLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Get or create the chat needed for execution
  async function getChat(): Promise<string | null> {
    if (chatId) return chatId;
    if (connectionId) {
      try {
        const { chat } = await chatApi.create({ connectionId });
        return chat.id;
      } catch { return null; }
    }
    return null;
  }

  // Run a natural-language prompt → generate SQL → execute → preview.
  async function runPromptGeneration(p: string) {
    const finalPrompt = (p || '').trim();
    if (!finalPrompt) return;
    setRunning(true); setError(''); setPreview(null);
    try {
      const cid = await getChat();
      if (!cid) { setError('No connection available to run this query.'); return; }
      const result = await chatApi.ask(cid, finalPrompt, true);
      const exec = (result as any).execution;

      if (exec?.generated_query) {
        setSql(exec.generated_query); // always update SQL pane so user can see it
      }

      const rows: Record<string, unknown>[] = exec?.rows || [];
      const llmHint: string = (result as any).assistantMessage?.ui_hint || exec?.ui_hint;

      if (exec?.status === 'failed') {
        setError(formatQueryError(exec.error_message));
      } else {
        setPreview({ rows: rows.slice(0, 5), fullRows: rows, columns: exec?.columns || [], ui_hint: widget.widget_type, llm_suggested_hint: llmHint });
        setLastRanVia('prompt');
      }
    } catch (e: any) { setError(formatQueryError(e?.message)); }
    finally { setRunning(false); }
  }

  function formatQueryError(raw?: string): string {
    const msg = (raw || '').toLowerCase();
    if (msg.includes('etimedout') || msg.includes('timed out') || msg.includes('econnrefused') || msg.includes('connection failed')) {
      return 'Database connection failed — the server is unreachable. Go to Connections and verify the host, port, and credentials, then retry.';
    }
    if (msg.includes('schema') && msg.includes('sync')) {
      return 'Schema not synced — go to Connection Settings → Schema Sync and run a sync, then retry.';
    }
    if (raw?.trim()) return raw.trim();
    return 'Query could not be executed. Try editing the prompt, or check your data source connection.';
  }

  /** Map an AI-assist (suggest/refine) failure to a clear, non-empty message. */
  function formatAssistError(e: any, mode: 'suggest' | 'refine'): string {
    const code = e?.code || e?.cause?.code;
    const status: number | undefined = e?.status ?? e?.structured?.status;
    const raw = (e?.structured?.message || e?.message || '').toLowerCase();
    if (code === 'ECONNABORTED' || raw.includes('timeout')) return 'The AI request timed out. Please try again.';
    if (code === 'ERR_NETWORK' || raw.includes('network') || raw.includes('econnrefused') || raw.includes('failed to fetch')) {
      return 'Could not reach the server. Please check your connection and try again.';
    }
    if (raw.includes('schema')) return 'Failed to load the database schema. Run Schema Sync for this connection and try again.';
    if (status === 404) return 'This widget could not be found. Try reopening the dashboard.';
    return mode === 'suggest'
      ? 'AI generation failed — could not propose a question. Please type one and try again.'
      : 'Unable to refine the prompt right now. Please try again.';
  }

  /**
   * Primary AI-assisted action — ALWAYS produces a populated prompt + SQL in a
   * single click. Two modes:
   *  • Empty prompt  → AI proposes a question for this widget/schema, fills the
   *                    prompt, then generates the SQL + preview from it.
   *  • Existing text → AI refines the wording (best-effort), updates the prompt,
   *                    then generates SQL + preview from the refined text.
   * A misleading "type a question" message is never shown for an empty prompt —
   * an error surfaces only when the AI service itself genuinely fails.
   */
  async function handleGenerate() {
    if (running || saving || assisting || noConnection) return;
    setError('');
    setAssistNote('');

    let finalPrompt = prompt.trim();

    if (!finalPrompt) {
      // ── Mode 1: empty prompt → suggest a question, then continue to SQL. ──
      setAssisting(true);
      try {
        const { question } = await dashboardApi.suggestQuestion(dashId, pageId, widget.id);
        const suggested = (question || '').trim();
        if (!suggested) {
          // Backend always returns a fallback, so empty here means a real failure.
          setError('AI generation failed — could not propose a question. Please type one and try again.');
          return;
        }
        finalPrompt = suggested;
        setPrompt(finalPrompt);
        setAssistNote('AI proposed a question from this widget and your schema.');
      } catch (e: any) {
        setError(formatAssistError(e, 'suggest'));
        return;
      } finally {
        setAssisting(false);
      }
    } else {
      // ── Mode 2: existing text → refine (best-effort), then continue to SQL. ──
      setAssisting(true);
      try {
        const { prompt: improved } = await dashboardApi.improvePrompt(dashId, pageId, widget.id, finalPrompt);
        const refined = (improved || '').trim();
        if (refined && refined !== finalPrompt) {
          finalPrompt = refined;
          setPrompt(finalPrompt);
          setAssistNote('Refined your question for clearer analysis.');
        }
      } catch (e: any) {
        // Refinement is best-effort — log, keep the user's wording, still generate SQL.
        console.warn('[widget-generate] prompt refinement failed, using original wording:', e);
      } finally {
        setAssisting(false);
      }
    }

    setJustSuggested(false);
    // Both modes converge here → populates the Generated SQL editor + preview.
    await runPromptGeneration(finalPrompt);
  }

  async function handleRunSQL() {
    if (!sql.trim()) return;
    setRunning(true); setError(''); setPreview(null);
    try {
      const cid = await getChat();
      if (!cid) { setError('No connection available to run this query.'); return; }
      const result = await chatApi.executeDraft(cid, '', sql);
      const exec = result.execution ?? result;
      const rows: Record<string, unknown>[] = exec?.rows || [];
      
      if (exec?.status === 'failed') {
        setError(formatQueryError(exec.error_message));
      } else {
        setPreview({ rows: rows.slice(0, 5), fullRows: rows, columns: exec?.columns || [], ui_hint: widget.widget_type, llm_suggested_hint: exec?.ui_hint });
        setLastRanVia('sql');
      }
    } catch (e: any) { setError(formatQueryError(e?.message)); }
    finally { setRunning(false); }
  }

  async function handleApply() {
    if (!preview) return;
    setSaving(true); setError('');
    try {
      const patch: Partial<WidgetData> = {
        // Always save the new results
        result_rows: preview.fullRows,
        result_columns: preview.columns,
        // Only update prompt when it was the prompt that was run
        query_prompt: lastRanVia === 'prompt' ? prompt : widget.query_prompt,
        // Always save the SQL that was actually executed (so inspect finds it next time)
        sql: sql,
      };
      // Persist to DB (sql goes into query_definition.sql via updateWidget)
      await dashboardApi.updateWidget(dashId, pageId, widget.id, {
        ...widget,
        ...patch,
      });
      onUpdate(patch);
      onClose();
    } catch (e: any) {
      setError('Failed to save: ' + (e?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }

  const noConnection = !chatId && !connectionId;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
        style={{ boxShadow: 'var(--shadow-elevated)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Edit Widget Query</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{widget.title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {noConnection && (
            <div className="text-xs text-warning bg-warning/8 border border-warning/20 rounded-xl px-3 py-2">
              This dashboard has no datasource connected — queries cannot be run.
            </div>
          )}

          {/* ── Prompt section ── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-foreground">Data prompt</label>
              <span className="text-[10px] text-muted-foreground">Natural language — AI refines it & writes the SQL</span>
            </div>
            <textarea
              value={prompt}
              onChange={e => { setPrompt(e.target.value); setPreview(null); setJustSuggested(false); setAssistNote(''); }}
              rows={2}
              disabled={running || saving || assisting}
              placeholder="Describe what you want to see — or leave empty and click Generate for an AI suggestion"
              className="w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none disabled:opacity-50 transition-all"
            />

            {/* AI assist note (suggested / refined) */}
            {assistNote && (
              <p className="mt-1.5 text-[11px] text-primary flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" /> {assistNote}
              </p>
            )}

            <div className="mt-2 flex items-center gap-2">
              {/* Primary AI-assisted Generate */}
              <button
                onClick={handleGenerate}
                disabled={running || saving || assisting || noConnection}
                title={prompt.trim()
                  ? 'Refine the question and generate the chart'
                  : 'Suggest a relevant question for this widget'}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
              >
                {assisting
                  ? <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />{prompt.trim() ? 'Refining…' : 'Suggesting…'}</>
                  : running && lastRanVia !== 'sql'
                    ? <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />Generating…</>
                    : <><Sparkles className="w-3.5 h-3.5" />{justSuggested ? 'Generate from suggestion' : 'Generate'}</>}
              </button>

              {/* Run the typed prompt verbatim (no rephrasing) */}
              <button
                onClick={() => runPromptGeneration(prompt)}
                disabled={running || saving || assisting || !prompt.trim() || noConnection}
                title="Run your prompt exactly as written (skip AI rephrasing)"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 border border-border rounded-lg text-xs font-medium text-foreground disabled:opacity-40 transition-colors"
              >
                <Play className="w-3 h-3 text-primary" />Run as-is
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* ── SQL section ── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-foreground">Generated SQL</label>
              <span className="text-[10px] text-muted-foreground">Edit directly and run</span>
            </div>
            {sqlLoading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                <span className="w-3 h-3 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
                Loading last executed SQL…
              </div>
            ) : (
              <textarea
                value={sql}
                onChange={e => { setSql(e.target.value); setPreview(null); }}
                rows={5}
                disabled={running || saving}
                placeholder="SELECT * FROM your_table LIMIT 100"
                className="w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y min-h-[80px] disabled:opacity-50 transition-all"
                spellCheck={false}
              />
            )}
            <button
              onClick={handleRunSQL}
              disabled={running || saving || !sql.trim() || noConnection}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 border border-border rounded-lg text-xs font-medium text-foreground disabled:opacity-40 transition-colors"
            >
              {running && lastRanVia === 'sql'
                ? <><span className="w-3 h-3 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />Running…</>
                : <><Play className="w-3 h-3 text-primary" />Run SQL directly</>}
            </button>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-xl px-3 py-2">{error}</p>
          )}

          {/* Preview */}
          {preview && (
            <div className="bg-success/5 border border-success/20 rounded-xl p-3">
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-success" />
                {preview.fullRows.length} rows returned
                {preview.llm_suggested_hint && normalizeWidgetType(preview.llm_suggested_hint) !== widget.widget_type && (
                  <span className="ml-2 text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                    💡 AI suggests: {normalizeWidgetType(preview.llm_suggested_hint).replace(/_/g, ' ')}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-success font-medium">
                  Ready to apply
                </span>
              </p>
              <div className="overflow-x-auto">
                <table className="text-xs w-full">
                  <thead>
                    <tr>
                      {preview.columns.map(c => (
                        <th key={c} className="px-2 py-1 text-left text-muted-foreground whitespace-nowrap font-medium">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 3).map((row, i) => (
                      <tr key={i} className="border-t border-border/40">
                        {preview.columns.map(c => (
                          <td key={c} className="px-2 py-1 text-foreground truncate max-w-[120px]">
                            {String(row[c] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Visualization Settings ──────────────────────────── */}
          <div className="border-t border-border pt-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <label className="text-xs font-semibold text-foreground">Visualization Settings</label>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Reshapes the returned rows client-side — no need to re-run the query.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Visualization Type</label>
                <select
                  value={vizType}
                  onChange={e => setVizType(e.target.value)}
                  className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                >
                  {WIDGET_TEMPLATES.filter(t => t.type !== 'text' && t.type !== 'image').map(t => (
                    <option key={t.type} value={t.type}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Aggregation</label>
                <select
                  value={aggregation}
                  onChange={e => setAggregation(e.target.value as AggregationFn | '')}
                  className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                >
                  <option value="">(none)</option>
                  {AGGREGATION_OPTIONS.map(opt => (
                    <option
                      key={opt.value}
                      value={opt.value}
                      disabled={!yAxisIsNumeric && NUMERIC_ONLY_AGGREGATIONS.includes(opt.value)}
                    >
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">X-Axis</label>
                <select
                  value={xAxis}
                  onChange={e => setXAxis(e.target.value)}
                  className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                >
                  <option value="">Select column…</option>
                  {availableColumns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Y-Axis (Measure) {yAxis && !yAxisIsNumeric && <span className="text-warning">— not numeric</span>}
                </label>
                <select
                  value={yAxis}
                  onChange={e => setYAxis(e.target.value)}
                  className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                >
                  <option value="">Select column…</option>
                  {availableColumns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Group By</label>
                <select
                  value={groupBy}
                  onChange={e => setGroupBy(e.target.value)}
                  className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                >
                  <option value="">(use X-Axis)</option>
                  {availableColumns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">Sort By</label>
                <div className="flex gap-1.5">
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value)}
                    className="flex-1 px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                  >
                    <option value="">(none)</option>
                    {availableColumns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                    disabled={!sortBy}
                    title="Toggle sort direction"
                    className="px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground disabled:opacity-40 hover:bg-muted transition-colors"
                  >
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </button>
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showLegendSetting}
                onChange={e => setShowLegendSetting(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-border accent-primary"
              />
              <span className="text-xs text-foreground">Show legend</span>
            </label>

            {vizError && (
              <p className="mt-3 text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-xl px-3 py-2">{vizError}</p>
            )}

            <button
              onClick={handleSaveVisualization}
              disabled={vizSaving}
              className="mt-3 px-4 py-2 bg-muted hover:bg-muted/80 border border-border rounded-xl text-xs font-semibold text-foreground disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {vizSaving
                ? <><span className="w-3 h-3 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />Saving…</>
                : vizSaved ? <><Check className="w-3.5 h-3.5 text-success" />Saved</> : 'Save Visualization Settings'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border text-muted-foreground rounded-xl text-sm hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!preview || saving}
            className="flex-1 py-2 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            {saving
              ? <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Saving…</>
              : 'Apply & Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Free Text / Image content editor ────────────────────────────
// Text and Image cards are static content, not queries — they get a
// dedicated, much simpler editor instead of EditQueryDialog's prompt/SQL flow.
function TextImageEditDialog({ widget, dashId, pageId, onUpdate, onClose }: {
  widget: WidgetData;
  dashId: string;
  pageId: string;
  onUpdate: (patch: Partial<WidgetData>) => void;
  onClose: () => void;
}) {
  const isText = widget.widget_type === 'text';
  const [textContent, setTextContent] = useState(widget.text_content || '');
  const [imageUrl, setImageUrl] = useState(widget.image_url || '');
  const [imageCaption, setImageCaption] = useState(widget.image_caption || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const inputCls = 'w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all';

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const patch: Partial<WidgetData> = isText
        ? { text_content: textContent }
        : { image_url: imageUrl, image_caption: imageCaption };
      await dashboardApi.updateWidget(dashId, pageId, widget.id, { ...widget, ...patch });
      onUpdate(patch);
      onClose();
    } catch (e: any) {
      setError('Failed to save: ' + (e?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
        style={{ boxShadow: 'var(--shadow-elevated)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{isText ? 'Edit Text Card' : 'Edit Image Card'}</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{widget.title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isText ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-foreground">Content</label>
                <span className="text-[10px] text-muted-foreground">Markdown supported</span>
              </div>
              <textarea
                value={textContent}
                onChange={e => setTextContent(e.target.value)}
                placeholder="Write a note, annotation, or context for this dashboard…"
                rows={10}
                className={`${inputCls} resize-none font-mono text-xs`}
                autoFocus
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">Image URL</label>
                <input
                  value={imageUrl}
                  onChange={e => setImageUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className={inputCls}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">Caption (optional)</label>
                <input
                  value={imageCaption}
                  onChange={e => setImageCaption(e.target.value)}
                  placeholder="e.g., Q3 brand campaign"
                  className={inputCls}
                />
              </div>
              {imageUrl.trim() && (
                <div className="rounded-xl border border-border overflow-hidden bg-muted/30 p-3">
                  <ImageCard imageUrl={imageUrl} caption={imageCaption} compact={false} />
                </div>
              )}
            </>
          )}

          {error && (
            <p className="text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-xl px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-border text-muted-foreground rounded-xl text-sm hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (isText ? !textContent.trim() : !imageUrl.trim())}
            className="flex-1 py-2 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            {saving
              ? <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Saving…</>
              : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sortable page tab ───────────────────────────────────────────
// A single dashboard page tab that can be dragged to reorder (dnd-kit
// sortable), clicked to switch, double-clicked to rename, exported as a PNG,
// or deleted. Dragging is enabled only in edit mode.
function SortablePageTab({
  page, active, isEditing, canDelete, renaming, draftName, confirmDelete, exporting,
  canShare, sharedByName,
  onSwitch, onStartRename, onDraftChange, onCommitRename, onCancelRename,
  onRequestDelete, onConfirmDelete, onCancelDelete, onExportPng,
  onShare, onMove, onCopy, onDuplicate,
}: {
  page: { id: string; name: string };
  active: boolean;
  isEditing: boolean;
  canDelete: boolean;
  renaming: boolean;
  draftName: string;
  confirmDelete: boolean;
  exporting: boolean;
  /** Page/card-level sharing is owner-only, mirrored from the parent's isOwner flag. */
  canShare?: boolean;
  /** Set when this page is visible to the current user ONLY via a page-level share (not dashboard-level). */
  sharedByName?: string | null;
  onSwitch: () => void;
  onStartRename: () => void;
  onDraftChange: (v: string) => void;
  onCommitRename: (v: string) => void;
  onCancelRename: () => void;
  onRequestDelete: (e: React.MouseEvent) => void;
  onConfirmDelete: (e: React.MouseEvent) => void;
  onCancelDelete: (e: React.MouseEvent) => void;
  onExportPng: () => void;
  onShare?: () => void;
  onMove?: () => void;
  onCopy?: () => void;
  onDuplicate?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
    disabled: !isEditing || renaming,
  });
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!actionsOpen) return;
    function close(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setActionsOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [actionsOpen]);
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group/tab flex items-center">
      {renaming ? (
        <div className="flex items-center px-3 py-2.5 border-b-2 border-primary">
          <input
            value={draftName}
            onChange={e => onDraftChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onCommitRename(draftName);
              if (e.key === 'Escape') onCancelRename();
            }}
            onBlur={() => onCommitRename(draftName)}
            autoFocus
            className="text-xs font-medium bg-transparent text-foreground outline-none w-28"
          />
        </div>
      ) : (
        <div
          {...(isEditing ? { ...attributes, ...listeners } : {})}
          className={`flex items-center border-b-2 transition-colors ${
            isEditing ? 'cursor-grab active:cursor-grabbing' : ''
          } ${active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          {isEditing && (
            <div className="pl-2 pr-1 opacity-40 hover:opacity-100 flex items-center justify-center shrink-0">
              <GripVertical className="w-3.5 h-3.5" />
            </div>
          )}
          <button
            onClick={onSwitch}
            onDoubleClick={() => { if (isEditing) onStartRename(); }}
            title={isEditing ? 'Drag to reorder · double-click to rename' : page.name}
            className={`py-2.5 text-xs font-medium whitespace-nowrap ${isEditing ? 'pr-2 pl-1' : 'px-3.5'}`}
          >
            {page.name}
            {sharedByName && (
              <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">Shared by {sharedByName}</span>
            )}
          </button>
          {isEditing && (
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={onStartRename}
              className="opacity-0 group-hover/tab:opacity-100 mr-2 w-4 h-4 rounded text-muted-foreground hover:text-primary hover:bg-muted flex items-center justify-center transition-all"
              title="Rename page"
            >
              <Edit3 className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Share / Move / Copy / Duplicate */}
      {!renaming && (onShare || onMove || onCopy || onDuplicate) && (
        <div ref={actionsRef} className="relative">
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={() => setActionsOpen(v => !v)}
            title="Page actions"
            className="opacity-0 group-hover/tab:opacity-100 ml-0.5 w-5 h-5 rounded text-muted-foreground hover:text-primary hover:bg-muted flex items-center justify-center transition-all"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
          {actionsOpen && (
            <div className="absolute top-full mt-1 left-0 w-44 bg-card border border-border rounded-xl shadow-xl z-40 py-1" onPointerDown={e => e.stopPropagation()}>
              {canShare && onShare && (
                <button onClick={() => { setActionsOpen(false); onShare(); }}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors">
                  <Share2 className="w-3.5 h-3.5 text-muted-foreground" /> Share page
                </button>
              )}
              {onDuplicate && (
                <button onClick={() => { setActionsOpen(false); onDuplicate(); }}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors">
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" /> Duplicate page
                </button>
              )}
              {onCopy && (
                <button onClick={() => { setActionsOpen(false); onCopy(); }}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors">
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" /> Copy to dashboard…
                </button>
              )}
              {onMove && (
                <button onClick={() => { setActionsOpen(false); onMove(); }}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors">
                  <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground" /> Move to dashboard…
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Per-page PNG export */}
      {!renaming && (
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={onExportPng}
          disabled={exporting}
          title="Export this page as PNG"
          className="opacity-0 group-hover/tab:opacity-100 ml-0.5 w-5 h-5 rounded text-muted-foreground hover:text-primary hover:bg-muted flex items-center justify-center transition-all disabled:opacity-40"
        >
          <ImageDown className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Delete */}
      {isEditing && canDelete && !renaming && (
        confirmDelete ? (
          <div className="flex items-center gap-1 px-1.5 py-1">
            <span className="text-[10px] text-destructive font-medium">Delete?</span>
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={onConfirmDelete}
              className="w-4 h-4 rounded bg-destructive text-white flex items-center justify-center hover:opacity-90 transition-opacity"
              title="Confirm delete"
            >
              <Check className="w-2.5 h-2.5" />
            </button>
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={onCancelDelete}
              className="w-4 h-4 rounded bg-muted border border-border text-muted-foreground flex items-center justify-center hover:text-foreground transition-colors"
              title="Cancel"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        ) : (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={onRequestDelete}
            className="opacity-0 group-hover/tab:opacity-100 ml-0.5 w-4 h-4 rounded-full bg-muted border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 flex items-center justify-center transition-all"
            title="Delete page"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        )
      )}
    </div>
  );
}

// ── Export-to-PDF page selection modal ──────────────────────────
function ExportPdfModal({
  pages, dashName, exporting, onExport, onClose,
}: {
  pages: { id: string; name: string }[];
  dashName: string;
  exporting: boolean;
  onExport: (orderedSelectedIds: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(pages.map(p => String(p.id))),
  );
  const allSelected = selected.size === pages.length && pages.length > 0;

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(pages.map(p => String(p.id))));

  const handleExport = () => {
    // Preserve current dashboard order, include only selected pages.
    const ordered = pages.filter(p => selected.has(String(p.id))).map(p => String(p.id));
    if (ordered.length) onExport(ordered);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={exporting ? undefined : onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()} style={{ boxShadow: 'var(--shadow-elevated)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Export dashboard as PDF</h2>
              <p className="text-xs text-muted-foreground">{dashName}.pdf</p>
            </div>
          </div>
          {!exporting && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"><X className="w-4 h-4" /></button>
          )}
        </div>

        <div className="px-5 py-3 border-b border-border shrink-0 flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={exporting} className="accent-primary w-3.5 h-3.5" />
            Select all
          </label>
          <span className="text-[11px] text-muted-foreground">{selected.size} of {pages.length} selected</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {pages.map((p, i) => {
            const id = String(p.id);
            const checked = selected.has(id);
            return (
              <label
                key={id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${checked ? 'bg-primary/5' : 'hover:bg-muted/50'}`}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(id)} disabled={exporting} className="accent-primary w-4 h-4 shrink-0" />
                <span className="w-5 h-5 rounded-md bg-muted text-[10px] text-muted-foreground flex items-center justify-center shrink-0">{i + 1}</span>
                <span className="text-sm text-foreground truncate flex-1">{p.name}</span>
              </label>
            );
          })}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} disabled={exporting} className="px-4 py-2 border border-border text-muted-foreground rounded-xl text-sm hover:bg-muted transition-colors disabled:opacity-40">Cancel</button>
          <button
            onClick={handleExport}
            disabled={exporting || selected.size === 0}
            className="flex-1 py-2 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            {exporting
              ? <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Generating PDF…</>
              : <><FileText className="w-3.5 h-3.5" />Export {selected.size} page{selected.size !== 1 ? 's' : ''}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Move / Copy target picker ───────────────────────────────────
// Shared by both pages and cards — pages only need a destination dashboard
// (they land as a new page there); cards additionally need a destination
// page within that dashboard.
function MoveCopyDialog({
  kind, mode, onClose, onConfirm,
}: {
  kind: 'page' | 'widget';
  mode: 'move' | 'copy';
  onClose: () => void;
  onConfirm: (targetDashboardId: string, targetPageId?: string) => Promise<void>;
}) {
  const [dashboards, setDashboards] = useState<any[]>([]);
  const [loadingDash, setLoadingDash] = useState(true);
  const [selectedDash, setSelectedDash] = useState('');
  const [pages, setPages] = useState<any[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [selectedPage, setSelectedPage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dashboardApi.list({ editableOnly: true })
      .then(r => setDashboards(r.dashboards || []))
      .catch(() => setError('Could not load your dashboards'))
      .finally(() => setLoadingDash(false));
  }, []);

  useEffect(() => {
    if (kind !== 'widget' || !selectedDash) { setPages([]); setSelectedPage(''); return; }
    setLoadingPages(true);
    dashboardApi.get(selectedDash)
      .then(r => { setPages(r.pages || []); setSelectedPage(String(r.pages?.[0]?.id || '')); })
      .catch(() => setError('Could not load pages for that dashboard'))
      .finally(() => setLoadingPages(false));
  }, [selectedDash, kind]);

  async function handleConfirm() {
    if (!selectedDash || (kind === 'widget' && !selectedPage)) return;
    setSubmitting(true);
    setError('');
    try {
      await onConfirm(selectedDash, kind === 'widget' ? selectedPage : undefined);
      onClose();
    } catch (e: any) {
      setError(e?.message || `Failed to ${mode} ${kind}`);
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card w-full max-w-sm rounded-2xl shadow-2xl border border-border overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold capitalize">{mode} {kind === 'widget' ? 'card' : kind}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
              Destination dashboard
            </label>
            {loadingDash ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <select
                value={selectedDash}
                onChange={e => setSelectedDash(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Select a dashboard…</option>
                {dashboards.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>

          {kind === 'widget' && selectedDash && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                Destination page
              </label>
              {loadingPages ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <select
                  value={selectedPage}
                  onChange={e => setSelectedPage(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  {pages.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive font-medium">{error}</p>}

          <button
            onClick={handleConfirm}
            disabled={submitting || !selectedDash || (kind === 'widget' && !selectedPage)}
            className="w-full px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting
              ? (mode === 'move' ? 'Moving…' : 'Copying…')
              : `${mode === 'move' ? 'Move' : 'Copy'} ${kind === 'widget' ? 'card' : kind}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DashboardBuilder({
  dashId, backUrl, backLabel, titleOverride, subtitleOverride, hideContextNav, isNew,
}: {
  dashId: string; backUrl?: string; backLabel?: string;
  titleOverride?: string; subtitleOverride?: string;
  // When true, hides the in-header back link + Chat/Dashboard buttons because
  // the surrounding layout already provides that navigation (single data source).
  hideContextNav?: boolean;
  // When true (newly created datasource dashboard), auto-reload after a short
  // delay to replace placeholder cards with AI-generated insight cards seeded
  // in the background.
  isNew?: boolean;
}) {
  const currentUser = useAuthStore(s => s.user);
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null);
  const [pages, setPages] = useState<Record<string, unknown>[]>([]);
  const [activePage, setActivePage] = useState<string | null>(null);
  const [widgets, setWidgets] = useState<WidgetData[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Caller's access level on this dashboard, returned by the backend
  // (getDashboard). Drives read-only mode and the Publish action — the backend
  // enforces the same rules, so the UI just mirrors them. Defensive default:
  // only an explicit `false` locks editing, so owners are never accidentally
  // locked out if the field is ever absent.
  const canEdit = (dashboard as any)?.can_edit !== false;
  const canPublish = Boolean((dashboard as any)?.can_publish);
  // isPublished: use `status` field from backend (status enum: 'draft' | 'published' | 'archived')
  const isPublished = (dashboard as any)?.status === 'published';
  const canShare = Boolean(dashboard && (dashboard.created_by === currentUser?.id || currentUser?.role === 'ADMIN'));
  // Page/card-level sharing is owner-only on the backend (no admin bypass —
  // matches DashboardPermissionsService.requireOwner), so gate those finer
  // share affordances strictly by ownership to avoid showing a button that 403s.
  const isOwner = Boolean(dashboard && dashboard.created_by === currentUser?.id);

  // Force read-only users out of edit mode if a load ever flips the flag.
  useEffect(() => {
    if (dashboard && (dashboard as any).can_edit === false) setIsEditing(false);
  }, [dashboard]);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Monotonic page-number reservation so rapid +Page clicks never collide.
  const pageSeqRef = useRef(0);
  const [deletedWidgetIds, setDeletedWidgetIds] = useState<string[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | undefined>();
  const [focusedWidget, setFocusedWidget] = useState<WidgetData | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [pageShareTarget, setPageShareTarget] = useState<{ id: string; name: string } | null>(null);
  const [widgetShareTarget, setWidgetShareTarget] = useState<{ id: string; title: string } | null>(null);
  const [moveCopyTarget, setMoveCopyTarget] = useState<
    | { kind: 'page'; id: string; mode: 'move' | 'copy' }
    | { kind: 'widget'; id: string; pageId: string; mode: 'move' | 'copy' }
    | null
  >(null);

  async function handleMoveCopyConfirm(targetDashboardId: string, targetPageId?: string) {
    if (!moveCopyTarget) return;
    if (moveCopyTarget.kind === 'page') {
      if (moveCopyTarget.mode === 'move') {
        await dashboardApi.movePage(dashId, moveCopyTarget.id, targetDashboardId);
      } else {
        await dashboardApi.copyPageTo(dashId, moveCopyTarget.id, targetDashboardId);
      }
    } else {
      if (!targetPageId) throw new Error('Select a destination page');
      if (moveCopyTarget.mode === 'move') {
        await dashboardApi.moveWidget(dashId, moveCopyTarget.pageId, moveCopyTarget.id, targetPageId);
      } else {
        await dashboardApi.copyWidget(dashId, moveCopyTarget.pageId, moveCopyTarget.id, targetPageId);
      }
    }
    await loadData();
  }

  let chatUrl = '';
  if (dashboard?.combo_id) {
    chatUrl = `/combos/${dashboard.combo_id}/chat`;
  } else if (dashboard?.connection_id) {
    chatUrl = `/connections/${dashboard.connection_id}/chat`;
  }
  if (chatUrl && activeChatId) {
    chatUrl += `?chatId=${activeChatId}`;
  }

  const [inspectWidgetId, setInspectWidgetId] = useState<string | null>(null);
  const [editQueryWidgetId, setEditQueryWidgetId] = useState<string | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  
  const isGeneral = dashboard?.context_type === 'org_overview' || (!dashboard?.connection_id && !dashboard?.combo_id);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [defaultPosition, setDefaultPosition] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [defaultHint, setDefaultHint] = useState('');
  const [refreshingAll, setRefreshingAll] = useState(false);

  // Export state — a single in-flight flag prevents duplicate export requests.
  const [exporting, setExporting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportNote, setExportNote] = useState<{ kind: 'success' | 'error' | 'info'; msg: string } | null>(null);
  const [pageNote, setPageNote] = useState<{ kind: 'success' | 'error' | 'info'; msg: string } | null>(null);

  // Global left-nav sidebar control — collapse it while editing to give the canvas room.
  const { setSidebarCollapsed } = useUIStore();

  // Page rename state
  const [renamingPage, setRenamingPage] = useState<string | null>(null);
  const [pageNameDraft, setPageNameDraft] = useState('');
  const [confirmDeletePageId, setConfirmDeletePageId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  // Live refs so async export/reorder routines read current pages/active page
  // across awaits (state closures would be stale).
  const pagesRef = useRef(pages);
  const activePageRef = useRef(activePage);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => { activePageRef.current = activePage; }, [activePage]);

  // Auto-dismiss export notifications.
  useEffect(() => {
    if (!exportNote) return;
    const t = setTimeout(() => setExportNote(null), 4000);
    return () => clearTimeout(t);
  }, [exportNote]);

  // Auto-dismiss page notifications.
  useEffect(() => {
    if (!pageNote) return;
    const t = setTimeout(() => setPageNote(null), 4000);
    return () => clearTimeout(t);
  }, [pageNote]);

  // Sensors for the page-tab reorder drag (separate from the widget DndContext).
  const pageSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Auto-collapse the global sidebar in edit mode; restore it when leaving.
  // Also clear any widget selection when leaving edit mode.
  useEffect(() => {
    setSidebarCollapsed(isEditing);
    if (!isEditing) setSelectedWidgetId(null);
  }, [isEditing, setSidebarCollapsed]);

  // Make sure the sidebar is restored if the builder unmounts while editing.
  useEffect(() => {
    return () => setSidebarCollapsed(false);
  }, [setSidebarCollapsed]);

  const [activeDragItem, setActiveDragItem] = useState<{ type: string; data: any } | null>(null);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data) {
      setActiveDragItem({ type: data.type, data: data[data.type] });
    }
  }, []);

  useEffect(() => {
    const measure = () => { if (containerRef.current) setContainerWidth(containerRef.current.offsetWidth); };
    measure();

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Tracks whether we have already injected the synthetic skeleton placeholders
  // so we never inject them twice (important because loadData is called from
  // the polling effect too).
  // Standard 2x2 grid positions matching the backend DEFAULT layout
  const SKELETON_SLOTS = [
    { x: 0, y: 0, type: 'line_chart',  title: 'Generating insight…' },
    { x: 6, y: 0, type: 'bar_chart',   title: 'Generating insight…' },
    { x: 0, y: 4, type: 'bar_chart',   title: 'Generating insight…' },
    { x: 6, y: 4, type: 'metric_card', title: 'Generating insight…' },
  ] as const;

  // Merges real widgets with synthetic skeletons for any missing slots
  // in the default 2x2 layout, ensuring the grid stays stable while seeding.
  const mergeSkeletons = useCallback((realWidgets: WidgetData[]) => {
    const merged = [...realWidgets];
    SKELETON_SLOTS.forEach((s, i) => {
      const hasReal = realWidgets.some(w => w.position_x === s.x && w.position_y === s.y);
      if (!hasReal) {
        merged.push({
          id: `__skeleton_${i}`,
          title: s.title,
          widget_type: s.type,
          ui_hint: s.type,
          query_prompt: '',
          position_x: s.x,
          position_y: s.y,
          width: 6,
          height: 4,
          isLoading: true,
        });
      }
    });
    return merged;
  }, []);

  const loadData = useCallback(async () => {
    try {
      const data = await dashboardApi.get(dashId);
      setDashboard(data.dashboard);
      setPages(data.pages || []);
      dashboardApi.listVersions(dashId).then(res => setVersions(res.versions || [])).catch(console.error);
      const first = data.pages?.[0];
      if (first) {
        setActivePage(first.id);
        const builtWidgets = buildWidgets(first);
        
        // When this is a newly created data-source dashboard AND the backend
        // hasn't finished seeding real widgets yet, ensure all 4 slots are
        // filled (using skeletons for any missing ones) so the layout feels
        // complete from the very first render. As real widgets arrive, they
        // naturally replace the skeleton in their assigned slot.
        if (isNew) {
          setWidgets(mergeSkeletons(builtWidgets));
        } else {
          // Standard refresh for empty widgets on existing dashboards
          const emptyWidgets = builtWidgets.filter(w => !w.result_rows?.length);
          if (emptyWidgets.length > 0) {
            refreshWidgets(String(first.id), emptyWidgets);
          }
        }
      }
      if (data.dashboard?.connection_id) {
        const { chats } = await chatApi.list({ connectionId: data.dashboard.connection_id as string });
        if (chats.length > 0) setActiveChatId(chats[0].id);
      } else if (data.dashboard?.combo_id) {
        const { chats } = await chatApi.list({ comboId: data.dashboard.combo_id as string });
        if (chats.length > 0) setActiveChatId(chats[0].id);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-reload for new datasource dashboards: AI card seeding runs in the
  // background and takes ~15-30s. Poll every 5 seconds until real widgets
  // arrive (skeletons are replaced automatically), then stop polling.
  const [seedingBanner, setSeedingBanner] = useState(!!isNew);
  const seedingDoneRef = useRef(!isNew);
  useEffect(() => {
    if (!isNew) return;
    let cancelled = false;

    async function poll() {
      if (cancelled || seedingDoneRef.current) return;
      try {
        const data = await dashboardApi.get(dashId);
        const first = data.pages?.[0];
        const widgets = ((first?.widgets as any[]) || []);
        const realCount = widgets.length;

        if (!cancelled) {
          setPages(data.pages || []);
          if (first) {
            const builtWidgets = buildWidgets(first);
            setWidgets(mergeSkeletons(builtWidgets));
          }

          // Stop polling if we have all 4 widgets (even if some are static fallbacks)
          if (realCount >= 4) {
            seedingDoneRef.current = true;
            setSeedingBanner(false);
          } else {
            // Not ready yet, schedule next poll
            setTimeout(poll, 5000);
          }
        }
      } catch {
        if (!cancelled) setTimeout(poll, 8000); // back-off on error
      }
    }

    // Start first poll after 8s (give backend time to start seeding)
    const t = setTimeout(poll, 8000);
    // Hard stop the banner after 60s regardless
    const tStop = setTimeout(() => { setSeedingBanner(false); }, 60000);
    return () => { cancelled = true; clearTimeout(t); clearTimeout(tStop); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  async function refreshWidgets(
    pageId: string,
    widgetList: WidgetData[],
    forceRefresh = false,
  ) {
    widgetList = widgetList.filter(widgetHasQuery);
    if (!widgetList.length) return;

    const emptyIds = new Set(widgetList.map(w => w.id));
    setWidgets(prev => prev.map(w => emptyIds.has(w.id) ? { ...w, isLoading: true } : w));

    const CONCURRENCY = 4;
    let i = 0;

    async function runNext() {
      while (i < widgetList.length) {
        const widget = widgetList[i++];
        let succeeded = false;
        for (let attempt = 0; attempt < 2 && !succeeded; attempt++) {
          try {
            const result = await dashboardApi.executeWidget(dashId, pageId, widget.id, attempt > 0 || forceRefresh);
            if (result.rows?.length > 0 && result.columns) {
              setWidgets(prev => prev.map(w =>
                w.id === widget.id
                  ? { ...w, result_rows: result.rows, result_columns: result.columns, isLoading: false }
                  : w
              ));
              succeeded = true;
            } else if (attempt === 1) {
              setWidgets(prev => prev.map(w => w.id === widget.id ? { ...w, isLoading: false } : w));
              succeeded = true;
            }
          } catch {
            if (attempt === 1) {
              setWidgets(prev => prev.map(w => w.id === widget.id ? { ...w, isLoading: false } : w));
              succeeded = true;
            }
          }
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, runNext));
  }

  async function refreshAllWidgets(
    pageId: string,
    widgetList: WidgetData[],
    forceRefresh = false,
  ) {
    widgetList = widgetList.filter(widgetHasQuery);
    if (!widgetList.length) { setRefreshingAll(false); return; }
    setRefreshingAll(true);

    const execIds = new Set(widgetList.map(w => w.id));
    setWidgets(prev => prev.map(w => execIds.has(w.id) ? { ...w, isLoading: true } : w));

    const CONCURRENCY = 4;
    let i = 0;

    async function runNext() {
      while (i < widgetList.length) {
        const widget = widgetList[i++];
        let succeeded = false;
        for (let attempt = 0; attempt < 2 && !succeeded; attempt++) {
          try {
            const result = await dashboardApi.executeWidget(dashId, pageId, widget.id, attempt > 0 || forceRefresh);
            if (result.rows?.length > 0 && result.columns) {
              setWidgets(prev => prev.map(w =>
                w.id === widget.id
                  ? { ...w, result_rows: result.rows, result_columns: result.columns, isLoading: false }
                  : w
              ));
              succeeded = true;
            } else if (attempt === 1) {
              setWidgets(prev => prev.map(w => w.id === widget.id ? { ...w, isLoading: false } : w));
              succeeded = true;
            }
          } catch {
            if (attempt === 1) {
              setWidgets(prev => prev.map(w => w.id === widget.id ? { ...w, isLoading: false } : w));
              succeeded = true;
            }
          }
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, runNext));
    setRefreshingAll(false);
  }

  function buildWidgets(page: Record<string, unknown>): WidgetData[] {
    const widgetList = ((page?.widgets as Record<string, unknown>[]) || []).map(w => {
      const qd = w.query_definition as Record<string, unknown> || {};
      let cardRows: Record<string, unknown>[] = [];
      let cardCols: string[] = [];
      if (w.card_id) {
        if (w.card_result_preview) {
          try { cardRows = JSON.parse(w.card_result_preview as string); } catch { cardRows = []; }
        }
        if (Array.isArray(w.card_result_columns)) cardCols = w.card_result_columns as string[];
      }
      const resultRows = (qd.result_rows as Record<string, unknown>[] | undefined)?.length
        ? qd.result_rows as Record<string, unknown>[]
        : cardRows;
      const resultCols = (qd.result_columns as string[] | undefined)?.length
        ? qd.result_columns as string[]
        : cardCols;
      return {
        id: String(w.id), title: String(w.title || ''),
        widget_type: normalizeWidgetType(String(qd.ui_hint || w.card_chart_type || w.widget_type || 'table')),
        query_prompt: String(qd.prompt || w.query_prompt || ''),
        position_x: Number(w.grid_x ?? w.position_x) || 0,
        position_y: Number(w.grid_y ?? w.position_y) || 0,
        width: Number(w.grid_w ?? w.width) || 6,
        height: Number(w.grid_h ?? w.height) || 4,
        result_rows: resultRows,
        result_columns: resultCols,
        ui_hint: normalizeWidgetType(String(qd.ui_hint || w.card_chart_type || w.ui_hint || w.widget_type || 'table')),
        sql: String(qd.sql || w.card_raw_query || ''),
        query_definition: qd,
        text_content: qd.text_content as string | undefined,
        image_url: qd.image_url as string | undefined,
        image_caption: qd.image_caption as string | undefined,
        visualization_config: (typeof w.visualization_config === 'string'
          ? JSON.parse(w.visualization_config)
          : (w.visualization_config as VisualizationConfig | undefined)) || undefined,
      };
    });
    setWidgets(widgetList);
    return widgetList;
  }

  function switchPage(id: string) {
    setActivePage(id);
    setSelectedWidgetId(null);
    setDeletedWidgetIds([]);
    const p = pages.find(p => p.id === id);
    if (p) {
      const builtWidgets = buildWidgets(p as Record<string, unknown>);
      {
        const emptyWidgets = builtWidgets.filter(w => !w.result_rows?.length);
        if (emptyWidgets.length === 0) return;
        if (emptyWidgets.length === builtWidgets.length) {
          refreshAllWidgets(id, builtWidgets);
        } else {
          refreshWidgets(id, emptyWidgets);
        }
      }
    }
  }

  async function addPage() {
    const next = Math.max(highestPageNumber(pages), pageSeqRef.current) + 1;
    pageSeqRef.current = next;
    try {
      const { page } = await dashboardApi.addPage(dashId, `Page ${next}`);
      setPages(ps => [...ps, { ...page, widgets: [] }]);
      setActivePage(page.id); setWidgets([]); setSelectedWidgetId(null);
    } catch (e) { console.error(e); }
  }

  async function deletePage(pageId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (pages.length <= 1) return;
    if (confirmDeletePageId !== pageId) { setConfirmDeletePageId(pageId); return; }
    try {
      await dashboardApi.deletePage?.(dashId, pageId);
      const next = pages.filter(p => p.id !== pageId);
      setPages(next);
      if (activePage === pageId && next.length > 0) switchPage(String(next[0].id));
    } catch (e) { console.error(e); }
    finally { setConfirmDeletePageId(null); }
  }

  async function duplicatePageInPlace(pageId: string) {
    try {
      await dashboardApi.duplicatePage(dashId, pageId);
      await loadData();
    } catch (e) { console.error('duplicatePage failed:', e); }
  }

  async function commitPageRename(pageId: string, rawName: string) {
    const name = (rawName || '').trim();
    const current = pages.find(p => String(p.id) === String(pageId));
    if (!name) {
      setPageNote({ kind: 'error', msg: 'Page name cannot be empty' });
      return;
    }
    if (current && String(current.name).trim() === name) {
      setRenamingPage(null);
      return;
    }
    const dupe = pages.some(p =>
      String(p.id) !== String(pageId) &&
      String(p.name).trim().toLowerCase() === name.toLowerCase(),
    );
    if (dupe) {
      setPageNote({ kind: 'error', msg: `A page named “${name}” already exists` });
      return;
    }

    setPages(prev => prev.map(p => String(p.id) === String(pageId) ? { ...p, name } : p));
    setRenamingPage(null);
    try {
      await dashboardApi.updatePage(dashId, pageId, { name });
    } catch (err: any) {
      setPageNote({ kind: 'error', msg: err?.message || 'Failed to rename page' });
      try {
        const data = await dashboardApi.get(dashId);
        setPages(data.pages || []);
      } catch { /* ignore */ }
    }
  }

  const handlePageReorder = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setPages(prev => {
      const oldIdx = prev.findIndex(p => String(p.id) === String(active.id));
      const newIdx = prev.findIndex(p => String(p.id) === String(over.id));
      if (oldIdx < 0 || newIdx < 0) return prev;
      const next = arrayMove(prev, oldIdx, newIdx);
      dashboardApi
        .reorderPages(dashId, next.map(p => String(p.id)))
        .catch(err => {
          console.error('reorderPages failed:', err);
          setExportNote({ kind: 'error', msg: 'Failed to save page order' });
        });
      return next;
    });
  }, [dashId]);

  async function handleSave() {
    setSaving(true);
    try {
      if (activePage && deletedWidgetIds.length > 0) {
        await Promise.all(deletedWidgetIds.map(id => 
          dashboardApi.deleteWidget?.(dashId, activePage, id).catch(() => {})
        ));
      }
      setDeletedWidgetIds([]);

      await dashboardApi.updateLayout(dashId, widgets.map(w => ({
        widgetId: w.id,
        gridX: w.position_x,
        gridY: w.position_y,
        gridW: w.width,
        gridH: w.height
      })));
      const result = await dashboardApi.saveVersion(dashId, undefined);
      setVersions(vs => [result.version, ...vs]);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  async function handlePublish() {
    if (publishing) return;
    setPublishing(true);
    try {
      // Always flush the current layout before publishing so no unsaved changes
      // are silently dropped. Previously this was guarded by `isEditing` which
      // meant exiting edit mode without saving and then publishing would discard
      // the last layout edits.
      await handleSave();
      // Then publish: promotes draft_layout to live widget positions and sets
      // status = 'published' on the backend (all in one transaction).
      const result = await dashboardApi.publish(dashId);
      // Update local state immediately — no need for a separate GET call
      // since publishDashboard returns the full annotated dashboard object.
      if (result?.dashboard) {
        setDashboard(result.dashboard);
      } else {
        // Fallback: reload if publish didn't return the dashboard
        const data = await dashboardApi.get(dashId);
        setDashboard(data.dashboard);
      }
    } catch (e) { console.error('[dashboard] publish failed:', e); }
    finally { setPublishing(false); }
  }

  async function handleUnpublish() {
    if (publishing) return;
    setPublishing(true);
    try {
      const result = await dashboardApi.unpublish(dashId);
      if (result?.dashboard) {
        setDashboard(result.dashboard);
      } else {
        const data = await dashboardApi.get(dashId);
        setDashboard(data.dashboard);
      }
    } catch (e) { console.error('[dashboard] unpublish failed:', e); }
    finally { setPublishing(false); }
  }

  function handleWidgetAdded(raw: Record<string, unknown>) {
    const qd = raw.query_definition as Record<string, unknown> || {};
    const w: WidgetData = {
      id: String(raw.id), title: String(raw.title || ''),
      widget_type: String(raw.widget_type || 'table'),
      query_prompt: String(qd.prompt || raw.query_prompt || ''),
      position_x: Number(raw.grid_x ?? raw.position_x) || 0,
      position_y: Number(raw.grid_y ?? raw.position_y) || 0,
      width: WIDGET_W,
      height: WIDGET_H,
      result_rows: ((qd.result_rows || raw.result_rows || []) as Record<string, unknown>[]),
      result_columns: (qd.result_columns || raw.result_columns || []) as string[],
      ui_hint: String(qd.ui_hint || raw.ui_hint || raw.widget_type || 'table'),
      sql: String(qd.sql || raw.sql || ''),
    };
    const tempId = (defaultPosition as any)?.tempId;
    if (tempId) {
      setWidgets(ws => ws.map(old => old.id === tempId ? { ...old, ...w, id: w.id, isLoading: false } : old));
      return;
    }

    if (raw.is_dropped) {
      setWidgets(ws => [...ws, w]);
    } else {
      setWidgets(ws => {
        const slot = findNextSlot(ws);
        return [...ws, { ...w, position_x: slot.x, position_y: slot.y }];
      });
    }
  }

  function removeWidget(id: string) {
    setWidgets(ws => ws.filter(w => w.id !== id));
    if (!id.startsWith('temp-') && !id.startsWith('card-')) {
      setDeletedWidgetIds(prev => [...prev, id]);
    }
  }

  async function moveWidgetToPage(widgetId: string, targetPageId: string) {
    if (!activePage) return;
    const widget = widgets.find(w => w.id === widgetId);
    if (!widget) return;
    try {
      const res = await dashboardApi.addWidget(dashId, targetPageId, {
        title: widget.title, widget_type: widget.widget_type,
        queryPrompt: widget.query_prompt, sql: widget.sql,
        resultRows: widget.result_rows || [], resultColumns: widget.result_columns || [],
        uiHint: widget.ui_hint || widget.widget_type,
        gridX: 0, gridY: 0, gridW: widget.width || 6, gridH: widget.height || 4,
        datasourceScopeType: 'connection',
      });
      const newWidget = res.widget;
      
      await dashboardApi.deleteWidget?.(dashId, activePage, widgetId).catch(() => { });
      
      setPages(ps => ps.map(p => {
        if (p.id === targetPageId) {
          const currentWidgets = Array.isArray(p.widgets) ? p.widgets : [];
          return { ...p, widgets: [...currentWidgets, newWidget] };
        }
        return p;
      }));
      
      removeWidget(widgetId);
    } catch (e) { console.error(e); }
  }

  function renameWidget(id: string, title: string) {
    setWidgets(ws => ws.map(w => w.id === id ? { ...w, title } : w));
  }

  async function suggestWidgetTitle(widgetId: string) {
    const widget = widgets.find(w => w.id === widgetId);
    if (!widget) return;
    setWidgets(ws => ws.map(w => w.id === widgetId ? { ...w, isLoading: true } : w));
    try {
      const cols = (widget.result_columns || []).join(', ');
      const hint = widget.ui_hint || widget.widget_type;
      const intent = widget.query_prompt ? `\nBusiness Intent: ${widget.query_prompt}` : '';
      const sqlContext = widget.sql ? `\nSQL Logic: ${widget.sql.slice(0, 400)}` : '';
      
      const prompt = `Visualization Type: ${hint}
Columns: ${cols}${intent}${sqlContext}

Based on the above data context, suggest a highly relevant dashboard card title.`;
      
      const result = await chatApi.suggestTitle(prompt);
      const title = (result.title || '').trim().replace(/^["']|["']$/g, '');
      const cleanTitle = title || widget.title;
      renameWidget(widgetId, cleanTitle);
      if (result.fallback) {
        setPageNote({ kind: 'info', msg: 'AI was busy — applied a suggested title you can edit.' });
      } else {
        setPageNote({ kind: 'success', msg: 'AI title applied' });
      }

      if (activePage) {
        await dashboardApi.updateWidget(dashId, activePage, widgetId, {
          ...widget,
          title: cleanTitle,
        });
      }
    } catch (e: any) {
      console.warn('Suggest title request failed; keeping current title.', e?.message || e);
      setPageNote({ kind: 'info', msg: "Couldn't reach the AI title service — kept the current title." });
    } finally {
      setWidgets(ws => ws.map(w => w.id === widgetId ? { ...w, isLoading: false } : w));
    }
  }

  async function autoExecuteCardWidget(
    widgetId: string,
    sql: string,
    connectionId: string,
    pageId: string,
    widgetTitle: string,
    widgetType: string,
  ) {
    try {
      const { chats } = await chatApi.list({ connectionId });
      let execChatId: string;
      if (chats.length > 0) {
        execChatId = chats[0].id;
      } else {
        const { chat } = await chatApi.create({ connectionId });
        execChatId = chat.id;
      }

      const result = await chatApi.executeDraft(execChatId, '', sql);
      const exec = result.execution ?? result;
      const rows: Record<string, unknown>[] = (exec?.rows || []).slice(0, 100);
      const cols: string[] = exec?.columns || [];

      if (rows.length > 0 || cols.length > 0) {
        await dashboardApi.updateWidget(dashId, pageId, widgetId, {
          title: widgetTitle,
          query_prompt: widgetTitle,
          result_rows: rows,
          result_columns: cols,
          sql,
          ui_hint: widgetType,
          widget_type: widgetType,
        });
        setWidgets(prev => prev.map(w =>
          w.id === widgetId
            ? { ...w, result_rows: rows, result_columns: cols, isLoading: false }
            : w,
        ));
      } else {
        setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, isLoading: false } : w));
      }
    } catch (e) {
      console.error('Card widget auto-execute failed:', e);
      setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, isLoading: false } : w));
    }
  }

  async function handleCardClick(card: any) {
    if (!activePage) return;
    const slot = findNextSlot(widgets);
    try {
      const cardQd = typeof card.query_definition === 'string'
        ? JSON.parse(card.query_definition) : (card.query_definition || {});
      const cardSql = card.raw_query || cardQd.sql || '';
      const widgetType = normalizeWidgetType(card.chart_type);
      const contextType = card.datasource_context_type || 'connection';

      let initRows: Record<string, unknown>[] = [];
      let initCols: string[] = [];
      if (card.last_result_preview) {
        try { initRows = JSON.parse(card.last_result_preview); } catch { initRows = []; }
      }
      if (Array.isArray(card.last_result_columns)) initCols = card.last_result_columns;

      const res = await dashboardApi.addWidget(dashId, activePage, {
        title: card.name,
        widget_type: widgetType,
        cardId: card.id,
        gridX: slot.x, gridY: slot.y, gridW: WIDGET_W, gridH: WIDGET_H,
        datasourceScopeType: contextType,
        datasourceContextId: card.datasource_context_id,
        sql: cardSql,
        queryPrompt: card.name,
        resultRows: initRows,
        resultColumns: initCols,
        uiHint: widgetType,
      });

      const rw = res.widget;
      const newWidgetId = String(rw.id);
      const needsExec = initRows.length === 0 && !!cardSql && contextType === 'connection' && !!card.datasource_context_id;

      setWidgets(prev => [...prev, {
        id: newWidgetId,
        title: String(rw.title || ''),
        widget_type: widgetType,
        query_prompt: card.name,
        position_x: slot.x, position_y: slot.y, width: WIDGET_W, height: WIDGET_H,
        result_rows: initRows,
        result_columns: initCols,
        ui_hint: widgetType,
        sql: cardSql,
        isLoading: needsExec,
      }]);

      if (needsExec) {
        autoExecuteCardWidget(
          newWidgetId, cardSql, card.datasource_context_id,
          activePage, card.name, widgetType,
        );
      }
    } catch (e) { console.error(e); }
  }

  async function addStaticWidget(type: 'text' | 'image', slot: { x: number; y: number }) {
    if (!activePage) return;
    const tempId = 'temp-' + Date.now();
    const template = WIDGET_TEMPLATES.find(t => t.type === type);
    setWidgets(prev => [...prev, {
      id: tempId, title: template?.name || type, widget_type: type,
      query_prompt: '', position_x: slot.x, position_y: slot.y,
      width: WIDGET_W, height: WIDGET_H, isLoading: true,
    }]);
    try {
      const res = await dashboardApi.addWidget(dashId, activePage, {
        title: template?.name || type, widget_type: type,
        gridX: slot.x, gridY: slot.y, gridW: WIDGET_W, gridH: WIDGET_H,
        datasourceScopeType: 'connection',
        sql: '', queryPrompt: '', resultRows: [], resultColumns: [], uiHint: type,
      });
      setWidgets(ws => ws.map(w => w.id === tempId ? { ...w, id: String(res.widget.id), isLoading: false } : w));
    } catch (e) { console.error(e); }
  }

  function handleTemplateClick(type: string) {
    if (!activePage) return;
    const slot = findNextSlot(widgets);
    if (type === 'text' || type === 'image') {
      addStaticWidget(type, slot);
      return;
    }
    setDefaultPosition({ x: slot.x, y: slot.y, w: WIDGET_W, h: WIDGET_H });
    setDefaultHint(type);
    setShowAddWidget(true);
  }

  function handleCellClick(x: number, y: number) {
    if (!activePage || !isEditing) return;
    setDefaultPosition({ x, y, w: WIDGET_W, h: WIDGET_H });
    setDefaultHint('');
    setShowAddWidget(true);
  }

  const dashName = () => safeFilePart(String(dashboard?.name || titleOverride || 'Dashboard'));

  function triggerDownload(filename: string, dataUrl: string) {
    const a = document.createElement('a');
    a.download = filename;
    a.href = dataUrl;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function showPageForCapture(pageId: string): boolean {
    const p = pagesRef.current.find(pp => String(pp.id) === String(pageId));
    if (!p) return false;
    setActivePage(String(pageId));
    buildWidgets(p as Record<string, unknown>);
    return true;
  }

  async function capturePage(pageId: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
    if (String(activePageRef.current) !== String(pageId)) {
      if (!showPageForCapture(pageId)) return null;
      activePageRef.current = String(pageId);
      await new Promise(r => setTimeout(r, 1100));
    } else {
      await new Promise(r => setTimeout(r, 350));
    }

    const el = captureRef.current;
    if (!el) return null;

    const { toPng } = await import('html-to-image');
    const dataUrl = await toPng(el, {
      backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
      pixelRatio: 2,
      width: el.offsetWidth,
      height: el.scrollHeight,
      style: { overflow: 'visible', height: `${el.scrollHeight}px` },
      filter: (node: HTMLElement) =>
        !(node.classList && (
          node.classList.contains('widget-drag-handle') ||
          node.classList.contains('react-resizable-handle')
        )),
    });
    return { dataUrl, width: el.offsetWidth, height: el.scrollHeight };
  }

  async function exportPagePng(pageId: string) {
    if (exporting) return;
    setExporting(true);
    setExportNote(null);
    const orig = activePageRef.current;
    const page = pagesRef.current.find(p => String(p.id) === String(pageId));
    const pageName = safeFilePart(String(page?.name || 'Page'));
    try {
      const cap = await capturePage(pageId);
      if (!cap) throw new Error('This page has no content to export');
      triggerDownload(`${dashName()}_${pageName}.png`, cap.dataUrl);
      setExportNote({ kind: 'success', msg: `Exported “${page?.name || 'page'}” as PNG` });
    } catch (e: any) {
      setExportNote({ kind: 'error', msg: e?.message || 'Failed to export page' });
    } finally {
      if (orig && String(activePageRef.current) !== String(orig)) switchPage(String(orig));
      setExporting(false);
    }
  }

  async function exportDashboardPdf(orderedSelectedIds: string[]) {
    if (exporting) return;
    setExporting(true);
    setExportNote(null);
    const orig = activePageRef.current;
    const ordered = pagesRef.current
      .filter(p => orderedSelectedIds.includes(String(p.id)));
    try {
      if (!ordered.length) throw new Error('No pages selected');
      const { jsPDF } = await import('jspdf');
      let pdf: any = null;
      let added = 0;
      for (const p of ordered) {
        const cap = await capturePage(String(p.id));
        if (!cap) continue;
        const orientation = cap.width >= cap.height ? 'landscape' : 'portrait';
        if (!pdf) {
          pdf = new jsPDF({ orientation, unit: 'px', format: [cap.width, cap.height], compress: true });
        } else {
          pdf.addPage([cap.width, cap.height], orientation);
        }
        pdf.addImage(cap.dataUrl, 'PNG', 0, 0, cap.width, cap.height, undefined, 'FAST');
        added++;
      }
      if (!pdf || added === 0) throw new Error('No page content could be captured');
      pdf.save(`${dashName()}.pdf`);
      setExportNote({ kind: 'success', msg: `Exported ${added} page${added !== 1 ? 's' : ''} to PDF` });
    } catch (e: any) {
      setExportNote({ kind: 'error', msg: e?.message || 'Failed to export PDF' });
    } finally {
      setShowExportModal(false);
      if (orig && String(activePageRef.current) !== String(orig)) switchPage(String(orig));
      setExporting(false);
    }
  }

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragItem(null);
    const { active, over } = event;

    if (!over) return;

    const isZone = over.id === 'dashboard-drop-zone';
    const isWidget = over.data?.current?.type === 'widget-drop';
    const isCell = over.data?.current?.type === 'grid-cell';

    if (isZone || isWidget || isCell) {
      const activeData = active.data?.current;
      if (!activeData || !activePage) return;

      let slot: { x: number; y: number };

      if (isWidget) {
        const overWidget = over.data?.current?.widget as WidgetData;
        const { slotX, slotY, shiftedWidgets } = insertAtSlot(
          widgets,
          overWidget.position_x ?? 0,
          overWidget.position_y ?? 0,
        );
        slot = { x: slotX, y: slotY };
        setWidgets(shiftedWidgets);
      } else if (isCell) {
        slot = { x: Number(over.data?.current?.x) || 0, y: Number(over.data?.current?.y) || 0 };
      } else {
        slot = findNextSlot(widgets);
      }

      if (activeData.type === 'template') {
        const newWidgetId = 'temp-' + Date.now();
        const newWidget: WidgetData = {
          id: newWidgetId, title: activeData.template.name, widget_type: activeData.template.type,
          query_prompt: '', position_x: slot.x, position_y: slot.y,
          width: WIDGET_W, height: WIDGET_H, isLoading: true,
        };

        setWidgets(prev => [
          ...prev.filter(w => w.id !== newWidgetId),
          newWidget,
        ]);

        try {
          const res = await dashboardApi.addWidget(dashId, activePage, {
            title: activeData.template.name, widget_type: activeData.template.type,
            gridX: slot.x, gridY: slot.y, gridW: WIDGET_W, gridH: WIDGET_H,
            datasourceScopeType: 'connection',
            sql: '', queryPrompt: '', resultRows: [], resultColumns: [], uiHint: activeData.template.type,
          });

          setWidgets(ws => ws.map(w => w.id === newWidgetId ? { ...w, id: String(res.widget.id), isLoading: false } : w));
        } catch (e) { console.error(e); }

      } else if (activeData.type === 'card') {
        const card = activeData.card;
        const widgetType = normalizeWidgetType(card.chart_type);
        const cardSql = card.raw_query || (typeof card.query_definition === 'string' ? JSON.parse(card.query_definition).sql : card.query_definition?.sql) || '';
        const contextType = card.datasource_context_type || 'connection';

        const newWidgetId = 'card-' + Date.now();
        const newWidget: WidgetData = {
          id: newWidgetId, title: card.name, widget_type: widgetType,
          query_prompt: card.name, position_x: slot.x, position_y: slot.y, width: WIDGET_W, height: WIDGET_H,
          result_rows: [], result_columns: [], ui_hint: widgetType,
          sql: cardSql, isLoading: true,
        };

        setWidgets(prev => [
          ...prev.filter(w => w.id !== newWidgetId),
          newWidget,
        ]);

        try {
          const res = await dashboardApi.addWidget(dashId, activePage, {
            title: card.name, widget_type: widgetType, cardId: card.id,
            gridX: slot.x, gridY: slot.y, gridW: WIDGET_W, gridH: WIDGET_H,
            datasourceScopeType: contextType, datasourceContextId: card.datasource_context_id || undefined,
            sql: cardSql, queryPrompt: card.name, resultRows: [], resultColumns: [], uiHint: widgetType,
          });

          const needsExec = !!cardSql && contextType === 'connection' && !!card.datasource_context_id;
          setWidgets(ws => ws.map(w => w.id === newWidgetId ? { ...w, id: String(res.widget.id), isLoading: needsExec } : w));
          if (needsExec) {
            autoExecuteCardWidget(String(res.widget.id), cardSql, card.datasource_context_id, activePage, card.name, widgetType);
          }
        } catch (e) { console.error(e); }
      }
    }
  }, [activePage, widgets, dashId]);

  const layout = useMemo(() => widgets.map(w => ({
    i: String(w.id),
    x: w.position_x || 0,
    y: w.position_y || 0,
    w: Math.max(1, w.width || 6),
    h: Math.max(1, w.height || 4),
    minW: 2,
    minH: 2
  })), [widgets]);

  const layouts = useMemo(() => ({
    lg: layout, md: layout, sm: layout, xs: layout, xxs: layout
  }), [layout]);
  const { isOver, setNodeRef } = useDroppable({ id: 'dashboard-drop-zone' });
  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      if (containerRef && 'current' in containerRef && typeof containerRef.current !== 'undefined') {
        (containerRef as any).current = node;
      }
    },
    [setNodeRef],
  );

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <>
    <DndContext
      sensors={dndSensors}
      collisionDetection={gridCollisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDragItem(null)}
    >
      <div className="h-full bg-background text-foreground flex flex-col min-h-0 w-full">
        <style dangerouslySetInnerHTML={{
          __html: `
        .react-grid-placeholder {
          background: hsl(var(--primary)) !important;
          opacity: 0.15 !important;
          border: 2px dashed hsl(var(--primary)) !important;
          border-radius: 0.75rem !important;
          transition: all 0.1s ease;
        }
        .react-grid-item.dropping {
          visibility: visible !important;
          background: hsl(var(--primary)) !important;
          opacity: 0.15 !important;
          border: 2px dashed hsl(var(--primary)) !important;
          border-radius: 0.75rem !important;
          z-index: 1000 !important;
        }
        .react-resizable-handle {
          opacity: 1 !important;
          z-index: 100 !important;
        }
        .react-resizable-handle::after {
          content: '';
          position: absolute;
          background: hsl(var(--primary));
          border-radius: 2px;
        }
        .react-resizable-handle-se {
          bottom: 2px !important;
          right: 2px !important;
          width: 14px !important;
          height: 14px !important;
          background-image: none !important;
          cursor: se-resize !important;
        }
        .react-resizable-handle-se::after {
          right: 2px; bottom: 2px; width: 6px; height: 6px;
          background: transparent;
          border-right: 3px solid hsl(var(--primary));
          border-bottom: 3px solid hsl(var(--primary));
          border-radius: 1px;
        }
        .react-resizable-handle-e {
          right: 0 !important; top: 0 !important; height: 100% !important; width: 10px !important;
          cursor: e-resize !important; background-image: none !important;
        }
        .react-resizable-handle-e::after {
          right: 3px; top: 50%; transform: translateY(-50%); width: 4px; height: 24px;
        }
        .react-resizable-handle-s {
          bottom: 0 !important; left: 0 !important; width: 100% !important; height: 10px !important;
          cursor: s-resize !important; background-image: none !important;
        }
        .react-resizable-handle-s::after {
          bottom: 3px; left: 50%; transform: translateX(-50%); width: 24px; height: 4px;
        }
      `}} />

        <header className="border-b border-border bg-background/95 backdrop-blur-md px-4 py-2.5 flex items-center gap-3 shrink-0" style={{ boxShadow: 'var(--shadow-soft)' }}>
          {!hideContextNav && (backUrl ? (
            <Link href={backUrl} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-xs mr-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
              {backLabel || 'Back'}
            </Link>
          ) : (
            <Link href={`/dashboards`} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
            </Link>
          ))}

          {!hideContextNav && <div className="w-px h-4 bg-border shrink-0" />}

          <LayoutGrid className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground truncate leading-tight">{titleOverride || String(dashboard?.name || '')}</h1>
            {subtitleOverride && <p className="text-[10px] text-muted-foreground">{subtitleOverride}</p>}
          </div>

          {chatUrl && !hideContextNav && dashboard?.origin !== 'manual' && (
            <div className="flex items-center gap-2 ml-4 shrink-0">
              <Link
                href={chatUrl}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Chat</span>
              </Link>
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 text-primary border border-primary/20 shrink-0"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>Dashboard</span>
              </div>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {!isGeneral && canEdit && (
              <button onClick={() => setShowGenerate(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}>
                <Sparkles className="w-3.5 h-3.5" /> Generate
              </button>
            )}

            <button
              onClick={() => {
                if (!activePage) return;
                refreshAllWidgets(activePage, widgets, true);
              }}
              disabled={refreshingAll}
              title="Re-execute all widgets against the live database"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-50 transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingAll ? 'animate-spin' : ''}`} />
              {refreshingAll ? 'Refreshing…' : 'Refresh'}
            </button>

            <button
              onClick={() => setShowExportModal(true)}
              disabled={exporting || pages.length === 0}
              title="Export dashboard as PDF"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-50 transition-all"
            >
              <FileText className={`w-3.5 h-3.5 ${exporting ? 'animate-pulse' : ''}`} />
              {exporting ? 'Exporting…' : 'Export PDF'}
            </button>

            <button onClick={() => setShowVersions(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${showVersions ? 'bg-muted border-border text-foreground' : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}>
              <History className="w-3.5 h-3.5" /> History
            </button>

            {canEdit && (
              <button onClick={() => setIsEditing(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${isEditing ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}>
                <Play className={`w-3.5 h-3.5 ${isEditing ? 'rotate-0' : ''}`} />
                {isEditing ? 'Editing' : 'Edit'}
              </button>
            )}

            {canEdit && (
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 hover:bg-muted border border-border rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 transition-all">
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}

            {canPublish && (
              <>
                {isPublished ? (
                  // ── Published state: badge + recovery button ──────────
                  <>
                    {/* Non-clickable badge showing current status */}
                    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/15 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 cursor-default">
                      <Check className="w-3.5 h-3.5" />
                      Published
                    </span>
                    {/* Revert to Draft — recovery path for premature publishes */}
                    <button
                      onClick={handleUnpublish}
                      disabled={publishing}
                      title="Revert this dashboard back to draft status"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 hover:bg-amber-500/10 border border-border hover:border-amber-500/40 rounded-xl text-xs font-medium text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 disabled:opacity-50 transition-all"
                    >
                      {publishing ? (
                        <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                      )}
                      {publishing ? 'Reverting…' : 'Revert to Draft'}
                    </button>
                  </>
                ) : (
                  // ── Draft state: primary Publish button ───────────────
                  <button
                    onClick={handlePublish}
                    disabled={publishing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-primary hover:opacity-90 text-white disabled:opacity-50 transition-all"
                  >
                    {publishing ? (
                      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                    )}
                    {publishing ? 'Publishing…' : 'Publish'}
                  </button>
                )}
              </>
            )}

            {canShare && (
              <button onClick={() => setShareModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 hover:bg-muted border border-border rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground transition-all">
                <Share2 className="w-3.5 h-3.5" />
                Share
              </button>
            )}
          </div>
        </header>

        {/* AI seeding banner — shown only on newly created datasource dashboards
            while background card generation is in progress (~15-30s). */}
        {seedingBanner && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-gradient-to-r from-amber-500/15 to-orange-500/10 border-b border-amber-500/25 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="flex shrink-0 items-center justify-center w-5 h-5 rounded-full bg-amber-500/20">
                <svg className="w-3 h-3 animate-spin text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              </div>
              <div>
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Generating AI insights…</span>
                <span className="text-xs text-amber-600/80 dark:text-amber-400/80 ml-1.5">Analyzing your data and building 4 meaningful charts. This takes about 15–30 seconds.</span>
              </div>
            </div>
            <button onClick={() => setSeedingBanner(false)} className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 transition-colors shrink-0 p-1 rounded">✕</button>
          </div>
        )}

        <div className="border-b border-border px-4 flex items-center gap-0.5 bg-background shrink-0 overflow-x-auto">
          <DndContext sensors={pageSensors} collisionDetection={closestCenter} onDragEnd={handlePageReorder}>
            <SortableContext items={pages.map(p => String(p.id))} strategy={horizontalListSortingStrategy}>
              {pages.map(page => {
                const id = String(page.id);
                return (
                  <SortablePageTab
                    key={id}
                    page={{ id, name: String(page.name) }}
                    active={activePage === id}
                    isEditing={isEditing}
                    canDelete={pages.length > 1}
                    renaming={renamingPage === id}
                    draftName={pageNameDraft}
                    confirmDelete={confirmDeletePageId === id}
                    exporting={exporting}
                    onSwitch={() => switchPage(id)}
                    onStartRename={() => { setRenamingPage(id); setPageNameDraft(String(page.name)); }}
                    onDraftChange={setPageNameDraft}
                    onCommitRename={(v) => commitPageRename(id, v)}
                    onCancelRename={() => setRenamingPage(null)}
                    onRequestDelete={(e) => deletePage(id, e)}
                    onConfirmDelete={(e) => deletePage(id, e)}
                    onCancelDelete={(e) => { e.stopPropagation(); setConfirmDeletePageId(null); }}
                    onExportPng={() => exportPagePng(id)}
                    canShare={isOwner}
                    sharedByName={(page as any).access_source === 'page_share' ? String((page as any).shared_by_name || '') : null}
                    onShare={() => setPageShareTarget({ id, name: String(page.name) })}
                    onDuplicate={() => duplicatePageInPlace(id)}
                    onCopy={() => setMoveCopyTarget({ kind: 'page', id, mode: 'copy' })}
                    onMove={() => setMoveCopyTarget({ kind: 'page', id, mode: 'move' })}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
          {isEditing && (
            <button onClick={addPage}
              className="flex items-center gap-1 px-3 py-2.5 text-xs text-muted-foreground/60 hover:text-primary transition-colors border-b-2 border-transparent shrink-0">
              <Plus className="w-3.5 h-3.5" /> Page
            </button>
          )}
        </div>

        {isEditing && (
          <div className="bg-primary/8 border-b border-primary/20 px-4 py-2 flex items-center gap-3 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <p className="text-xs text-primary/80 font-medium">Edit mode · Drag to reposition · Resize from corners</p>
            <button onClick={() => {
                const slot = findNextSlot(widgets);
                setDefaultPosition({ x: slot.x, y: slot.y, w: WIDGET_W, h: WIDGET_H });
                setShowAddWidget(true);
              }}
              className="ml-auto flex items-center gap-1.5 px-3 py-1 bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-lg text-xs text-primary font-semibold transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add Widget
            </button>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden min-h-0">
          <div className={`flex-1 overflow-auto bg-muted/10 p-4 transition-colors ${isOver ? 'bg-primary/5' : ''}`} ref={mergedRef}>
            {isOver && isEditing && (
              <div className="mb-4 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5 py-6">
                <div className="flex items-center gap-2 text-primary">
                  <Plus className="h-4 w-4" />
                  <span className="text-sm font-medium">Release to add widget</span>
                </div>
              </div>
            )}
            {widgets.length === 0 ? (
              <div className="relative" style={{ minHeight: 'calc(100vh - 220px)' }}>
              <div className="flex flex-col items-center justify-center h-full gap-5 text-center min-h-[400px]">
                <div className="w-16 h-16 rounded-2xl bg-muted/50 border border-border flex items-center justify-center">
                  <LayoutGrid className="w-7 h-7 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-foreground font-semibold mb-1">Empty page</p>
                  <p className="text-muted-foreground text-sm">
                    {isEditing
                      ? 'Click "Add Widget" or drag widgets from the sidebar'
                      : 'Click "Edit" to start building your dashboard'}
                  </p>
                </div>
                {!isEditing && (
                  <div className="flex gap-2">
                    <button onClick={() => setIsEditing(true)}
                      className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity">
                      Start editing
                    </button>
                    {!isGeneral && (
                      <button onClick={() => setShowGenerate(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                        style={{ background: 'linear-gradient(135deg,#D97A1E,#F5A623)' }}>
                        <Sparkles className="w-4 h-4" /> Generate with AI
                      </button>
                    )}
                  </div>
                )}
              </div>
              {isEditing && activeDragItem && (
                <GridOverlay
                  containerWidth={containerWidth}
                  widgets={widgets}
                  onClickCell={handleCellClick}
                />
              )}
              </div>
            ) : (
              <div ref={captureRef} className="relative">
                <ResponsiveGridLayout
                  className="layout"
                  width={containerWidth}
                  style={{ minHeight: 'calc(100vh - 220px)' }}
                  layouts={layouts}
                  breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                  cols={{ lg: GRID_COLS, md: GRID_COLS, sm: 6, xs: 4, xxs: 2 }}
                  rowHeight={GRID_ROW_H}
                  margin={[GRID_MARGIN, GRID_MARGIN]}
                  containerPadding={[0, 0]}
                  compactType="vertical"
                  preventCollision={false}
                  draggableHandle=".widget-drag-handle"
                  isDraggable={isEditing}
                  isResizable={isEditing}
                  resizeHandles={['s', 'e', 'se']}
                  onLayoutChange={(newLayout: any) => {
                    setWidgets(ws => {
                      let changed = false;
                      const next = ws.map(w => {
                        const item = newLayout.find((l: any) => l.i === String(w.id));
                        if (item) {
                          if (w.position_x !== item.x || w.position_y !== item.y || w.width !== item.w || w.height !== item.h) {
                            changed = true;
                            return { ...w, position_x: item.x, position_y: item.y, width: item.w, height: item.h };
                          }
                        }
                        return w;
                      });
                      return changed ? next : ws;
                    });
                  }}
                >
                  {widgets.map(widget => (
                    <div key={widget.id} className="relative h-full">
                      <DashboardWidgetDroppable widget={widget}>
                        <Widget
                          widget={widget}
                          isEditing={isEditing}
                          isSelected={selectedWidgetId === widget.id}
                          onSelect={() => setSelectedWidgetId(widget.id)}
                          onRemove={() => removeWidget(widget.id)}
                          onInspect={() => setInspectWidgetId(widget.id)}
                          onRename={title => renameWidget(widget.id, title)}
                          onSuggestTitle={() => suggestWidgetTitle(widget.id)}
                          onEditQuery={() => setEditQueryWidgetId(widget.id)}
                          otherPages={pages.filter(p => p.id !== activePage).map(p => ({ id: String(p.id), name: String(p.name) }))}
                          onMoveToPage={targetPageId => moveWidgetToPage(widget.id, targetPageId)}
                          isGeneral={isGeneral}
                          onFocus={() => setFocusedWidget(widget)}
                          canShare={isOwner}
                          onShare={() => setWidgetShareTarget({ id: String(widget.id), title: String(widget.title || 'Card') })}
                          onCopyToDashboard={() => setMoveCopyTarget({ kind: 'widget', id: String(widget.id), pageId: String(activePage || ''), mode: 'copy' })}
                          onMoveToDashboard={() => setMoveCopyTarget({ kind: 'widget', id: String(widget.id), pageId: String(activePage || ''), mode: 'move' })}
                        />
                      </DashboardWidgetDroppable>
                    </div>
                  ))}
                </ResponsiveGridLayout>

                {isEditing && activeDragItem && (
                  <GridOverlay
                    containerWidth={containerWidth}
                    widgets={widgets}
                    onClickCell={handleCellClick}
                  />
                )}
              </div>
            )}
          </div>

          {isEditing && <WidgetSidebar onCardClick={handleCardClick} onTemplateClick={handleTemplateClick} />}

          {showVersions && (
            <div className="w-60 bg-card border-l border-border flex flex-col shrink-0 h-full overflow-hidden">
              <div className="px-4 py-3.5 border-b border-border flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Version History</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">View and restore</p>
                </div>
                <button onClick={() => setShowVersions(false)} className="p-1 rounded-md hover:bg-muted text-muted-foreground transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {versions.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground text-center mt-6">No versions saved yet</p>
                ) : versions.map(v => (
                  <div key={v.id} className="p-3 bg-muted/30 border border-border rounded-xl">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-semibold text-foreground">v{v.version_number}</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(v.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">{v.commit_message || 'No message'}</p>
                    <button
                      disabled={restoringVersionId === v.id}
                      onClick={async () => {
                        setRestoringVersionId(v.id);
                        try {
                          await dashboardApi.restoreVersion(dashId, v.id);
                          // Reload pages + widgets from server
                          const data = await dashboardApi.get(dashId);
                          setPages(data.pages || []);
                          const first = data.pages?.[0];
                          if (first) { setActivePage(String(first.id)); buildWidgets(first as any); }
                          setShowVersions(false);
                        } catch (e) { console.error(e); }
                        finally { setRestoringVersionId(null); }
                      }}
                      className="text-[10px] text-primary hover:opacity-80 font-semibold disabled:opacity-40"
                    >
                      {restoringVersionId === v.id ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Modals ─────────────────────────────────────────── */}
        {showAddWidget && activePage && (
          <AddWidgetDialog
            dashId={dashId} pageId={activePage}
            chatId={activeChatId} connectionId={dashboard?.connection_id as string | undefined}
            onChatCreated={setActiveChatId}
            defaultHint={defaultHint} defaultPosition={defaultPosition || undefined}
            isGeneral={isGeneral}
            onAdd={handleWidgetAdded} onClose={() => {
              if ((defaultPosition as any)?.tempId) {
                const tid = (defaultPosition as any).tempId;
                setWidgets(ws => ws.filter(w => w.id !== tid));
              }
              setShowAddWidget(false); setDefaultHint(''); setDefaultPosition(null);
            }}
          />
        )}

        {showGenerate && activePage && (
          <GenerateDialog
            dashId={dashId} pageId={activePage}
            chatId={activeChatId} connectionId={dashboard?.connection_id as string | undefined}
            onChatCreated={setActiveChatId}
            onWidgetAdded={handleWidgetAdded}
            onClose={() => setShowGenerate(false)}
          />
        )}

        {inspectWidgetId && (
          <QueryInspectorModal
            widgetId={inspectWidgetId} dashId={dashId} pageId={activePage!}
            onClose={() => setInspectWidgetId(null)}
          />
        )}

        {editQueryWidgetId && (() => {
          const w = widgets.find(x => x.id === editQueryWidgetId);
          if (!w) return null;
          if (w.widget_type === 'text' || w.widget_type === 'image') {
            return (
              <TextImageEditDialog
                widget={w}
                dashId={dashId}
                pageId={activePage!}
                onUpdate={patch => setWidgets(ws => ws.map(x => x.id === editQueryWidgetId ? { ...x, ...patch } : x))}
                onClose={() => setEditQueryWidgetId(null)}
              />
            );
          }
          return (
            <EditQueryDialog
              widget={w}
              dashId={dashId}
              pageId={activePage!}
              chatId={activeChatId}
              connectionId={dashboard?.connection_id as string | undefined}
              isGeneral={isGeneral}
              onUpdate={patch => setWidgets(ws => ws.map(x => x.id === editQueryWidgetId ? { ...x, ...patch } : x))}
              onClose={() => setEditQueryWidgetId(null)}
            />
          );
        })()}

        {focusedWidget && (
          <WidgetFocusOverlay widget={focusedWidget} onClose={() => setFocusedWidget(null)} />
        )}

        <DragOverlay>
          {activeDragItem ? (
            <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-2xl z-[100]">
              <span className="text-xs font-medium text-foreground">
                {activeDragItem.type === 'template' ? activeDragItem.data.name : activeDragItem.data.name}
              </span>
            </div>
          ) : null}
        </DragOverlay>

        {/* ── Export PDF page-selection modal ─────────────────── */}
        {showExportModal && (
          <ExportPdfModal
            pages={pages.map(p => ({ id: String(p.id), name: String(p.name) }))}
            dashName={String(dashboard?.name || titleOverride || 'Dashboard')}
            exporting={exporting}
            onExport={(ids) => exportDashboardPdf(ids)}
            onClose={() => setShowExportModal(false)}
          />
        )}

        {/* ── Export progress overlay (masks page-switch flicker) ── */}
        {exporting && (
          <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center pointer-events-auto">
            <div className="bg-card border border-border rounded-2xl px-6 py-5 shadow-2xl flex items-center gap-3">
              <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium text-foreground">Generating export…</span>
            </div>
          </div>
        )}

        {/* ── Export notification toast ───────────────────────── */}
        {exportNote && (
          <div
            className={`fixed bottom-5 right-5 z-[70] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium animate-fade-in ${
              exportNote.kind === 'success'
                ? 'bg-success/10 border-success/30 text-success'
                : exportNote.kind === 'error'
                  ? 'bg-destructive/10 border-destructive/30 text-destructive'
                  : 'bg-card border-border text-foreground'
            }`}
            role="status"
          >
            {exportNote.kind === 'success'
              ? <Check className="w-4 h-4 shrink-0" />
              : exportNote.kind === 'error'
                ? <X className="w-4 h-4 shrink-0" />
                : <FileText className="w-4 h-4 shrink-0" />}
            <span>{exportNote.msg}</span>
            <button onClick={() => setExportNote(null)} className="ml-1 opacity-60 hover:opacity-100 transition-opacity">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ── Page notification toast ───────────────────────── */}
        {pageNote && (
          <div
            className={`fixed bottom-20 right-5 z-[70] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium animate-fade-in ${
              pageNote.kind === 'success'
                ? 'bg-success/10 border-success/30 text-success'
                : pageNote.kind === 'error'
                  ? 'bg-destructive/10 border-destructive/30 text-destructive'
                  : 'bg-card border-border text-foreground'
            }`}
            role="status"
          >
            {pageNote.kind === 'success'
              ? <Check className="w-4 h-4 shrink-0" />
              : pageNote.kind === 'error'
                ? <X className="w-4 h-4 shrink-0" />
                : <Type className="w-4 h-4 shrink-0" />}
            <span>{pageNote.msg}</span>
            <button onClick={() => setPageNote(null)} className="ml-1 opacity-60 hover:opacity-100 transition-opacity">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </DndContext>

    {/* ── Share Dashboard Modal ─────────────────────────── */}
    {shareModalOpen && dashboard && (
      <ShareDashboardModal
        dashId={dashId}
        dashName={String(dashboard.name || 'Dashboard')}
        ownerName={String((dashboard as any).created_by_name || 'Owner')}
        ownerId={String((dashboard as any).created_by || '')}
        currentUserId={currentUser?.id || ''}
        onClose={() => setShareModalOpen(false)}
      />
    )}

    {/* ── Share Page Modal ──────────────────────────────── */}
    {pageShareTarget && dashboard && (
      <ShareResourceModal
        resourceLabel="Page"
        resourceName={pageShareTarget.name}
        ownerName={String((dashboard as any).created_by_name || 'Owner')}
        ownerId={String((dashboard as any).created_by || '')}
        currentUserId={currentUser?.id || ''}
        onClose={() => setPageShareTarget(null)}
        api={{
          list: () => dashboardApi.listPageShares(dashId, pageShareTarget.id),
          share: (data) => dashboardApi.sharePage(dashId, pageShareTarget.id, data),
          update: (accountId, data) => dashboardApi.updatePageShare(dashId, pageShareTarget.id, accountId, data),
          revoke: (accountId) => dashboardApi.revokePageShare(dashId, pageShareTarget.id, accountId),
          search: (q) => dashboardApi.searchShareTargets(q),
        }}
      />
    )}

    {/* ── Share Card Modal ──────────────────────────────── */}
    {widgetShareTarget && dashboard && (
      <ShareResourceModal
        resourceLabel="Card"
        resourceName={widgetShareTarget.title}
        ownerName={String((dashboard as any).created_by_name || 'Owner')}
        ownerId={String((dashboard as any).created_by || '')}
        currentUserId={currentUser?.id || ''}
        onClose={() => setWidgetShareTarget(null)}
        api={{
          list: () => dashboardApi.listWidgetShares(dashId, String(activePage || ''), widgetShareTarget.id),
          share: (data) => dashboardApi.shareWidget(dashId, String(activePage || ''), widgetShareTarget.id, data),
          update: (accountId, data) => dashboardApi.updateWidgetShare(dashId, String(activePage || ''), widgetShareTarget.id, accountId, data),
          revoke: (accountId) => dashboardApi.revokeWidgetShare(dashId, String(activePage || ''), widgetShareTarget.id, accountId),
          search: (q) => dashboardApi.searchShareTargets(q),
        }}
      />
    )}

    {/* ── Move / Copy Dialog ────────────────────────────── */}
    {moveCopyTarget && (
      <MoveCopyDialog
        kind={moveCopyTarget.kind}
        mode={moveCopyTarget.mode}
        onClose={() => setMoveCopyTarget(null)}
        onConfirm={handleMoveCopyConfirm}
      />
    )}
    </>
  );
}
