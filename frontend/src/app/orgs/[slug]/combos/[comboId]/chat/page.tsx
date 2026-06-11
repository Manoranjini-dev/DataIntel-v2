'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { comboApi, chatApi, orgApi, dashboardApi, cardApi } from '@/lib/api';
import { usePrefsStore } from '@/lib/prefs-store';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Send, GitFork, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, LayoutDashboard, BookMarked, X, Plus,
} from 'lucide-react';

const GenerativeUIRenderer = dynamic(
  () => import('@/components/generative-ui').then((m) => m.GenerativeUIRenderer),
  {
    ssr: false,
    loading: () => <div className="h-40 animate-pulse rounded-xl border border-border bg-card/40" />,
  },
);

// ── Types ──────────────────────────────────────────────────────
interface ComboMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  plan?: any;
  stepResults?: any[];
  rows?: any[];
  columns?: string[];
  totalMs?: number;
  mergeStrategy?: string;
  ui_hint?: string;
  error?: boolean;
}

// ── Query plan breakdown ────────────────────────────────────────
function SubQueryPlan({ plan, stepResults }: { plan: any; stepResults: any[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-2.5 space-y-1.5">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Query Plan · <span className="text-primary font-medium">{plan?.merge?.strategy ?? plan?.mergeStrategy ?? 'join'}</span> merge
      </button>
      {expanded && (
        <div className="space-y-1.5 pl-1">
          {stepResults.map((sr: any, i: number) => (
            <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-xl border text-xs
              ${sr.status === 'success' ? 'bg-success/5 border-success/20' : 'bg-destructive/5 border-destructive/20'}`}>
              <span className={`mt-0.5 shrink-0 ${sr.status === 'success' ? 'text-success' : 'text-destructive'}`}>●</span>
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-foreground">{sr.alias}</span>
                {sr.query && (
                  <pre className="text-muted-foreground truncate mt-0.5 font-mono text-[10px]">{sr.query.substring(0, 100)}…</pre>
                )}
              </div>
              <div className="text-right text-muted-foreground/60 whitespace-nowrap shrink-0">
                {sr.rowCount} rows · {sr.executionTimeMs}ms
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Inline data table fallback ──────────────────────────────────
function ResultTable({ rows, columns }: { rows: any[]; columns: string[] }) {
  if (!rows.length) return <p className="text-muted-foreground text-sm mt-2">No results.</p>;
  return (
    <div className="overflow-x-auto mt-2 rounded-xl border border-border">
      <table className="text-xs text-left w-full">
        <thead className="bg-muted/50">
          <tr>{columns.map(c => <th key={c} className="px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.slice(0, 100).map((row, i) => (
            <tr key={i} className="hover:bg-muted/20 transition-colors">
              {columns.map(c => (
                <td key={c} className="px-3 py-2 text-foreground whitespace-nowrap max-w-xs truncate font-mono text-[10px]">
                  {row[c] === null ? <span className="text-muted-foreground/40 italic">null</span> : String(row[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 100 && (
        <p className="text-muted-foreground text-xs px-3 py-2 border-t border-border">
          Showing 100 of {rows.length} rows
        </p>
      )}
    </div>
  );
}

// ── Message bubble ──────────────────────────────────────────────
function ComboBubble({
  message,
  showQueryPlan,
  onAddToDashboard,
  onSaveCard,
}: {
  message: ComboMessage;
  showQueryPlan: boolean;
  onAddToDashboard?: (msg: ComboMessage) => void;
  onSaveCard?: (msg: ComboMessage) => void;
}) {
  const hasResults = (message.rows?.length ?? 0) > 0 && (message.columns?.length ?? 0) > 0;

  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div
          className="max-w-[72%] bg-primary text-white px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
          style={{ boxShadow: 'var(--shadow-soft)' }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 mb-5">
      {/* AI avatar — same gradient as connection chat */}
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center text-xs shrink-0 mt-0.5"
        style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
      >
        <span className="text-white font-bold text-[11px]">AI</span>
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <div
          className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3"
          style={{ boxShadow: 'var(--shadow-soft)' }}
        >
          {/* Main prose content */}
          <div className="text-sm text-foreground leading-relaxed prose prose-sm max-w-none prose-p:my-1 prose-strong:text-foreground prose-code:text-primary prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>

          {/* Status + timing bar */}
          {message.stepResults && (
            <div className="flex flex-wrap items-center gap-3 mt-2.5 pt-2.5 border-t border-border text-xs text-muted-foreground">
              {message.error ? (
                <span className="flex items-center gap-1 text-destructive">
                  <XCircle className="w-3.5 h-3.5" /> Failed
                </span>
              ) : (
                <span className="flex items-center gap-1 text-success">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Success
                </span>
              )}
              <span>{message.stepResults.length} source{message.stepResults.length !== 1 ? 's' : ''}</span>
              {message.rows?.length !== undefined && <span>{message.rows.length} merged rows</span>}
              {message.totalMs !== undefined && <span>{message.totalMs}ms total</span>}
            </div>
          )}

          {/* Query plan — controlled by showGeneratedSQL pref */}
          {showQueryPlan && message.stepResults && message.plan && (
            <SubQueryPlan plan={message.plan} stepResults={message.stepResults} />
          )}

          {/* Step-result list when plan is hidden but there are steps */}
          {!showQueryPlan && message.stepResults && (
            <SubQueryPlan plan={message.plan} stepResults={message.stepResults} />
          )}
        </div>

        {/* Chart / table */}
        {hasResults && (
          <>
            {message.ui_hint && message.ui_hint !== 'data_table' ? (
              <GenerativeUIRenderer
                execution={{
                  rows: message.rows!,
                  columns: message.columns!,
                  rowCount: message.rows!.length,
                  executionTimeMs: message.totalMs || 0,
                } as any}
                uiHint={message.ui_hint as any}
              />
            ) : (
              <ResultTable rows={message.rows!} columns={message.columns!} />
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <button
                onClick={() => onAddToDashboard?.(message)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 hover:bg-muted border border-border rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground transition-all"
              >
                <LayoutDashboard className="w-3.5 h-3.5" /> Add to Dashboard
              </button>
              <button
                onClick={() => onSaveCard?.(message)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 hover:bg-muted border border-border rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground transition-all"
              >
                <BookMarked className="w-3.5 h-3.5" /> Save to Card Library
              </button>
            </div>
          </>
        )}

        <p className="text-[10px] text-muted-foreground/60 px-1">
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

// ── Add to Dashboard Modal ──────────────────────────────────────
function AddToDashboardModal({ orgId, message, onClose }: {
  orgId: string; message: ComboMessage; onClose: () => void;
}) {
  const [dashboards, setDashboards] = useState<any[]>([]);
  const [pages, setPages] = useState<any[]>([]);
  const [selDash, setSelDash] = useState('');
  const [selPage, setSelPage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dashboardApi.list(orgId).then(r => setDashboards((r as any).dashboards || [])).catch(() => {});
  }, [orgId]);

  useEffect(() => {
    if (!selDash) return;
    dashboardApi.get(orgId, selDash).then((r: any) => {
      const ps = r.dashboard?.pages || r.pages || [];
      setPages(ps); setSelPage(ps[0]?.id || '');
    }).catch(() => {});
  }, [orgId, selDash]);

  async function handleAdd() {
    if (!selDash || !selPage) return;
    setSaving(true);
    try {
      await dashboardApi.addWidget(orgId, selDash, selPage, {
        title: message.content.slice(0, 50),
        widget_type: message.ui_hint?.replace('data_table', 'table') || 'table',
        queryPrompt: message.content,
        datasourceScopeType: 'combo',
        resultRows: message.rows || [],
        resultColumns: message.columns || [],
        uiHint: message.ui_hint || 'table',
        gridX: 0, gridY: 0, gridW: 6, gridH: 4,
      });
      onClose();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <span className="font-semibold text-foreground text-sm">Add to Dashboard</span>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Dashboard</label>
            <select value={selDash} onChange={e => setSelDash(e.target.value)}
              className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40">
              <option value="">Select a dashboard…</option>
              {dashboards.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          {pages.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Page</label>
              <select value={selPage} onChange={e => setSelPage(e.target.value)}
                className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40">
                {pages.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <button onClick={handleAdd} disabled={!selDash || !selPage || saving}
            className="w-full py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center justify-center gap-2">
            {saving ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Adding…</> : <><Plus className="w-4 h-4" />Add Widget</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Save Card Modal ─────────────────────────────────────────────
function SaveCardModal({ orgId, message, onClose }: {
  orgId: string; message: ComboMessage; onClose: () => void;
}) {
  const [name, setName] = useState(message.content.slice(0, 60));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await cardApi.create(orgId, {
        name: name.trim(),
        chart_type: message.ui_hint || 'table',
        raw_query: message.content,
        result_cache: { rows: message.rows || [], columns: message.columns || [] },
        visibility: 'org_shared',
      });
      onClose();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <span className="font-semibold text-foreground text-sm">Save to Card Library</span>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Card Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="e.g. Monthly Revenue by Source" />
          </div>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="w-full py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center justify-center gap-2">
            {saving ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Saving…</> : <><BookMarked className="w-4 h-4" />Save Card</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────
const SUGGESTIONS = [
  'Which CRM leads converted to paying customers?',
  'Compare revenue by lead source across platforms',
  'Show top customers with open support tickets',
  'Revenue trends for converted leads this quarter',
];

export default function ComboChatPage() {
  const { slug, comboId } = useParams<{ slug: string; comboId: string }>();
  const { showGeneratedSQL } = usePrefsStore();

  const [org, setOrg] = useState<any>(null);
  const [combo, setCombo] = useState<any>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ComboMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [addToDashMsg, setAddToDashMsg] = useState<ComboMessage | null>(null);
  const [saveCardMsg, setSaveCardMsg] = useState<ComboMessage | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [slug, comboId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function loadData() {
    setHistoryLoading(true);
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);

      // Load combo details
      const c = await comboApi.list(o.id);
      const found = (c as any).combos?.find((x: any) => x.id === comboId);
      setCombo(found);

      // Find or create a chat session for this combo
      const { chats } = await chatApi.list(o.id, { comboId });
      let cid: string;
      if (chats.length > 0) {
        cid = chats[0].id;
      } else {
        const { chat } = await chatApi.create(o.id, { comboId, title: found?.name || 'Combo Chat' });
        cid = chat.id;
      }
      setChatId(cid);

      // Load existing message history
      const { messages: hist } = await chatApi.getMessages(o.id, cid);
      // Map chat_messages rows (joined with query_executions) → ComboMessage
      const mapped: ComboMessage[] = hist.map((m: any) => {
        // result_preview is JSON-encoded first-25 rows stored by combo.service
        let rows: any[] | undefined;
        let columns: string[] | undefined;
        if (m.result_preview) {
          try { rows = JSON.parse(m.result_preview); } catch { rows = undefined; }
        }
        if (m.result_columns?.length) columns = m.result_columns;
        return {
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          created_at: m.created_at,
          ui_hint: m.ui_hint,
          rows,
          columns,
        };
      });
      setMessages(mapped);
    } catch (e) { console.error(e); }
    finally { setHistoryLoading(false); }
  }

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || sending || !org || !chatId) return;
    const prompt = input.trim();
    setInput('');
    setSending(true);

    // Optimistic user message
    const tempId = `u-${Date.now()}`;
    setMessages(ms => [...ms, { id: tempId, role: 'user', content: prompt, created_at: new Date().toISOString() }]);

    try {
      // Pass chatId so the backend persists user + assistant messages
      const result = await comboApi.query(org.id, comboId, prompt, chatId);
      // Replace temp with final user msg + rich AI response (including rows/columns)
      setMessages(ms => {
        const without = ms.filter(m => m.id !== tempId);
        return [
          ...without,
          { id: `u2-${Date.now()}`, role: 'user', content: prompt, created_at: new Date().toISOString() },
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: result.insight
              || `Executed across ${result.stepResults?.length || 0} sources using **${result.mergeStrategy}** merge strategy. Found ${result.rowCount} merged results.`,
            created_at: new Date().toISOString(),
            plan: result.plan,
            stepResults: result.stepResults,
            rows: result.rows,
            columns: result.columns,
            totalMs: result.totalExecutionTimeMs,
            mergeStrategy: result.mergeStrategy,
            ui_hint: result.ui_hint,
          },
        ];
      });
    } catch (err: any) {
      setMessages(ms => {
        const without = ms.filter(m => m.id !== tempId);
        return [...without, {
          id: `u2-${Date.now()}`, role: 'user', content: prompt, created_at: new Date().toISOString(),
        }, {
          id: `err-${Date.now()}`, role: 'assistant',
          content: `I encountered an error: ${err.message}`,
          created_at: new Date().toISOString(),
          error: true,
        }];
      });
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border px-5 py-3 flex items-center gap-3 bg-card/60" style={{ boxShadow: 'var(--shadow-soft)' }}>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <GitFork className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <span className="text-sm font-semibold text-foreground truncate block">{combo?.name || 'Combo Chat'}</span>
            <span className="text-[10px] text-muted-foreground">Multi-source · {combo?.connections?.length ?? 0} connections</span>
          </div>
        </div>

        {sending && (
          <div className="flex items-center gap-2 text-xs text-primary shrink-0">
            <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />
            Planning queries…
          </div>
        )}
      </header>

      {/* ── Messages ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {historyLoading ? (
            <div className="flex items-center justify-center min-h-[40vh]">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
                Loading chat history…
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(217,122,30,.15), rgba(245,166,35,.15))', border: '1px solid rgba(217,122,30,.2)' }}
              >
                <GitFork className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground mb-2">Ask across all your data</h2>
                <p className="text-muted-foreground text-sm max-w-sm leading-relaxed">
                  Ask questions that span multiple data sources. The AI plans queries for each source and merges the results automatically.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); inputRef.current?.focus(); }}
                    className="px-3 py-1.5 bg-muted/60 hover:bg-muted border border-border rounded-full text-xs text-muted-foreground hover:text-foreground transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(msg => (
              <ComboBubble
                key={msg.id}
                message={msg}
                showQueryPlan={showGeneratedSQL}
                onAddToDashboard={setAddToDashMsg}
                onSaveCard={setSaveCardMsg}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input area ───────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border bg-card/60 p-4">
        <form onSubmit={handleSend} className="max-w-3xl mx-auto">
          <div className="flex gap-3 items-end bg-muted/50 border border-border rounded-2xl px-4 py-3 focus-within:ring-2 focus-within:ring-primary/40 transition-all">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Ask across all your data sources…"
              rows={1}
              disabled={sending}
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 max-h-[200px] overflow-y-auto"
              style={{ minHeight: '24px' }}
            />
            <button
              type="submit"
              disabled={!input.trim() || sending || !chatId}
              className="w-9 h-9 flex-shrink-0 rounded-xl bg-primary hover:opacity-90 flex items-center justify-center transition-opacity disabled:opacity-30"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 text-center mt-2">
            Shift+Enter for new line · queries run across {combo?.connections?.length ?? 'all'} connected sources
          </p>
        </form>
      </div>

      {/* ── Modals ───────────────────────────────────────────── */}
      {addToDashMsg && org && (
        <AddToDashboardModal orgId={org.id} message={addToDashMsg} onClose={() => setAddToDashMsg(null)} />
      )}
      {saveCardMsg && org && (
        <SaveCardModal orgId={org.id} message={saveCardMsg} onClose={() => setSaveCardMsg(null)} />
      )}
    </div>
  );
}
