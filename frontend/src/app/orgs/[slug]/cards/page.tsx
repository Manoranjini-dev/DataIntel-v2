'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { orgApi, cardApi, connectionApi, chatApi } from '@/lib/api';
import { Plus, Pencil, X, Check, ChevronRight, BarChart2, TrendingUp, PieChart, Table2, Hash, RefreshCw } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────
type ChartType = 'bar_chart' | 'line_chart' | 'pie_chart' | 'table' | 'metric_card' | 'area_chart' | 'donut_chart';

const CHART_OPTIONS: { type: ChartType; label: string; icon: React.ReactNode; desc: string }[] = [
  { type: 'bar_chart',    label: 'Bar Chart',    icon: <BarChart2 className="w-5 h-5" />,  desc: 'Compare categories' },
  { type: 'line_chart',   label: 'Line Chart',   icon: <TrendingUp className="w-5 h-5" />, desc: 'Trends over time'  },
  { type: 'pie_chart',    label: 'Pie Chart',    icon: <PieChart className="w-5 h-5" />,   desc: 'Part-to-whole'     },
  { type: 'area_chart',   label: 'Area Chart',   icon: <TrendingUp className="w-5 h-5" />, desc: 'Volume over time'  },
  { type: 'metric_card',  label: 'Metric',       icon: <Hash className="w-5 h-5" />,       desc: 'Single KPI value'  },
  { type: 'table',        label: 'Data Table',   icon: <Table2 className="w-5 h-5" />,     desc: 'Tabular rows'      },
];

const CHART_ICON_MAP: Record<string, React.ReactNode> = {
  bar_chart:   <BarChart2 className="w-4 h-4" />,
  line_chart:  <TrendingUp className="w-4 h-4" />,
  pie_chart:   <PieChart className="w-4 h-4" />,
  area_chart:  <TrendingUp className="w-4 h-4" />,
  metric_card: <Hash className="w-4 h-4" />,
  table:       <Table2 className="w-4 h-4" />,
};

const inputCls = 'w-full px-3 py-2.5 bg-muted/60 border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all';

