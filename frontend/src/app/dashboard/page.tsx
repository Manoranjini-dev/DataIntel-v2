'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import {
  DndContext,
  DragOverlay,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { ResponsiveGridLayout, type LayoutItem } from 'react-grid-layout';
import {
  Zap,
  MessageSquare,
  Settings,
  LogOut,
  Loader2,
  RefreshCw,
  Database,
  Table2,
  LayoutDashboard,
  AlertTriangle,
  Network as NetworkIcon,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Search,
  Download,
  GripHorizontal,
  Pencil,
  Camera,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSession } from '@/hooks/use-session';
import { useDashboard } from '@/hooks/use-dashboard';
import { getDashboardState } from '@/lib/store';
import {
  getDashboardWidgets,
  executeDashboardWidget,
  disconnect as disconnectApi,
  connect as connectApi,
  getConnectionStatus,
} from '@/lib/api';
import { loadParams } from '@/lib/storage';
import type { PaletteItem } from '@/components/dashboard/widget-palette';
import type { ConnectorType, DashboardWidgetResult, UIHint } from '@/lib/types';
import { getConnectorFamily } from '@/lib/types';

const GenerativeUIRenderer = dynamic(
  () => import('@/components/generative-ui').then((m) => m.GenerativeUIRenderer),
  {
    ssr: false,
    loading: () => <div className="h-44 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />,
  },
);

const WidgetPalette = dynamic(
  () => import('@/components/dashboard/widget-palette').then((m) => m.WidgetPalette),
  {
    ssr: false,
    loading: () => <div className="h-72 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />,
  },
);

const WidgetPromptDialog = dynamic(
  () => import('@/components/dashboard/widget-prompt-dialog').then((m) => m.WidgetPromptDialog),
  { ssr: false },
);

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

let widgetCounter = 0;
function nextWidgetId(): string {
  return `widget-${Date.now()}-${++widgetCounter}`;
}

function sizeToGrid(size: 'sm' | 'md' | 'lg', uiHint?: string): { w: number; h: number; minW: number; minH: number; maxW?: number; maxH?: number } {
  const metrics = ['metric_card', 'gauge', 'number_trend', 'comparison_card'];
  const wideCharts = ['data_table', 'timeline', 'heatmap', 'stacked_bar', 'horizontal_bar'];
  const isMetric = uiHint && metrics.includes(uiHint);
  const isWide = uiHint && wideCharts.includes(uiHint);

  if (isMetric) {
    switch (size) {
      case 'sm': return { w: 3, h: 3, minW: 2, minH: 2, maxW: 4 };
      case 'lg': return { w: 4, h: 4, minW: 3, minH: 3, maxW: 6 };
      default:  return { w: 3, h: 3, minW: 2, minH: 2, maxW: 5 };
    }
  }
  if (isWide) {
    switch (size) {
      case 'sm': return { w: 6, h: 5, minW: 4, minH: 3 };
      case 'lg': return { w: 12, h: 7, minW: 6, minH: 4 };
      default:  return { w: 8, h: 5, minW: 4, minH: 3 };
    }
  }
  switch (size) {
    case 'sm': return { w: 4, h: 4, minW: 3, minH: 3 };
    case 'lg': return { w: 12, h: 7, minW: 6, minH: 4 };
    default:  return { w: 6, h: 5, minW: 3, minH: 3 };
  }
}

