'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { chatApi, orgApi, connectionApi } from '@/lib/api';
import { usePrefsStore } from '@/lib/prefs-store';
import dynamic from 'next/dynamic';
import {
  Plus, Send, MessageSquare,
  CheckCircle2, XCircle, Code2, ChevronDown, Play,
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
  running,
}: {
  initialSQL: string;
  executionId?: string;
  messageId: string;
  onRun: (messageId: string, executionId: string, sql: string) => void;
  running: boolean;
}) {
  const [sql, setSQL] = useState(initialSQL);

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
        onChange={e => setSQL(e.target.value)}
        disabled={running}
        rows={Math.min(12, Math.max(3, sql.split('\n').length + 1))}
        className="w-full text-xs font-mono bg-muted/70 border border-primary/20 rounded-xl px-3 py-2.5 text-foreground resize-y min-h-[72px] focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all disabled:opacity-50"
        spellCheck={false}
      />

      {/* Execute button */}
      <button
        onClick={() => onRun(messageId, executionId || '', sql)}
        disabled={running || !sql.trim()}
        className="w-full py-2.5 bg-primary text-white text-xs font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
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
  );
}

// ── Message Bubble ─────────────────────────────────────────────
function ChatBubble({
  message,
  autoExecute,
  showGeneratedSQL,
  onRunSQL,
}: {
  message: Message;
  autoExecute: boolean;
  showGeneratedSQL: boolean;
  onRunSQL: (messageId: string, executionId: string, sql: string) => void;
}) {
  const [showSQL, setShowSQL] = useState(false);
  const hasChart = message.result_preview?.length && message.result_columns?.length;

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
          <p className="text-sm text-foreground leading-relaxed">{message.content}</p>

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
          <GenerativeUIRenderer
            execution={{
              rows: message.result_preview || [],
              columns: message.result_columns || [],
              rowCount: message.row_count || 0,
              executionTimeMs: message.execution_time_ms || 0,
            } as any}
            uiHint={message.ui_hint as any}
          />
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
        ui_hint: exec?.ui_hint,
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
            ui_hint: autoExecute ? exec?.ui_hint : undefined,
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
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

      {/* ── Header ──────────────────────────────────────────── */}
      <header
        className="h-12 border-b border-border bg-background/95 backdrop-blur-md px-5 flex items-center gap-3 shrink-0"
        style={{ boxShadow: 'var(--shadow-soft)' }}
      >
        {/* Connection label */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
            {(conn?.connector_type?.[0] ?? 'DB').toUpperCase()}
          </div>
          <span className="text-xs font-medium text-muted-foreground hidden sm:block">{conn?.name}</span>
          <div className="w-1.5 h-1.5 rounded-full bg-success" title="Connected" />
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
                <span className="text-3xl">🤖</span>
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
    </div>
  );
}