// ── Edit Card Modal ────────────────────────────────────────────
function EditCardModal({ card, orgId, onSave, onClose }: {
  card: any; orgId: string; onSave: (updated: any) => void; onClose: () => void;
}) {
  const [query,   setQuery]   = useState(card.raw_query || '');
  const [name,    setName]    = useState(card.name || '');
  const [saving,  setSaving]  = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const { card: updated } = await cardApi.update(orgId, card.id, { name, rawQuery: query });
      onSave(updated);
      onClose();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Edit Card</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Card name</label>
            <input value={name} onChange={e => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Query</label>
            <textarea
              value={query} onChange={e => setQuery(e.target.value)}
              rows={6}
              placeholder="SELECT ..."
              className={`${inputCls} font-mono resize-none`}
            />
          </div>
        </div>

        <div className="flex gap-2 px-6 pb-6">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition-colors">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button onClick={onClose}
            className="px-5 py-2.5 bg-muted hover:bg-muted/80 rounded-xl text-sm text-muted-foreground transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New Card Modal (multi-step) ────────────────────────────────
function NewCardModal({ orgId, connections, onCreated, onClose }: {
  orgId: string; connections: any[]; onCreated: (card: any) => void; onClose: () => void;
}) {
  const [step,         setStep]         = useState<1 | 2 | 3 | 4>(1);
  const [query,        setQuery]        = useState('');
  const [chartType,    setChartType]    = useState<ChartType>('bar_chart');
  const [connectionId, setConnectionId] = useState(connections[0]?.id || '');
  const [preview,      setPreview]      = useState<any>(null);
  const [previewErr,   setPreviewErr]   = useState('');
  const [cardName,     setCardName]     = useState('');
  const [loading,      setLoading]      = useState(false);
  const [saving,       setSaving]       = useState(false);

  // Step 3 — run the query to get preview data
  async function runPreview() {
    if (!query.trim() || !connectionId) return;
    setLoading(true);
    setPreviewErr('');
    try {
      // Create a temporary chat to run the query
      const { chat } = await chatApi.create(orgId, { connectionId });
      const result   = await chatApi.ask(orgId, chat.id, query, true);
      const exec     = (result as any)?.execution;
      if (!exec?.rows?.length) { setPreviewErr('Query returned no data.'); }
      else { setPreview(exec); setStep(4); }
    } catch (e: any) {
      setPreviewErr(e?.message || 'Query failed');
    } finally { setLoading(false); }
  }

  async function handleSave() {
    if (!cardName.trim()) return;
    setSaving(true);
    try {
      const { card } = await cardApi.create(orgId, {
        name:        cardName,
        chartType:   chartType,
        rawQuery:    query,
        connectionId,
        queryDefinition: {
          prompt:         query,
          result_rows:    preview?.rows?.slice(0, 100),
          result_columns: preview?.columns,
          ui_hint:        chartType,
        },
      });
      onCreated(card);
      onClose();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  const steps = ['Query', 'Chart type', 'Data source', 'Preview & save'];

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-xl shadow-xl" onClick={e => e.stopPropagation()}>

        {/* Header + stepper */}
        <div className="px-6 py-5 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">New Card</h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Stepper */}
          <div className="flex items-center gap-1">
            {steps.map((s, i) => {
              const n   = i + 1;
              const done = n < step;
              const cur  = n === step;
              return (
                <div key={s} className="flex items-center gap-1 flex-1">
                  <div className={`flex items-center gap-1.5 ${cur ? '' : done ? 'opacity-100' : 'opacity-40'}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors
                      ${done ? 'bg-[#F5A623] text-[#2B2B2B]' : cur ? 'bg-[#2B2B2B] text-white' : 'bg-muted text-muted-foreground'}`}>
                      {done ? <Check className="w-3 h-3" /> : n}
                    </div>
                    <span className={`text-xs font-medium hidden sm:block ${cur ? 'text-foreground' : 'text-muted-foreground'}`}>{s}</span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`flex-1 h-px mx-1 ${done ? 'bg-[#F5A623]/60' : 'bg-border'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step content */}
        <div className="p-6">
          {/* Step 1: Query */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Write the SQL or natural-language query for this card.</p>
              <textarea
                value={query} onChange={e => setQuery(e.target.value)}
                rows={7}
                placeholder="SELECT region, SUM(revenue) AS total FROM sales GROUP BY region ORDER BY total DESC"
                className={`${inputCls} font-mono resize-none`}
                autoFocus
              />
            </div>
          )}

          {/* Step 2: Chart type */}
          {step === 2 && (
            <div className="grid grid-cols-3 gap-3">
              {CHART_OPTIONS.map(opt => (
                <button key={opt.type} onClick={() => setChartType(opt.type)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center
                    ${chartType === opt.type
                      ? 'border-[#2B2B2B] bg-[#2B2B2B]/5'
                      : 'border-border hover:border-border/80 hover:bg-muted/40'}`}>
                  <div className={`${chartType === opt.type ? 'text-[#F5A623]' : 'text-muted-foreground'}`}>
                    {opt.icon}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Step 3: Data source */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Choose the data source to run this query against.</p>
              {connections.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No data sources configured yet.{' '}
                  <span className="text-primary underline cursor-pointer" onClick={onClose}>Add one first</span>
                </div>
              ) : connections.map((conn: any) => (
                <button key={conn.id} onClick={() => setConnectionId(conn.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left
                    ${connectionId === conn.id
                      ? 'border-[#2B2B2B] bg-[#2B2B2B]/5'
                      : 'border-border hover:border-border/80 hover:bg-muted/30'}`}>
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {conn.connector_type?.[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{conn.name}</p>
                    <p className="text-xs text-muted-foreground">{conn.connector_type} · {conn.host}</p>
                  </div>
                  {connectionId === conn.id && <Check className="w-4 h-4 text-[#F5A623] shrink-0" />}
                </button>
              ))}

              {previewErr && <p className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-xl px-3 py-2">{previewErr}</p>}
            </div>
          )}

          {/* Step 4: Preview & save */}
          {step === 4 && preview && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Card name</p>
                <input value={cardName} onChange={e => setCardName(e.target.value)}
                  placeholder="e.g. Revenue by Region"
                  className={inputCls} autoFocus />
              </div>

              {/* Preview table */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  Preview <span className="font-normal">— {preview.rows.length} row{preview.rows.length !== 1 ? 's' : ''}</span>
                </p>
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="overflow-x-auto max-h-48">
                    <table className="text-xs w-full">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          {(preview.columns as string[]).map(c => (
                            <th key={c} className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {preview.rows.slice(0, 10).map((row: any, i: number) => (
                          <tr key={i} className="hover:bg-muted/30">
                            {(preview.columns as string[]).map(c => (
                              <td key={c} className="px-3 py-2 text-foreground truncate max-w-[120px]">{String(row[c] ?? '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-xl px-3 py-2">
                <span className="text-primary">{CHART_ICON_MAP[chartType]}</span>
                Saved as <span className="font-semibold text-foreground">{CHART_OPTIONS.find(o => o.type === chartType)?.label}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 pb-6">
          {step > 1 && (
            <button onClick={() => setStep(s => (s - 1) as any)}
              className="px-4 py-2.5 bg-muted hover:bg-muted/80 rounded-xl text-sm text-muted-foreground transition-colors">
              Back
            </button>
          )}

          {step < 3 && (
            <button
              onClick={() => setStep(s => (s + 1) as any)}
              disabled={step === 1 && !query.trim()}
              className="flex-1 py-2.5 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {step === 3 && (
            <button onClick={runPreview} disabled={loading || !connectionId}
              className="flex-1 py-2.5 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
              {loading
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Running…</>
                : <><ChevronRight className="w-4 h-4" /> Preview</>}
            </button>
          )}

          {step === 4 && (
            <button onClick={handleSave} disabled={!cardName.trim() || saving}
              className="flex-1 py-2.5 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition-colors">
              {saving ? 'Saving…' : 'Save Card'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Live Card Tile ─────────────────────────────────────────────
// Lazily re-executes the card's query when it scrolls into view.
function LiveCardTile({ card, orgId, onEdit }: { card: any; orgId: string; onEdit: () => void }) {
  const [liveRows, setLiveRows] = useState<any[] | null>(null);
  const [liveCols, setLiveCols] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const tileRef = useRef<HTMLDivElement>(null);
  const executedRef = useRef(false);

  // Parse any cached preview from the card object (last_result_preview from backend JOIN)
  const cachedRows: any[] = (() => {
    if (!card.last_result_preview) return [];
    try { return JSON.parse(card.last_result_preview); } catch { return []; }
  })();
  const cachedCols: string[] = Array.isArray(card.last_result_columns) ? card.last_result_columns : [];

  const runRefresh = useCallback(async () => {
    if (!card.raw_query || !card.connection_id || refreshing) return;
    setRefreshing(true);
    try {
      // Reuse an existing chat for this connection so we don't create orphan chats
      const { chats } = await chatApi.list(orgId, { connectionId: card.connection_id });
      let chatId: string;
      if (chats.length > 0) {
        chatId = chats[0].id;
      } else {
        const { chat } = await chatApi.create(orgId, { connectionId: card.connection_id });
        chatId = chat.id;
      }
      const result = await chatApi.executeDraft(orgId, chatId, '', card.raw_query);
      const exec = result.execution ?? result;
      if (exec?.rows?.length > 0) {
        setLiveRows(exec.rows);
        setLiveCols(exec.columns || []);
      }
    } catch { /* silently fall back to cached data */ }
    finally { setRefreshing(false); }
  }, [card.raw_query, card.connection_id, orgId, refreshing]);

  // Trigger once when tile scrolls into view
  useEffect(() => {
    if (!card.raw_query || !card.connection_id) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !executedRef.current) {
          executedRef.current = true;
          runRefresh();
        }
      },
      { threshold: 0.1 },
    );
    if (tileRef.current) observer.observe(tileRef.current);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  const displayRows = liveRows ?? cachedRows;
  const displayCols = liveRows ? liveCols : cachedCols;
  const hasData = displayRows.length > 0 && displayCols.length > 0;

  return (
    <div
      ref={tileRef}
      className="group bg-card border border-border rounded-2xl overflow-hidden hover:border-[#2B2B2B]/20 hover:shadow-md transition-all"
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
            {CHART_ICON_MAP[card.chart_type] ?? <Table2 className="w-4 h-4" />}
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground line-clamp-1">{card.name}</p>
            <p className="text-[10px] text-muted-foreground capitalize">{card.chart_type?.replace(/_/g, ' ')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Live refresh indicator / button */}
          <button
            onClick={() => { executedRef.current = false; runRefresh(); }}
            disabled={refreshing}
            title="Refresh with live data"
            className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-muted text-muted-foreground transition-all"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border shrink-0
            ${card.status === 'published'
              ? 'bg-green-50 text-green-700 border-green-200'
              : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
            {card.status}
          </span>
        </div>
      </div>

      {/* Live data mini-preview or loading state */}
      {refreshing && !hasData ? (
        <div className="mx-4 mb-3 bg-muted/40 rounded-lg px-3 py-3 flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-muted-foreground/40 border-t-muted-foreground rounded-full animate-spin shrink-0" />
          <span className="text-[10px] text-muted-foreground">Fetching live data…</span>
        </div>
      ) : hasData ? (
        <div className="mx-4 mb-3 overflow-x-auto bg-muted/30 rounded-lg">
          <table className="text-[10px] w-full">
            <thead className="bg-muted/50">
              <tr>
                {displayCols.map(c => (
                  <th key={c} className="px-2 py-1 text-left text-muted-foreground font-medium whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.slice(0, 3).map((row, i) => (
                <tr key={i} className="border-t border-border/30">
                  {displayCols.map(c => (
                    <td key={c} className="px-2 py-1 text-foreground truncate max-w-[80px]">{String(row[c] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {displayRows.length > 3 && (
            <p className="px-2 py-1 text-[9px] text-muted-foreground/60 border-t border-border/30">
              {displayRows.length} rows · {liveRows ? '🟢 live' : 'cached'}
            </p>
          )}
        </div>
      ) : card.raw_query ? (
        <div className="mx-4 mb-3 bg-muted/50 rounded-lg px-3 py-2">
          <p className="text-[10px] font-mono text-muted-foreground line-clamp-2 leading-relaxed">
            {card.raw_query}
          </p>
        </div>
      ) : null}

      {/* Footer */}
      <div className="px-4 pb-4 flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">
          v{card.current_version} · {new Date(card.updated_at).toLocaleDateString()}
        </p>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-muted/60 hover:bg-[#2B2B2B] hover:text-white rounded-lg text-xs font-medium text-muted-foreground transition-all opacity-0 group-hover:opacity-100"
        >
          <Pencil className="w-3 h-3" /> Edit
        </button>
      </div>
    </div>
  );
}

// ── Cards Page ─────────────────────────────────────────────────
export default function CardsPage() {
  const { slug } = useParams<{ slug: string }>();

  const [org,         setOrg]         = useState<any>(null);
  const [cards,       setCards]       = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [editingCard, setEditingCard] = useState<any>(null);
  const [showNew,     setShowNew]     = useState(false);

  useEffect(() => { loadOrg(); }, [slug]);

  async function loadOrg() {
    const { org: o } = await orgApi.get(slug);
    setOrg(o);
  }

  const loadCards = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      const [{ cards: c }, { connections: conns }] = await Promise.all([
        cardApi.list(org.id, params),
        connectionApi.list(org.id),
      ]);
      setCards(c);
      setConnections(conns);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [org, search]);

  useEffect(() => { loadCards(); }, [loadCards]);

  function handleCardSaved(updated: any) {
    setCards(cs => cs.map(c => c.id === updated.id ? { ...c, ...updated } : c));
  }

  function handleCardCreated(card: any) {
    setCards(cs => [card, ...cs]);
  }

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="max-w-5xl mx-auto px-8 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Cards</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{cards.length} card{cards.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-xl text-sm font-semibold transition-colors">
            <Plus className="w-4 h-4" /> New Card
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search cards…"
            className="w-full max-w-sm px-3 py-2.5 bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          />
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-border rounded-2xl">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-sm font-semibold text-foreground mb-1">No cards yet</p>
            <p className="text-xs text-muted-foreground mb-5">Cards are reusable chart widgets backed by a query</p>
            <button onClick={() => setShowNew(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#2B2B2B] text-white rounded-xl text-sm font-semibold hover:bg-[#3a3a3a] transition-colors">
              <Plus className="w-4 h-4" /> New Card
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((card: any) => (
              <LiveCardTile
                key={card.id}
                card={card}
                orgId={org.id}
                onEdit={() => setEditingCard(card)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {editingCard && org && (
        <EditCardModal
          card={editingCard}
          orgId={org.id}
          onSave={handleCardSaved}
          onClose={() => setEditingCard(null)}
        />
      )}

      {showNew && org && (
        <NewCardModal
          orgId={org.id}
          connections={connections}
          onCreated={handleCardCreated}
          onClose={() => setShowNew(false)}
        />
      )}
    </div>
  );
}