export default function DashboardPage() {
  const router = useRouter();
  const {
    sessionId,
    connection,
    tables,
    isConnected,
    disconnect,
    connect: setConnected,
  } = useSession();

  const dashboard = useDashboard();

  const [isMounted, setIsMounted] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tablesExpanded, setTablesExpanded] = useState(true);

  useEffect(() => {
    setIsMounted(true);
  }, []);
  const [pendingDrop, setPendingDrop] = useState<PaletteItem | null>(null);
  const [activeDragItem, setActiveDragItem] = useState<PaletteItem | null>(null);
  const [searchTables, setSearchTables] = useState('');
  const [editingWidget, setEditingWidget] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const widgetRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const contentRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Session verification
  useEffect(() => {
    if (!sessionId) { router.push('/connect'); return; }
    (async () => {
      try {
        const status = await getConnectionStatus(sessionId);
        if (!status.connected) {
          const params = loadParams();
          if (params) {
            try { const result = await connectApi(params); setConnected(result); }
            catch { disconnect(); router.push('/connect'); }
          } else { disconnect(); router.push('/connect'); }
        }
      } catch { disconnect(); router.push('/connect'); }
      finally { /* session verified in background */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isConnected && sessionId && !initialized.current) {
      initialized.current = true;
      // If we already have widgets in the in-memory store (from chat or previous visit), skip regeneration
      if (dashboard.widgets.length > 0) return;
      generateDashboard();
    }
  }, [isConnected, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Build layout from widget results (bin-packing) ── */
  const buildLayoutForWidgets = useCallback((widgets: DashboardWidgetResult[]): LayoutItem[] => {
    const cols = 12;
    const colHeights = new Array(cols).fill(0);

    return widgets.map((w) => {
      const grid = sizeToGrid(w.size, w.ui_hint);
      const gw = Math.min(grid.w, cols);
      const gh = grid.h;

      let bestX = 0;
      let bestY = Infinity;
      for (let startCol = 0; startCol <= cols - gw; startCol++) {
        let maxH = 0;
        for (let c = startCol; c < startCol + gw; c++) {
          maxH = Math.max(maxH, colHeights[c]);
        }
        if (maxH < bestY) {
          bestY = maxH;
          bestX = startCol;
        }
      }

      for (let c = bestX; c < bestX + gw; c++) {
        colHeights[c] = bestY + gh;
      }

      const item: LayoutItem = { i: w.id, x: bestX, y: bestY, w: gw, h: gh, minW: grid.minW, minH: grid.minH };
      return item;
    });
  }, []);

  const generateDashboard = useCallback(async () => {
    if (!sessionId || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    try {
      const { widgets } = await getDashboardWidgets(sessionId);
      const initial: DashboardWidgetResult[] = widgets.map((w) => ({ ...w, loading: true }));
      let currentWidgets = initial;
      dashboard.setWidgets(currentWidgets);
      dashboard.setLayouts(buildLayoutForWidgets(initial));
      const batchSize = 3;
      for (let i = 0; i < widgets.length; i += batchSize) {
        const batch = widgets.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map((w) => executeDashboardWidget(sessionId, w.prompt)),
        );
        const updated = [...currentWidgets];
        results.forEach((result, j) => {
          const idx = i + j;
          if (idx < updated.length) {
            if (result.status === 'fulfilled') {
              if (!result.value.sql) {
                updated[idx] = { ...updated[idx], loading: false, error: result.value.explanation || 'Query generation failed' };
              } else {
                updated[idx] = { ...updated[idx], loading: false, execution: result.value, ui_hint: updated[idx].ui_hint || result.value.ui_hint };
              }
            } else {
              updated[idx] = { ...updated[idx], loading: false, error: result.reason?.message || 'Widget failed' };
            }
          }
        });
        currentWidgets = updated;
        dashboard.setWidgets(currentWidgets);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate dashboard');
    } finally { setIsGenerating(false); }
  }, [sessionId, isGenerating, buildLayoutForWidgets, dashboard]);

  const addWidget = useCallback(async (prompt: string, uiHint: UIHint, size: 'sm' | 'md' | 'lg') => {
    if (!sessionId) return;
    const id = nextWidgetId();
    const newWidget: DashboardWidgetResult = { id, title: prompt.slice(0, 40), prompt, ui_hint: uiHint, size, loading: true };
    const { w, h, minW, minH } = sizeToGrid(size, uiHint);
    dashboard.addWidget(newWidget, { i: id, x: 0, y: Infinity, w, h, minW, minH });
    try {
      const execution = await executeDashboardWidget(sessionId, prompt);
      const currentWidgets = getDashboardState().widgets;
      if (!execution.sql) {
        dashboard.setWidgets(
          currentWidgets.map((ww) => ww.id === id ? { ...ww, loading: false, error: execution.explanation || 'Query generation failed' } : ww),
        );
      } else {
        dashboard.setWidgets(
          currentWidgets.map((ww) => ww.id === id ? { ...ww, loading: false, execution, title: prompt.slice(0, 40), ui_hint: uiHint || execution.ui_hint } : ww),
        );
      }
    } catch (err) {
      const currentWidgets = getDashboardState().widgets;
      dashboard.setWidgets(
        currentWidgets.map((ww) => ww.id === id ? { ...ww, loading: false, error: err instanceof Error ? err.message : 'Failed' } : ww),
      );
    }
  }, [sessionId, dashboard]);

  const removeWidget = useCallback((id: string) => {
    dashboard.removeWidget(id);
  }, [dashboard]);

  const downloadWidget = useCallback(async (id: string, title: string) => {
    const el = widgetRefs.current[id];
    if (!el) return;
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(el, { backgroundColor: '#09090b', pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
      link.href = dataUrl;
      link.click();
    } catch { /* noop */ }
  }, []);

  const downloadDashboard = useCallback(async () => {
    const el = contentRef.current;
    if (!el || isDownloading) return;
    setIsDownloading(true);
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(el, {
        backgroundColor: '#09090b',
        pixelRatio: 2,
        width: el.offsetWidth,
        height: el.scrollHeight,
        style: { overflow: 'visible', height: `${el.scrollHeight}px` },
      });
      const link = document.createElement('a');
      link.download = `dashboard_${connection?.database || 'export'}_${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    } catch { /* noop */ }
    finally { setIsDownloading(false); }
  }, [isDownloading, connection?.database]);

  const handleLayoutChange = useCallback((newLayout: LayoutItem[]) => {
    dashboard.setLayouts(newLayout);
  }, [dashboard]);

  const handleDisconnect = useCallback(async () => {
    if (sessionId) await disconnectApi(sessionId).catch(() => {});
    disconnect();
    router.push('/connect');
  }, [sessionId, disconnect, router]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.paletteItem) setActiveDragItem(data.paletteItem as PaletteItem);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragItem(null);
    const { active, over } = event;
    if (over?.id === 'dashboard-drop-zone' && active.data.current?.paletteItem) {
      setPendingDrop(active.data.current.paletteItem as PaletteItem);
    }
  }, []);

  const handleSaveTitle = useCallback((id: string) => {
    dashboard.setWidgets(
      dashboard.widgets.map((w) => w.id === id ? { ...w, title: editTitle } : w),
    );
    setEditingWidget(null);
  }, [editTitle, dashboard]);

  if (!isMounted || !isConnected) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  const connectorFamily = connection?.connectorType ? getConnectorFamily(connection.connectorType as ConnectorType) : 'sql';
  const isES = connectorFamily === 'elasticsearch';
  const filteredTables = tables.filter((t) => t.name.toLowerCase().includes(searchTables.toLowerCase()));

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-screen overflow-hidden bg-zinc-950">
        {/* Left Sidebar */}
        <aside className="hidden w-56 flex-col border-r border-zinc-800/60 bg-zinc-950 lg:flex">
          <div className="border-b border-zinc-800/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
                <Zap className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">DataIntel</p>
                <p className="truncate text-[10px] text-zinc-500">{connection?.database}@{connection?.host}</p>
              </div>
            </div>
          </div>

          <nav className="border-b border-zinc-800/60 px-2 py-2 space-y-0.5">
            <button className="flex w-full items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2 text-[13px] font-medium text-white">
              <LayoutDashboard className="h-4 w-4 text-emerald-400" />
              Dashboard
            </button>
            <button onClick={() => router.push('/chat')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white">
              <MessageSquare className="h-4 w-4" />
              Chat
            </button>
            <button onClick={() => router.push('/schema')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white">
              <NetworkIcon className="h-4 w-4" />
              Schema Explorer
            </button>
          </nav>

          <div className="flex-1 overflow-hidden flex flex-col">
            <button onClick={() => setTablesExpanded(!tablesExpanded)} className="flex items-center justify-between px-4 py-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <Database className="h-3 w-3" />
                {tables.length} {isES ? 'Indices' : 'Tables'}
              </p>
              {tablesExpanded ? <ChevronUp className="h-3 w-3 text-zinc-600" /> : <ChevronDown className="h-3 w-3 text-zinc-600" />}
            </button>
            {tablesExpanded && (
              <>
                <div className="px-2 pb-2">
                  <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800/60 bg-zinc-900/50 px-2 py-1">
                    <Search className="h-3 w-3 text-zinc-600" />
                    <input value={searchTables} onChange={(e) => setSearchTables(e.target.value)} placeholder="Search…" className="w-full bg-transparent text-[11px] text-zinc-300 placeholder:text-zinc-700 focus:outline-none" />
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="space-y-px px-2 pb-3">
                    {filteredTables.map((table) => (
                      <div key={table.name} className="flex items-center gap-2 rounded-md px-2 py-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-300" title={table.name}>
                        <Table2 className="h-3 w-3 shrink-0 text-zinc-700" />
                        <span className="flex-1 truncate text-[12px]">{table.name}</span>
                        <span className="text-[10px] tabular-nums text-zinc-700">{table.columnCount}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>

          <div className="border-t border-zinc-800/60 px-2 py-2 space-y-0.5">
            <button onClick={() => router.push('/settings')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300">
              <Settings className="h-3.5 w-3.5" /> Settings
            </button>
            <button onClick={handleDisconnect} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300">
              <LogOut className="h-3.5 w-3.5" /> Disconnect
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-zinc-800/60 px-6 py-3.5">
            <div>
              <h1 className="text-xl font-bold text-white">Dashboard</h1>
              <p className="text-xs text-zinc-500">
                Insights for <span className="text-zinc-400">{connection?.database || 'your data'}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-full border border-zinc-800 px-2.5 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="text-[11px] font-medium uppercase text-zinc-500">{connection?.connectorType}</span>
              </div>
              <button onClick={downloadDashboard} disabled={isDownloading || dashboard.widgets.length === 0} className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40" title="Download dashboard as PNG">
                {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                Export
              </button>
              <button onClick={generateDashboard} disabled={isGenerating} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50">
                {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {isGenerating ? 'Generating…' : 'Regenerate'}
              </button>
            </div>
          </header>

          <DashboardDropZone
            widgetResults={dashboard.widgets}
            layouts={dashboard.layouts}
            isGenerating={isGenerating}
            error={error}
            isES={isES}
            activeDragItem={activeDragItem}
            onRemove={removeWidget}
            onDownload={downloadWidget}
            onLayoutChange={handleLayoutChange}
            widgetRefs={widgetRefs}
            contentRef={contentRef}
            editingWidget={editingWidget}
            editTitle={editTitle}
            onStartEdit={(id, title) => { setEditingWidget(id); setEditTitle(title); }}
            onChangeEditTitle={setEditTitle}
            onSaveTitle={handleSaveTitle}
            onCancelEdit={() => setEditingWidget(null)}
          />
        </main>

        {/* Right Sidebar — Widget Palette */}
        <aside className="hidden w-56 flex-col border-l border-zinc-800/60 bg-zinc-950 xl:flex">
          <div className="border-b border-zinc-800/60 px-4 py-3.5">
            <h2 className="text-sm font-semibold text-white">Widgets</h2>
            <p className="text-[10px] text-zinc-500">Drag to add to dashboard</p>
          </div>
          <ScrollArea className="flex-1 p-3">
            <WidgetPalette />
          </ScrollArea>
        </aside>
      </div>

      <DragOverlay>
        {activeDragItem && (
          <div className="flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-zinc-900 px-3 py-2 shadow-2xl">
            <activeDragItem.icon className="h-4 w-4 text-indigo-400" />
            <span className="text-xs font-medium text-white">{activeDragItem.label}</span>
          </div>
        )}
      </DragOverlay>

      {pendingDrop && (
        <WidgetPromptDialog
          paletteItem={pendingDrop}
          tables={tables.map((t) => t.name)}
          onConfirm={(prompt) => { addWidget(prompt, pendingDrop.type, pendingDrop.defaultSize); setPendingDrop(null); }}
          onCancel={() => setPendingDrop(null)}
        />
      )}
    </DndContext>
  );
}

/* ── Dashboard Drop Zone with react-grid-layout ── */

function DashboardDropZone({
  widgetResults,
  layouts,
  isGenerating,
  error,
  isES,
  activeDragItem,
  onRemove,
  onDownload,
  onLayoutChange,
  widgetRefs,
  contentRef,
  editingWidget,
  editTitle,
  onStartEdit,
  onChangeEditTitle,
  onSaveTitle,
  onCancelEdit,
}: {
  widgetResults: DashboardWidgetResult[];
  layouts: LayoutItem[];
  isGenerating: boolean;
  error: string | null;
  isES: boolean;
  activeDragItem: PaletteItem | null;
  onRemove: (id: string) => void;
  onDownload: (id: string, title: string) => void;
  onLayoutChange: (layout: LayoutItem[]) => void;
  widgetRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  contentRef: React.RefObject<HTMLDivElement>;
  editingWidget: string | null;
  editTitle: string;
  onStartEdit: (id: string, title: string) => void;
  onChangeEditTitle: (title: string) => void;
  onSaveTitle: (id: string) => void;
  onCancelEdit: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: 'dashboard-drop-zone' });
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width - 32); // subtract padding
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const mergedRef = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, [setNodeRef]);

  return (
    <div className="flex-1 overflow-auto" ref={mergedRef}>
        <div ref={contentRef} className={`min-h-full p-4 transition-colors ${isOver ? 'bg-indigo-500/5' : ''}`}>
        {activeDragItem && (
          <div className={`mb-4 flex items-center justify-center rounded-2xl border-2 border-dashed py-6 transition-all ${isOver ? 'border-indigo-500/50 bg-indigo-500/5 text-indigo-300' : 'border-zinc-800 text-zinc-600'}`}>
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              <span className="text-sm font-medium">{isOver ? 'Release to add widget' : 'Drop widget here'}</span>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {widgetResults.length === 0 && !isGenerating && !error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
              <LayoutDashboard className="h-7 w-7 text-emerald-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">Building Your Dashboard</h2>
            <p className="mt-1.5 max-w-sm text-sm text-zinc-500">Analyzing your {isES ? 'indices' : 'tables'} to create insightful widgets…</p>
          </motion.div>
        )}

        {widgetResults.length === 0 && isGenerating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-24 text-center">
            <Loader2 className="mb-4 h-8 w-8 animate-spin text-emerald-400" />
            <h2 className="text-lg font-semibold text-white">Analyzing Your Data</h2>
            <p className="mt-1.5 max-w-sm text-sm text-zinc-500">Creating dashboard widgets based on your schema…</p>
          </motion.div>
        )}

        {widgetResults.length > 0 && (
          <ResponsiveGridLayout
            className="layout"
            layouts={{ lg: layouts }}
            breakpoints={{ lg: 1024, md: 768, sm: 480, xs: 0 }}
            cols={{ lg: 12, md: 8, sm: 4, xs: 2 }}
            rowHeight={40}
            width={containerWidth}
            dragConfig={{ enabled: true, handle: '.widget-drag-handle' }}
            resizeConfig={{ enabled: true, handles: ['se', 'sw'] }}
            onLayoutChange={(currentLayout) => onLayoutChange(currentLayout as unknown as LayoutItem[])}
            margin={[10, 10]}
          >
            {widgetResults.map((widget) => (
              <div key={widget.id} className="group">
                <div
                  ref={(el) => { widgetRefs.current[widget.id] = el; }}
                  className="relative h-full w-full overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/50 transition-shadow hover:shadow-lg hover:shadow-zinc-900/50"
                >
                  {/* Widget toolbar */}
                  <div className="absolute right-1 top-1 z-20 flex items-center gap-0.5 rounded-lg bg-zinc-900/90 px-1 py-0.5 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                    <button className="widget-drag-handle cursor-grab rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-300 active:cursor-grabbing" title="Drag to move">
                      <GripHorizontal className="h-3 w-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onStartEdit(widget.id, widget.title); }} className="rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-300" title="Edit title">
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onDownload(widget.id, widget.title); }} className="rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-300" title="Download as PNG">
                      <Download className="h-3 w-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onRemove(widget.id); }} className="rounded p-1 text-zinc-500 hover:bg-red-500/20 hover:text-red-400" title="Remove widget">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Inline title editor */}
                  {editingWidget === widget.id && (
                    <div className="absolute inset-x-0 top-0 z-30 flex items-center gap-1 bg-zinc-900 p-2 border-b border-zinc-800/60">
                      <input
                        title="Widget title"
                        aria-label="Widget title"
                        placeholder="Widget title"
                        autoFocus
                        value={editTitle}
                        onChange={(e) => onChangeEditTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') onSaveTitle(widget.id); if (e.key === 'Escape') onCancelEdit(); }}
                        className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                      />
                      <button onClick={() => onSaveTitle(widget.id)} className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-500">Save</button>
                      <button onClick={onCancelEdit} className="rounded px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300">Cancel</button>
                    </div>
                  )}

                  {/* Widget content */}
                  <div className="h-full w-full overflow-auto p-2">
                    {widget.loading ? (
                      <WidgetSkeleton title={widget.title} uiHint={widget.ui_hint} />
                    ) : widget.error ? (
                      <WidgetError title={widget.title} error={widget.error} />
                    ) : widget.execution ? (
                      <GenerativeUIRenderer execution={widget.execution} uiHint={widget.ui_hint} title={widget.title} compact />
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>
    </div>
  );
}

function WidgetSkeleton({ title }: { title: string; uiHint: UIHint }) {
  return (
    <div className="animate-pulse h-full flex flex-col items-center justify-center">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-700 mb-3">{title}</p>
      <Loader2 className="h-5 w-5 animate-spin text-zinc-800" />
    </div>
  );
}

function WidgetError({ title, error }: { title: string; error: string }) {
  return (
    <div className="h-full flex flex-col justify-center">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-700 mb-2">{title}</p>
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-red-400/50" />
        <p className="text-[11px] text-red-400/50">{error}</p>
      </div>
    </div>
  );
}
