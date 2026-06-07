'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { chatApi, orgApi, connectionApi } from '@/lib/api';
import dynamic from 'next/dynamic';
import {
  Plus, Send, MessageSquare,
  CheckCircle2, XCircle, Code2, ChevronDown,
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
}

// ── Message Bubble ─────────────────────────────────────────────
function ChatBubble({ message }: { message: Message }) {
  const [showSQL, setShowSQL] = useState(false);
  const hasChart = message.result_preview?.length && message.result_columns?.length;

  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[72%] bg-primary text-white px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
          style={{ boxShadow: 'var(--shadow-soft)' }}>
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 mb-5">
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center text-xs shrink-0 mt-0.5"
        style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
      >
        <span className="text-white font-bold text-[11px]">AI</span>
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3"
          style={{ boxShadow: 'var(--shadow-soft)' }}>
          <p className="text-sm text-foreground leading-relaxed">{message.content}</p>

          {message.exec_status && (
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
              {message.generated_query && (
                <button onClick={() => setShowSQL(v => !v)}
                  className="ml-auto text-xs text-primary hover:opacity-80 flex items-center gap-1 transition-opacity">
                  <Code2 className="w-3 h-3" />
                  {showSQL ? 'Hide SQL' : 'View SQL'}
                </button>
              )}
            </div>
          )}
          {showSQL && message.generated_query && (
            <pre className="mt-2.5 text-xs bg-muted border border-border rounded-xl px-3 py-2.5 overflow-x-auto text-foreground font-mono">
              {message.generated_query}
            </pre>
          )}
        </div>

        {hasChart && (
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

      const result = await chatApi.ask(org.id, targetChatId!, prompt);

      setMessages(ms => {
        const filtered = ms.filter(m => m.id !== tempId);
        const newMsgs: Message[] = [];
        if (result.userMessage) newMsgs.push({
          ...result.userMessage,
          result_preview: result.execution?.rows?.slice(0, 50) || [],
          result_columns: result.execution?.columns || [],
        });
        if (result.assistantMessage) newMsgs.push({
          ...result.assistantMessage,
          exec_status: result.execution?.status,
          row_count: result.execution?.row_count,
          execution_time_ms: result.execution?.execution_time_ms,
          generated_query: result.execution?.generated_query,
          result_preview: result.execution?.rows?.slice(0, 50) || [],
          result_columns: result.execution?.columns || [],
          ui_hint: result.execution?.ui_hint,
        });
        return [...filtered, ...newMsgs];
      });

      setChats(prev => prev.map(c => c.id === targetChatId
        ? { ...c, message_count: (c.message_count || 0) + 2 } : c));
    } catch (err: any) {
      setMessages(ms => ms.filter(m => m.id !== tempId));
      setMessages(ms => [...ms, { id: `err-${Date.now()}`, role: 'assistant', content: `Error: ${err.message}`, created_at: new Date().toISOString() }]);
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
      <header className="h-12 border-b border-border bg-background/95 backdrop-blur-md px-5 flex items-center gap-3 shrink-0" style={{ boxShadow: 'var(--shadow-soft)' }}>
        {/* Connection label */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
            {(conn?.connector_type?.[0] ?? 'DB').toUpperCase()}
          </div>
          <span className="text-xs font-medium text-muted-foreground hidden sm:block">{conn?.name}</span>
          <div className="w-1.5 h-1.5 rounded-full bg-success" title="Connected" />
        </div>

        <div className="w-px h-4 bg-border shrink-0" />

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
            <div className="absolute top-full left-0 mt-1 w-72 bg-card border border-border rounded-xl shadow-lg z-20 py-1 animate-fade-in overflow-hidden"
              style={{ boxShadow: 'var(--shadow-elevated)' }}>
              <div className="px-3 pt-2 pb-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Chat History ({chats.length})
                </p>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {chats.map((c: any) => (
                  <button key={c.id} onClick={() => switchChat(c.id)}
                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                      currentChatId === c.id
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-muted/60'
                    }`}>
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
          <button onClick={newChat}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 rounded-lg text-xs font-semibold text-primary transition-colors">
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
                  Natural language queries, instant answers. Just type what you want to know.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => setInput(s)}
                    className="text-xs px-3.5 py-2 border border-border rounded-full text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(msg => <ChatBubble key={msg.id} message={msg} />)
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
              placeholder="Ask anything about your data…"
              rows={1}
              disabled={sending}
              className="flex-1 resize-none px-4 py-3 bg-muted/50 border border-border rounded-2xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 max-h-32 overflow-y-auto transition-all"
              style={{ minHeight: '48px' }}
            />
            <button type="submit" disabled={!input.trim() || sending}
              className="w-11 h-11 shrink-0 rounded-2xl bg-primary flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed">
              <Send className="w-4 h-4 text-white" />
            </button>
          </form>
          <p className="text-[11px] text-muted-foreground/50 text-center mt-2">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
