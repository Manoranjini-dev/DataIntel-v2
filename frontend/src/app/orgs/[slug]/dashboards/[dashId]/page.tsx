'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { dashboardApi, chatApi, orgApi } from '@/lib/api';
import { GridLayout } from 'react-grid-layout';
import type { Layout, LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

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

// ── Mini widget renderers ──────────────────────────────────────
function BarChartWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <TableWidget title={title} rows={rows} columns={columns} />;
  const labelCol = columns[0];
  const valueCol = columns[1];
  const maxVal = Math.max(...rows.map(r => Number(r[valueCol]) || 0)) || 1;
  return (
    <div className="h-full flex flex-col px-3 py-2">
      <p className="text-xs font-semibold text-zinc-300 mb-2 truncate">{title}</p>
      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {rows.slice(0, 15).map((row, i) => {
          const val = Number(row[valueCol]) || 0;
          const pct = (val / maxVal) * 100;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-500 w-20 truncate flex-shrink-0">{String(row[labelCol] ?? '')}</span>
              <div className="flex-1 bg-white/5 rounded-full h-4 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-500 to-violet-400 rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[11px] text-zinc-300 w-12 text-right flex-shrink-0">{val.toLocaleString()}</span>
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
      <p className="text-xs font-semibold text-zinc-300 mb-2 truncate">{title}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full flex-1 min-h-0" preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinejoin="round" />
        <polyline points={`0,${H} ${pts} ${W},${H}`} fill="rgba(139,92,246,0.12)" stroke="none" />
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
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
        <p className="text-xs font-semibold text-zinc-300 truncate mb-1">{title}</p>
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
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
  const row = rows[0] || {};
  const value = row[columns[0]];
  return (
    <div className="h-full flex flex-col justify-center items-center p-4">
      <p className="text-[11px] text-zinc-500 mb-2 text-center">{title}</p>
      <p className="text-4xl font-bold text-white tracking-tight">
        {typeof value === 'number' ? value.toLocaleString() : String(value ?? '—')}
      </p>
      {columns[1] && <p className="text-xs text-zinc-500 mt-1">{String(row[columns[1]] ?? '')}</p>}
    </div>
  );
}

function TableWidget({ title, rows, columns }: { title: string; rows: Record<string, unknown>[]; columns: string[] }) {
  return (
    <div className="h-full flex flex-col">
      <p className="text-xs font-semibold text-zinc-300 px-3 py-2 border-b border-white/5 flex-shrink-0 truncate">{title}</p>
      <div className="flex-1 overflow-auto min-h-0">
        <table className="text-xs w-full">
          <thead className="bg-white/5 sticky top-0">
            <tr>{columns.map(c => <th key={c} className="px-2 py-1.5 text-left text-zinc-500 whitespace-nowrap">{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((row, i) => (
              <tr key={i} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                {columns.map(c => (
                  <td key={c} className="px-2 py-1.5 text-zinc-300 whitespace-nowrap max-w-[120px] truncate">
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

function Widget({ widget, onRemove, isEditing }: {
  widget: WidgetData;
  onRemove?: () => void;
  isEditing: boolean;
}) {
  const rows = widget.result_rows || [];
  const columns = widget.result_columns || [];
  const hint = widget.ui_hint || widget.widget_type || 'data_table';

  const renderContent = () => {
    if (widget.isLoading) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }
    if (!rows.length) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-xs gap-1">
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
    <div className={`relative h-full bg-[#141420] border rounded-xl overflow-hidden transition-all ${isEditing ? 'border-violet-500/40 cursor-grab active:cursor-grabbing' : 'border-white/10 hover:border-white/20'}`}>
      {isEditing && (
        <div className="absolute inset-0 bg-violet-500/5 pointer-events-none z-0 rounded-xl" />
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
      <div className="relative z-10 h-full">
        {renderContent()}
      </div>
    </div>
  );
}

// ── Add Widget Dialog ──────────────────────────────────────────
function AddWidgetDialog({ orgId, dashId, pageId, chatId, onAdd, onClose }: {
  orgId: string; dashId: string; pageId: string; chatId?: string;
  onAdd: (widget: WidgetData) => void; onClose: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);

  async function handleGenerate() {
    if (!prompt.trim() || !chatId) return;
    setLoading(true);
    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/orgs/${orgId}/chats/${chatId}/ask`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ prompt }) }
      );
      const data = await r.json();
      setPreview(data);
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
        widget_type: String(exec?.ui_hint || 'data_table'),
        queryPrompt: prompt,
        datasourceScopeType: 'connection',
        resultRows: (exec?.rows as Record<string, unknown>[])?.slice(0, 100),
        resultColumns: exec?.columns as string[],
        uiHint: String(exec?.ui_hint || 'data_table'),
      });
      onAdd({
        id: widget.widget.id,
        title: widget.widget.title,
        widget_type: widget.widget.widget_type,
        query_prompt: widget.widget.query_prompt,
        position_x: 0,
        position_y: 0,
        width: widget.widget.width || 4,
        height: widget.widget.height || 3,
        result_rows: (exec?.rows as Record<string, unknown>[])?.slice(0, 100) || [],
        result_columns: exec?.columns as string[] || [],
        ui_hint: String(exec?.ui_hint || 'data_table'),
      });
      onClose();
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  const execPreview = preview ? (preview as Record<string, unknown>).execution as Record<string, unknown> : null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#111117] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm text-white">Add Widget</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Widget Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g., Monthly Revenue"
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Data Query</label>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder="e.g., Show total revenue by month"
              rows={3}
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-none" />
          </div>

          {!chatId && (
            <p className="text-xs text-amber-400/80 bg-amber-400/5 border border-amber-400/20 rounded-xl px-3 py-2">
              ⚠️ No linked chat found. Create a chat for this connection first.
            </p>
          )}

          <button onClick={handleGenerate} disabled={!prompt.trim() || loading || !chatId}
            className="w-full py-2.5 bg-violet-600/20 border border-violet-500/30 hover:bg-violet-600/30 rounded-xl text-sm text-violet-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">
            {loading ? 'Generating…' : 'Generate Preview'}
          </button>

          {execPreview && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
              <p className="text-xs text-zinc-400">
                <span className="text-emerald-400">✓</span> {String(execPreview.row_count)} rows · chart type: <span className="text-violet-400">{String(execPreview.ui_hint)}</span>
              </p>
              <div className="overflow-x-auto rounded-lg">
                <table className="text-xs w-full">
                  <thead><tr>{(execPreview.columns as string[] || []).map((c: string) => <th key={c} className="px-2 py-1 text-left text-zinc-500">{c}</th>)}</tr></thead>
                  <tbody>
                    {((execPreview.rows as Record<string, unknown>[] || []).slice(0, 5)).map((row, i) => (
                      <tr key={i}>{(execPreview.columns as string[]).map((c: string) => <td key={c} className="px-2 py-1 text-zinc-300 truncate max-w-[80px]">{String(row[c] ?? '')}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={handleAdd} disabled={!preview || loading}
            className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Add to Dashboard
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-sm text-zinc-400 transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard Editor ─────────────────────────────────────
export default function DashboardEditorPage() {
  const { slug, dashId } = useParams<{ slug: string; dashId: string }>();
  const [org, setOrg] = useState<Record<string, unknown> | null>(null);
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null);
  const [pages, setPages] = useState<Record<string, unknown>[]>([]);
  const [activePage, setActivePage] = useState<string>('');
  const [widgets, setWidgets] = useState<WidgetData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [chatId, setChatId] = useState<string>('');
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

  useEffect(() => { loadData(); }, [slug, dashId]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o as Record<string, unknown>);
      const data = await dashboardApi.get(o.id, dashId);
      setDashboard(data.dashboard);
      setPages(data.pages || []);

      const firstPage = data.pages?.[0]?.id;
      if (firstPage) {
        setActivePage(firstPage);
        buildWidgets(data.pages[0]);
      }

      if (data.dashboard?.connection_id) {
        const { chats } = await chatApi.list(o.id, { connectionId: data.dashboard.connection_id });
        if (chats.length > 0) setChatId(chats[0].id);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function buildWidgets(page: Record<string, unknown>) {
    const pageWidgets: WidgetData[] = ((page?.widgets as Record<string, unknown>[]) || []).map((w) => ({
      id: String(w.id),
      title: String(w.title || ''),
      widget_type: String(w.widget_type || 'data_table'),
      query_prompt: String(w.query_prompt || ''),
      position_x: Number(w.position_x) || 0,
      position_y: Number(w.position_y) || 0,
      width: Number(w.width) || 4,
      height: Number(w.height) || 3,
      result_rows: (w.result_rows as Record<string, unknown>[]) || [],
      result_columns: (w.result_columns as string[]) || [],
      ui_hint: String(w.ui_hint || w.widget_type || 'data_table'),
    }));
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
      await dashboardApi.save(String(org.id), dashId);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  function handleWidgetAdded(widget: WidgetData) {
    // Place new widget after existing ones
    const maxY = widgets.reduce((m, w) => Math.max(m, (w.position_y || 0) + (w.height || 3)), 0);
    setWidgets(ws => [...ws, { ...widget, position_y: maxY }]);
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
  const gridCfg = { cols: COLS, rowHeight: ROW_HEIGHT, margin: MARGIN, containerPadding: [0, 0] as readonly [number, number] };

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="h-screen bg-[#0a0a0f] text-white flex flex-col">
      {/* Top bar */}
      <header className="border-b border-white/10 px-5 py-3 flex items-center gap-3 flex-shrink-0">
        <Link href={`/orgs/${slug}/dashboards`} className="text-zinc-500 hover:text-zinc-300">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
        </Link>
        <span className="text-base">📊</span>
        <h1 className="text-sm font-semibold truncate">{dashboard?.name as string || ''}</h1>
        {!!dashboard?.is_published && (
          <span className="text-xs px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full">Published</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setIsEditing(e => !e)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${isEditing ? 'bg-violet-600/30 border-violet-500 text-violet-300' : 'bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10'}`}>
            {isEditing ? '✏️ Editing' : '✏️ Edit Layout'}
          </button>
          {isEditing && (
            <button onClick={() => setShowAddWidget(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-xs font-medium transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add Widget
            </button>
          )}
          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 rounded-xl text-xs text-zinc-300 disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : '💾 Save'}
          </button>
        </div>
      </header>

      {/* Page tabs */}
      <div className="border-b border-white/[0.06] px-5 flex items-center gap-1 flex-shrink-0 bg-black/20">
        {pages.map((page) => (
          <button key={String(page.id)} onClick={() => switchPage(String(page.id))}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${activePage === page.id ? 'border-violet-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {String(page.name)}
          </button>
        ))}
        {isEditing && (
          <button onClick={addPage} className="px-3 py-2.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors border-b-2 border-transparent">
            + Page
          </button>
        )}
      </div>

      {/* Edit mode indicator */}
      {isEditing && (
        <div className="bg-violet-600/10 border-b border-violet-500/20 px-5 py-1.5 flex items-center gap-2 flex-shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
          <p className="text-xs text-violet-400">Drag to reposition · Resize from corners · Click × to remove</p>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 overflow-auto bg-[#0f0f14] p-4" ref={containerRef}>
        {widgets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center min-h-[400px]">
            <div className="text-5xl">📊</div>
            <div>
              <p className="text-zinc-300 font-medium mb-1">Empty page</p>
              <p className="text-zinc-500 text-sm">
                {isEditing ? 'Click "Add Widget" to add your first chart or metric' : 'Click "Edit Layout" to start adding widgets'}
              </p>
            </div>
            {isEditing && (
              <button onClick={() => setShowAddWidget(true)}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Add Widget
              </button>
            )}
          </div>
        ) : (
          <GridLayout
            className="layout"
            layout={layout}
            gridConfig={gridCfg}
            width={containerWidth > 32 ? containerWidth - 32 : 1200}
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
              <div key={widget.id} className="h-full">
                {isEditing && (
                  <div className="drag-handle absolute top-0 left-0 right-0 h-8 z-20 flex items-center justify-center cursor-grab active:cursor-grabbing">
                    <div className="w-8 h-1 bg-violet-400/40 rounded-full" />
                  </div>
                )}
                <Widget
                  widget={widget}
                  onRemove={() => removeWidget(widget.id)}
                  isEditing={isEditing}
                />
              </div>
            ))}
          </GridLayout>
        )}
      </div>

      {showAddWidget && org && activePage && (
        <AddWidgetDialog
          orgId={String(org.id)}
          dashId={dashId}
          pageId={activePage}
          chatId={chatId}
          onAdd={handleWidgetAdded}
          onClose={() => setShowAddWidget(false)}
        />
      )}
    </div>
  );
}
