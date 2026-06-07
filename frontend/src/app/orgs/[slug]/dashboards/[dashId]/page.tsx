'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { dashboardApi, chatApi, orgApi } from '@/lib/api';

// ── Widget renderer ────────────────────────────────────────────

interface WidgetData {
  id: string;
  title: string;
  widget_type: string;
  query_prompt: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  result_rows?: any[];
  result_columns?: string[];
  ui_hint?: string;
  isLoading?: boolean;
}

function MetricCardWidget({ data, rows, columns }: { data: WidgetData; rows: any[]; columns: string[] }) {
  const row = rows[0] || {};
  const value = row[columns[0]];
  return (
    <div className="h-full flex flex-col justify-center items-center p-4">
      <p className="text-xs text-zinc-500 mb-2">{data.title}</p>
      <p className="text-4xl font-bold text-white">{typeof value === 'number' ? value.toLocaleString() : String(value ?? 0)}</p>
      {columns[1] && <p className="text-sm text-zinc-400 mt-1">{columns[1]}: {String(row[columns[1]] ?? '')}</p>}
    </div>
  );
}

function TableWidget({ data, rows, columns }: { data: WidgetData; rows: any[]; columns: string[] }) {
  return (
    <div className="h-full flex flex-col">
      <p className="text-xs font-medium text-zinc-400 px-3 py-2 border-b border-white/5 flex-shrink-0">{data.title}</p>
      <div className="flex-1 overflow-auto">
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

function BarChartWidget({ data, rows, columns }: { data: WidgetData; rows: any[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <TableWidget data={data} rows={rows} columns={columns} />;
  const labelCol = columns[0];
  const valueCol = columns[1];
  const maxVal = Math.max(...rows.map(r => Number(r[valueCol]) || 0)) || 1;
  return (
    <div className="h-full flex flex-col px-3 py-2">
      <p className="text-xs font-medium text-zinc-400 mb-2">{data.title}</p>
      <div className="flex-1 overflow-y-auto space-y-1.5">
        {rows.slice(0, 15).map((row, i) => {
          const val = Number(row[valueCol]) || 0;
          const pct = (val / maxVal) * 100;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 w-20 truncate flex-shrink-0">{String(row[labelCol] ?? '')}</span>
              <div className="flex-1 bg-white/5 rounded-full h-4 overflow-hidden">
                <div className="h-full bg-violet-500/70 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-zinc-300 w-12 text-right flex-shrink-0">{val.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LineChartWidget({ data, rows, columns }: { data: WidgetData; rows: any[]; columns: string[] }) {
  if (!rows.length || columns.length < 2) return <TableWidget data={data} rows={rows} columns={columns} />;
  const valueCol = columns[1];
  const labelCol = columns[0];
  const values = rows.map(r => Number(r[valueCol]) || 0);
  const max = Math.max(...values) || 1;
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 300;
  const h = 80;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <div className="h-full flex flex-col px-3 py-2">
      <p className="text-xs font-medium text-zinc-400 mb-2">{data.title}</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="flex-1 w-full" preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke="#8b5cf6" strokeWidth="2" />
        <polyline points={`0,${h} ${pts} ${w},${h}`} fill="rgba(139,92,246,0.1)" stroke="none" />
      </svg>
      <div className="flex justify-between text-xs text-zinc-600 mt-1">
        <span>{String(rows[0]?.[labelCol] ?? '')}</span>
        <span>{String(rows[rows.length - 1]?.[labelCol] ?? '')}</span>
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

  const renderContent = () => {
    if (widget.isLoading) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }
    if (!rows.length && !widget.isLoading) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-xs">
          <span className="text-2xl mb-1">📭</span>
          No data
        </div>
      );
    }
    const hint = widget.ui_hint || 'data_table';
    if (hint === 'metric_card' || hint === 'stat_grid') return <MetricCardWidget data={widget} rows={rows} columns={columns} />;
    if (hint === 'bar_chart' || hint === 'horizontal_bar') return <BarChartWidget data={widget} rows={rows} columns={columns} />;
    if (hint === 'line_chart' || hint === 'area_chart') return <LineChartWidget data={widget} rows={rows} columns={columns} />;
    return <TableWidget data={widget} rows={rows} columns={columns} />;
  };

  return (
    <div className="relative h-full bg-white/[0.04] border border-white/10 rounded-xl overflow-hidden group">
      {isEditing && onRemove && (
        <button onClick={onRemove}
          className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/40">
          ×
        </button>
      )}
      {renderContent()}
    </div>
  );
}

// ── Add Widget Dialog ──────────────────────────────────────────
function AddWidgetDialog({ orgId, dashId, pageId, chatId, onAdd, onClose }: {
  orgId: string; dashId: string; pageId: string; chatId?: string;
  onAdd: (widget: any) => void; onClose: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<any>(null);

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      // Ask the backend to generate a widget from a prompt via chat
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/orgs/${orgId}/chats/${chatId}/ask`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ prompt }),
        }
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
      const widget = await dashboardApi.addWidget(orgId, dashId, pageId, {
        title: title || prompt,
        widget_type: preview.execution?.ui_hint || 'data_table',
        queryPrompt: prompt,
        datasourceScopeType: 'connection',
        resultRows: preview.execution?.rows?.slice(0, 100),
        resultColumns: preview.execution?.columns,
        uiHint: preview.execution?.ui_hint,
      });
      onAdd(widget.widget);
      onClose();
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#111117] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="font-semibold text-sm">Add Widget</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Widget Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g., Monthly Revenue"
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50"/>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Data Query</label>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder="e.g., Show total revenue by month for this year"
              rows={3}
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-none"/>
          </div>

          {!chatId && (
            <p className="text-xs text-amber-400">⚠️ This dashboard has no linked chat. Create a chat for this connection first.</p>
          )}

          <button onClick={handleGenerate} disabled={!prompt.trim() || loading || !chatId}
            className="w-full py-2.5 bg-violet-600/20 border border-violet-500/30 hover:bg-violet-600/30 rounded-xl text-sm text-violet-300 disabled:opacity-40 transition-colors">
            {loading ? 'Generating preview…' : 'Generate Preview'}
          </button>

          {preview?.execution && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <p className="text-xs text-zinc-400 mb-2">
                Preview: {preview.execution?.row_count} rows · {preview.execution?.ui_hint} · {preview.execution?.execution_time_ms}ms
              </p>
              {preview.execution?.columns?.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="text-xs w-full">
                    <thead><tr>{preview.execution.columns.map((c: string) => <th key={c} className="px-2 py-1 text-left text-zinc-500">{c}</th>)}</tr></thead>
                    <tbody>
                      {(preview.execution.rows || []).slice(0, 5).map((row: any, i: number) => (
                        <tr key={i}>{preview.execution.columns.map((c: string) => <td key={c} className="px-2 py-1 text-zinc-300 truncate max-w-[80px]">{String(row[c] ?? '')}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={handleAdd} disabled={!preview || loading}
            className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium disabled:opacity-40 transition-colors">
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
  const [org, setOrg] = useState<any>(null);
  const [dashboard, setDashboard] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [activePage, setActivePage] = useState<string>('');
  const [widgets, setWidgets] = useState<WidgetData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [chatId, setChatId] = useState<string>('');

  useEffect(() => { loadData(); }, [slug, dashId]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const data = await dashboardApi.get(o.id, dashId);
      setDashboard(data.dashboard);
      setPages(data.pages || []);

      const firstPage = data.pages?.[0]?.id;
      if (firstPage) {
        setActivePage(firstPage);
        loadPageWidgets(firstPage, data.dashboard, data.pages);
      }

      // Find a chat linked to this dashboard's connection
      if (data.dashboard?.connection_id) {
        const { chats } = await chatApi.list(o.id, { connectionId: data.dashboard.connection_id });
        if (chats.length > 0) setChatId(chats[0].id);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function loadPageWidgets(pageId: string, dash: any, pgs: any[]) {
    const page = pgs.find((p: any) => p.id === pageId);
    const pageWidgets: WidgetData[] = (page?.widgets || []).map((w: any) => ({
      ...w,
      result_rows: w.result_rows || [],
      result_columns: w.result_columns || [],
    }));
    setWidgets(pageWidgets);
  }

  function switchPage(pageId: string) {
    setActivePage(pageId);
    loadPageWidgets(pageId, dashboard, pages);
  }

  async function addPage() {
    if (!org) return;
    const name = `Page ${pages.length + 1}`;
    try {
      const { page } = await dashboardApi.addPage(org.id, dashId, name);
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
      await dashboardApi.save(org.id, dashId);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  function handleWidgetAdded(widget: any) {
    const newWidget: WidgetData = {
      id: widget.id,
      title: widget.title,
      widget_type: widget.widget_type,
      query_prompt: widget.query_prompt,
      position_x: widget.position_x || 0,
      position_y: widget.position_y || 0,
      width: widget.width || 4,
      height: widget.height || 3,
      result_rows: widget.result_rows || [],
      result_columns: widget.result_columns || [],
      ui_hint: widget.ui_hint,
    };
    setWidgets(ws => [...ws, newWidget]);
  }

  function removeWidget(id: string) {
    setWidgets(ws => ws.filter(w => w.id !== id));
  }

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      {/* Top bar */}
      <header className="border-b border-white/10 px-5 py-3 flex items-center gap-3 flex-shrink-0">
        <Link href={`/orgs/${slug}/dashboards`} className="text-zinc-500 hover:text-zinc-300">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-base">📊</span>
          <h1 className="text-sm font-semibold">{dashboard?.name}</h1>
          {dashboard?.is_published && (
            <span className="text-xs px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full">Published</span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setIsEditing(e => !e)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors
              ${isEditing ? 'bg-violet-600/20 border-violet-500 text-violet-300' : 'bg-white/5 border-white/10 text-zinc-400'}`}>
            {isEditing ? '✏️ Editing' : '✏️ Edit'}
          </button>
          {isEditing && (
            <button onClick={() => setShowAddWidget(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-xs font-medium transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Widget
            </button>
          )}
          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 rounded-xl text-xs text-zinc-300 disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : '💾 Save'}
          </button>
        </div>
      </header>

      {/* Page tabs (PowerBI-style) */}
      <div className="border-b border-white/[0.06] px-5 flex items-center gap-1 flex-shrink-0 bg-black/20">
        {pages.map((page: any) => (
          <button key={page.id} onClick={() => switchPage(page.id)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors
              ${activePage === page.id
                ? 'border-violet-500 text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {page.name}
          </button>
        ))}
        {isEditing && (
          <button onClick={addPage}
            className="px-3 py-2.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors border-b-2 border-transparent">
            + Page
          </button>
        )}
      </div>

      {/* Canvas */}
      <div className="flex-1 p-6 overflow-auto">
        {widgets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="text-5xl">📊</div>
            <div>
              <p className="text-zinc-300 font-medium mb-1">Empty page</p>
              <p className="text-zinc-500 text-sm">
                {isEditing ? 'Click "Add Widget" to add your first chart or metric' : 'Enter edit mode to add widgets'}
              </p>
            </div>
            {isEditing && (
              <button onClick={() => setShowAddWidget(true)}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add Widget
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-4 auto-rows-[80px]">
            {widgets.map(widget => (
              <div key={widget.id}
                style={{
                  gridColumn: `span ${Math.min(widget.width || 4, 12)}`,
                  gridRow: `span ${widget.height || 3}`,
                }}>
                <Widget
                  widget={widget}
                  onRemove={() => removeWidget(widget.id)}
                  isEditing={isEditing}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Widget Dialog */}
      {showAddWidget && org && activePage && (
        <AddWidgetDialog
          orgId={org.id}
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
