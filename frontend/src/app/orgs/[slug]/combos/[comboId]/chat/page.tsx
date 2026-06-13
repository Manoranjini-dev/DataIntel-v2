'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { comboApi, chatApi, orgApi, dashboardApi, cardApi } from '@/lib/api';
import { usePrefsStore } from '@/lib/prefs-store';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Send, GitFork, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, LayoutDashboard, BookMarked, X, Plus,
  MessageSquare, RefreshCw,
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
  // execution_id for live-refresh lookup
  execution_id?: string;
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

          {/* Query plan */}
          {message.stepResults && message.plan && (
            <SubQueryPlan plan={message.plan} stepResults={message.stepResults} />
          )}
          {/* Step-result list when plan is not available */}
          {message.stepResults && !message.plan && (
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
function AddToDashboardModal({ orgId, comboId, message, onClose }: {
  orgId: string; comboId: string; message: ComboMessage; onClose: () => void;
}) {
  const [dashboards, setDashboards] = useState<any[]>([]);
  const [pages, setPages] = useState<any[]>([]);
  const [selectedDash, setSelectedDash] = useState<string>('');
  const [selectedPage, setSelectedPage] = useState<string>('');
  const [title, setTitle] = useState(message.content.slice(0, 60));
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dashboardApi.list(orgId).then(res => {
      const list = res.dashboards || [];
      setDashboards(list);
      if (list.length > 0) setSelectedDash(list[0].id);
    }).catch(console.error);
  }, [orgId]);

  useEffect(() => {
    if (!selectedDash) return;
    setSelectedPage(''); // Reset page until fetched
    dashboardApi.get(orgId, selectedDash).then(res => {
      const ps = res.pages || [];
      setPages(ps);
      if (ps.length > 0) setSelectedPage(String(ps[0].id));
    }).catch(console.error);
  }, [selectedDash, orgId]);

  async function handleAdd() {
    if (!selectedDash || !selectedPage) return;
    setSaving(true); setError('');
    try {
      const widgetType = message.ui_hint?.replace('data_table', 'table') || 'table';
      await dashboardApi.addWidget(orgId, selectedDash, selectedPage, {
        title: title || 'Untitled Widget',
        widget_type: widgetType,
        queryPrompt: message.content,
        datasourceScopeType: 'combo',
        datasourceContextId: comboId,
        resultRows: message.rows || [],
        resultColumns: message.columns || [],
        uiHint: message.ui_hint || 'table',
        gridX: 0, gridY: 999, gridW: 6, gridH: 4,
      });
      setDone(true);
    } catch (e: any) {
      setError(e?.message || 'Failed to add widget. Please try again.');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Add to Dashboard</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 className="w-10 h-10 text-success mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">Widget added!</p>
              <p className="text-xs text-muted-foreground mt-1">Find it on your dashboard</p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Card Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 mb-3"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Dashboard</label>
                <select value={selectedDash} onChange={e => setSelectedDash(e.target.value)}
                  className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40">
                  {dashboards.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  {dashboards.length === 0 && <option value="">No dashboards yet</option>}
                </select>
              </div>
              {pages.length > 1 && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Page</label>
                  <select value={selectedPage} onChange={e => setSelectedPage(e.target.value)}
                    className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40">
                    {pages.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              {error && (
                <p className="text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-xl px-3 py-2">{error}</p>
              )}
            </>
          )}
        </div>
        {!done && (
          <div className="flex gap-2 px-5 pb-5">
            <button onClick={onClose} className="px-4 py-2 border border-border rounded-xl text-sm text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
            <button onClick={handleAdd} disabled={saving || !selectedDash || !title.trim()}
              className="flex-1 py-2 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity">
              {saving ? 'Adding…' : 'Add Widget'}
            </button>
          </div>
        )}
        {done && <div className="pb-5 px-5"><button onClick={onClose} className="w-full py-2 bg-muted border border-border rounded-xl text-sm text-foreground hover:bg-muted/80 transition-colors">Close</button></div>}
      </div>
    </div>
  );
}

// ── Save Card Modal ─────────────────────────────────────────────
function SaveCardModal({ orgId, comboId, message, onClose }: {
  orgId: string; comboId: string; message: ComboMessage; onClose: () => void;
}) {
  const [name, setName] = useState(message.content.slice(0, 60));
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true); setError('');
    try {
      const chartType = message.ui_hint?.replace('data_table', 'table') || 'table';
      await cardApi.create(orgId, {
        name,
        description:            message.content.slice(0, 500),
        rawQuery:               message.content || '',
        chartType,
        datasourceContextType:  'combo',
        datasourceContextId:    comboId,
        queryDefinition: {
          prompt:    message.content,
          sql:       '',
          ui_hint:   chartType,
        },
      });
      setDone(true);
    } catch (e: any) {
      setError(e?.message || 'Failed to save card. Please try again.');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <BookMarked className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Save to Card Library</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 className="w-10 h-10 text-success mx-auto mb-3" />
              <p className="text-sm font-semibold text-foreground">Card saved!</p>
              <p className="text-xs text-muted-foreground mt-1">Available in your Card Library</p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Card Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 mb-3"
                />
              </div>
              {error && (
                <p className="text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-xl px-3 py-2">{error}</p>
              )}
            </>
          )}
        </div>
        {!done && (
          <div className="flex gap-2 px-5 pb-5">
            <button onClick={onClose} className="px-4 py-2 border border-border rounded-xl text-sm text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving || !name.trim()}
              className="flex-1 py-2 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity">
              {saving ? 'Saving…' : 'Save Card'}
            </button>
          </div>
        )}
        {done && <div className="pb-5 px-5"><button onClick={onClose} className="w-full py-2 bg-muted border border-border rounded-xl text-sm text-foreground hover:bg-muted/80 transition-colors">Close</button></div>}
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const { showGeneratedSQL } = usePrefsStore();

  const [org, setOrg] = useState<any>(null);
  const [combo, setCombo] = useState<any>(null);
  // ── History state (mirrors single-connection chat page) ──────
  const [chats, setChats] = useState<any[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    searchParams.get('chatId') && searchParams.get('chatId') !== 'new'
      ? searchParams.get('chatId')
      : null,
  );
  const [showChatList, setShowChatList] = useState(false);
  const chatListRef = useRef<HTMLDivElement>(null);
  // ────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ComboMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [addToDashMsg, setAddToDashMsg] = useState<ComboMessage | null>(null);
  const [saveCardMsg, setSaveCardMsg] = useState<ComboMessage | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [slug, comboId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Close chat-list dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (chatListRef.current && !chatListRef.current.contains(e.target as Node)) {
        setShowChatList(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function loadData() {
    setHistoryLoading(true);
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);

      // Load combo details
      const c = await comboApi.list(o.id);
      const found = (c as any).combos?.find((x: any) => x.id === comboId);
      setCombo(found);

      // Load ALL chats for this combo (for history panel)
      const { chats: fetchedChats } = await chatApi.list(o.id, { comboId });
      const validChats = fetchedChats.filter((c: any) => c.message_count > 0);
      setChats(validChats);

      // Determine active chat: URL param → first in list → auto-create
      const urlChatId = searchParams.get('chatId');
      let activeChatId = currentChatId;

      if (urlChatId && urlChatId !== 'new') {
        activeChatId = urlChatId;
      } else if (!activeChatId || activeChatId === 'new') {
        if (validChats.length > 0 && urlChatId !== 'new') {
          activeChatId = validChats[0].id;
        } else {
          // No existing chats or explicit 'new' — use the 'new' placeholder ID
          activeChatId = 'new';
        }
      }

      setCurrentChatId(activeChatId);
      // Sync URL without causing a navigation
      router.replace(`/orgs/${slug}/combos/${comboId}/chat?chatId=${activeChatId}`, { scroll: false });

      // Load message history for the active chat
      if (activeChatId && activeChatId !== 'new') {
        await loadMessages(o.id, activeChatId);
      } else {
        setMessages([]);
      }
    } catch (e) { console.error(e); }
    finally { setHistoryLoading(false); }
  }

  async function loadMessages(orgId: string, cid: string) {
    try {
      const { messages: hist } = await chatApi.getMessages(orgId, cid);
      // Map chat_messages rows (joined with query_executions) → ComboMessage
      const mapped: ComboMessage[] = hist.map((m: any) => {
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
          // Keep execution_id for live-refresh
          execution_id: m.execution_id,
        };
      });
      setMessages(mapped);
      // Background refresh for live data
      refreshComboMessages(orgId, cid, mapped);
    } catch (e) { console.error(e); }
  }

  /**
   * Re-execute stored sub-queries for assistant messages in this combo chat.
   * Updates only in-memory result state — never overwrites stored history.
   */
  async function refreshComboMessages(orgId: string, cid: string, msgsData: ComboMessage[]) {
    const toRefresh = msgsData
      .filter(m => m.role === 'assistant' && m.execution_id)
      .map(m => m.execution_id as string);
    if (!toRefresh.length) return;

    setRefreshing(true);
    try {
      const { results } = await chatApi.refreshComboMessages(orgId, cid, toRefresh);
      if (!results?.length) return;

      const resultMap = new Map(results.map(r => [r.executionId, r]));

      setMessages(prev => prev.map(m => {
        if (!m.execution_id) return m;
        const fresh = resultMap.get(m.execution_id);
        if (!fresh || fresh.status === 'failed') return m;
        return {
          ...m,
          rows: fresh.rows,
          columns: fresh.columns,
          totalMs: fresh.execution_time_ms,
        };
      }));
    } catch (e) { console.error('refreshComboMessages failed:', e); }
    finally { setRefreshing(false); }
  }

  async function switchChat(cid: string) {
    setCurrentChatId(cid);
    setMessages([]);
    setShowChatList(false);
    router.replace(`/orgs/${slug}/combos/${comboId}/chat?chatId=${cid}`, { scroll: false });
    if (org) await loadMessages(org.id, cid);
  }

  async function newChat() {
    if (!org) return;
    setCurrentChatId('new');
    setMessages([]);
    setShowChatList(false);
    router.replace(`/orgs/${slug}/combos/${comboId}/chat?chatId=new`, { scroll: false });
  }

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || sending || !org || !currentChatId) return;
    const prompt = input.trim();
    setInput('');
    setSending(true);

    // Optimistic user message
    const tempId = `u-${Date.now()}`;
    setMessages(ms => [...ms, { id: tempId, role: 'user', content: prompt, created_at: new Date().toISOString() }]);

    try {
      let activeCid = currentChatId;
      if (activeCid === 'new') {
        // Lazily create the chat session now that the user sent a message
        const title = prompt.slice(0, 50) + (prompt.length > 50 ? '…' : '');
        const { chat } = await chatApi.create(org.id, { comboId, title });
        activeCid = chat.id;
        setCurrentChatId(activeCid);
        setChats(prev => [chat, ...prev]);
        router.replace(`/orgs/${slug}/combos/${comboId}/chat?chatId=${activeCid}`, { scroll: false });
      }

      // Pass chatId so the backend persists user + assistant messages
      const result = await comboApi.query(org.id, comboId, prompt, activeCid);
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
            execution_id: result.executionId,
          },
        ];
      });

      // Update chat's message count in sidebar
      setChats(prev => prev.map(c => c.id === activeCid
        ? { ...c, message_count: (c.message_count || 0) + 2 }
        : c));

      // Auto-title the chat on the first exchange
      const currentChat = chats.find(c => c.id === activeCid);
      if (currentChat && (!currentChat.title || currentChat.title === 'New Combo Chat' || currentChat.title === combo?.name)) {
        const autoTitle = prompt.slice(0, 50) + (prompt.length > 50 ? '…' : '');
        await chatApi.updateTitle(org.id, activeCid, autoTitle).catch(() => {});
        setChats(prev => prev.map(c => c.id === activeCid ? { ...c, title: autoTitle } : c));
      }
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

  const currentChat = chats.find(c => c.id === currentChatId);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Header ───────────────────────────────────────────── */}
      <header
        className="h-12 border-b border-border bg-background/95 backdrop-blur-md px-5 flex items-center gap-3 shrink-0"
        style={{ boxShadow: 'var(--shadow-soft)' }}
      >
        {/* Combo indicator */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <GitFork className="w-4 h-4 text-primary" />
          </div>
          <span className="text-xs text-muted-foreground hidden sm:block">{combo?.name || 'Combo'}</span>
        </div>

        <div className="w-px h-4 bg-border shrink-0" />

        {/* Chat selector dropdown */}
        <div className="relative shrink-0" ref={chatListRef}>
          <button
            onClick={() => setShowChatList(v => !v)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted/60 transition-colors max-w-xs"
          >
            <MessageSquare className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-sm font-semibold text-foreground truncate">
              {currentChat?.title || 'New Chat'}
            </span>
            {chats.length > 0 && (
              <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${showChatList ? 'rotate-180' : ''}`} />
            )}
          </button>

          {/* Chat history dropdown */}
          {showChatList && chats.length > 0 && (
            <div
              className="absolute top-full left-0 mt-1 w-72 bg-card border border-border rounded-xl shadow-lg z-20 py-1 animate-fade-in overflow-hidden"
              style={{ boxShadow: 'var(--shadow-elevated)' }}
            >
              <div className="px-3 pt-2 pb-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Chat History ({chats.length})
                </p>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {chats.map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => switchChat(c.id)}
                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                      currentChatId === c.id
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-muted/60'
                    }`}
                  >
                    <p className="font-medium truncate">{c.title || 'Untitled'}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.message_count || 0} messages</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Navigation Action Buttons */}
        <div className="flex items-center gap-2 ml-4 shrink-0">
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 text-primary border border-primary/20 shrink-0"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chat</span>
          </div>
          <Link
            href={`/orgs/${slug}/combos/${comboId}/dashboard`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </Link>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right actions */}
        <div className="flex items-center gap-2 shrink-0">
          {sending && (
            <div className="flex items-center gap-2 text-xs text-primary shrink-0">
              <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />
              Planning queries…
            </div>
          )}
          {refreshing && !sending && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span className="hidden sm:block">Refreshing data…</span>
            </div>
          )}
          <button
            onClick={newChat}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 rounded-lg text-xs font-semibold text-primary transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </button>
        </div>
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
              disabled={!input.trim() || sending || !currentChatId}
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
        <AddToDashboardModal orgId={org.id} comboId={comboId} message={addToDashMsg} onClose={() => setAddToDashMsg(null)} />
      )}
      {saveCardMsg && org && (
        <SaveCardModal orgId={org.id} comboId={comboId} message={saveCardMsg} onClose={() => setSaveCardMsg(null)} />
      )}
    </div>
  );
}
