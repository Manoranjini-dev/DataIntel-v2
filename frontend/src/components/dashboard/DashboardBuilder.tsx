'use client';

import { useEffect, useState, useRef } from 'react';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { dashboardApi, chatApi, orgApi, cardApi } from '@/lib/api';
import { ResponsiveGridLayout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

type Layout = { i: string; x: number; y: number; w: number; h: number; [key: string]: any };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type LayoutItem = Layout;

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
}

// ── Constants & Templates ──────────────────────────────────────
const WIDGET_TEMPLATES = [
  { type: 'metric_card', name: 'Metric Card', icon: '#' },
  { type: 'bar_chart', name: 'Bar Chart', icon: '📊' },
  { type: 'line_chart', name: 'Line Chart', icon: '📈' },
  { type: 'pie_chart', name: 'Pie Chart', icon: '🥧' },
  { type: 'area_chart', name: 'Area Chart', icon: '🏔️' },
  { type: 'stat_grid', name: 'Stat Grid', icon: '⊞' },
  { type: 'table', name: 'Data Table', icon: '▦' },
  { type: 'list', name: 'List', icon: '≡' },
  { type: 'donut_chart', name: 'Donut Chart', icon: '🍩' },
  { type: 'horizontal_bar', name: 'Horizontal Bar', icon: '▤' },
];

