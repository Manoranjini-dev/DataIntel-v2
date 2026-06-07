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
  MoreHorizontal, RefreshCw, Type, Trash2, Play, Check,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────
interface WidgetData {
  id: string;
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

// ── Templates ──────────────────────────────────────────────────
const WIDGET_TEMPLATES = [
  { type: 'metric_card',    name: 'KPI Card',         icon: '▣',  desc: 'Single key number'      },
  { type: 'bar_chart',      name: 'Bar Chart',        icon: '▦',  desc: 'Compare categories'     },
  { type: 'line_chart',     name: 'Line Chart',       icon: '↗',  desc: 'Trends over time'       },
  { type: 'area_chart',     name: 'Area Chart',       icon: '◿',  desc: 'Volume over time'       },
  { type: 'pie_chart',      name: 'Pie Chart',        icon: '◑',  desc: 'Part-to-whole'          },
  { type: 'donut_chart',    name: 'Donut Chart',      icon: '◎',  desc: 'Proportion rings'       },
  { type: 'horizontal_bar', name: 'Horizontal Bar',   icon: '▬',  desc: 'Ranked comparison'      },
  { type: 'scatter_chart',  name: 'Scatter Plot',     icon: '⁝',  desc: 'Correlation / clusters' },
  { type: 'funnel_chart',   name: 'Funnel',           icon: '▽',  desc: 'Conversion stages'      },
  { type: 'gauge_chart',    name: 'Gauge',            icon: '◐',  desc: 'Single value vs target' },
  { type: 'waterfall_chart',name: 'Waterfall',        icon: '⊟',  desc: 'Running totals'         },
  { type: 'stat_grid',      name: 'Stat Grid',        icon: '⊞',  desc: 'Multiple metrics'       },
  { type: 'table',          name: 'Data Table',       icon: '☰',  desc: 'Raw row data'           },
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
      <div className="h-full flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
    if (!rows.length) return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground/40 text-xs gap-2">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
        <span>No data</span>
      </div>
    );
    if (['metric_card', 'stat_grid', 'number_trend'].includes(hint)) return <MetricWidget title={widget.title} rows={rows} columns={columns} />;
    if (['bar_chart', 'horizontal_bar', 'stacked_bar'].includes(hint)) return <BarWidget title={widget.title} rows={rows} columns={columns} />;
    if (['line_chart', 'area_chart', 'timeline'].includes(hint)) return <LineWidget title={widget.title} rows={rows} columns={columns} />;
    if (['pie_chart', 'donut_chart'].includes(hint)) return <PieWidget title={widget.title} rows={rows} columns={columns} />;
    if (hint === 'scatter_chart') return <ScatterWidget title={widget.title} rows={rows} columns={columns} />;
    if (hint === 'funnel_chart') return <FunnelWidget title={widget.title} rows={rows} columns={columns} />;
    if (hint === 'gauge_chart') return <GaugeWidget title={widget.title} rows={rows} columns={columns} />;
    if (hint === 'waterfall_chart') return <WaterfallWidget title={widget.title} rows={rows} columns={columns} />;
    return <TableWidget title={widget.title} rows={rows} columns={columns} />;
  };

  return (
    <div className={`relative h-full bg-card border rounded-xl overflow-hidden transition-all group ${
      isEditing ? 'border-primary/30 cursor-grab active:cursor-grabbing ring-1 ring-primary/10' : 'border-border hover:border-border'
    }`} style={{ boxShadow: 'var(--shadow-soft)' }}>

      {/* Drag handle */}
      {isEditing && (
        <div className="drag-handle absolute top-0 left-0 right-0 h-7 z-20 flex items-center justify-center cursor-grab opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-10 h-1 bg-primary/30 rounded-full" />
        </div>
      )}

      {/* Edit menu */}
      {isEditing && (
        <div className="absolute top-2 right-2 z-30" ref={menuRef}>
          {renaming ? (
            <div className="flex items-center gap-1 bg-card border border-border rounded-lg px-2 py-1 shadow-lg">
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
              className="w-7 h-7 rounded-lg bg-card/80 border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          )}

          {menuOpen && !renaming && (
            <div className="absolute top-8 right-0 w-48 bg-card border border-border rounded-xl shadow-xl z-40 py-1 overflow-hidden" onMouseDown={e => e.stopPropagation()}>
              <button onClick={() => { setMenuOpen(false); setRenaming(true); setDraftTitle(widget.title); }}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors">
                <Type className="w-3.5 h-3.5 text-muted-foreground" /> Rename
              </button>
              <button onClick={() => { setMenuOpen(false); onSuggestTitle?.(); }}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors">
                <Sparkles className="w-3.5 h-3.5 text-primary" /> AI suggest title
              </button>
              <button onClick={() => { setMenuOpen(false); onEditQuery?.(); }}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors">
                <Play className="w-3.5 h-3.5 text-primary" /> Edit query
              </button>
              {otherPages && otherPages.length > 0 && (
                <>
                  <div className="mx-3 my-1 h-px bg-border" />
                  <p className="px-3 py-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Move to page</p>
                  {otherPages.map(p => (
                    <button key={p.id} onClick={() => { setMenuOpen(false); onMoveToPage?.(p.id); }}
                      className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/></svg>
                      {p.name}
                    </button>
                  ))}
                </>
              )}
              <div className="mx-3 my-1 h-px bg-border" />
              <button onClick={() => { setMenuOpen(false); onRemove?.(); }}
                className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> Remove widget
              </button>
            </div>
          )}
        </div>
      )}

      {/* Inspect button (view mode) */}
      {!isEditing && onInspect && (
        <button
          onClick={e => { e.stopPropagation(); onInspect(); }}
          className="absolute top-2 right-2 z-30 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-background/80 border border-border text-muted-foreground hover:text-foreground transition-all backdrop-blur-sm"
          title="Inspect"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      )}

      <div className="relative z-10 h-full">{renderContent()}</div>
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
              {t === 'templates' ? 'Templates' : 'Library'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {tab === 'templates' && WIDGET_TEMPLATES.map(w => (
          <div key={w.type}
            className="flex items-center gap-2.5 p-2.5 bg-muted/30 border border-border/50 rounded-xl cursor-pointer hover:bg-muted/60 hover:border-primary/20 transition-all"
            draggable
            unselectable="on"
            onClick={() => onTemplateClick?.(w.type)}
            onDragStart={e => { e.dataTransfer.setData('text/plain', w.type); (window as any).__draggedWidgetHint = w.type; }}
          >
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">{w.icon}</div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-foreground">{w.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{w.desc}</p>
            </div>
          </div>
        ))}

        {tab === 'cards' && (
          cards.length === 0
            ? <p className="text-[11px] text-muted-foreground text-center mt-6 leading-relaxed">No cards in library yet</p>
            : cards.map(c => (
              <div key={c.id}
                className="flex items-center gap-2.5 p-2.5 bg-muted/30 border border-border/50 rounded-xl cursor-pointer hover:bg-muted/60 hover:border-primary/20 transition-all"
                draggable
                unselectable="on"
                onClick={() => onCardClick?.(c)}
                onDragStart={e => { const hint = JSON.stringify({ type: 'card', cardId: c.id, chartType: c.chart_type, title: c.name }); e.dataTransfer.setData('text/plain', hint); (window as any).__draggedWidgetHint = hint; }}
              >
                <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center shrink-0 text-[11px] font-bold text-accent/70">{(c.chart_type || 'C').slice(0,1).toUpperCase()}</div>
                <p className="text-[11px] font-medium text-foreground truncate">{c.name}</p>
              </div>
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
      const widget = await dashboardApi.addWidget(orgId, dashId, pageId, {
        title: title || prompt,
        widget_type: String(exec?.ui_hint || defaultHint || 'table').replace('data_table', 'table'),
        queryPrompt: prompt,
        datasourceScopeType: 'connection',
        resultRows: (exec?.rows as Record<string, unknown>[])?.slice(0, 100),
        resultColumns: exec?.columns as string[],
        uiHint: String(exec?.ui_hint || defaultHint || 'table').replace('data_table', 'table'),
        gridX: defaultPosition?.x, gridY: defaultPosition?.y,
        gridW: defaultPosition?.w, gridH: defaultPosition?.h,
      });
      onAdd({
        id: widget.widget.id, title: widget.widget.title, widget_type: widget.widget.widget_type,
        query_prompt: widget.widget.query_prompt,
        position_x: defaultPosition?.x || 0, position_y: defaultPosition?.y || 0,
        width: defaultPosition?.w || widget.widget.width || 4,
        height: defaultPosition?.h || widget.widget.height || 3,
        result_rows: (exec?.rows as Record<string, unknown>[])?.slice(0, 100) || [],
        result_columns: exec?.columns as string[] || [],
        ui_hint: String(exec?.ui_hint || defaultHint || 'table').replace('data_table', 'table'),
        is_dropped: !!defaultPosition,
      });
      onClose();
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  const exec = preview ? (preview as any).execution as Record<string, unknown> : null;
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
            <div className="bg-success/5 border border-success/20 rounded-xl p-3 space-y-2">
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <span className="text-success">✓</span>
                {String(exec.row_count)} rows · <span className="text-primary font-medium">{String(exec.ui_hint)}</span>
              </p>
              <div className="overflow-x-auto">
                <table className="text-xs w-full">
                  <thead><tr>{(exec.columns as string[] || []).map((c: string) => <th key={c} className="px-2 py-1 text-left text-muted-foreground">{c}</th>)}</tr></thead>
                  <tbody>{((exec.rows as any[] || []).slice(0, 5)).map((row, i) => (
                    <tr key={i}>{(exec.columns as string[]).map(c => <td key={c} className="px-2 py-1 text-foreground truncate max-w-[80px]">{String(row[c] ?? '')}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
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
    const chartHints = ['bar_chart', 'line_chart', 'metric_card', 'pie_chart', 'table'];

    let activeChatId = chatId;
    if (!activeChatId && connectionId) {
      const { chat } = await chatApi.create(orgId, { connectionId });
      activeChatId = chat.id;
      onChatCreated?.(chat.id);
    }
    if (!activeChatId) return;

    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      const hint = chartHints[i % chartHints.length];
      setProgress(p => [...p, prompt]);
      try {
        const result = await chatApi.ask(orgId, activeChatId, `${prompt} (format the result for a ${hint.replace(/_/g, ' ')})`, true);
        const exec = (result as any).execution;
        if (exec?.rows?.length) {
          const maxY = i * 4;
          const widget = await dashboardApi.addWidget(orgId, dashId, pageId, {
            title: prompt.slice(0, 50),
            widget_type: String(exec.ui_hint || hint).replace('data_table', 'table'),
            queryPrompt: prompt,
            datasourceScopeType: 'connection',
            resultRows: exec.rows.slice(0, 100),
            resultColumns: exec.columns,
            uiHint: String(exec.ui_hint || hint).replace('data_table', 'table'),
            gridX: (i % 3) * 4,
            gridY: Math.floor(i / 3) * 4,
            gridW: 4, gridH: 4,
          });
          onWidgetAdded({
            id: widget.widget.id, title: widget.widget.title,
            widget_type: widget.widget.widget_type,
            query_prompt: prompt,
            position_x: (i % 3) * 4, position_y: Math.floor(i / 3) * 4,
            width: 4, height: 4,
            result_rows: exec.rows.slice(0, 100),
            result_columns: exec.columns,
            ui_hint: String(exec.ui_hint || hint).replace('data_table', 'table'),
          });
        }
      } catch (e) { console.error(e); }
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

              {generating && (
                <div className="space-y-2">
                  {progress.map((p, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-xs text-foreground">
                      <div className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin shrink-0" />
                      <span className="truncate text-muted-foreground">{p}</span>
                    </div>
                  ))}
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
function EditQueryDialog({ widget, orgId, chatId, connectionId, onUpdate, onClose }: {
  widget: WidgetData;
  orgId: string;
  chatId?: string;
  connectionId?: string;
  onUpdate: (patch: Partial<WidgetData>) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(widget.query_prompt);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<{ rows: Record<string, unknown>[]; columns: string[]; ui_hint: string } | null>(null);
  const [error, setError] = useState('');

  async function handleRun() {
    if (!prompt.trim() || (!chatId && !connectionId)) return;
    setRunning(true); setError(''); setPreview(null);
    try {
      let activeChatId = chatId;
      if (!activeChatId && connectionId) {
        const { chat } = await chatApi.create(orgId, { connectionId });
        activeChatId = chat.id;
      }
      const result = await chatApi.ask(orgId, activeChatId!, prompt, true);
      const exec = (result as any).execution;
      if (exec?.rows?.length) {
        setPreview({ rows: exec.rows.slice(0, 5), columns: exec.columns || [], ui_hint: exec.ui_hint || widget.widget_type });
      } else {
        setError('Query returned no rows. Try a different prompt.');
      }
    } catch (e: any) { setError(e?.message || 'Query failed'); }
    finally { setRunning(false); }
  }

  function handleApply() {
    if (!preview) return;
    onUpdate({ query_prompt: prompt, result_rows: preview.rows, result_columns: preview.columns, ui_hint: preview.ui_hint, widget_type: preview.ui_hint || widget.widget_type });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-xl shadow-2xl" onClick={e => e.stopPropagation()} style={{ boxShadow: 'var(--shadow-elevated)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Edit Widget Query</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{widget.title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Data prompt</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={3}
              disabled={running}
              className="w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none disabled:opacity-50 transition-all"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-xl px-3 py-2">{error}</p>
          )}

          {preview && (
            <div className="bg-success/5 border border-success/20 rounded-xl p-3">
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-success" /> {preview.rows.length}+ rows · {preview.ui_hint}
              </p>
              <div className="overflow-x-auto">
                <table className="text-xs w-full">
                  <thead><tr>{preview.columns.map(c => <th key={c} className="px-2 py-1 text-left text-muted-foreground whitespace-nowrap">{c}</th>)}</tr></thead>
                  <tbody>{preview.rows.slice(0, 3).map((row, i) => (
                    <tr key={i} className="border-t border-border/40">{preview.columns.map(c => <td key={c} className="px-2 py-1 text-foreground truncate max-w-[100px]">{String(row[c] ?? '')}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} className="px-4 py-2 border border-border text-muted-foreground rounded-xl text-sm hover:bg-muted transition-colors">Cancel</button>
          <button onClick={handleRun} disabled={running || !prompt.trim() || (!chatId && !connectionId)}
            className="flex-1 py-2 bg-muted hover:bg-muted/80 border border-border rounded-xl text-sm font-medium text-foreground disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
            {running ? <><span className="w-3.5 h-3.5 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />Running…</> : <><Play className="w-3.5 h-3.5 text-primary" />Run Query</>}
          </button>
          <button onClick={handleApply} disabled={!preview}
            className="px-5 py-2 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard Builder ─────────────────────────────────────
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
  const [activeChatId, setActiveChatId] = useState<string | undefined>();

  const [inspectWidgetId,  setInspectWidgetId]  = useState<string | null>(null);
  const [editQueryWidgetId, setEditQueryWidgetId] = useState<string | null>(null);
  const [filters, setFilters] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [showVersions, setShowVersions] = useState(false);
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
      dashboardApi.listFilters(o.id, dashId).then(res => setFilters(res.filters || [])).catch(console.error);
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
      return {
        id: String(w.id), title: String(w.title || ''),
        widget_type: String(w.widget_type || 'table'),
        query_prompt: String(qd.prompt || w.query_prompt || ''),
        position_x: Number(w.grid_x ?? w.position_x) || 0,
        position_y: Number(w.grid_y ?? w.position_y) || 0,
        width: Number(w.grid_w ?? w.width) || 4,
        height: Number(w.grid_h ?? w.height) || 3,
        result_rows: (qd.result_rows || w.result_rows || []) as Record<string, unknown>[],
        result_columns: (qd.result_columns || w.result_columns || []) as string[],
        ui_hint: String(qd.ui_hint || w.ui_hint || w.widget_type || 'table'),
      };
    }));
  }

  function switchPage(id: string) {
    setActivePage(id);
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
      await dashboardApi.updateLayout(String(org.id), dashId, widgets.map(w => ({ i: w.id, x: w.position_x, y: w.position_y, w: w.width, h: w.height })));
      await dashboardApi.save(String(org.id), dashId);
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
    };
    if (raw.is_dropped) setWidgets(ws => [...ws, w]);
    else { const maxY = widgets.reduce((m, ww) => Math.max(m, (ww.position_y || 0) + (ww.height || 3)), 0); setWidgets(ws => [...ws, { ...w, position_y: maxY }]); }
  }

  function removeWidget(id: string) { setWidgets(ws => ws.filter(w => w.id !== id)); }

  async function moveWidgetToPage(widgetId: string, targetPageId: string) {
    if (!org || !activePage) return;
    const widget = widgets.find(w => w.id === widgetId);
    if (!widget) return;
    try {
      // Add to target page
      await dashboardApi.addWidget(String(org.id), dashId, targetPageId, {
        title: widget.title, widget_type: widget.widget_type,
        queryPrompt: widget.query_prompt,
        resultRows: widget.result_rows || [], resultColumns: widget.result_columns || [],
        uiHint: widget.ui_hint || widget.widget_type,
        gridX: 0, gridY: 0, gridW: widget.width || 4, gridH: widget.height || 3,
        datasourceScopeType: 'connection',
      });
      // Remove from current page backend
      await dashboardApi.deleteWidget?.(String(org.id), dashId, activePage, widgetId).catch(() => {});
      // Remove from local state
      removeWidget(widgetId);
    } catch (e) { console.error(e); }
  }

  function renameWidget(id: string, title: string) {
    setWidgets(ws => ws.map(w => w.id === id ? { ...w, title } : w));
  }

  async function suggestWidgetTitle(widgetId: string) {
    const widget = widgets.find(w => w.id === widgetId);
    if (!widget || !activeChatId || !org) return;
    setWidgets(ws => ws.map(w => w.id === widgetId ? { ...w, isLoading: true } : w));
    try {
      const cols = (widget.result_columns || []).join(', ');
      const hint = widget.ui_hint || widget.widget_type;
      const result = await chatApi.ask(String(org.id), activeChatId,
        `Suggest a concise, human-friendly title (max 6 words) for a ${hint} chart with columns: ${cols}. Respond with ONLY the title, no quotes or explanation.`, true);
      const title = (result as any)?.assistantMessage?.content?.trim() || widget.title;
      renameWidget(widgetId, title.replace(/^["']|["']$/g, ''));
    } catch (e) { console.error(e); }
    finally { setWidgets(ws => ws.map(w => w.id === widgetId ? { ...w, isLoading: false } : w)); }
  }

  async function handleCardClick(card: any) {
    if (!org || !activePage) return;
    const maxY = widgets.reduce((m, w) => Math.max(m, (w.position_y || 0) + (w.height || 3)), 0);
    try {
      const res = await dashboardApi.addWidget(String(org.id), dashId, activePage, {
        title: card.name, widget_type: card.chart_type === 'data_table' ? 'table' : (card.chart_type || 'table'),
        cardId: card.id, gridX: 0, gridY: maxY, gridW: 4, gridH: 3,
        datasourceScopeType: 'connection', uiHint: card.chart_type,
      });
      const rw = res.widget, qd = rw.query_definition || {};
      setWidgets(prev => [...prev, {
        id: String(rw.id), title: String(rw.title || ''), widget_type: String(rw.widget_type || 'table'),
        query_prompt: String(qd.prompt || rw.query_prompt || ''),
        position_x: 0, position_y: maxY, width: 4, height: 3,
        result_rows: qd.result_rows || rw.result_rows || [],
        result_columns: qd.result_columns || rw.result_columns || [],
        ui_hint: String(qd.ui_hint || rw.ui_hint || rw.widget_type || 'table'),
      }]);
    } catch (e) { console.error(e); }
  }

  function handleTemplateClick(type: string) {
    if (!activePage) return;
    const maxY = widgets.reduce((m, w) => Math.max(m, (w.position_y || 0) + (w.height || 3)), 0);
    setDefaultPosition({ x: 0, y: maxY, w: 4, h: 3 });
    setDefaultHint(type);
    setShowAddWidget(true);
  }

  const layout = widgets.map(w => ({ i: w.id, x: w.position_x || 0, y: w.position_y || 0, w: Math.max(1, w.width || 4), h: Math.max(1, w.height || 3), minW: 2, minH: 2 }));

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="h-full bg-background text-foreground flex flex-col min-h-0 w-full">

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
          <button onClick={async () => {
            await handleSave();
            const msg = window.prompt('Version message (optional):');
            if (msg !== null) {
              dashboardApi.saveVersion(String(org?.id), dashId, msg || undefined)
                .then(res => setVersions(vs => [res.version, ...vs])).catch(console.error);
            }
          }} disabled={saving}
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
          <p className="text-xs text-primary/80 font-medium">Edit mode · Drag to reposition · Resize from corners · Double-click page tab to rename</p>
          <button onClick={() => setShowAddWidget(true)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1 bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-lg text-xs text-primary font-semibold transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add Widget
          </button>
        </div>
      )}

      {/* ── Filter bar (only if filters exist or editing) ── */}
      {(filters.length > 0 || isEditing) && (
        <div className="border-b border-border px-4 py-2 flex items-center gap-2 bg-muted/20 shrink-0">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
            Filters
          </span>
          {filters.map(f => (
            <div key={f.id} className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-2.5 py-1 text-xs">
              <span className="text-muted-foreground">{f.name}:</span>
              <span className="text-foreground font-medium">{f.default_value || 'All'}</span>
              {isEditing && (
                <button onClick={() => dashboardApi.removeFilter(String(org?.id), dashId, f.id).then(() => setFilters(fs => fs.filter(x => x.id !== f.id)))}
                  className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"><X className="w-3 h-3" /></button>
              )}
            </div>
          ))}
          {isEditing && (
            <button onClick={() => { const n = window.prompt('Filter name:'); if (!n) return; dashboardApi.addFilter(String(org?.id), dashId, { name: n, filterType: 'text', operator: '=', defaultValue: '' }).then(res => setFilters(fs => [...fs, res.filter])); }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs border border-dashed border-border text-muted-foreground rounded-lg hover:border-primary/30 hover:text-primary transition-colors">
              <Plus className="w-3 h-3" /> Add Filter
            </button>
          )}
        </div>
      )}

      {/* ── Canvas + Sidebar ───────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 overflow-auto bg-muted/10 p-4" ref={containerRef}>
          {widgets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-5 text-center min-h-[400px]">
              <div className="w-16 h-16 rounded-2xl bg-muted/50 border border-border flex items-center justify-center">
                <LayoutGrid className="w-7 h-7 text-muted-foreground/40" />
              </div>
              <div>
                <p className="text-foreground font-semibold mb-1">Empty page</p>
                <p className="text-muted-foreground text-sm">
                  {isEditing
                    ? 'Click "Add Widget" or drag templates from the sidebar'
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
              layouts={{ lg: layout }}
              breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
              cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
              rowHeight={80}
              margin={[12, 12]}
              containerPadding={[0, 0]}
              isDraggable={isEditing}
              isResizable={isEditing}
              isDroppable={isEditing}
              onDrop={async (_layout: any, item: any, e: Event) => {
                const hint = (window as any).__draggedWidgetHint || (e as unknown as DragEvent).dataTransfer?.getData('text/plain');
                if (!hint || !item) return;
                if (hint.startsWith('{')) {
                  const data = JSON.parse(hint);
                  if (data.type === 'card' && org) {
                    const res = await dashboardApi.addWidget(String(org.id), dashId, activePage!, {
                      title: data.title, widget_type: data.chartType === 'data_table' ? 'table' : (data.chartType || 'table'),
                      cardId: data.cardId, gridX: item.x, gridY: item.y, gridW: 4, gridH: 3, datasourceScopeType: 'connection', uiHint: data.chartType,
                    });
                    const rw = res.widget, qd = rw.query_definition || {};
                    setWidgets(prev => [...prev, {
                      id: String(rw.id), title: String(rw.title || ''), widget_type: String(rw.widget_type || 'table'),
                      query_prompt: String(qd.prompt || rw.query_prompt || ''),
                      position_x: item.x, position_y: item.y, width: 4, height: 3,
                      result_rows: qd.result_rows || rw.result_rows || [],
                      result_columns: qd.result_columns || rw.result_columns || [],
                      ui_hint: String(qd.ui_hint || rw.ui_hint || rw.widget_type || 'table'),
                    }]);
                  }
                } else {
                  setDefaultPosition({ x: item.x, y: item.y, w: 4, h: 3 });
                  setDefaultHint(hint);
                  setShowAddWidget(true);
                }
                (window as any).__draggedWidgetHint = null;
              }}
              droppingItem={{ i: '__dropping__', w: 4, h: 3, x: 0, y: 0 } as any}
              onLayoutChange={(newLayout: any) => {
                setWidgets(ws => ws.map(w => {
                  const item = newLayout.find((l: any) => l.i === w.id);
                  return item ? { ...w, position_x: item.x, position_y: item.y, width: item.w, height: item.h } : w;
                }));
              }}
            >
              {widgets.map(widget => (
                <div key={widget.id} className="relative h-full">
                  {isEditing && (
                    <div className="drag-handle absolute top-0 left-0 right-0 h-8 z-20 cursor-grab active:cursor-grabbing" />
                  )}
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
                    <span className="text-xs font-semibold text-foreground">v{v.version}</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(v.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">{v.commit_message || 'No message'}</p>
                  <button onClick={() => alert('Restore coming soon')} className="text-[10px] text-primary hover:opacity-80 font-semibold">Restore</button>
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
          onAdd={handleWidgetAdded} onClose={() => { setShowAddWidget(false); setDefaultHint(''); setDefaultPosition(null); }}
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
            chatId={activeChatId}
            connectionId={dashboard?.connection_id as string | undefined}
            onUpdate={patch => setWidgets(ws => ws.map(x => x.id === editQueryWidgetId ? { ...x, ...patch } : x))}
            onClose={() => setEditQueryWidgetId(null)}
          />
        );
      })()}
    </div>
  );
}
