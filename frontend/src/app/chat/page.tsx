'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Database,
  Table2,
  LogOut,
  Loader2,
  AlertTriangle,
  Zap,
  Settings,
  Network as NetworkIcon,
  Star,
  X,
  Keyboard,
  RefreshCw,
  LayoutDashboard,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Search,
  Sparkles,
  Copy,
  Check,
  Shield,
  Plus,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSession } from '@/hooks/use-session';
import {
  ask,
  executeQuery,
  disconnect as disconnectApi,
  connect as connectApi,
  getConnectionStatus,
  APIError,
} from '@/lib/api';
import { SQLBlock } from '@/components/chat/sql-block';
import { MetadataStrip } from '@/components/chat/metadata-strip';
import {
  loadSettings,
  loadParams,
  savePinnedQuery,
  loadPinnedQueries,
  removePinnedQuery,
} from '@/lib/storage';
import { addDashboardWidget } from '@/lib/store';
import type { PinnedQuery } from '@/lib/storage';
import type { ChatMessage, ConnectorType, UIHint, DashboardWidgetResult } from '@/lib/types';
import { getConnectorFamily } from '@/lib/types';

const GenerativeUIRenderer = dynamic(
  () => import('@/components/generative-ui').then((m) => m.GenerativeUIRenderer),
  {
    ssr: false,
    loading: () => <div className="h-40 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />,
  },
);

/* ── Friendly error translator ────────────────────────── */
function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out'))
    return 'That query took too long to run. Try asking for less data or a simpler question.';
  if (lower.includes('no schema') || lower.includes('no tables'))
    return "I couldn't find any tables in your database. Please check your connection and try again.";
  if (lower.includes('validation') || lower.includes('re-validation'))
    return "The generated query didn't pass safety checks. Try rephrasing your question.";
  if (lower.includes('connect') || lower.includes('econnrefused') || lower.includes('enotfound'))
    return 'It looks like the database connection was lost. Try reconnecting.';
  if (lower.includes('permission') || lower.includes('access denied'))
    return "You don't have permission to run that query. Contact your database administrator.";
  if (lower.includes('syntax') || lower.includes('parse'))
    return 'There was a problem generating the query. Please try rephrasing your question.';
  if (lower.includes('fetch') || lower.includes('network'))
    return 'Network error — please check your internet connection and try again.';
  // Surface the message as-is if it looks like a human-readable explanation from the backend
  return raw;
}

/** Map a backend StructuredError type to a user-facing message. */
function mapStructuredError(structured: { type: string; message: string }): string {
  switch (structured.type) {
    case 'LLM_FORMAT_VIOLATION':
      return "I wasn't able to generate a valid query for that question. Try rephrasing — e.g. \"top 10 customers by total spend last month\".";
    case 'VALIDATION_REJECTION':
      return "The generated query didn't pass safety checks. Try rephrasing your question.";
    case 'EXECUTION_TIMEOUT':
      return 'That query took too long to run. Try asking for less data or a more specific time range.';
    case 'UNAUTHORIZED':
      return "You don't have permission to run that query.";
    default:
      return friendlyError(structured.message);
  }
}

/* ════════════════════════════════════════════════════════ */