function WidgetSidebar({ orgId, onCardClick, onTemplateClick }: { orgId: string, onCardClick?: (c: any) => void, onTemplateClick?: (t: string) => void }) {
  const [cards, setCards] = useState<any[]>([]);
  const [tab, setTab] = useState<'templates'|'cards'>('templates');

  useEffect(() => {
    cardApi.list(orgId, { limit: 50 }).then(res => setCards(res.cards)).catch(console.error);
  }, [orgId]);

  return (
    <div className="w-64 bg-card border-l border-border flex flex-col flex-shrink-0 h-full overflow-hidden">
      <div className="p-4 border-b border-border flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-white">Add to Dashboard</h3>
        <p className="text-[10px] text-muted-foreground">Drag or click to add</p>
        <div className="flex bg-black/40 p-1 rounded-lg">
          <button onClick={() => setTab('templates')} className={`flex-1 text-xs py-1 rounded-md transition-colors ${tab === 'templates' ? 'bg-white/10 text-white' : 'text-muted-foreground hover:text-foreground'}`}>Templates</button>
          <button onClick={() => setTab('cards')} className={`flex-1 text-xs py-1 rounded-md transition-colors ${tab === 'cards' ? 'bg-white/10 text-white' : 'text-muted-foreground hover:text-foreground'}`}>Card Library</button>
        </div>
      </div>
      <div className="p-4 flex-1 overflow-y-auto space-y-2">
        {tab === 'templates' && WIDGET_TEMPLATES.map(w => (
          <div key={w.type}
            className="flex items-center gap-3 p-3 bg-muted/50 border border-border rounded-xl cursor-pointer hover:bg-white/10 transition-colors"
            draggable={true}
            unselectable="on"
            onClick={() => onTemplateClick?.(w.type)}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', w.type);
              (window as any).__draggedWidgetHint = w.type;
            }}
          >
            <div className="w-8 h-8 rounded bg-black/20 border border-white/5 flex items-center justify-center text-sm">{w.icon}</div>
            <div>
              <p className="text-xs font-medium text-white">{w.name}</p>
            </div>
          </div>
        ))}
        {tab === 'cards' && (
          cards.length === 0 ? <p className="text-xs text-muted-foreground text-center mt-4">No cards found in library.</p> :
          cards.map(c => (
            <div key={c.id}
              className="flex items-center gap-3 p-3 bg-muted/50 border border-border rounded-xl cursor-pointer hover:bg-white/10 transition-colors"
              draggable={true}
              unselectable="on"
              onClick={() => onCardClick?.(c)}
              onDragStart={(e) => {
                const hint = JSON.stringify({ type: 'card', cardId: c.id, chartType: c.chart_type, title: c.name, queryDefinition: c.query_definition });
                e.dataTransfer.setData('text/plain', hint);
                (window as any).__draggedWidgetHint = hint;
              }}
            >
              <div className="w-8 h-8 rounded bg-black/20 border border-white/5 flex items-center justify-center text-sm">📊</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate">{c.name}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Mini widget renderers ──────────────────────────────────────
function BarChartWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <TableWidget title={title} rows={rows} columns={columns} />;
  const labelCol = columns[0];
  const valueCol = columns[1];
  const maxVal = Math.max(...rows.map(r => Number(r[valueCol]) || 0)) || 1;
  return (
    <div className="h-full flex flex-col px-3 py-2">
      <p className="text-xs font-semibold text-foreground mb-2 truncate">{title}</p>
      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {rows.slice(0, 15).map((row, i) => {
          const val = Number(row[valueCol]) || 0;
          const pct = (val / maxVal) * 100;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground w-20 truncate flex-shrink-0">{String(row[labelCol] ?? '')}</span>
              <div className="flex-1 bg-muted/50 rounded-full h-4 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary to-primary/80 rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[11px] text-foreground w-12 text-right flex-shrink-0">{val.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LineChartWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <TableWidget title={title} rows={rows} columns={columns} />;
  const valueCol = columns[1];
  const labelCol = columns[0];
  const values = rows.map(r => Number(r[valueCol]) || 0);
  const max = Math.max(...values) || 1;
  const min = Math.min(...values);
  const range = max - min || 1;
  const W = 280;
  const H = 70;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x},${y}`;
  }).join(' ');
  return (
    <div className="h-full flex flex-col px-3 py-2">
      <p className="text-xs font-semibold text-foreground mb-2 truncate">{title}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full flex-1 min-h-0" preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinejoin="round" />
        <polyline points={`0,${H} ${pts} ${W},${H}`} fill="rgba(217,122,30,0.12)" stroke="none" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
        <span className="truncate max-w-[45%]">{String(rows[0]?.[labelCol] ?? '')}</span>
        <span className="truncate max-w-[45%] text-right">{String(rows[rows.length - 1]?.[labelCol] ?? '')}</span>
      </div>
    </div>
  );
}

function PieChartWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <TableWidget title={title} rows={rows} columns={columns} />;
  const labelCol = columns[0];
  const valueCol = columns[1];
  const total = rows.reduce((s, r) => s + (Number(r[valueCol]) || 0), 0) || 1;
  const COLORS = ['#8b5cf6', '#6d28d9', '#a78bfa', '#c4b5fd', '#ddd6fe', '#7c3aed'];
  let cumulative = 0;
  const slices = rows.slice(0, 6).map((row, i) => {
    const val = Number(row[valueCol]) || 0;
    const start = (cumulative / total) * 360;
    cumulative += val;
    const end = (cumulative / total) * 360;
    const startRad = (start - 90) * Math.PI / 180;
    const endRad = (end - 90) * Math.PI / 180;
    const x1 = 50 + 45 * Math.cos(startRad);
    const y1 = 50 + 45 * Math.sin(startRad);
    const x2 = 50 + 45 * Math.cos(endRad);
    const y2 = 50 + 45 * Math.sin(endRad);
    const lg = end - start > 180 ? 1 : 0;
    return { path: `M50,50 L${x1},${y1} A45,45 0 ${lg},1 ${x2},${y2} Z`, color: COLORS[i % COLORS.length], label: String(row[labelCol] ?? ''), pct: Math.round((val / total) * 100) };
  });
  return (
    <div className="h-full flex items-center gap-3 px-3 py-2">
      <svg viewBox="0 0 100 100" className="w-20 h-20 flex-shrink-0">
        {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} />)}
      </svg>
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-xs font-semibold text-foreground truncate mb-1">{title}</p>
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-[10px] text-muted-foreground truncate flex-1">{s.label}</span>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">{s.pct}%</span>
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
    <div className="h-full flex flex-col justify-center items-center p-4">
      <p className="text-[11px] text-muted-foreground mb-2 text-center">{title}</p>
      <p className="text-4xl font-bold text-white tracking-tight">
        {typeof value === 'number' ? value.toLocaleString() : String(value ?? '—')}
      </p>
      {columns[1] && <p className="text-xs text-muted-foreground mt-1">{String(row[columns[1]] ?? '')}</p>}
    </div>
  );
}

function TableWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  return (
    <div className="h-full flex flex-col">
      <p className="text-xs font-semibold text-foreground px-3 py-2 border-b border-white/5 flex-shrink-0 truncate">{title}</p>
      <div className="flex-1 overflow-auto min-h-0">
        <table className="text-xs w-full">
          <thead className="bg-muted/50 sticky top-0">
            <tr>{columns.map(c => <th key={c} className="px-2 py-1.5 text-left text-muted-foreground whitespace-nowrap">{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((row, i) => (
              <tr key={i} className="border-t border-white/[0.04] hover:bg-muted/20">
                {columns.map(c => (
                  <td key={c} className="px-2 py-1.5 text-foreground whitespace-nowrap max-w-[120px] truncate">
                    {String(row[c] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Widget({ widget, onRemove, onInspect, isEditing }: {
  widget: WidgetData;
  onRemove?: () => void;
  onInspect?: () => void;
  isEditing: boolean;
}) {
  const rows = widget.result_rows || [];
  const columns = widget.result_columns || [];
  const hint = widget.ui_hint || widget.widget_type || 'table';

  const renderContent = () => {
    if (widget.isLoading) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }
    if (!rows.length) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-muted-foreground/60 text-xs gap-1">
          <span className="text-2xl">📭</span>
          <span>No data</span>
        </div>
      );
    }
    if (hint === 'metric_card' || hint === 'stat_grid' || hint === 'number_trend' || hint === 'gauge') return <MetricWidget title={widget.title} rows={rows} columns={columns} />;
    if (hint === 'bar_chart' || hint === 'horizontal_bar' || hint === 'stacked_bar') return <BarChartWidget title={widget.title} rows={rows} columns={columns} />;
    if (hint === 'line_chart' || hint === 'area_chart' || hint === 'timeline') return <LineChartWidget title={widget.title} rows={rows} columns={columns} />;
    if (hint === 'pie_chart' || hint === 'donut_chart') return <PieChartWidget title={widget.title} rows={rows} columns={columns} />;
    return <TableWidget title={widget.title} rows={rows} columns={columns} />;
  };

  return (
    <div className={`relative h-full bg-[#141420] border rounded-xl overflow-hidden transition-all group ${isEditing ? 'border-primary/40 cursor-grab active:cursor-grabbing' : 'border-border hover:border-white/20'}`}>
      {isEditing && (
        <div className="absolute inset-0 bg-primary/5 pointer-events-none z-0 rounded-xl" />
      )}
      {isEditing && onRemove && (
        <button
          onMouseDown={(e) => { e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-1.5 right-1.5 z-30 w-6 h-6 rounded-full bg-red-500/20 border border-red-500/40 text-red-400 text-sm flex items-center justify-center hover:bg-red-500/50 transition-colors"
        >
          ×
        </button>
      )}
      {!isEditing && onInspect && (
        <button
          onClick={(e) => { e.stopPropagation(); onInspect(); }}
          className="absolute top-2 right-2 z-30 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-black/50 border border-border text-muted-foreground hover:text-white transition-all backdrop-blur-sm"
          title="Inspect Query"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </button>
      )}
      <div className="relative z-10 h-full">
        {renderContent()}
      </div>
    </div>
  );
}

// ── Add Widget Dialog ──────────────────────────────────────────
function AddWidgetDialog({ orgId, dashId, pageId, chatId, connectionId, onChatCreated, onAdd, onClose, defaultHint, defaultPosition }: {
  orgId: string; dashId: string; pageId: string; chatId?: string; connectionId?: string;
  onChatCreated?: (id: string) => void;
  onAdd: (widget: Record<string, unknown>) => void; onClose: () => void;
  defaultHint?: string; defaultPosition?: { x: number, y: number, w: number, h: number };
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
        if (onChatCreated) onChatCreated(chat.id);
      }
      if (!activeChatId) return;

      const p = defaultHint ? `${prompt} (Format the result for a ${defaultHint})` : prompt;
      const data = await chatApi.ask(orgId, activeChatId, p, true);
      setPreview(data as Record<string, unknown>);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleAdd() {
    if (!preview) return;
    setLoading(true);
    try {
      const exec = (preview as Record<string, unknown>).execution as Record<string, unknown>;
      const widget = await dashboardApi.addWidget(orgId, dashId, pageId, {
        title: title || prompt,
        widget_type: String(exec?.ui_hint || defaultHint || 'table').replace('data_table', 'table'),
        queryPrompt: prompt,
        datasourceScopeType: 'connection',
        resultRows: (exec?.rows as Record<string, unknown>[])?.slice(0, 100),
        resultColumns: exec?.columns as string[],
        uiHint: String(exec?.ui_hint || defaultHint || 'table').replace('data_table', 'table'),
        gridX: defaultPosition?.x,
        gridY: defaultPosition?.y,
        gridW: defaultPosition?.w,
        gridH: defaultPosition?.h,
      });
      onAdd({
        id: widget.widget.id,
        title: widget.widget.title,
        widget_type: widget.widget.widget_type,
        query_prompt: widget.widget.query_prompt,
        position_x: defaultPosition?.x || 0,
        position_y: defaultPosition?.y || 0,
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

  const execPreview = preview ? (preview as Record<string, unknown>).execution as Record<string, unknown> : null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-sm text-white">Add Widget</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Widget Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g., Monthly Revenue"
              className="w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Data Query</label>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder="e.g., Show total revenue by month"
              rows={3}
              className="w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none" />
          </div>

          {!chatId && (
            <p className="text-xs text-amber-400/80 bg-amber-400/5 border border-amber-400/20 rounded-xl px-3 py-2">
              ⚠️ No linked chat found. Create a chat for this connection first.
            </p>
          )}

          <button onClick={handleGenerate} disabled={!prompt.trim() || loading || !chatId}
            className="w-full py-2.5 bg-primary/20 border border-primary/30 hover:bg-primary/30 rounded-xl text-sm text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">
            {loading ? 'Generating…' : 'Generate Preview'}
          </button>

          {execPreview && (
            <div className="bg-muted/50 border border-border rounded-xl p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                <span className="text-success">✓</span> {String(execPreview.row_count)} rows · chart type: <span className="text-primary">{String(execPreview.ui_hint)}</span>
              </p>
              <div className="overflow-x-auto rounded-lg">
                <table className="text-xs w-full">
                  <thead><tr>{(execPreview.columns as string[] || []).map((c: string) => <th key={c} className="px-2 py-1 text-left text-muted-foreground">{c}</th>)}</tr></thead>
                  <tbody>
                    {((execPreview.rows as Record<string, unknown>[] || []).slice(0, 5)).map((row, i) => (
                      <tr key={i}>{(execPreview.columns as string[]).map((c: string) => <td key={c} className="px-2 py-1 text-foreground truncate max-w-[80px]">{String(row[c] ?? '')}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={handleAdd} disabled={!preview || loading}
            className="flex-1 py-2.5 bg-primary hover:opacity-90 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Add to Dashboard
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-muted/50 hover:bg-white/10 rounded-xl text-sm text-muted-foreground transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard Editor ─────────────────────────────────────
export function DashboardBuilder({ 
  orgSlug, 
  dashId, 
  backUrl, 
  backLabel,
  titleOverride,
  subtitleOverride
}: { 
  orgSlug: string, 
  dashId: string, 
  backUrl?: string, 
  backLabel?: string,
  titleOverride?: string,
  subtitleOverride?: string,
}) {
  const slug = orgSlug;
  const [org, setOrg] = useState<Record<string, unknown> | null>(null);
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null);
  const [pages, setPages] = useState<Record<string, unknown>[]>([]);
  const [activePage, setActivePage] = useState<string | null>(null);
  const [widgets, setWidgets] = useState<WidgetData[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | undefined>();
  
  const [inspectWidgetId, setInspectWidgetId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [inspectData, setInspectData] = useState<any | null>(null);

  const [filters, setFilters] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [showVersions, setShowVersions] = useState(false);

  // Drag & drop state
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [defaultPosition, setDefaultPosition] = useState<{ x: number, y: number, w: number, h: number } | null>(null);
  const [defaultHint, setDefaultHint] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  // Measure container for GridLayout
  useEffect(() => {
    function measure() {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [slug, dashId]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o as Record<string, unknown>);
      const data = await dashboardApi.get(o.id, dashId);
      setDashboard(data.dashboard);
      setPages(data.pages || []);

      dashboardApi.listFilters(o.id, dashId)
        .then(res => setFilters(res.filters || []))
        .catch(console.error);

      dashboardApi.listVersions(o.id, dashId)
        .then(res => setVersions(res.versions || []))
        .catch(console.error);

      const firstPage = data.pages?.[0]?.id;
      if (firstPage) {
        setActivePage(firstPage);
        buildWidgets(data.pages[0]);
      }

      if (data.dashboard?.connection_id) {
        const { chats } = await chatApi.list(o.id, { connectionId: data.dashboard.connection_id });
        if (chats.length > 0) setActiveChatId(chats[0].id);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function buildWidgets(page: Record<string, unknown>) {
    const pageWidgets: WidgetData[] = ((page?.widgets as Record<string, unknown>[]) || []).map((w) => {
      const qd = w.query_definition as Record<string, unknown> || {};
      return {
        id: String(w.id),
        title: String(w.title || ''),
        widget_type: String(w.widget_type || 'table'),
        query_prompt: String(qd.prompt || w.query_prompt || ''),
        position_x: Number(w.grid_x ?? w.position_x) || 0,
        position_y: Number(w.grid_y ?? w.position_y) || 0,
        width: Number(w.grid_w ?? w.width) || 4,
        height: Number(w.grid_h ?? w.height) || 3,
        result_rows: (qd.result_rows as Record<string, unknown>[] || w.result_rows as Record<string, unknown>[]) || [],
        result_columns: (qd.result_columns as string[] || w.result_columns as string[]) || [],
        ui_hint: String(qd.ui_hint || w.ui_hint || w.widget_type || 'table'),
      };
    });
    setWidgets(pageWidgets);
  }

  function switchPage(pageId: string) {
    setActivePage(pageId);
    const page = pages.find(p => p.id === pageId);
    if (page) buildWidgets(page as Record<string, unknown>);
  }

  async function addPage() {
    if (!org) return;
    try {
      const { page } = await dashboardApi.addPage(String(org.id), dashId, `Page ${pages.length + 1}`);
      const newPages = [...pages, { ...page, widgets: [] }];
      setPages(newPages);
      setActivePage(page.id);
      setWidgets([]);
    } catch (e) { console.error(e); }
  }

  async function handleSave() {
    if (!org) return;
    setSaving(true);
    try {
      const layoutPayload = widgets.map(w => ({
        i: w.id,
        x: w.position_x,
        y: w.position_y,
        w: w.width,
        h: w.height
      }));
      await dashboardApi.updateLayout(String(org.id), dashId, layoutPayload);
      await dashboardApi.save(String(org.id), dashId);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  function handleWidgetAdded(rawWidget: Record<string, unknown>) {
    const qd = rawWidget.query_definition as Record<string, unknown> || {};
    const widget = {
      id: String(rawWidget.id),
      title: String(rawWidget.title || ''),
      widget_type: String(rawWidget.widget_type || 'table'),
      query_prompt: String(qd.prompt || rawWidget.query_prompt || ''),
      position_x: Number(rawWidget.grid_x ?? rawWidget.position_x) || 0,
      position_y: Number(rawWidget.grid_y ?? rawWidget.position_y) || 0,
      width: Number(rawWidget.grid_w ?? rawWidget.width) || 4,
      height: Number(rawWidget.grid_h ?? rawWidget.height) || 3,
      result_rows: (qd.result_rows as Record<string, unknown>[] || rawWidget.result_rows as Record<string, unknown>[]) || [],
      result_columns: (qd.result_columns as string[] || rawWidget.result_columns as string[]) || [],
      ui_hint: String(qd.ui_hint || rawWidget.ui_hint || rawWidget.widget_type || 'table'),
    };
    if (rawWidget.is_dropped) {
      setWidgets(ws => [...ws, widget]);
    } else {
      const maxY = widgets.reduce((m, w) => Math.max(m, (w.position_y || 0) + (w.height || 3)), 0);
      setWidgets(ws => [...ws, { ...widget, position_y: maxY }]);
    }
  }

  function removeWidget(id: string) {
    setWidgets(ws => ws.filter(w => w.id !== id));
  }

  // Build layout array for react-grid-layout
  const layout = widgets.map(w => ({
    i: w.id,
    x: w.position_x || 0,
    y: w.position_y || 0,
    w: Math.max(1, w.width || 4),
    h: Math.max(1, w.height || 3),
    minW: 2,
    minH: 2,
  }));

  const COLS = 12;
  const ROW_HEIGHT = 80;
  const MARGIN: readonly [number, number] = [12, 12];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const gridCfg = { cols: COLS, rowHeight: ROW_HEIGHT, margin: MARGIN, containerPadding: [0, 0] as readonly [number, number] };

  async function handleCardClick(card: any) {
    if (!org || !activePage) return;
    try {
      const maxY = widgets.reduce((m, w) => Math.max(m, (w.position_y || 0) + (w.height || 3)), 0);
      const res = await dashboardApi.addWidget(String(org.id), dashId, activePage, {
        title: card.name,
        widget_type: card.chart_type === 'data_table' ? 'table' : (card.chart_type || 'table'),
        cardId: card.id,
        gridX: 0,
        gridY: maxY,
        gridW: 4,
        gridH: 3,
        datasourceScopeType: 'connection', // placeholder
        uiHint: card.chart_type,
      });

      const rawWidget = res.widget;
      const qd = rawWidget.query_definition || {};
      const newWidgetData = {
        id: String(rawWidget.id),
        title: String(rawWidget.title || ''),
        widget_type: String(rawWidget.widget_type || 'table'),
        query_prompt: String(qd.prompt || rawWidget.query_prompt || ''),
        position_x: Number(rawWidget.grid_x ?? rawWidget.position_x) || 0,
        position_y: Number(rawWidget.grid_y ?? rawWidget.position_y) || 0,
        width: Number(rawWidget.grid_w ?? rawWidget.width) || 4,
        height: Number(rawWidget.grid_h ?? rawWidget.height) || 3,
        result_rows: (qd.result_rows || rawWidget.result_rows || []),
        result_columns: (qd.result_columns || rawWidget.result_columns || []),
        ui_hint: String(qd.ui_hint || rawWidget.ui_hint || rawWidget.widget_type || 'table'),
      };
      
      setWidgets(prev => [...prev, newWidgetData]);
    } catch (err) {
      console.error('Failed to add widget from card click', err);
    }
  }

  function handleTemplateClick(type: string) {
    if (!org || !activePage) return;
    const maxY = widgets.reduce((m, w) => Math.max(m, (w.position_y || 0) + (w.height || 3)), 0);
    setDefaultPosition({ x: 0, y: maxY, w: 4, h: 3 });
    setDefaultHint(type);
    setShowAddWidget(true);
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="h-full bg-background text-white flex flex-col min-h-0 w-full">
      {/* Top bar */}
      <header className="border-b border-border px-5 py-3 flex items-center gap-3 flex-shrink-0">
        {backUrl ? (
          <Link href={backUrl} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-xs mr-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
            {backLabel || 'Back'}
          </Link>
        ) : (
          <Link href={`/orgs/${slug}/dashboards`} className="text-muted-foreground hover:text-foreground">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
          </Link>
        )}
        <span className="text-base">📊</span>
        <div>
          <h1 className="text-sm font-semibold truncate">{titleOverride || (dashboard?.name as string) || ''}</h1>
          {subtitleOverride && <p className="text-[10px] text-muted-foreground">{subtitleOverride}</p>}
        </div>
        {!!dashboard?.is_published && (
          <span className="text-xs px-2 py-0.5 bg-success/10 border border-success/20 text-success rounded-full">Published</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowVersions(true)}
            className="px-3 py-1.5 bg-muted/50 border border-border hover:bg-white/10 rounded-xl text-xs text-foreground transition-colors">
            🕒 History
          </button>
          <button onClick={() => setIsEditing(e => !e)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${isEditing ? 'bg-primary/30 border-primary text-primary' : 'bg-muted/50 border-border text-muted-foreground hover:bg-white/10'}`}>
            {isEditing ? '✏️ Editing' : '✏️ Edit Layout'}
          </button>
          <button onClick={async () => {
            await handleSave();
            const msg = window.prompt('Commit message for this version:');
            if (msg !== null) {
              dashboardApi.saveVersion(String(org?.id), dashId, msg || undefined)
                .then(res => setVersions(vs => [res.version, ...vs]))
                .catch(console.error);
            }
          }} disabled={saving}
            className="px-3 py-1.5 bg-muted/50 border border-border hover:bg-white/10 rounded-xl text-xs text-foreground disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : '💾 Save & Commit'}
          </button>
        </div>
      </header>

      {/* Page tabs */}
      <div className="border-b border-border px-5 flex items-center gap-1 flex-shrink-0 bg-black/20">
        {pages.map((page) => (
          <button key={String(page.id)} onClick={() => switchPage(String(page.id))}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${activePage === page.id ? 'border-primary text-white' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {String(page.name)}
          </button>
        ))}
        {isEditing && (
          <button onClick={addPage} className="px-3 py-2.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors border-b-2 border-transparent">
            + Page
          </button>
        )}
      </div>

      {/* Edit mode indicator */}
      {isEditing && (
        <div className="bg-primary/10 border-b border-primary/20 px-5 py-1.5 flex items-center gap-2 flex-shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <p className="text-xs text-primary">Drag to reposition · Resize from corners · Click × to remove</p>
        </div>
      )}

      {/* Filter Bar */}
      <div className="border-b border-border px-5 py-2 flex items-center gap-3 flex-shrink-0 bg-[#0f0f14]">
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
          Filters
        </div>
        {filters.length === 0 && !isEditing ? (
          <span className="text-xs text-muted-foreground/60">No active filters</span>
        ) : (
          filters.map(f => (
            <div key={f.id} className="flex items-center gap-1.5 bg-muted/50 border border-border rounded-lg px-2.5 py-1 text-xs">
              <span className="text-muted-foreground">{f.name}:</span>
              <span className="text-white font-medium">{f.default_value || 'All'}</span>
              {isEditing && (
                <button onClick={() => {
                  dashboardApi.removeFilter(String(org?.id), dashId, f.id).then(() => setFilters(fs => fs.filter(x => x.id !== f.id)));
                }} className="ml-1 text-muted-foreground hover:text-red-400">×</button>
              )}
            </div>
          ))
        )}
        {isEditing && (
          <button onClick={() => {
            const name = window.prompt('Filter Name (e.g. Date Range):');
            if (!name) return;
            dashboardApi.addFilter(String(org?.id), dashId, { name, filterType: 'text', operator: '=', defaultValue: '' })
              .then(res => setFilters(fs => [...fs, res.filter]));
          }} className="px-2 py-1 text-xs border border-dashed border-white/20 text-muted-foreground rounded-lg hover:bg-muted/50 hover:text-white transition-colors">
            + Add Filter
          </button>
        )}
      </div>
      {isEditing && (
        <div className="bg-primary/10 border-b border-primary/20 px-5 py-1.5 flex items-center gap-2 flex-shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <p className="text-xs text-primary">Drag to reposition · Resize from corners · Click × to remove</p>
        </div>
      )}

      {/* Canvas and Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto bg-[#0f0f14] p-4" ref={containerRef}>
        {widgets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center min-h-[400px]">
            <div className="text-5xl">📊</div>
            <div>
              <p className="text-foreground font-medium mb-1">Empty page</p>
              <p className="text-muted-foreground text-sm">
                {isEditing ? 'Click "Add Widget" to add your first chart or metric' : 'Click "Edit Layout" to start adding widgets'}
              </p>
            </div>
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
            dragConfig={{ enabled: isEditing, handle: '.drag-handle' }}
            resizeConfig={{ enabled: isEditing }}
            dropConfig={{ enabled: isEditing }}
            onDrop={async (_layout: any, item: any, e: Event) => {
              const hint = (window as any).__draggedWidgetHint || (e as unknown as DragEvent).dataTransfer?.getData('text/plain');
              if (hint && item) {
                if (hint.startsWith('{')) {
                  const data = JSON.parse(hint);
                  if (data.type === 'card' && org) {
                    try {
                      const res = await dashboardApi.addWidget(String(org.id), dashId, activePage!, {
                        title: data.title,
                        widget_type: data.chartType === 'data_table' ? 'table' : (data.chartType || 'table'),
                        cardId: data.cardId,
                        gridX: item.x,
                        gridY: item.y,
                        gridW: 4,
                        gridH: 3,
                        datasourceScopeType: 'connection', // placeholder
                        uiHint: data.chartType,
                      });
                      
                      // Format the returned widget from API to WidgetData structure
                      const rawWidget = res.widget;
                      const qd = rawWidget.query_definition || {};
                      const newWidgetData = {
                        id: String(rawWidget.id),
                        title: String(rawWidget.title || ''),
                        widget_type: String(rawWidget.widget_type || 'table'),
                        query_prompt: String(qd.prompt || rawWidget.query_prompt || ''),
                        position_x: Number(rawWidget.grid_x ?? rawWidget.position_x) || 0,
                        position_y: Number(rawWidget.grid_y ?? rawWidget.position_y) || 0,
                        width: Number(rawWidget.grid_w ?? rawWidget.width) || 4,
                        height: Number(rawWidget.grid_h ?? rawWidget.height) || 3,
                        result_rows: (qd.result_rows || rawWidget.result_rows || []),
                        result_columns: (qd.result_columns || rawWidget.result_columns || []),
                        ui_hint: String(qd.ui_hint || rawWidget.ui_hint || rawWidget.widget_type || 'table'),
                      };
                      
                      setWidgets(prev => [...prev, newWidgetData]);
                    } catch (err) {
                      console.error('Failed to add widget from card', err);
                    }
                  }
                } else {
                  setDefaultPosition({ x: item.x, y: item.y, w: 4, h: 3 });
                  setDefaultHint(hint);
                  setShowAddWidget(true);
                }
              }
              (window as any).__draggedWidgetHint = null;
            }}
            droppingItem={{ i: '__dropping-elem__', w: 4, h: 3, x: 0, y: 0 } as LayoutItem}
            onLayoutChange={(newLayout: any) => {
              setWidgets(ws => ws.map(w => {
                const item = newLayout.find((l: any) => l.i === w.id);
                if (item) return { ...w, position_x: item.x, position_y: item.y, width: item.w, height: item.h };
                return w;
              }));
            }}
          >
            {widgets.map(widget => (
              <div key={widget.id} className="relative h-full">
                {isEditing && (
                  <div className="drag-handle absolute top-0 left-0 right-0 h-8 z-20 flex items-center justify-center cursor-grab active:cursor-grabbing">
                    <div className="w-8 h-1 bg-primary/40 rounded-full" />
                  </div>
                )}
                <Widget
                  widget={widget}
                  onRemove={() => removeWidget(widget.id)}
                  onInspect={() => setInspectWidgetId(widget.id)}
                  isEditing={isEditing}
                />
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
        </div>
        {isEditing && <WidgetSidebar orgId={String(org?.id)} onCardClick={handleCardClick} onTemplateClick={handleTemplateClick} />}
        {showVersions && (
          <div className="w-64 bg-card border-l border-border flex flex-col flex-shrink-0 h-full overflow-hidden">
            <div className="p-4 border-b border-border flex justify-between items-center">
              <div>
                <h3 className="text-sm font-semibold text-white">Version History</h3>
                <p className="text-xs text-muted-foreground">View and restore versions</p>
              </div>
              <button onClick={() => setShowVersions(false)} className="text-muted-foreground hover:text-white">×</button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-2">
              {versions.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center mt-4">No versions saved yet.</p>
              ) : (
                versions.map(v => (
                  <div key={v.id} className="p-3 bg-muted/50 border border-border rounded-xl hover:bg-white/10 transition-colors">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-xs font-semibold text-white">v{v.version}</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(v.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-xs text-foreground mb-2">{v.commit_message}</p>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-muted-foreground">{v.created_by_email || 'System'}</span>
                      <button onClick={() => alert('Restore functionality coming soon!')} className="text-[10px] text-primary hover:opacity-80 font-medium">Restore</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {showAddWidget && org && activePage && (
        <AddWidgetDialog
          orgId={String(org.id)}
          dashId={dashId}
          pageId={activePage}
          chatId={activeChatId}
          connectionId={dashboard?.connection_id as string | undefined}
          onChatCreated={setActiveChatId}
          defaultHint={defaultHint}
          defaultPosition={defaultPosition || undefined}
          onAdd={handleWidgetAdded}
          onClose={() => setShowAddWidget(false)}
        />
      )}

      {inspectWidgetId && (
        <QueryInspectorModal
          widgetId={inspectWidgetId}
          orgId={String(org?.id)}
          dashId={dashId}
          pageId={activePage!}
          onClose={() => { setInspectWidgetId(null); setInspectData(null); }}
        />
      )}
    </div>
  );
}

function QueryInspectorModal({ widgetId, orgId, dashId, pageId, onClose }: { widgetId: string, orgId: string, dashId: string, pageId: string, onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi.inspect(orgId, dashId, pageId, widgetId)
      .then(res => setData(res.execution))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [widgetId, orgId, dashId, pageId]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#14141d] border border-border rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-muted/20">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <span className="text-primary">🔍</span> Query Inspector
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg text-muted-foreground transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        
        <div className="p-5 flex-1 overflow-auto min-h-[300px]">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : data ? (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-muted/50 rounded-xl p-4 border border-white/5">
                  <p className="text-xs text-muted-foreground mb-1">Status</p>
                  <p className={`font-semibold ${data.status === 'success' ? 'text-success' : 'text-red-400'}`}>{data.status}</p>
                </div>
                <div className="bg-muted/50 rounded-xl p-4 border border-white/5">
                  <p className="text-xs text-muted-foreground mb-1">Duration</p>
                  <p className="font-semibold text-white">{data.duration_ms}ms {data.cached && <span className="text-xs text-amber-400 ml-1">(Cached)</span>}</p>
                </div>
                <div className="bg-muted/50 rounded-xl p-4 border border-white/5">
                  <p className="text-xs text-muted-foreground mb-1">Rows Returned</p>
                  <p className="font-semibold text-white">{data.rows_returned}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-foreground mb-2">Executed SQL</p>
                <div className="bg-black/50 p-4 rounded-xl border border-white/5 font-mono text-[11px] text-emerald-300 whitespace-pre-wrap overflow-x-auto">
                  {data.raw_query || 'No SQL generated'}
                </div>
              </div>

              {data.error && (
                <div>
                  <p className="text-xs font-semibold text-foreground mb-2">Error</p>
                  <div className="bg-red-500/10 p-4 rounded-xl border border-red-500/20 text-xs text-red-400 font-mono">
                    {data.error}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No execution data found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
