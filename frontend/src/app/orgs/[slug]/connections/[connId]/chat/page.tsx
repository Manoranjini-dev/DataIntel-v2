'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { chatApi, orgApi, connectionApi, dashboardApi, cardApi } from '@/lib/api';
import { usePrefsStore } from '@/lib/prefs-store';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { resolveComponent } from '@/components/generative-ui';
import {
  Plus, Send, MessageSquare, Sparkles,
  CheckCircle2, XCircle, Code2, ChevronDown, Play,
  LayoutDashboard, BookMarked, X, Save,
} from 'lucide-react';

const GenerativeUIRenderer = dynamic(
  () => import('@/components/generative-ui').then((m) => m.GenerativeUIRenderer),
  { ssr: false, loading: () => <div className="h-32 animate-pulse rounded-xl bg-muted" /> }
);

// ── Types ──────────────────────────────────────────────────────
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  exec_status?: string;
  row_count?: number;
  execution_time_ms?: number;
  generated_query?: string;
  result_preview?: Record<string, unknown>[];
  result_columns?: string[];
  ui_hint?: string;
  // Editable SQL fields (used when autoExecute = false)
  executionId?: string;
  pending_execution?: boolean;
  sql_running?: boolean;
}

// ── Editable SQL block ─────────────────────────────────────────
function EditableSQLBlock({
  initialSQL,
  executionId,
  messageId,
  onRun,
  onSave,
  running,
}: {
  initialSQL: string;
  executionId?: string;
  messageId: string;
  onRun: (messageId: string, executionId: string, sql: string) => void;
  onSave?: (sql: string) => void;
  running: boolean;
}) {
  const [sql, setSQL] = useState(initialSQL);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    onSave?.(sql);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mt-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <Code2 className="w-3.5 h-3.5" /> Generated SQL
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
          Editable
        </span>
      </div>

      {/* Editable textarea */}
      <textarea
        value={sql}
        onChange={e => { setSQL(e.target.value); setSaved(false); }}
        disabled={running}
        rows={Math.min(12, Math.max(3, sql.split('\n').length + 1))}
        className="w-full text-xs font-mono bg-muted/70 border border-primary/20 rounded-xl px-3 py-2.5 text-foreground resize-y min-h-[72px] focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all disabled:opacity-50"
        spellCheck={false}
      />

      {/* Action buttons */}
      <div className="flex gap-2">
        {/* Save to Card Library */}
        {onSave && (
          <button
            onClick={handleSave}
            disabled={running || !sql.trim()}
            className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-40 border ${
              saved
                ? 'bg-success/10 border-success/30 text-success'
                : 'bg-muted/70 border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            {saved ? 'Saved!' : 'Save'}
          </button>
        )}

        {/* Execute */}
        <button
          onClick={() => onRun(messageId, executionId || '', sql)}
          disabled={running || !sql.trim()}
          className="flex-1 py-2.5 bg-primary text-white text-xs font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {running ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Running…
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              Execute Query
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Message Bubble ─────────────────────────────────────────────
function ChatBubble({
  message,
  autoExecute,
  showGeneratedSQL,
  onRunSQL,
  onAddToDashboard,
  onSaveCard,
}: {
  message: Message;
  autoExecute: boolean;
  showGeneratedSQL: boolean;
  onRunSQL: (messageId: string, executionId: string, sql: string) => void;
  onAddToDashboard?: (msg: Message) => void;
  onSaveCard?: (msg: Message) => void;
}) {
  const [showSQL, setShowSQL] = useState(false);
  // Fix: use explicit boolean to avoid React rendering "0"
  const hasChart = (message.result_preview?.length ?? 0) > 0 && (message.result_columns?.length ?? 0) > 0;

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

  // When auto-execute is OFF and SQL is pending, show editable SQL block
  const isPendingSQL = !autoExecute && message.pending_execution && message.generated_query;
  // When auto-execute is ON, show SQL only when user toggled it (or if showGeneratedSQL pref is on)
  const showReadOnlySQL = autoExecute && message.generated_query && (showSQL || showGeneratedSQL);

  return (
    <div className="flex gap-3 mb-5">
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
          <div className="text-sm text-foreground leading-relaxed prose prose-sm max-w-none prose-p:my-1 prose-strong:text-foreground prose-code:text-primary prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>

          {/* Status bar — only after execution */}
          {message.exec_status && !isPendingSQL && (
            <div className="flex flex-wrap items-center gap-3 mt-2.5 pt-2.5 border-t border-border">
              <span className={`text-xs font-medium flex items-center gap-1.5 ${message.exec_status === 'success' ? 'text-success' : 'text-destructive'}`}>
                {message.exec_status === 'success'
                  ? <CheckCircle2 className="w-3.5 h-3.5" />
                  : <XCircle className="w-3.5 h-3.5" />}
                {message.exec_status}
              </span>
              {message.row_count !== undefined && (
                <span className="text-xs text-muted-foreground">{message.row_count} rows</span>
              )}
              {message.execution_time_ms !== undefined && (
                <span className="text-xs text-muted-foreground">{message.execution_time_ms}ms</span>
              )}
              {/* SQL toggle — only shown when autoExecute=ON and not using the pref default */}
              {autoExecute && message.generated_query && !showGeneratedSQL && (
                <button
                  onClick={() => setShowSQL(v => !v)}
                  className="ml-auto text-xs text-primary hover:opacity-80 flex items-center gap-1 transition-opacity"
                >
                  <Code2 className="w-3 h-3" />
                  {showSQL ? 'Hide SQL' : 'View SQL'}
                </button>
              )}
            </div>
          )}

          {/* Editable SQL (autoExecute=OFF, awaiting execution) */}
          {isPendingSQL && (
            <div className="mt-2.5 pt-2.5 border-t border-border">
              <EditableSQLBlock
                initialSQL={message.generated_query!}
                executionId={message.executionId}
                messageId={message.id}
                onRun={onRunSQL}
                onSave={onSaveCard ? (sql) => onSaveCard({ ...message, generated_query: sql }) : undefined}
                running={!!message.sql_running}
              />
            </div>
          )}

          {/* Read-only SQL (autoExecute=ON, shown via pref or toggle) */}
          {showReadOnlySQL && (
            <pre className="mt-2.5 text-xs bg-muted border border-border rounded-xl px-3 py-2.5 overflow-x-auto text-foreground font-mono">
              {message.generated_query}
            </pre>
          )}
        </div>

        {/* Chart / data visualisation — shown only after execution */}
        {hasChart && !isPendingSQL && (
          <>
            <GenerativeUIRenderer
              execution={{
                rows: message.result_preview || [],
                columns: message.result_columns || [],
                rowCount: message.row_count || 0,
                executionTimeMs: message.execution_time_ms || 0,
              } as any}
              uiHint={message.ui_hint as any}
            />
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

// ── Main Chat Page ─────────────────────────────────────────────
export default function ConnectionChatPage() {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Preferences (in-memory Zustand store — no caching)
  const { autoExecute, showGeneratedSQL } = usePrefsStore();

  const chatId = searchParams.get('chatId') || 'new';
  const [org, setOrg] = useState<any>(null);
  const [conn, setConn] = useState<any>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(chatId === 'new' ? null : chatId);
  const [chats, setChats] = useState<any[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showChatList, setShowChatList] = useState(false);
  const [addToDashMsg, setAddToDashMsg] = useState<Message | null>(null);
  const [saveCardMsg, setSaveCardMsg] = useState<Message | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatListRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadData(); }, [slug, connId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Close dropdown on outside click
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
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const { connection: c } = await connectionApi.get(o.id, connId);
      setConn(c);
      const { chats: chatList } = await chatApi.list(o.id, { connectionId: connId });
      setChats(chatList);
      if (currentChatId && currentChatId !== 'new') await loadMessages(o.id, currentChatId);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function loadMessages(orgId: string, cid: string) {
    try {
      const { messages: msgs } = await chatApi.getMessages(orgId, cid);
      setMessages(msgs.map((m: any) => ({
        ...m,
        result_preview: typeof m.result_preview === 'string' ? JSON.parse(m.result_preview) : (m.result_preview || []),
        result_columns: typeof m.result_columns === 'string' ? JSON.parse(m.result_columns) : (m.result_columns || []),
        // Persisted messages are already executed
        pending_execution: false,
      })));
    } catch (e) { console.error(e); }
  }

  async function switchChat(cid: string) {
    setCurrentChatId(cid);
    setMessages([]);
    setShowChatList(false);
    if (org) await loadMessages(org.id, cid);
    router.replace(`/orgs/${slug}/connections/${connId}/chat?chatId=${cid}`);
  }

  function newChat() {
    setCurrentChatId(null);
    setMessages([]);
    setShowChatList(false);
    router.replace(`/orgs/${slug}/connections/${connId}/chat?chatId=new`);
  }

  // ── Execute SQL that user has (potentially) edited ─────────────
  async function handleRunSQL(messageId: string, executionId: string, sql: string) {
    if (!org || !currentChatId) return;

    // Mark message as running
    setMessages(ms => ms.map(m => m.id === messageId ? { ...m, sql_running: true } : m));

    try {
      const result = await chatApi.executeDraft(org.id, currentChatId, executionId, sql);
      const exec = result.execution ?? result;

      setMessages(ms => ms.map(m => m.id === messageId ? {
        ...m,
        // Update SQL in case user modified it
        generated_query: sql,
        exec_status: exec?.status ?? 'success',
        row_count: exec?.row_count,
        execution_time_ms: exec?.execution_time_ms,
        result_preview: exec?.rows?.slice(0, 50) ?? [],
        result_columns: exec?.columns ?? [],
        // executeDraft returns no ui_hint — keep the existing value from when the
        // LLM originally created this message (stored in chat_messages.ui_hint)
        // Clear pending state — execution complete
        pending_execution: false,
        sql_running: false,
      } : m));
    } catch (err: any) {
      setMessages(ms => ms.map(m => m.id === messageId ? {
        ...m,
        exec_status: 'error',
        pending_execution: false,
        sql_running: false,
        content: m.content + (err?.message ? `\n\nError: ${err.message}` : ''),
      } : m));
    }
  }

  // ── Send a natural-language prompt ─────────────────────────────
  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || sending || !org) return;
    const prompt = input.trim();
    setInput('');
    setSending(true);

    const tempId = `temp-${Date.now()}`;
    setMessages(ms => [...ms, { id: tempId, role: 'user', content: prompt, created_at: new Date().toISOString() }]);

    try {
      let targetChatId = currentChatId;

      if (!targetChatId) {
        const { chat: newChatObj } = await chatApi.create(org.id, {
          connectionId: connId,
          title: prompt.slice(0, 50) + (prompt.length > 50 ? '…' : ''),
        });
        targetChatId = newChatObj.id;
        setCurrentChatId(targetChatId);
        setChats(prev => [newChatObj, ...prev]);
        router.replace(`/orgs/${slug}/connections/${connId}/chat?chatId=${targetChatId}`);
      }

      // Pass autoExecute preference to backend
      const result = await chatApi.ask(org.id, targetChatId!, prompt, autoExecute);

      setMessages(ms => {
        const filtered = ms.filter(m => m.id !== tempId);
        const newMsgs: Message[] = [];

        if (result.userMessage) newMsgs.push({
          ...result.userMessage,
          result_preview: [],
          result_columns: [],
          pending_execution: false,
        });

        if (result.assistantMessage) {
          const exec = result.execution;
          newMsgs.push({
            ...result.assistantMessage,
            exec_status: autoExecute ? exec?.status : undefined,
            row_count: autoExecute ? exec?.row_count : undefined,
            execution_time_ms: autoExecute ? exec?.execution_time_ms : undefined,
            generated_query: exec?.generated_query,
            result_preview: autoExecute ? (exec?.rows?.slice(0, 50) ?? []) : [],
            result_columns: autoExecute ? (exec?.columns ?? []) : [],
            // ui_hint comes from assistantMessage (stored in chat_messages.ui_hint by the LLM).
            // query_executions has no ui_hint column, so do NOT read exec?.ui_hint — it is
            // always undefined and would overwrite the correct value from the spread above.
            // When autoExecute=OFF there is no data yet, so clear the hint to hide the chart.
            ...(autoExecute ? {} : { ui_hint: undefined }),
            // Execution identity for the draft endpoint
            executionId: exec?.id ?? result.executionId,
            // When autoExecute=OFF, mark as pending so UI shows editable SQL
            pending_execution: !autoExecute && !!exec?.generated_query,
          });
        }

        return [...filtered, ...newMsgs];
      });

      setChats(prev => prev.map(c => c.id === targetChatId
        ? { ...c, message_count: (c.message_count || 0) + 2 } : c));
    } catch (err: any) {
      setMessages(ms => ms.filter(m => m.id !== tempId));
      setMessages(ms => [...ms, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${err.message}`,
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  const SUGGESTIONS = [
    'Show me all tables',
    'How many records are in each table?',
    'What are the top 10 rows by ID?',
    'Show column structure of each table',
  ];

  const currentChat = chats.find(c => c.id === currentChatId);

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Header ──────────────────────────────────────────── */}
      <header
        className="h-12 border-b border-border bg-background/95 backdrop-blur-md px-5 flex items-center gap-3 shrink-0"
        style={{ boxShadow: 'var(--shadow-soft)' }}
      >
        {/* Connection status dot */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-success" title="Connected" />
          <span className="text-xs text-muted-foreground hidden sm:block">{conn?.name}</span>
        </div>

        <div className="w-px h-4 bg-border shrink-0" />

        {/* Auto-execute indicator */}
        {!autoExecute && (
          <>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg bg-warning/10 text-yellow-600 dark:text-yellow-400 border border-warning/30">
              <Play className="w-3 h-3" /> Manual execution
            </span>
            <div className="w-px h-4 bg-border shrink-0 hidden sm:block" />
          </>
        )}

        {/* Chat selector */}
        <div className="relative flex-1 min-w-0" ref={chatListRef}>
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

        {/* Right actions */}
        <div className="flex items-center gap-2 shrink-0">
          {sending && (
            <div className="flex items-center gap-1.5 text-xs text-primary">
              <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />
              <span className="hidden sm:block">Thinking…</span>
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

      {/* ── Messages ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(217,122,30,.15), rgba(245,166,35,.15))', border: '1px solid rgba(217,122,30,.2)' }}
              >
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground mb-2">Ask your database anything</h2>
                <p className="text-muted-foreground text-sm max-w-sm leading-relaxed">
                  {autoExecute
                    ? 'Natural language queries, instant answers. Just type what you want to know.'
                    : 'Auto-execute is off. The AI will generate SQL for you to review and run manually.'}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="text-xs px-3.5 py-2 border border-border rounded-full text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(msg => (
              <ChatBubble
                key={msg.id}
                message={msg}
                autoExecute={autoExecute}
                showGeneratedSQL={showGeneratedSQL}
                onRunSQL={handleRunSQL}
                onAddToDashboard={setAddToDashMsg}
                onSaveCard={setSaveCardMsg}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input bar ───────────────────────────────────────── */}
      <div className="border-t border-border bg-background/95 backdrop-blur-md shrink-0">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <form onSubmit={handleSend} className="flex gap-3 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={autoExecute ? 'Ask anything about your data…' : 'Ask anything — SQL will be shown for review before running…'}
              rows={1}
              disabled={sending}
              className="flex-1 resize-none px-4 py-3 bg-muted/50 border border-border rounded-2xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 max-h-32 overflow-y-auto transition-all"
              style={{ minHeight: '48px' }}
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="w-11 h-11 shrink-0 rounded-2xl bg-primary flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </form>
          <p className="text-[11px] text-muted-foreground/50 text-center mt-2">
            {autoExecute ? 'Enter to send · Shift+Enter for new line' : 'Enter to generate SQL · review and run manually'}
          </p>
        </div>
      </div>

      {/* ── Add to Dashboard Modal ──────────────────────────── */}
      {addToDashMsg && org && (
        <AddToDashboardModal
          orgId={org.id}
          orgSlug={slug}
          connId={connId}
          message={addToDashMsg}
          onClose={() => setAddToDashMsg(null)}
        />
      )}

      {/* ── Save Card Modal ──────────────────────────────────── */}
      {saveCardMsg && org && (
        <SaveCardModal
          orgId={org.id}
          connId={connId}
          message={saveCardMsg}
          onClose={() => setSaveCardMsg(null)}
        />
      )}
    </div>
  );
}

// ── Normalize LLM ui_hint → valid widget_type / chart_type enum ─
function normalizeWidgetType(hint?: string): string {
  // Map extended LLM hints to the actual PostgreSQL enum values
  const MAP: Record<string, string> = {
    data_table:      'table',
    stat_grid:       'metric_card',
    stacked_bar:     'bar_chart',
    horizontal_bar:  'bar_chart',
    scatter_plot:    'scatter',
    gauge_chart:     'gauge',
    funnel_chart:    'funnel',
    timeline:        'line_chart',
    radar_chart:     'bar_chart',
    comparison_card: 'metric_card',
    number_trend:    'metric_card',
    list:            'table',
  };
  const VALID = new Set([
    'metric_card', 'line_chart', 'area_chart', 'bar_chart', 'pie_chart',
    'donut_chart', 'table', 'heatmap', 'funnel', 'scatter', 'pivot',
    'gauge', 'treemap', 'sankey', 'text', 'image', 'divider', 'filter_control',
  ]);
  const normalized = MAP[hint || ''] || hint || 'table';
  return VALID.has(normalized) ? normalized : 'table';
}

// ── Add to Dashboard Modal ─────────────────────────────────────
function AddToDashboardModal({ orgId, connId, message, onClose }: {
  orgId: string; orgSlug?: string; connId: string; message: Message; onClose: () => void;
}) {
  const [dashboards, setDashboards] = useState<any[]>([]);
  const [selectedDash, setSelectedDash] = useState<string>('');
  const [pages, setPages] = useState<any[]>([]);
  const [selectedPage, setSelectedPage] = useState<string>('');
  const [title, setTitle] = useState(message.content.slice(0, 60));
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dashboardApi.list(orgId).then(res => {
      setDashboards(res.dashboards);
      if (res.dashboards.length > 0) setSelectedDash(res.dashboards[0].id);
    }).catch(console.error);
  }, [orgId]);

  useEffect(() => {
    if (!selectedDash) return;
    setSelectedPage(''); // Reset page until fetched
    dashboardApi.get(orgId, selectedDash).then(res => {
      setPages(res.pages || []);
      if (res.pages?.length > 0) setSelectedPage(String(res.pages[0].id));
    }).catch(console.error);
  }, [selectedDash, orgId]);

  async function handleAdd() {
    if (!selectedDash || !selectedPage) return;
    setSaving(true); setError('');
    try {
      let parsedRows = [];
      if (typeof message.result_preview === 'string') {
        try { parsedRows = JSON.parse(message.result_preview); } catch { parsedRows = []; }
        if (!Array.isArray(parsedRows)) parsedRows = [];
      } else if (Array.isArray(message.result_preview)) {
        parsedRows = message.result_preview;
      }
      
      let parsedCols = message.result_columns || [];
      if (typeof parsedCols === 'string') {
        try { parsedCols = JSON.parse(parsedCols); } catch { parsedCols = []; }
        if (!Array.isArray(parsedCols)) parsedCols = [];
      }

      // Resolve the actual component type used in the chat (auto-detect)
      const resolvedHint = resolveComponent({ rows: parsedRows, columns: parsedCols } as any, message.ui_hint as any);
      const widgetType = normalizeWidgetType(resolvedHint);

      await dashboardApi.addWidget(orgId, selectedDash, selectedPage, {
        title: title || 'Untitled Widget',
        widget_type: widgetType,
        queryPrompt: message.content,
        sql: message.generated_query || '',
        resultRows: parsedRows,
        resultColumns: parsedCols,
        uiHint: resolvedHint,
        gridX: 0, gridY: 999, gridW: 4, gridH: 3,
        datasourceScopeType: 'connection',
        datasourceContextId: connId,
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
            <button onClick={handleAdd} disabled={saving || !selectedDash}
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

// ── Save Card Modal ────────────────────────────────────────────
function SaveCardModal({ orgId, connId, message, onClose }: {
  orgId: string; connId: string; message: Message; onClose: () => void;
}) {
  const [name, setName] = useState(message.content.slice(0, 60));
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true); setError('');
    try {
      // Normalize ui_hint to a valid chart_type enum value (same enum as widget_type)
      const chartType = normalizeWidgetType(message.ui_hint);
      await cardApi.create(orgId, {
        name,
        description:            message.content.slice(0, 500),
        rawQuery:               message.generated_query || '',
        chartType,
        // Required NOT NULL fields
        datasourceContextType:  'connection',
        datasourceContextId:    connId,
        // Store prompt + SQL in queryDefinition JSONB
        queryDefinition: {
          prompt:    message.content,
          sql:       message.generated_query || '',
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
              <p className="text-xs text-muted-foreground mt-1">Find it in Cards</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Card Name</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <p className="text-xs text-muted-foreground">
                Chart type: <span className="font-medium text-foreground">{normalizeWidgetType(message.ui_hint)}</span>
              </p>
              {error && (
                <p className="text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-xl px-3 py-2">{error}</p>
              )}
            </div>
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
