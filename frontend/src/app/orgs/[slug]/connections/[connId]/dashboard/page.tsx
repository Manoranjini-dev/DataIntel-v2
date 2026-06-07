'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { orgApi, connectionApi, chatApi, dashboardApi } from '@/lib/api';
import { GridLayout } from 'react-grid-layout';
import type { Layout, LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// ── Widget type palette entries ────────────────────────────────
const WIDGET_TYPES = [
  { id: 'metric_card', icon: '📈', label: 'Metric Card', desc: 'Single KPI value' },
  { id: 'bar_chart', icon: '📊', label: 'Bar Chart', desc: 'Category comparison' },
  { id: 'line_chart', icon: '📉', label: 'Line Chart', desc: 'Trends over time' },
  { id: 'pie_chart', icon: '🥧', label: 'Pie Chart', desc: 'Proportional data' },
  { id: 'area_chart', icon: '〰️', label: 'Area Chart', desc: 'Accumulated trend' },
  { id: 'stat_grid', icon: '🔢', label: 'Stat Grid', desc: 'Multiple KPIs' },
  { id: 'data_table', icon: '📋', label: 'Data Table', desc: 'Tabular data view' },
  { id: 'donut_chart', icon: '🍩', label: 'Donut Chart', desc: 'Ring proportional view' },
  { id: 'stacked_bar', icon: '📶', label: 'Stacked Bar', desc: 'Layered comparison' },
  { id: 'horizontal_bar', icon: '↔️', label: 'Horizontal Bar', desc: 'Side-by-side bars' },
];

// ── Widget renderers ───────────────────────────────────────────
function BarChartWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <EmptyState title={title} />;
  const labelCol = columns[0], valueCol = columns[1];
  const maxVal = Math.max(...rows.map(r => Number(r[valueCol]) || 0)) || 1;
  return (
    <div className="h-full flex flex-col p-3">
      <p className="text-xs font-semibold text-zinc-300 mb-2 truncate">{title}</p>
      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {rows.slice(0, 12).map((row, i) => {
          const val = Number(row[valueCol]) || 0;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 w-16 truncate flex-shrink-0">{String(row[labelCol] ?? '')}</span>
              <div className="flex-1 bg-white/5 rounded-full h-3.5 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-500 to-violet-400 rounded-full" style={{ width: `${(val / maxVal) * 100}%` }} />
              </div>
              <span className="text-[10px] text-zinc-400 w-10 text-right flex-shrink-0">{val.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LineChartWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <EmptyState title={title} />;
  const values = rows.map(r => Number(r[columns[1]]) || 0);
  const max = Math.max(...values) || 1, min = Math.min(...values);
  const range = max - min || 1;
  const W = 280, H = 60;
  const pts = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * W},${H - ((v - min) / range) * H}`).join(' ');
  return (
    <div className="h-full flex flex-col p-3">
      <p className="text-xs font-semibold text-zinc-300 mb-2 truncate">{title}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full flex-1 min-h-0" preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinejoin="round" />
        <polyline points={`0,${H} ${pts} ${W},${H}`} fill="rgba(139,92,246,0.1)" stroke="none" />
      </svg>
    </div>
  );
}

function PieChartWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <EmptyState title={title} />;
  const labelCol = columns[0], valueCol = columns[1];
  const total = rows.reduce((s, r) => s + (Number(r[valueCol]) || 0), 0) || 1;
  const COLORS = ['#8b5cf6', '#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444'];
  let cumulative = 0;
  const slices = rows.slice(0, 6).map((row, i) => {
    const val = Number(row[valueCol]) || 0;
    const start = (cumulative / total) * 360, end = ((cumulative + val) / total) * 360;
    cumulative += val;
    const sr = (start - 90) * Math.PI / 180, er = (end - 90) * Math.PI / 180;
    return { path: `M50,50 L${50 + 40 * Math.cos(sr)},${50 + 40 * Math.sin(sr)} A40,40 0 ${end - start > 180 ? 1 : 0},1 ${50 + 40 * Math.cos(er)},${50 + 40 * Math.sin(er)} Z`, color: COLORS[i % COLORS.length], label: String(row[labelCol] ?? ''), pct: Math.round((val / total) * 100) };
  });
  return (
    <div className="h-full flex items-center gap-3 p-3">
      <svg viewBox="0 0 100 100" className="w-16 h-16 flex-shrink-0">{slices.map((s, i) => <path key={i} d={s.path} fill={s.color} />)}</svg>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-zinc-300 mb-1 truncate">{title}</p>
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-0.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-[10px] text-zinc-400 truncate flex-1">{s.label}</span>
            <span className="text-[10px] text-zinc-500 flex-shrink-0">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  const val = rows[0]?.[columns[0]];
  return (
    <div className="h-full flex flex-col items-center justify-center p-4 text-center">
      <p className="text-[11px] text-zinc-500 mb-1.5">{title}</p>
      <p className="text-3xl font-bold text-white">{typeof val === 'number' ? val.toLocaleString() : String(val ?? '—')}</p>
    </div>
  );
}

function TableWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  return (
    <div className="h-full flex flex-col">
      <p className="text-xs font-semibold text-zinc-300 px-3 py-2 border-b border-white/5 flex-shrink-0 truncate">{title}</p>
      <div className="flex-1 overflow-auto min-h-0">
        <table className="text-xs w-full">
          <thead className="bg-white/5 sticky top-0"><tr>{columns.map(c => <th key={c} className="px-2 py-1.5 text-left text-zinc-500 whitespace-nowrap">{c}</th>)}</tr></thead>
          <tbody>{rows.slice(0, 30).map((row, i) => <tr key={i} className="border-t border-white/[0.04]">{columns.map(c => <td key={c} className="px-2 py-1.5 text-zinc-300 truncate max-w-[100px]">{String(row[c] ?? '')}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-xs gap-1">
      <span className="text-2xl">📭</span>
      <p className="font-medium text-zinc-500">{title || 'No data'}</p>
    </div>
  );
}

function WidgetCard({ widget, onRemove, isEditing, onToggleView }: {
  widget: WidgetData; onRemove: () => void; isEditing: boolean;
  onToggleView: () => void;
}) {
  const rows = widget.result_rows || [], columns = widget.result_columns || [];
  const hint = widget.current_view === 'table' ? 'data_table' : (widget.ui_hint || widget.widget_type || 'data_table');
  const hasData = rows.length > 0;

  const content = !hasData ? <EmptyState title={widget.title} /> :
    hint === 'metric_card' || hint === 'stat_grid' ? <MetricWidget title={widget.title} rows={rows} columns={columns} /> :
    hint === 'bar_chart' || hint === 'horizontal_bar' || hint === 'stacked_bar' ? <BarChartWidget title={widget.title} rows={rows} columns={columns} /> :
    hint === 'line_chart' || hint === 'area_chart' ? <LineChartWidget title={widget.title} rows={rows} columns={columns} /> :
    hint === 'pie_chart' || hint === 'donut_chart' ? <PieChartWidget title={widget.title} rows={rows} columns={columns} /> :
    <TableWidget title={widget.title} rows={rows} columns={columns} />;

  return (
    <div className={`relative h-full bg-[#141420] border rounded-xl overflow-hidden transition-all ${isEditing ? 'border-violet-500/40' : 'border-white/10 hover:border-white/20'}`}>
      {isEditing && <div className="drag-handle absolute inset-x-0 top-0 h-6 cursor-grab active:cursor-grabbing z-10 flex items-center justify-center"><div className="w-8 h-1 bg-violet-400/30 rounded-full" /></div>}

      {/* Chart/Table toggle */}
      <div className="absolute top-1.5 left-1.5 z-20 flex gap-0.5">
        <button onClick={onToggleView}
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${widget.current_view !== 'table' ? 'bg-violet-500/20 text-violet-300 border border-violet-500/20' : 'bg-white/5 text-zinc-500 border border-white/10'}`}>
          Chart
        </button>
        <button onClick={onToggleView}
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${widget.current_view === 'table' ? 'bg-violet-500/20 text-violet-300 border border-violet-500/20' : 'bg-white/5 text-zinc-500 border border-white/10'}`}>
          Table
        </button>
      </div>

      {isEditing && (
        <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onRemove(); }}
          className="absolute top-1.5 right-1.5 z-30 w-5 h-5 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 text-xs flex items-center justify-center hover:bg-red-500/40 transition-colors">×</button>
      )}

      <div className="absolute inset-0 pt-7">{content}</div>
    </div>
  );
}

// ── Add Widget Dialog ──────────────────────────────────────────
function AddWidgetDialog({ orgId, chatId, dashId, pageId, widgetType, onAdd, onClose }: {
  orgId: string; chatId: string; dashId: string; pageId: string;
  widgetType: typeof WIDGET_TYPES[0]; onAdd: (w: WidgetData) => void; onClose: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);

  const typePrompts: Record<string, string> = {
    metric_card: 'What total or count do you want to display?',
    bar_chart: 'Compare by category (e.g., revenue by product)',
    line_chart: 'Show trend over time (e.g., orders by month)',
    pie_chart: 'Show distribution (e.g., users by gender)',
    area_chart: 'Accumulated data over time',
    stat_grid: 'Show multiple KPIs side by side',
    data_table: 'Show raw data in a table',
    donut_chart: 'Show proportion as a ring chart',
    stacked_bar: 'Show layered category comparisons',
    horizontal_bar: 'Show side-by-side horizontal bars',
  };

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/orgs/${orgId}/chats/${chatId}/ask`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ prompt }) });
      const data = await r.json();
      setPreview(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleAdd() {
    if (!preview) return;
    setLoading(true);
    try {
      const exec = (preview as any).execution;
      const widget = await dashboardApi.addWidget(orgId, dashId, pageId, {
        title: title || prompt,
        widget_type: widgetType.id,
        queryPrompt: prompt,
        datasourceScopeType: 'connection',
        resultRows: exec?.rows?.slice(0, 100),
        resultColumns: exec?.columns,
        uiHint: exec?.ui_hint || widgetType.id,
      });
      onAdd({
        id: widget.widget.id,
        title: title || prompt,
        widget_type: widgetType.id,
        query_prompt: prompt,
        position_x: 0, position_y: 0,
        width: widgetType.id === 'metric_card' || widgetType.id === 'stat_grid' ? 3 : 4,
        height: widgetType.id === 'metric_card' ? 2 : 3,
        result_rows: exec?.rows?.slice(0, 100) || [],
        result_columns: exec?.columns || [],
        ui_hint: exec?.ui_hint || widgetType.id,
        current_view: 'chart',
      });
      onClose();
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  const exec = preview ? (preview as any).execution : null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#111117] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <span className="text-xl">{widgetType.icon}</span>
          <div>
            <h2 className="font-semibold text-sm text-white">Add {widgetType.label}</h2>
            <p className="text-xs text-zinc-500">{widgetType.desc}</p>
          </div>
          <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Widget Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder={`e.g., ${widgetType.label} - Key Metric`}
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Data Query <span className="text-zinc-600">— {typePrompts[widgetType.id]}</span></label>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2}
              placeholder={`e.g., ${typePrompts[widgetType.id]}`}
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-none" />
          </div>

          <button onClick={handleGenerate} disabled={!prompt.trim() || loading}
            className="w-full py-2.5 bg-violet-600/20 border border-violet-500/30 hover:bg-violet-600/30 rounded-xl text-sm text-violet-300 disabled:opacity-40 transition-colors">
            {loading ? 'Generating…' : 'Generate Preview'}
          </button>

          {exec && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
              <p className="text-xs text-zinc-400">
                <span className="text-emerald-400">✓</span> {exec.row_count} rows · <span className="text-violet-400">{exec.ui_hint}</span> · {exec.execution_time_ms}ms
              </p>
              <div className="overflow-x-auto">
                <table className="text-xs w-full">
                  <thead><tr>{(exec.columns || []).map((c: string) => <th key={c} className="px-2 py-1 text-left text-zinc-500">{c}</th>)}</tr></thead>
                  <tbody>{(exec.rows || []).slice(0, 4).map((row: any, i: number) => <tr key={i}>{(exec.columns || []).map((c: string) => <td key={c} className="px-2 py-1 text-zinc-300 truncate max-w-[80px]">{String(row[c] ?? '')}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={handleAdd} disabled={!preview || loading}
            className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium disabled:opacity-40 transition-colors">Add to Dashboard</button>
          <button onClick={onClose} className="px-4 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-sm text-zinc-400 transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
}

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
  current_view?: 'chart' | 'table';
}

// ── Main Dashboard Page ────────────────────────────────────────
export default function ConnectionDashboardPage() {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();
  const [org, setOrg] = useState<any>(null);
  const [conn, setConn] = useState<any>(null);
  const [chatId, setChatId] = useState<string>('');
  const [dashId, setDashId] = useState<string>('');
  const [pageId, setPageId] = useState<string>('');
  const [widgets, setWidgets] = useState<WidgetData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingType, setAddingType] = useState<typeof WIDGET_TYPES[0] | null>(null);
  const [generating, setGenerating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1000);

  useEffect(() => {
    function measure() { if (containerRef.current) setContainerWidth(containerRef.current.offsetWidth); }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => { loadData(); }, [slug, connId]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const { connection: c } = await connectionApi.get(o.id, connId);
      setConn(c);

      // Find or create a chat for this connection
      const { chats } = await chatApi.list(o.id, { connectionId: connId });
      let cid = chats[0]?.id;
      if (!cid) {
        const { chat } = await chatApi.create(o.id, { connectionId: connId, title: `${c.name} Dashboard Chat` });
        cid = chat.id;
      }
      setChatId(cid);

      // Find or create a dashboard for this connection
      const { dashboards } = await dashboardApi.list(o.id);
      let dash = dashboards.find((d: any) => d.connection_id === connId);
      if (!dash) {
        const { dashboard: newDash } = await dashboardApi.create(o.id, { name: `${c.name} Dashboard`, connectionId: connId });
        dash = newDash;
      }
      setDashId(dash.id);

      // Load dashboard pages and widgets
      const data = await dashboardApi.get(o.id, dash.id);
      const firstPage = data.pages?.[0];
      if (firstPage) {
        setPageId(firstPage.id);
        const pageWidgets: WidgetData[] = (firstPage.widgets || []).map((w: any) => ({
          id: String(w.id),
          title: String(w.title || ''),
          widget_type: String(w.widget_type || 'data_table'),
          query_prompt: String(w.query_prompt || ''),
          position_x: Number(w.position_x) || 0,
          position_y: Number(w.position_y) || 0,
          width: Number(w.width) || 4,
          height: Number(w.height) || 3,
          result_rows: w.result_rows || [],
          result_columns: w.result_columns || [],
          ui_hint: String(w.ui_hint || w.widget_type || 'data_table'),
          current_view: 'chart',
        }));
        setWidgets(pageWidgets);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleRegenerate() {
    setGenerating(true);
    try {
      if (!org || !chatId) return;
      const result = await chatApi.ask(org.id, chatId, 'Regenerate a comprehensive dashboard overview with key metrics, charts, and insights from my data. Include total counts, trends, and distributions.');
      const exec = (result as any).execution;
      if (exec?.rows?.length && exec?.columns?.length && dashId && pageId) {
        const widget = await dashboardApi.addWidget(org.id, dashId, pageId, {
          title: 'Overview',
          widget_type: exec.ui_hint || 'data_table',
          queryPrompt: 'Regenerate dashboard overview',
          resultRows: exec.rows.slice(0, 100),
          resultColumns: exec.columns,
          uiHint: exec.ui_hint || 'data_table',
        });
        const maxY = widgets.reduce((m, w) => Math.max(m, (w.position_y || 0) + (w.height || 3)), 0);
        setWidgets(ws => [...ws, {
          id: widget.widget.id,
          title: 'Overview',
          widget_type: exec.ui_hint || 'data_table',
          query_prompt: 'Regenerate dashboard overview',
          position_x: 0, position_y: maxY,
          width: 8, height: 4,
          result_rows: exec.rows.slice(0, 100),
          result_columns: exec.columns,
          ui_hint: exec.ui_hint,
          current_view: 'chart',
        }]);
      }
    } catch (e) { console.error(e); }
    finally { setGenerating(false); }
  }

  async function handleSave() {
    if (!org) return;
    setSaving(true);
    try { await dashboardApi.save(org.id, dashId); }
    catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  function removeWidget(id: string) { setWidgets(ws => ws.filter(w => w.id !== id)); }

  function toggleWidgetView(id: string) {
    setWidgets(ws => ws.map(w => w.id === id ? { ...w, current_view: w.current_view === 'table' ? 'chart' : 'table' } : w));
  }

  function handleWidgetAdded(widget: WidgetData) {
    const maxY = widgets.reduce((m, w) => Math.max(m, (w.position_y || 0) + (w.height || 3)), 0);
    setWidgets(ws => [...ws, { ...widget, position_y: maxY }]);
  }

  const layout: LayoutItem[] = widgets.map(w => ({
    i: w.id,
    x: w.position_x || 0,
    y: w.position_y || 0,
    w: Math.max(1, w.width || 4),
    h: Math.max(1, w.height || 3),
    minW: 2, minH: 2,
  }));

  const COLS = 12, ROW_HEIGHT = 80;
  const gridCfg = { cols: COLS, rowHeight: ROW_HEIGHT, margin: [12, 12] as readonly [number, number], containerPadding: [0, 0] as readonly [number, number] };

  if (loading) return (
    <div className="h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="h-screen bg-[#0a0a0f] text-white flex overflow-hidden">
      {/* ── Left sidebar ──────────────────────────────── */}
      <aside className="w-44 border-r border-white/[0.08] flex flex-col h-full bg-[#0c0c14] flex-shrink-0">
        <div className="px-3 py-3 border-b border-white/[0.06] flex-shrink-0">
          <Link href={`/orgs/${slug}/connections/${connId}`}
            className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
            Back
          </Link>
          <div>
            <p className="text-xs font-semibold text-white truncate">{conn?.name}</p>
            <p className="text-[10px] text-zinc-500 uppercase">{conn?.connector_type}</p>
          </div>
        </div>
        <nav className="py-2 flex-1">
          {[
            { href: `/orgs/${slug}/connections/${connId}/dashboard`, icon: '📊', label: 'Dashboard', active: true },
            { href: `/orgs/${slug}/connections/${connId}/chat`, icon: '💬', label: 'Chat', active: false },
            { href: `/orgs/${slug}/connections/${connId}/schema`, icon: '📋', label: 'Schema', active: false },
            { href: `/orgs/${slug}/connections/${connId}/settings`, icon: '⚙️', label: 'Settings', active: false },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-2.5 mx-2 px-2.5 py-2 rounded-lg text-xs mb-0.5 transition-all ${item.active ? 'bg-violet-500/15 border border-violet-500/20 text-violet-300' : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'}`}>
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* ── Main Canvas ────────────────────────────────── */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Header */}
        <header className="border-b border-white/[0.08] px-5 py-3 flex items-center gap-3 flex-shrink-0 bg-[#0c0c14]">
          <div>
            <h1 className="text-sm font-semibold text-white">Dashboard</h1>
            <p className="text-xs text-zinc-500">Insights for {conn?.name}</p>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs px-2 py-1 border border-white/10 rounded-lg text-zinc-400 font-mono uppercase">{conn?.connector_type}</span>
            <button onClick={handleRegenerate} disabled={generating || !chatId}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-xs font-medium transition-colors disabled:opacity-50">
              {generating ? <><span className="w-3 h-3 border border-white/60 border-t-transparent rounded-full animate-spin" />Generating…</> : <>🔄 Regenerate</>}
            </button>
            <button onClick={() => setIsEditing(e => !e)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${isEditing ? 'bg-violet-600/30 border-violet-500 text-violet-300' : 'bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10'}`}>
              {isEditing ? '✏️ Editing' : '✏️ Edit'}
            </button>
            <button onClick={handleSave} disabled={saving}
              className="px-3 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 rounded-xl text-xs text-zinc-300 disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : '💾 Save'}
            </button>
          </div>
        </header>

        {isEditing && (
          <div className="bg-violet-600/10 border-b border-violet-500/20 px-5 py-1.5 flex items-center gap-2 flex-shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <p className="text-xs text-violet-400">Drag widgets to rearrange · Resize from corners · Click × to remove · Drag widget types from the right panel</p>
          </div>
        )}

        {/* Canvas area */}
        <div className="flex-1 overflow-auto bg-[#0f0f14] p-4" ref={containerRef}>
          {widgets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center min-h-[400px]">
              <div className="text-5xl">📊</div>
              <div>
                <p className="text-zinc-300 font-medium mb-1">Empty dashboard</p>
                <p className="text-zinc-500 text-sm">Drag widget types from the right panel, or click Regenerate for an auto-generated overview.</p>
              </div>
              <button onClick={handleRegenerate} disabled={generating || !chatId}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                🔄 Auto-Generate Dashboard
              </button>
            </div>
          ) : (
            <GridLayout
              className="layout"
              layout={layout}
              gridConfig={gridCfg}
              width={Math.max(containerWidth - 16, 600)}
              dragConfig={{ enabled: isEditing, handle: '.drag-handle' }}
              resizeConfig={{ enabled: isEditing }}
              onLayoutChange={(newLayout: Layout) => {
                setWidgets(ws => ws.map(w => {
                  const item = newLayout.find((l: LayoutItem) => l.i === w.id);
                  if (item) return { ...w, position_x: item.x, position_y: item.y, width: item.w, height: item.h };
                  return w;
                }));
              }}
            >
              {widgets.map(widget => (
                <div key={widget.id} className="relative h-full">
                  <WidgetCard
                    widget={widget}
                    onRemove={() => removeWidget(widget.id)}
                    isEditing={isEditing}
                    onToggleView={() => toggleWidgetView(widget.id)}
                  />
                </div>
              ))}
            </GridLayout>
          )}
        </div>
      </div>

      {/* ── Right Widget Palette ───────────────────────── */}
      <aside className="w-52 border-l border-white/[0.08] flex flex-col h-full bg-[#0c0c14] flex-shrink-0">
        <div className="px-3 py-3 border-b border-white/[0.06] flex-shrink-0">
          <h2 className="text-xs font-semibold text-white">Widgets</h2>
          <p className="text-[10px] text-zinc-500 mt-0.5">Click to add to dashboard</p>
        </div>
        <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider px-3 pt-2 pb-1">Drag Widgets to Dashboard</p>
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
          {WIDGET_TYPES.map(type => (
            <button key={type.id}
              onClick={() => chatId && dashId && pageId ? setAddingType(type) : null}
              disabled={!chatId || !dashId || !pageId}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 bg-white/[0.03] border border-white/[0.06] rounded-xl hover:bg-white/[0.07] hover:border-violet-500/30 transition-all group text-left disabled:opacity-40">
              <span className="text-lg flex-shrink-0">{type.icon}</span>
              <div>
                <p className="text-xs font-medium text-zinc-300 group-hover:text-white transition-colors">{type.label}</p>
                <p className="text-[10px] text-zinc-600">{type.desc}</p>
              </div>
            </button>
          ))}
        </div>
        <div className="border-t border-white/[0.06] px-3 py-2 flex-shrink-0">
          <Link href={`/orgs/${slug}/connections/${connId}/erd`}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 rounded-lg text-xs text-zinc-400 transition-colors">
            View ERD
          </Link>
        </div>
      </aside>

      {/* Widget type add dialog */}
      {addingType && org && chatId && dashId && pageId && (
        <AddWidgetDialog
          orgId={org.id}
          chatId={chatId}
          dashId={dashId}
          pageId={pageId}
          widgetType={addingType}
          onAdd={handleWidgetAdded}
          onClose={() => setAddingType(null)}
        />
      )}
    </div>
  );
}
