'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { dashboardApi, chatApi, orgApi, cardApi } from '@/lib/api';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ResponsiveGridLayout = require('react-grid-layout').Responsive as React.ComponentType<any>;
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  Sparkles, Plus, History, Save, LayoutGrid, X, ChevronDown,
  MoreHorizontal, RefreshCw, Type, Trash2, Play, Check, GripHorizontal
} from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, useDroppable,
  useDraggable, useSensor, useSensors, DragEndEvent, DragStartEvent
} from '@dnd-kit/core';
import { GenerativeUIRenderer } from '../generative-ui';

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
}

// ── Map LLM ui_hint → valid widget_type / chart_type enum ──────
// The PostgreSQL enum has a fixed set of values. LLM can return extended
// hints like 'data_table', 'stat_grid', 'stacked_bar' which aren't valid.
function normalizeWidgetType(hint?: string | null): string {
  const MAP: Record<string, string> = {
    data_table: 'table',
    stat_grid: 'metric_card',
    stacked_bar: 'bar_chart',
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
  { type: 'pie_chart', name: 'Pie Chart', icon: '◑', desc: 'Part-to-whole' },
  { type: 'donut_chart', name: 'Donut Chart', icon: '◎', desc: 'Proportion rings' },
  { type: 'horizontal_bar', name: 'Horizontal Bar', icon: '▬', desc: 'Ranked comparison' },
  { type: 'scatter_chart', name: 'Scatter Plot', icon: '⁝', desc: 'Correlation / clusters' },
  { type: 'funnel_chart', name: 'Funnel', icon: '▽', desc: 'Conversion stages' },
  { type: 'gauge_chart', name: 'Gauge', icon: '◐', desc: 'Single value vs target' },
  { type: 'waterfall_chart', name: 'Waterfall', icon: '⊟', desc: 'Running totals' },
  { type: 'stat_grid', name: 'Stat Grid', icon: '⊞', desc: 'Multiple metrics' },
  { type: 'table', name: 'Data Table', icon: '☰', desc: 'Raw row data' },
];

const CHART_COLORS = ['#D97A1E', '#F5A623', '#50A0B4', '#6ECA97', '#E97B7B', '#9B8EF5'];

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
  widget, isEditing, onRemove, onInspect, onRename, onSuggestTitle, onEditQuery, otherPages, onMoveToPage,
}: {
  widget: WidgetData;
  isEditing: boolean;
  onRemove?: () => void;
  onInspect?: () => void;
  onRename?: (newTitle: string) => void;
  onSuggestTitle?: () => void;
  onEditQuery?: () => void;
  otherPages?: { id: string; name: string }[];
  onMoveToPage?: (pageId: string) => void;
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

  const rows = widget.result_rows || [];
  const columns = widget.result_columns || [];
  const hint = widget.ui_hint || widget.widget_type || 'table';

  const renderContent = () => {
    if (widget.isLoading) return (
      <div className="h-full flex flex-col p-3">
        {widget.title && <p className="text-xs font-semibold text-foreground mb-1 truncate">{widget.title}</p>}
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
    if (!rows.length) return (
      <div
        className={`h-full flex flex-col p-3 ${isEditing ? 'cursor-pointer hover:bg-muted/30 transition-colors' : ''}`}
        onClick={() => isEditing && onEditQuery?.()}
      >
        {widget.title && <p className="text-xs font-semibold text-foreground mb-1 truncate">{widget.title}</p>}
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/40 text-xs gap-2">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
          <span>{isEditing ? 'Click to configure query' : 'No data'}</span>
        </div>
      </div>
    );
    return (
      <div className="h-full w-full overflow-hidden p-1">
        <GenerativeUIRenderer
          execution={{ rows, columns, rowCount: rows.length, executionTimeMs: 0 } as any}
          uiHint={hint as any}
          title={widget.title}
          compact={true}
        />
      </div>
    );
  };

  return (
    <div className={`relative h-full flex flex-col bg-card border rounded-xl overflow-hidden transition-all group ${isEditing ? 'border-primary/30 cursor-grab active:cursor-grabbing ring-1 ring-primary/10' : 'border-border hover:border-border'
      }`} style={{ boxShadow: 'var(--shadow-soft)' }}>

      {/* Drag handle */}
      {isEditing && (
        <div className="widget-drag-handle absolute top-0 left-1/2 -translate-x-1/2 w-48 h-8 z-20 flex items-center justify-center cursor-grab opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-10 h-1.5 bg-primary/30 rounded-full" />
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
              className="w-7 h-7 rounded-lg bg-card/80 border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100 pointer-events-auto shrink-0"
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
              <button onClick={() => { setMenuOpen(false); onSuggestTitle?.(); }}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-primary" /> AI suggest title
              </button>
              <button onClick={() => { setMenuOpen(false); onEditQuery?.(); }}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors shrink-0">
                <Play className="w-3.5 h-3.5 text-primary" /> Edit query
              </button>
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
              <div className="mx-3 my-1 h-px bg-border shrink-0" />
              <button onClick={() => { setMenuOpen(false); onRemove?.(); }}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 transition-colors shrink-0">
                <Trash2 className="w-3.5 h-3.5" /> Remove widget
              </button>
            </div>
          )}
        </div>
      )}



      <div className="relative z-10 h-full">{renderContent()}</div>
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
function WidgetSidebar({ orgId, onCardClick, onTemplateClick }: {
  orgId: string;
  onCardClick?: (c: any) => void;
  onTemplateClick?: (t: string) => void;
}) {
  const [cards, setCards] = useState<any[]>([]);
  const [tab, setTab] = useState<'templates' | 'cards'>('templates');

  useEffect(() => {
    cardApi.list(orgId, { limit: 50 }).then(res => setCards(res.cards)).catch(console.error);
  }, [orgId]);

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
function AddWidgetDialog({ orgId, dashId, pageId, chatId, connectionId, onChatCreated, onAdd, onClose, defaultHint, defaultPosition }: {
  orgId: string; dashId: string; pageId: string; chatId?: string; connectionId?: string;
  onChatCreated?: (id: string) => void;
  onAdd: (widget: Record<string, unknown>) => void; onClose: () => void;
  defaultHint?: string; defaultPosition?: { x: number; y: number; w: number; h: number };
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
        const { chat } = await chatApi.create(orgId, { connectionId });
        activeChatId = chat.id;
        onChatCreated?.(chat.id);
      }
      if (!activeChatId) return;
      const p = defaultHint ? `${prompt} (format for a ${defaultHint.replace(/_/g, ' ')})` : prompt;
      const data = await chatApi.ask(orgId, activeChatId, p, true);
      setPreview(data as Record<string, unknown>);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleAdd() {
    if (!preview) return;
    setLoading(true);
    try {
      const exec = (preview as any).execution as Record<string, unknown>;
      // ui_hint is on the assistantMessage, NOT on execution
      const llmHint = (preview as any).assistantMessage?.ui_hint || exec?.ui_hint;
      const rawHint = defaultHint || llmHint || 'table';
      const widgetType = normalizeWidgetType(rawHint as string);
      const widget = await dashboardApi.addWidget(orgId, dashId, pageId, {
        title: title || prompt,
        widget_type: widgetType,
        queryPrompt: prompt,
        sql: String(exec?.generated_query || ''),
        datasourceScopeType: 'connection',
        resultRows: (exec?.rows as Record<string, unknown>[]) || [],
        resultColumns: (exec?.columns as string[]) || [],
        uiHint: widgetType,
        gridX: defaultPosition?.x, gridY: defaultPosition?.y,
        gridW: defaultPosition?.w, gridH: defaultPosition?.h,
      });
      onAdd({
        id: widget.widget.id, title: widget.widget.title, widget_type: widget.widget.widget_type,
        query_prompt: widget.widget.query_prompt,
        position_x: defaultPosition?.x || 0, position_y: defaultPosition?.y || 0,
        width: defaultPosition?.w || widget.widget.width || 4,
        height: defaultPosition?.h || widget.widget.height || 3,
        result_rows: (exec?.rows as Record<string, unknown>[]) || [],
        result_columns: exec?.columns as string[] || [],
        ui_hint: widgetType,
        is_dropped: !!defaultPosition,
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
          <button onClick={handleAdd} disabled={!preview || loading}
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
function GenerateDialog({ orgId, chatId, connectionId, onChatCreated, onWidgetAdded, dashId, pageId, onClose }: {
  orgId: string; chatId?: string; connectionId?: string;
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
        const { chat } = await chatApi.create(orgId, { connectionId });
        activeChatId = chat.id;
        onChatCreated?.(chat.id);
      } catch (e) { console.error(e); setGenerating(false); return; }
    }
    if (!activeChatId) { setGenerating(false); return; }

    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      const fallbackHint = fallbackHints[i % fallbackHints.length];
      setProgress(p => [...p, `⏳ ${prompt}`]);

      let rows: Record<string, unknown>[] = [];
      let columns: string[] = [];
      let resolvedHint = fallbackHint;

      try {
        const result = await chatApi.ask(orgId, activeChatId, prompt, true);
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
        const widget = await dashboardApi.addWidget(orgId, dashId, pageId, {
          title: prompt.slice(0, 60),
          widget_type: resolvedHint,
          queryPrompt: prompt,
          datasourceScopeType: 'connection',
          resultRows: rows,
          resultColumns: columns,
          uiHint: resolvedHint,
          gridX: (i % 3) * 4,
          gridY: Math.floor(i / 3) * 4,
          gridW: 4, gridH: 4,
        });
        onWidgetAdded({
          id: widget.widget.id, title: widget.widget.title,
          widget_type: resolvedHint,
          query_prompt: prompt,
          position_x: (i % 3) * 4, position_y: Math.floor(i / 3) * 4,
          width: 4, height: 4,
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
function QueryInspectorModal({ widgetId, orgId, dashId, pageId, onClose }: {
  widgetId: string; orgId: string; dashId: string; pageId: string; onClose: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi.inspect(orgId, dashId, pageId, widgetId)
      .then(res => setData(res.execution))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [widgetId, orgId, dashId, pageId]);

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
function EditQueryDialog({ widget, orgId, dashId, pageId, chatId, connectionId, onUpdate, onClose }: {
  widget: WidgetData;
  orgId: string;
  dashId: string;
  pageId: string;
  chatId?: string;
  connectionId?: string;
  onUpdate: (patch: Partial<WidgetData>) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(widget.query_prompt || '');
  // Seed from widget.sql immediately (set during addWidget / previous handleApply)
  const [sql, setSql] = useState(widget.sql || '');
  const [sqlLoading, setSqlLoading] = useState(false);
  // 'prompt' = last ran via prompt, 'sql' = last ran via sql
  const [lastRanVia, setLastRanVia] = useState<'prompt' | 'sql' | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ rows: Record<string, unknown>[]; fullRows: Record<string, unknown>[]; columns: string[]; ui_hint: string; llm_suggested_hint?: string } | null>(null);
  const [error, setError] = useState('');

  // Load the current SQL from the widget's last execution on mount.
  // widget.sql is the immediate fallback (seeded from query_definition.sql above).
  // The inspect call may find a more-recent SQL from a widget_execution record.
  useEffect(() => {
    setSqlLoading(true);
    dashboardApi.inspect(orgId, dashId, pageId, widget.id)
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
        const { chat } = await chatApi.create(orgId, { connectionId });
        return chat.id;
      } catch { return null; }
    }
    return null;
  }

  async function handleRunPrompt() {
    if (!prompt.trim()) return;
    setRunning(true); setError(''); setPreview(null);
    try {
      const cid = await getChat();
      if (!cid) { setError('No connection available to run this query.'); return; }
      const result = await chatApi.ask(orgId, cid, prompt, true);
      const exec = (result as any).execution;
      
      if (exec?.generated_query) {
        setSql(exec.generated_query); // always update SQL pane so user can see it
      }
      
      const rows: Record<string, unknown>[] = exec?.rows || [];
      const llmHint: string = (result as any).assistantMessage?.ui_hint || exec?.ui_hint;
      
      if (exec?.status === 'failed') {
        setError(exec.error_message || 'Query failed to execute. Check the generated SQL.');
      } else {
        setPreview({ rows: rows.slice(0, 5), fullRows: rows, columns: exec?.columns || [], ui_hint: widget.widget_type, llm_suggested_hint: llmHint });
        setLastRanVia('prompt');
      }
    } catch (e: any) { setError(e?.message || 'Query failed.'); }
    finally { setRunning(false); }
  }

  async function handleRunSQL() {
    if (!sql.trim()) return;
    setRunning(true); setError(''); setPreview(null);
    try {
      const cid = await getChat();
      if (!cid) { setError('No connection available to run this query.'); return; }
      const result = await chatApi.executeDraft(orgId, cid, '', sql);
      const exec = result.execution ?? result;
      const rows: Record<string, unknown>[] = exec?.rows || [];
      
      if (exec?.status === 'failed') {
        setError(exec.error_message || 'SQL execution failed.');
      } else {
        setPreview({ rows: rows.slice(0, 5), fullRows: rows, columns: exec?.columns || [], ui_hint: widget.widget_type, llm_suggested_hint: exec?.ui_hint });
        setLastRanVia('sql');
      }
    } catch (e: any) { setError(e?.message || 'SQL execution failed.'); }
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
      await dashboardApi.updateWidget(orgId, dashId, pageId, widget.id, {
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
              <span className="text-[10px] text-muted-foreground">Natural language — AI writes the SQL</span>
            </div>
            <textarea
              value={prompt}
              onChange={e => { setPrompt(e.target.value); setPreview(null); }}
              rows={2}
              disabled={running || saving}
              placeholder="e.g. Show top 10 customers by total revenue"
              className="w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none disabled:opacity-50 transition-all"
            />
            <button
              onClick={handleRunPrompt}
              disabled={running || saving || !prompt.trim() || noConnection}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 border border-border rounded-lg text-xs font-medium text-foreground disabled:opacity-40 transition-colors"
            >
              {running && lastRanVia !== 'sql'
                ? <><span className="w-3 h-3 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />Running…</>
                : <><Play className="w-3 h-3 text-primary" />Run with prompt</>}
            </button>
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
export function DashboardBuilder({
  orgSlug, dashId, backUrl, backLabel, titleOverride, subtitleOverride,
}: {
  orgSlug: string; dashId: string; backUrl?: string; backLabel?: string;
  titleOverride?: string; subtitleOverride?: string;
}) {
  const [org, setOrg] = useState<Record<string, unknown> | null>(null);
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null);
  const [pages, setPages] = useState<Record<string, unknown>[]>([]);
  const [activePage, setActivePage] = useState<string | null>(null);
  const [widgets, setWidgets] = useState<WidgetData[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletedWidgetIds, setDeletedWidgetIds] = useState<string[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | undefined>();

  const [inspectWidgetId, setInspectWidgetId] = useState<string | null>(null);
  const [editQueryWidgetId, setEditQueryWidgetId] = useState<string | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const isDroppingRef = useRef(false);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [defaultPosition, setDefaultPosition] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [defaultHint, setDefaultHint] = useState('');

  // Page rename state
  const [renamingPage, setRenamingPage] = useState<string | null>(null);
  const [pageNameDraft, setPageNameDraft] = useState('');
  const [confirmDeletePageId, setConfirmDeletePageId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

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

  const loadData = useCallback(async () => {
    try {
      const { org: o } = await orgApi.get(orgSlug);
      setOrg(o as Record<string, unknown>);
      const data = await dashboardApi.get(o.id, dashId);
      setDashboard(data.dashboard);
      setPages(data.pages || []);
      dashboardApi.listVersions(o.id, dashId).then(res => setVersions(res.versions || [])).catch(console.error);
      const first = data.pages?.[0];
      if (first) { setActivePage(first.id); buildWidgets(first); }
      if (data.dashboard?.connection_id) {
        const { chats } = await chatApi.list(o.id, { connectionId: data.dashboard.connection_id as string });
        if (chats.length > 0) setActiveChatId(chats[0].id);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, dashId]);

  useEffect(() => { loadData(); }, [loadData]);

  function buildWidgets(page: Record<string, unknown>) {
    setWidgets(((page?.widgets as Record<string, unknown>[]) || []).map(w => {
      const qd = w.query_definition as Record<string, unknown> || {};
      // For card-based widgets, fall back to the card's last-execution cached data
      // (card_result_preview is a JSON string of rows; card_result_columns is a string[])
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
        width: Number(w.grid_w ?? w.width) || 4,
        height: Number(w.grid_h ?? w.height) || 3,
        result_rows: resultRows,
        result_columns: resultCols,
        ui_hint: normalizeWidgetType(String(qd.ui_hint || w.card_chart_type || w.ui_hint || w.widget_type || 'table')),
        sql: String(qd.sql || w.card_raw_query || ''),
      };
    }));
  }

  function switchPage(id: string) {
    setActivePage(id);
    setDeletedWidgetIds([]); // Clear unsaved deletions for the previous page
    const p = pages.find(p => p.id === id);
    if (p) buildWidgets(p as Record<string, unknown>);
  }

  async function addPage() {
    if (!org) return;
    try {
      const { page } = await dashboardApi.addPage(String(org.id), dashId, `Page ${pages.length + 1}`);
      setPages(ps => [...ps, { ...page, widgets: [] }]);
      setActivePage(page.id); setWidgets([]);
    } catch (e) { console.error(e); }
  }

  async function deletePage(pageId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (pages.length <= 1) return;
    if (confirmDeletePageId !== pageId) { setConfirmDeletePageId(pageId); return; }
    if (!org) return;
    try {
      await dashboardApi.deletePage?.(String(org.id), dashId, pageId);
      const next = pages.filter(p => p.id !== pageId);
      setPages(next);
      if (activePage === pageId && next.length > 0) switchPage(String(next[0].id));
    } catch (e) { console.error(e); }
    finally { setConfirmDeletePageId(null); }
  }

  async function handleSave() {
    if (!org) return;
    setSaving(true);
    try {
      if (activePage && deletedWidgetIds.length > 0) {
        await Promise.all(deletedWidgetIds.map(id => 
          dashboardApi.deleteWidget?.(String(org.id), dashId, activePage, id).catch(() => {})
        ));
      }
      setDeletedWidgetIds([]);

      await dashboardApi.updateLayout(String(org.id), dashId, widgets.map(w => ({
        widgetId: w.id,
        gridX: w.position_x,
        gridY: w.position_y,
        gridW: w.width,
        gridH: w.height
      })));
      const result = await dashboardApi.saveVersion(String(org.id), dashId, undefined);
      setVersions(vs => [result.version, ...vs]);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  function handleWidgetAdded(raw: Record<string, unknown>) {
    const qd = raw.query_definition as Record<string, unknown> || {};
    const w: WidgetData = {
      id: String(raw.id), title: String(raw.title || ''),
      widget_type: String(raw.widget_type || 'table'),
      query_prompt: String(qd.prompt || raw.query_prompt || ''),
      position_x: Number(raw.grid_x ?? raw.position_x) || 0,
      position_y: Number(raw.grid_y ?? raw.position_y) || 0,
      width: Number(raw.grid_w ?? raw.width) || 4,
      height: Number(raw.grid_h ?? raw.height) || 3,
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

    if (raw.is_dropped) setWidgets(ws => [...ws, w]);
    else {
      setWidgets(ws => {
        const maxY = ws.reduce((m, ww) => Math.max(m, (ww.position_y || 0) + (ww.height || 3)), 0);
        return [...ws, { ...w, position_y: maxY }];
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
    if (!org || !activePage) return;
    const widget = widgets.find(w => w.id === widgetId);
    if (!widget) return;
    try {
      // Add to target page
      const res = await dashboardApi.addWidget(String(org.id), dashId, targetPageId, {
        title: widget.title, widget_type: widget.widget_type,
        queryPrompt: widget.query_prompt, sql: widget.sql,
        resultRows: widget.result_rows || [], resultColumns: widget.result_columns || [],
        uiHint: widget.ui_hint || widget.widget_type,
        gridX: 0, gridY: 0, gridW: widget.width || 4, gridH: widget.height || 3,
        datasourceScopeType: 'connection',
      });
      const newWidget = res.widget;
      
      // Remove from current page backend
      await dashboardApi.deleteWidget?.(String(org.id), dashId, activePage, widgetId).catch(() => { });
      
      // Update the pages array so the target page has the new widget
      setPages(ps => ps.map(p => {
        if (p.id === targetPageId) {
          const currentWidgets = Array.isArray(p.widgets) ? p.widgets : [];
          return { ...p, widgets: [...currentWidgets, newWidget] };
        }
        return p;
      }));
      
      // Remove from local state of current page
      removeWidget(widgetId);
    } catch (e) { console.error(e); }
  }

  function renameWidget(id: string, title: string) {
    setWidgets(ws => ws.map(w => w.id === id ? { ...w, title } : w));
  }

  async function suggestWidgetTitle(widgetId: string) {
    const widget = widgets.find(w => w.id === widgetId);
    if (!widget || !org) return;
    setWidgets(ws => ws.map(w => w.id === widgetId ? { ...w, isLoading: true } : w));
    try {
      const cols = (widget.result_columns || []).join(', ');
      const hint = widget.ui_hint || widget.widget_type;
      const intent = widget.query_prompt ? `\nBusiness Intent: ${widget.query_prompt}` : '';
      const sqlContext = widget.sql ? `\nSQL Logic: ${widget.sql.slice(0, 400)}` : '';
      
      const prompt = `Visualization Type: ${hint}
Columns: ${cols}${intent}${sqlContext}

Based on the above data context, suggest a highly relevant dashboard card title.`;
      
      const result = await chatApi.suggestTitle(String(org.id), prompt);
      const title = result.title?.trim() || widget.title;
      const cleanTitle = title.replace(/^["']|["']$/g, '');
      renameWidget(widgetId, cleanTitle);
      
      // Persist the generated title to the backend so it survives refresh
      if (activePage) {
        await dashboardApi.updateWidget(String(org.id), dashId, activePage, widgetId, {
          ...widget,
          title: cleanTitle,
        });
      }
    } catch (e: any) {
      console.error('Suggest title failed:', e);
      alert('Failed to generate AI title: ' + (e.message || 'Unknown error'));
    } finally {
      setWidgets(ws => ws.map(w => w.id === widgetId ? { ...w, isLoading: false } : w));
    }
  }

  /**
   * Auto-execute a card widget's SQL against its connection and store the
   * results in the widget's query_definition so the widget shows data.
   * Called after addWidget when the card has no cached execution data.
   */
  async function autoExecuteCardWidget(
    widgetId: string,
    sql: string,
    connectionId: string,
    pageId: string,
    widgetTitle: string,
    widgetType: string,
  ) {
    if (!org) return;
    try {
      // Find or create a chat for this connection so we can run the SQL
      const { chats } = await chatApi.list(String(org.id), { connectionId });
      let execChatId: string;
      if (chats.length > 0) {
        execChatId = chats[0].id;
      } else {
        const { chat } = await chatApi.create(String(org.id), { connectionId });
        execChatId = chat.id;
      }

      const result = await chatApi.executeDraft(String(org.id), execChatId, '', sql);
      const exec = result.execution ?? result;
      const rows: Record<string, unknown>[] = (exec?.rows || []).slice(0, 100);
      const cols: string[] = exec?.columns || [];

      if (rows.length > 0 || cols.length > 0) {
        // Persist results to the widget so a page reload also shows data
        await dashboardApi.updateWidget(String(org.id), dashId, pageId, widgetId, {
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
    if (!org || !activePage) return;
    const maxY = widgets.reduce((m, w) => Math.max(m, (w.position_y || 0) + (w.height || 3)), 0);
    try {
      const cardQd = typeof card.query_definition === 'string'
        ? JSON.parse(card.query_definition) : (card.query_definition || {});
      const cardSql = card.raw_query || cardQd.sql || '';
      const widgetType = normalizeWidgetType(card.chart_type);
      const contextType = card.datasource_context_type || 'connection';

      // Prefer execution data already cached on the card (from card.service list JOIN)
      let initRows: Record<string, unknown>[] = [];
      let initCols: string[] = [];
      if (card.last_result_preview) {
        try { initRows = JSON.parse(card.last_result_preview); } catch { initRows = []; }
      }
      if (Array.isArray(card.last_result_columns)) initCols = card.last_result_columns;

      const res = await dashboardApi.addWidget(String(org.id), dashId, activePage, {
        title: card.name,
        widget_type: widgetType,
        cardId: card.id,
        gridX: 0, gridY: maxY, gridW: 4, gridH: 3,
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
        position_x: 0, position_y: maxY, width: 4, height: 3,
        result_rows: initRows,
        result_columns: initCols,
        ui_hint: widgetType,
        sql: cardSql,
        isLoading: needsExec,
      }]);

      // If the card has never been executed, run its SQL now so the widget shows data
      if (needsExec) {
        autoExecuteCardWidget(
          newWidgetId, cardSql, card.datasource_context_id,
          activePage, card.name, widgetType,
        );
      }
    } catch (e) { console.error(e); }
  }

  function handleTemplateClick(type: string) {
    if (!activePage) return;
    const maxY = widgets.reduce((m, w) => Math.max(m, (w.position_y || 0) + (w.height || 3)), 0);
    setDefaultPosition({ x: 0, y: maxY, w: 4, h: 3 });
    setDefaultHint(type);
    setShowAddWidget(true);
  }

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragItem(null);
    const { active, over } = event;

    if (!over) return;

    const isZone = over.id === 'dashboard-drop-zone';
    const isWidget = over.data?.current?.type === 'widget-drop';

    if (isZone || isWidget) {
      const activeData = active.data?.current;
      if (!activeData || !org || !activePage) return;

      let targetX = 0;
      let targetY = widgets.reduce((m, w) => Math.max(m, (w.position_y || 0) + (w.height || 3)), 0);

      if (isWidget) {
        const overWidget = over?.data?.current?.widget as WidgetData;
        targetX = overWidget.position_x;
        targetY = overWidget.position_y;
      }

      if (activeData.type === 'template') {
        const newWidgetId = 'temp-' + Date.now();
        const newWidget: WidgetData = {
          id: newWidgetId, title: activeData.template.name, widget_type: activeData.template.type,
          query_prompt: '', position_x: targetX, position_y: targetY,
          width: 4, height: 3, isLoading: true,
        };

        setWidgets(prev => [newWidget, ...prev]);

        try {
          const res = await dashboardApi.addWidget(String(org.id), dashId, activePage, {
            title: activeData.template.name, widget_type: activeData.template.type,
            gridX: targetX, gridY: targetY, gridW: 4, gridH: 3,
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
          query_prompt: card.name, position_x: targetX, position_y: targetY, width: 4, height: 3,
          result_rows: [], result_columns: [], ui_hint: widgetType,
          sql: cardSql, isLoading: true,
        };

        setWidgets(prev => [newWidget, ...prev]);

        try {
          const res = await dashboardApi.addWidget(String(org.id), dashId, activePage, {
            title: card.name, widget_type: widgetType, cardId: card.id,
            gridX: targetX, gridY: targetY, gridW: 4, gridH: 3,
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
  }, [activePage, widgets, org, dashId]);

  const layout = widgets.map(w => ({ i: w.id, x: w.position_x || 0, y: w.position_y || 0, w: Math.max(1, w.width || 4), h: Math.max(1, w.height || 3), minW: 2, minH: 2 }));

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
    <DndContext sensors={dndSensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
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

        {/* ── Top bar ──────────────────────────────────────────── */}
        <header className="border-b border-border bg-background/95 backdrop-blur-md px-4 py-2.5 flex items-center gap-3 shrink-0" style={{ boxShadow: 'var(--shadow-soft)' }}>
          {backUrl ? (
            <Link href={backUrl} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-xs mr-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
              {backLabel || 'Back'}
            </Link>
          ) : (
            <Link href={`/orgs/${orgSlug}/dashboards`} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
            </Link>
          )}

          <div className="w-px h-4 bg-border shrink-0" />

          <LayoutGrid className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground truncate leading-tight">{titleOverride || String(dashboard?.name || '')}</h1>
            {subtitleOverride && <p className="text-[10px] text-muted-foreground">{subtitleOverride}</p>}
          </div>
          {Boolean(dashboard?.is_published) && (
            <span className="text-[10px] px-2 py-0.5 bg-success/10 border border-success/20 text-success rounded-full font-semibold shrink-0">Published</span>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* AI Generate */}
            <button onClick={() => setShowGenerate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}>
              <Sparkles className="w-3.5 h-3.5" /> Generate
            </button>

            {/* History */}
            <button onClick={() => setShowVersions(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${showVersions ? 'bg-muted border-border text-foreground' : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}>
              <History className="w-3.5 h-3.5" /> History
            </button>

            {/* Edit toggle */}
            <button onClick={() => setIsEditing(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${isEditing ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}>
              <Play className={`w-3.5 h-3.5 ${isEditing ? 'rotate-0' : ''}`} />
              {isEditing ? 'Editing' : 'Edit'}
            </button>

            {/* Save */}
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 hover:bg-muted border border-border rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 transition-all">
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </header>

        {/* ── Page tabs ──────────────────────────────────────── */}
        <div className="border-b border-border px-4 flex items-center gap-0.5 bg-background shrink-0">
          {pages.map(page => {
            const id = String(page.id);
            const active = activePage === id;
            return (
              <div key={id} className="relative group/tab flex items-center">
                {renamingPage === id ? (
                  <div className="flex items-center px-3 py-2.5 border-b-2 border-primary">
                    <input
                      value={pageNameDraft}
                      onChange={e => setPageNameDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { setRenamingPage(null); /* TODO: save page name */ }
                        if (e.key === 'Escape') setRenamingPage(null);
                      }}
                      onBlur={() => setRenamingPage(null)}
                      autoFocus
                      className="text-xs font-medium bg-transparent text-foreground outline-none w-20"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => switchPage(id)}
                    onDoubleClick={() => isEditing && (setRenamingPage(id), setPageNameDraft(String(page.name)))}
                    className={`px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                  >
                    {String(page.name)}
                  </button>
                )}
                {isEditing && pages.length > 1 && (
                  confirmDeletePageId === id ? (
                    <div className="flex items-center gap-1 px-1.5 py-1">
                      <span className="text-[10px] text-destructive font-medium">Delete?</span>
                      <button
                        onClick={e => deletePage(id, e)}
                        className="w-4 h-4 rounded bg-destructive text-white flex items-center justify-center hover:opacity-90 transition-opacity"
                        title="Confirm delete"
                      >
                        <Check className="w-2.5 h-2.5" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDeletePageId(null); }}
                        className="w-4 h-4 rounded bg-muted border border-border text-muted-foreground flex items-center justify-center hover:text-foreground transition-colors"
                        title="Cancel"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={e => deletePage(id, e)}
                      className="opacity-0 group-hover/tab:opacity-100 absolute -top-0.5 -right-1.5 w-4 h-4 rounded-full bg-muted border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 flex items-center justify-center transition-all text-[10px]"
                      title="Delete page"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )
                )}
              </div>
            );
          })}
          {isEditing && (
            <button onClick={addPage}
              className="flex items-center gap-1 px-3 py-2.5 text-xs text-muted-foreground/60 hover:text-primary transition-colors border-b-2 border-transparent">
              <Plus className="w-3.5 h-3.5" /> Page
            </button>
          )}
        </div>

        {/* ── Edit mode bar ──────────────────────────────────── */}
        {isEditing && (
          <div className="bg-primary/8 border-b border-primary/20 px-4 py-2 flex items-center gap-3 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <p className="text-xs text-primary/80 font-medium">Edit mode · Drag to reposition · Resize from corners</p>
            <button onClick={() => setShowAddWidget(true)}
              className="ml-auto flex items-center gap-1.5 px-3 py-1 bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-lg text-xs text-primary font-semibold transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add Widget
            </button>
          </div>
        )}

        {/* ── Canvas + Sidebar ───────────────────────────────── */}
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
                    <button onClick={() => setShowGenerate(true)}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                      style={{ background: 'linear-gradient(135deg,#D97A1E,#F5A623)' }}>
                      <Sparkles className="w-4 h-4" /> Generate with AI
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <ResponsiveGridLayout
                className="layout"
                width={containerWidth}
                style={{ minHeight: 'calc(100vh - 220px)' }}
                layouts={{ lg: layout, md: layout, sm: layout, xs: layout, xxs: layout }}
                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                rowHeight={80}
                margin={[12, 12]}
                containerPadding={[0, 0]}
                draggableHandle=".widget-drag-handle"
                isDraggable={isEditing}
                isResizable={isEditing}
                resizeHandles={['s', 'e', 'se']}
                onLayoutChange={(newLayout: any) => {
                  if (isDroppingRef.current) return;
                  setWidgets(ws => ws.map(w => {
                    const item = newLayout.find((l: any) => l.i === w.id);
                    return item ? { ...w, position_x: item.x, position_y: item.y, width: item.w, height: item.h } : w;
                  }));
                }}
              >
                {widgets.map(widget => (
                  <div key={widget.id} className="relative h-full">
                    <DashboardWidgetDroppable widget={widget}>
                      <Widget
                        widget={widget}
                        isEditing={isEditing}
                        onRemove={() => removeWidget(widget.id)}
                        onInspect={() => setInspectWidgetId(widget.id)}
                        onRename={title => renameWidget(widget.id, title)}
                        onSuggestTitle={() => suggestWidgetTitle(widget.id)}
                        onEditQuery={() => setEditQueryWidgetId(widget.id)}
                        otherPages={pages.filter(p => p.id !== activePage).map(p => ({ id: String(p.id), name: String(p.name) }))}
                        onMoveToPage={targetPageId => moveWidgetToPage(widget.id, targetPageId)}
                      />
                    </DashboardWidgetDroppable>
                  </div>
                ))}
              </ResponsiveGridLayout>
            )}
          </div>

          {/* Widget sidebar (edit mode only) */}
          {isEditing && <WidgetSidebar orgId={String(org?.id)} onCardClick={handleCardClick} onTemplateClick={handleTemplateClick} />}

          {/* Version history panel */}
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
                        if (!org) return;
                        setRestoringVersionId(v.id);
                        try {
                          await dashboardApi.restoreVersion(String(org.id), dashId, v.id);
                          // Reload pages + widgets from server
                          const data = await dashboardApi.get(String(org.id), dashId);
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
        {showAddWidget && org && activePage && (
          <AddWidgetDialog
            orgId={String(org.id)} dashId={dashId} pageId={activePage}
            chatId={activeChatId} connectionId={dashboard?.connection_id as string | undefined}
            onChatCreated={setActiveChatId}
            defaultHint={defaultHint} defaultPosition={defaultPosition || undefined}
            onAdd={handleWidgetAdded} onClose={() => {
              if ((defaultPosition as any)?.tempId) {
                const tid = (defaultPosition as any).tempId;
                setWidgets(ws => ws.filter(w => w.id !== tid));
              }
              setShowAddWidget(false); setDefaultHint(''); setDefaultPosition(null);
            }}
          />
        )}

        {showGenerate && org && activePage && (
          <GenerateDialog
            orgId={String(org.id)} dashId={dashId} pageId={activePage}
            chatId={activeChatId} connectionId={dashboard?.connection_id as string | undefined}
            onChatCreated={setActiveChatId}
            onWidgetAdded={handleWidgetAdded}
            onClose={() => setShowGenerate(false)}
          />
        )}

        {inspectWidgetId && (
          <QueryInspectorModal
            widgetId={inspectWidgetId} orgId={String(org?.id)} dashId={dashId} pageId={activePage!}
            onClose={() => setInspectWidgetId(null)}
          />
        )}

        {editQueryWidgetId && org && (() => {
          const w = widgets.find(x => x.id === editQueryWidgetId);
          if (!w) return null;
          return (
            <EditQueryDialog
              widget={w}
              orgId={String(org.id)}
              dashId={dashId}
              pageId={activePage!}
              chatId={activeChatId}
              connectionId={dashboard?.connection_id as string | undefined}
              onUpdate={patch => setWidgets(ws => ws.map(x => x.id === editQueryWidgetId ? { ...x, ...patch } : x))}
              onClose={() => setEditQueryWidgetId(null)}
            />
          );
        })()}

        <DragOverlay>
          {activeDragItem ? (
            <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-2xl z-[100]">
              <span className="text-xs font-medium text-foreground">
                {activeDragItem.type === 'template' ? activeDragItem.data.name : activeDragItem.data.name}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
}