export default function ChatPage() {
  const router = useRouter();
  const {
    sessionId,
    connection,
    tables,
    messages,
    isConnected,
    pushMessage,
    patchLastMessage,
    patchMessageById,
    disconnect,
    connect: setConnected,
  } = useSession();

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSQL, setShowSQL] = useState(true);
  const [autoApprove, setAutoApprove] = useState(true);
  const [dashboardEnabled, setDashboardEnabled] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'tables' | 'history'>('tables');
  const [pinnedQueries, setPinnedQueries] = useState<PinnedQuery[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [tablesExpanded, setTablesExpanded] = useState(true);
  const [searchTables, setSearchTables] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ── Boot ───────────────────────────────────── */
  useEffect(() => { setPinnedQueries(loadPinnedQueries()); }, []);

  useEffect(() => {
    const prefill = sessionStorage.getItem('sqli_prefill');
    if (prefill) { setInput(prefill); sessionStorage.removeItem('sqli_prefill'); setTimeout(() => inputRef.current?.focus(), 100); }
  }, []);

  useEffect(() => {
    const s = loadSettings();
    setShowSQL(s.showSQL);
    setAutoApprove(s.autoApprove !== false);
    setDashboardEnabled(s.dashboardEnabled !== false);
  }, []);

  useEffect(() => {
    const onFocus = () => {
      const s = loadSettings();
      setShowSQL(s.showSQL);
      setAutoApprove(s.autoApprove !== false);
      setDashboardEnabled(s.dashboardEnabled !== false);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); inputRef.current?.focus(); }
      if (e.key === '?' && !isTyping) { e.preventDefault(); setShowShortcuts((v) => !v); }
      if (e.key === 'Escape') setShowShortcuts(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* ── Handlers ───────────────────────────────── */
  const handleSubmit = useCallback(async () => {
    if (!input.trim() || !sessionId || isLoading) return;
    const prompt = input.trim();
    setInput('');
    setIsLoading(true);
    pushMessage({ id: `user-${Date.now()}`, role: 'user', content: prompt, timestamp: new Date() });
    pushMessage({ id: `assistant-${Date.now()}`, role: 'assistant', content: '', timestamp: new Date(), isStreaming: true });
    let activePlan: typeof undefined | Awaited<ReturnType<typeof ask>>['plan'];
    try {
      const { plan } = await ask(sessionId, prompt);
      activePlan = plan;
      if (plan.validationVerdict === 'REJECT') { patchLastMessage({ content: '', plan, isStreaming: false }); return; }
      if (plan.validationVerdict === 'CONVERSATIONAL') { patchLastMessage({ content: plan.explanation, plan, isStreaming: false }); return; }
      if (!autoApprove) {
        patchLastMessage({
          content: '',
          plan,
          pendingApproval: true,
          isStreaming: false,
        });
        return;
      }

      patchLastMessage({ content: '', plan, pendingApproval: false, isStreaming: true });
      const result = await executeQuery(sessionId, plan.sql, prompt, true);
      patchLastMessage({
        content: '', plan, pendingApproval: false, isStreaming: false,
        execution: { ...result, confidence: plan.confidence ?? result.confidence, tables_used: result.tables_used.length ? result.tables_used : plan.tables_used ?? [] },
      });
    } catch (err) {
      const msg =
        err instanceof APIError
          ? mapStructuredError(err.structured)
          : friendlyError(err instanceof Error ? err.message : 'Something went wrong');
      patchLastMessage({ content: msg, plan: activePlan, isStreaming: false });
    } finally { setIsLoading(false); inputRef.current?.focus(); }
  }, [input, sessionId, isLoading, autoApprove, pushMessage, patchLastMessage]);

  const handleRerun = useCallback(async (message: ChatMessage) => {
    if (!message.plan?.sql || !sessionId || isLoading) return;
    const msgIdx = messages.findIndex((m) => m.id === message.id);
    const origPrompt = msgIdx > 0 ? messages[msgIdx - 1].content : '';
    setIsLoading(true);
    patchMessageById(message.id, { isStreaming: true });
    try {
      const result = await executeQuery(sessionId, message.plan.sql, origPrompt, true);
      patchMessageById(message.id, {
        pendingApproval: false,
        isStreaming: false,
        execution: { ...result, confidence: message.plan.confidence ?? result.confidence, tables_used: result.tables_used.length ? result.tables_used : message.plan.tables_used ?? [] },
      });
    } catch (err) {
      patchMessageById(message.id, { isStreaming: false, content: friendlyError(err instanceof Error ? err.message : 'Re-run failed') });
    } finally { setIsLoading(false); }
  }, [messages, sessionId, isLoading, patchMessageById]);

  const handleDisconnect = useCallback(async () => {
    if (sessionId) await disconnectApi(sessionId).catch(() => {});
    disconnect();
    router.push('/connect');
  }, [sessionId, disconnect, router]);

  /* ── Gate ────────────────────────────────────── */
  if (!isConnected) {
    return (<div className="flex h-screen items-center justify-center bg-zinc-950"><Loader2 className="h-6 w-6 animate-spin text-zinc-500" /></div>);
  }

  const connectorFamily = connection?.connectorType ? getConnectorFamily(connection.connectorType as ConnectorType) : 'sql';
  const isES = connectorFamily === 'elasticsearch';
  const filteredTables = tables.filter((t) => t.name.toLowerCase().includes(searchTables.toLowerCase()));
  /* ── Render ─────────────────────────────────── */
  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950">
      {/* ── Left Sidebar ── */}
      <aside className="hidden w-56 flex-col border-r border-zinc-800/60 bg-zinc-950 lg:flex">
        {/* Logo */}
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

        {/* Nav */}
        <nav className="border-b border-zinc-800/60 px-2 py-2 space-y-0.5">
          {dashboardEnabled && (
            <button onClick={() => router.push('/dashboard')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </button>
          )}
          <button className="flex w-full items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2 text-[13px] font-medium text-white">
            <MessageSquare className="h-4 w-4 text-emerald-400" />
            Chat
          </button>
          <button onClick={() => router.push('/schema')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-white">
            <NetworkIcon className="h-4 w-4" />
            Schema Explorer
          </button>
        </nav>

        {/* Tab switch: Tables / History */}
        <div className="flex border-b border-zinc-800/60">
          <button onClick={() => setSidebarTab('tables')} className={`flex-1 py-2 text-[11px] font-medium transition-colors ${sidebarTab === 'tables' ? 'border-b-2 border-emerald-500 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {isES ? 'Indices' : 'Tables'}
          </button>
          <button onClick={() => setSidebarTab('history')} className={`flex-1 py-2 text-[11px] font-medium transition-colors ${sidebarTab === 'history' ? 'border-b-2 border-emerald-500 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
            History
          </button>
        </div>

        {sidebarTab === 'tables' ? (
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
                      <div key={table.name} className="flex items-center gap-2 rounded-md px-2 py-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-300 cursor-pointer" title={table.name}
                        onClick={() => { setInput(`Show me the top 10 rows from ${table.name}`); inputRef.current?.focus(); }}>
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
        ) : (
          <ScrollArea className="flex-1">
            <div className="px-2 py-2">
              {pinnedQueries.length > 0 && (
                <div className="mb-2">
                  <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500/80 flex items-center gap-1">
                    <Star className="h-2.5 w-2.5 fill-amber-500/80" /> Pinned
                  </p>
                  <div className="space-y-px">
                    {pinnedQueries.map((pq) => (
                      <div key={pq.id} className="group flex items-start gap-1 rounded-md px-1 py-1 hover:bg-white/5">
                        <button onClick={() => { setInput(pq.text); setSidebarTab('tables'); setTimeout(() => inputRef.current?.focus(), 50); }} className="flex-1 text-left">
                          <p className="text-[12px] text-zinc-300 line-clamp-2 leading-snug px-1.5">{pq.text}</p>
                        </button>
                        <button
                          title="Remove pinned query"
                          aria-label="Remove pinned query"
                          onClick={() => { removePinnedQuery(pq.id); setPinnedQueries(loadPinnedQueries()); }}
                          className="mt-0.5 shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-400"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="my-2 border-t border-zinc-800/40" />
                </div>
              )}
              <div className="space-y-px">
                {messages.filter((m) => m.role === 'user').slice().reverse().map((m) => {
                  const isPinned = pinnedQueries.some((pq) => pq.text === m.content);
                  return (
                    <div key={m.id} className="group flex items-start gap-1 rounded-md px-1 py-1 hover:bg-white/5">
                      <button onClick={() => { setInput(m.content); setSidebarTab('tables'); setTimeout(() => inputRef.current?.focus(), 50); }} className="flex-1 text-left pl-1.5">
                        <p className="text-[12px] text-zinc-300 line-clamp-2 leading-snug">{m.content}</p>
                        <p className="mt-0.5 text-[10px] text-zinc-600">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                      </button>
                      <button onClick={() => { if (isPinned) { const pq = pinnedQueries.find((p) => p.text === m.content); if (pq) removePinnedQuery(pq.id); } else { savePinnedQuery(m.content); } setPinnedQueries(loadPinnedQueries()); }}
                        className={`mt-0.5 shrink-0 rounded p-0.5 transition-colors ${isPinned ? 'text-amber-400' : 'text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-amber-400'}`} title={isPinned ? 'Unpin' : 'Pin query'}>
                        <Star className={`h-3 w-3 ${isPinned ? 'fill-amber-400' : ''}`} />
                      </button>
                    </div>
                  );
                })}
                {messages.filter((m) => m.role === 'user').length === 0 && (
                  <p className="px-2 py-6 text-center text-xs text-zinc-600">No queries yet</p>
                )}
              </div>
            </div>
          </ScrollArea>
        )}

        {/* Bottom actions */}
        <div className="border-t border-zinc-800/60 px-2 py-2 space-y-0.5">
          <button onClick={() => router.push('/settings')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300">
            <Settings className="h-3.5 w-3.5" /> Settings
          </button>
          <button onClick={handleDisconnect} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300">
            <LogOut className="h-3.5 w-3.5" /> Disconnect
          </button>
        </div>
      </aside>

      {/* ── Main Chat Area ── */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-zinc-800/60 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10">
              <Sparkles className="h-4 w-4 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-white">Chat</h1>
              <p className="text-[11px] text-zinc-500">Ask anything about your data</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-zinc-800 px-2.5 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-[11px] font-medium uppercase text-zinc-500">{connection?.connectorType}</span>
            </div>
            <button onClick={() => setShowShortcuts(true)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300" title="Keyboard shortcuts (?)">
              <Keyboard className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {/* Messages */}
        <ScrollArea className="flex-1">
          <div className="mx-auto max-w-3xl space-y-6 p-6">
            {messages.length === 0 && (
              <EmptyState onSuggestion={(s) => setInput(s)} tables={tables.map((t) => t.name)} isES={isES} />
            )}
            <AnimatePresence mode="popLayout">
              {messages.map((msg, idx) => {
                const prevMsg = idx > 0 ? messages[idx - 1] : undefined;
                return (
                <motion.div key={msg.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                  {msg.role === 'user' ? (
                    <UserMessage content={msg.content} />
                  ) : (
                    <AssistantMessage message={msg} showSQL={showSQL} onRerun={handleRerun}
                      onFollowUp={(q) => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50); }}
                      isLatest={idx === messages.length - 1}
                      userPrompt={prevMsg?.role === 'user' ? prevMsg.content : undefined} />
                  )}
                </motion.div>
              );})}
            </AnimatePresence>
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="border-t border-zinc-800/60 bg-zinc-950/80 p-4 backdrop-blur-sm">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="relative flex-1">
              <Input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
                placeholder={isES ? 'Search your indices, ask questions…' : 'Ask anything about your data… (Ctrl+K)'}
                disabled={isLoading} autoFocus
                className="border-zinc-800 bg-zinc-900/50 pr-10 text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-500/30" />
              {input.trim() && (
                <button
                  title="Clear input"
                  aria-label="Clear input"
                  onClick={() => setInput('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button onClick={handleSubmit} disabled={!input.trim() || isLoading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white transition-all hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </main>

      {/* Shortcuts modal */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowShortcuts(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10"><Keyboard className="h-3.5 w-3.5 text-emerald-400" /></div>
              <h2 className="font-semibold text-white">Keyboard Shortcuts</h2>
              <button title="Close shortcuts" aria-label="Close shortcuts" onClick={() => setShowShortcuts(false)} className="ml-auto rounded-md p-1.5 text-zinc-500 hover:bg-white/5"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-1">
              {[
                { keys: ['Ctrl', 'K'], label: 'Focus input' },
                { keys: ['Enter'], label: 'Send query' },
                { keys: ['?'], label: 'Show this modal' },
                { keys: ['Esc'], label: 'Dismiss modal' },
              ].map((s) => (
                <div key={s.label} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-white/5">
                  <span className="text-sm text-zinc-400">{s.label}</span>
                  <div className="flex gap-1">
                    {s.keys.map((k) => (
                      <kbd key={k} className="inline-flex items-center rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] font-medium text-zinc-300">{k}</kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────── */

const SQL_SUGGESTIONS = ['Top 10 customers by revenue', 'Orders placed last month', 'Best selling products', 'Products with low stock'];
const ES_SUGGESTIONS = ['Show the most recent 10 documents', 'Count documents by status', 'Aggregate events over the last 24 hours', 'Search for error messages'];

function EmptyState({ onSuggestion, tables, isES }: { onSuggestion: (s: string) => void; tables: string[]; isES: boolean }) {
  const baseSuggestions = isES ? ES_SUGGESTIONS : SQL_SUGGESTIONS;
  const suggestions = useMemo(() => {
    if (tables.length === 0) return baseSuggestions;
    const picked = tables.slice(0, 4);
    if (isES) {
      return [
        `Show latest 10 documents from ${picked[0]}`,
        picked[1] ? `Count documents in ${picked[1]}` : `How many documents in ${picked[0]}?`,
        picked[2] ? `Search ${picked[2]} for errors` : `Show field mappings for ${picked[0]}`,
        picked[3] ? `Aggregate data in ${picked[3]} by date` : `Find recent entries in ${picked[0]}`,
      ];
    }
    return [
      `Show me the top 10 rows from ${picked[0]}`,
      picked[1] ? `How many records are in ${picked[1]}?` : `Count all rows in ${picked[0]}`,
      picked[2] ? `Show recent entries in ${picked[2]}` : `Show columns of ${picked[0]}`,
      picked[3] ? `Summarize data across ${picked[3]}` : `Find duplicates in ${picked[0]}`,
    ];
  }, [tables, isES, baseSuggestions]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
        <Sparkles className="h-7 w-7 text-emerald-400" />
      </div>
      <h2 className="text-lg font-semibold text-white">{isES ? 'Ask your cluster anything' : 'Ask your database anything'}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-zinc-500">Natural language queries, instant answers. Just type what you want to know.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button key={s} onClick={() => onSuggestion(s)}
            className="rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-400 transition-all hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-emerald-300">
            {s}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function UserMessage({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex justify-end group">
      <div className="relative max-w-[75%]">
        <div className="rounded-2xl rounded-br-sm bg-emerald-600 px-4 py-2.5 text-sm text-white">
          {content}
        </div>
        <button onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="absolute -left-8 top-1/2 -translate-y-1/2 rounded-lg p-1 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-400">
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );
}

function generateFallbackInsight(execution: { rows: Record<string, unknown>[]; columns: string[]; rowCount: number }): string {
  const { rows, columns, rowCount } = execution;
  if (!rows || rows.length === 0) return 'No records were found matching your criteria.';
  const count = rowCount || rows.length;
  if (rows.length === 1 && columns.length >= 1) {
    const val = rows[0][columns[0]];
    const col = columns[0].replace(/_/g, ' ').toLowerCase();
    if (columns.length === 2) {
      const val2 = rows[0][columns[1]];
      const col2 = columns[1].replace(/_/g, ' ').toLowerCase();
      return `The result shows a **${col}** of **${val}** with **${col2}** of **${val2}**.`;
    }
    return `The result shows **${val}** for **${col}**.`;
  }
  const colNames = columns.slice(0, 3).map((c) => c.replace(/_/g, ' ')).join(', ');
  return `Found **${count}** result${count !== 1 ? 's' : ''} covering **${colNames}**${columns.length > 3 ? ` and ${columns.length - 3} more column${columns.length - 3 !== 1 ? 's' : ''}` : ''}.`;
}

function AssistantMessage({ message, showSQL, onRerun, onFollowUp, isLatest, userPrompt }: {
  message: ChatMessage; showSQL: boolean; onRerun: (message: ChatMessage) => void;
  onFollowUp: (question: string) => void; isLatest: boolean; userPrompt?: string;
}) {
  const [addedToDashboard, setAddedToDashboard] = useState(false);
  const effectiveHint: UIHint | undefined = message.plan?.ui_hint || message.execution?.ui_hint;
  const followUps = message.plan?.follow_up_questions || message.execution?.follow_up_questions || [];

  if (message.isStreaming) {
    return (
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10">
          <Zap className="h-3.5 w-3.5 text-indigo-400" />
        </div>
        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.4, repeat: Infinity }} className="flex gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
        </motion.div>
      </div>
    );
  }

  if (message.plan && message.pendingApproval && !message.execution) {
    return (
      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
            <Shield className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-emerald-300">Query ready for approval</p>
            <p className="mt-1 text-xs text-zinc-400">
              Auto-approval is disabled. Review the query, then click Run Query.
            </p>
            {message.plan.explanation && (
              <p className="mt-2 text-xs text-zinc-500">{message.plan.explanation}</p>
            )}
          </div>
        </div>

        {showSQL && message.plan.sql && <SQLBlock sql={message.plan.sql} />}

        <button
          onClick={() => onRerun(message)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Run Query
        </button>
      </div>
    );
  }

  if (message.plan?.validationVerdict === 'CONVERSATIONAL') {
    return (
      <div className="flex gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-blue-500/10">
          <MessageSquare className="h-3.5 w-3.5 text-blue-400" />
        </div>
        <div className="space-y-2">
          <p className="text-sm text-zinc-300 leading-relaxed">{message.content || message.plan.explanation}</p>
          {message.plan.follow_up_questions && message.plan.follow_up_questions.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-zinc-500">
              {message.plan.follow_up_questions.map((q, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-blue-400/40" />
                  {q}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (message.plan?.validationVerdict === 'REJECT') {
    return (
      <div className="flex gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-amber-400">Couldn&apos;t run that query</p>
          <ul className="space-y-0.5 text-xs text-zinc-400">
            {message.plan.validationReasons.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400/50" />{r}</li>
            ))}
          </ul>
          {message.plan.explanation && (
            <p className="mt-2 text-xs text-zinc-500">{message.plan.explanation}</p>
          )}
        </div>
      </div>
    );
  }

  if (message.content && !message.execution) {
    return (
      <div className="flex gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-red-500/10">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
        </div>
        <div>
          <p className="text-sm text-zinc-400">{message.content}</p>
          {message.plan?.explanation && (
            <p className="mt-1.5 text-xs text-zinc-600">{message.plan.explanation}</p>
          )}
        </div>
      </div>
    );
  }

  if (message.execution) {
    const insightText = message.execution.insight || generateFallbackInsight({
      rows: message.execution.rows,
      columns: message.execution.columns,
      rowCount: message.execution.rowCount,
    });
    return (
      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10">
            <Zap className="h-3.5 w-3.5 text-indigo-400" />
          </div>
          <div className="flex-1 text-sm leading-relaxed text-zinc-200">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
              em: ({ children }) => <em className="italic text-zinc-300">{children}</em>,
              p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="ml-4 mt-1.5 list-disc space-y-0.5 text-zinc-300">{children}</ul>,
              ol: ({ children }) => <ol className="ml-4 mt-1.5 list-decimal space-y-0.5 text-zinc-300">{children}</ol>,
              code: ({ children }) => <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-xs text-indigo-300">{children}</code>,
            }}>{insightText}</ReactMarkdown>
          </div>
        </div>

        {showSQL && message.plan?.sql && <SQLBlock sql={message.plan.sql} />}

        <div className="flex items-center gap-2">
          <MetadataStrip execution={message.execution} />
          {message.plan?.sql && (
            <button onClick={() => onRerun(message)} title="Re-run query"
              className="flex items-center justify-center rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300">
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
          {message.execution && message.execution.rows && message.execution.rows.length > 0 && (
            addedToDashboard ? (
              <span className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-400">
                <Check className="h-3 w-3" />
                Added!
              </span>
            ) : (
              <button
                onClick={() => {
                  const title = (userPrompt || message.plan?.explanation || 'Chat Widget').slice(0, 40);
                  const uiHint: UIHint = message.plan?.ui_hint || message.execution?.ui_hint || 'bar_chart';
                  const widget: DashboardWidgetResult = {
                    id: `chat-widget-${Date.now()}`,
                    title,
                    prompt: userPrompt || title,
                    ui_hint: uiHint,
                    size: 'md',
                    loading: false,
                    execution: message.execution,
                  };
                  addDashboardWidget(widget, { i: widget.id, x: 0, y: Infinity, w: 6, h: 5, minW: 3, minH: 3 });
                  setAddedToDashboard(true);
                  setTimeout(() => setAddedToDashboard(false), 2500);
                }}
                title="Add this visualization to dashboard"
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700/50 bg-zinc-800/40 px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition-all hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-300"
              >
                <LayoutDashboard className="h-3 w-3" />
                <Plus className="h-2.5 w-2.5" />
                Add to Dashboard
              </button>
            )
          )}
        </div>

        <GenerativeUIRenderer execution={message.execution} uiHint={effectiveHint} />

        {isLatest && followUps.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {followUps.map((q, i) => (
              <button key={i} onClick={() => onFollowUp(q)}
                className="rounded-full border border-zinc-700/50 bg-zinc-800/40 px-3 py-1.5 text-xs text-zinc-400 transition-all hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-emerald-300">
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}
