'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { chatApi, orgApi, connectionApi } from '@/lib/api';
import dynamic from 'next/dynamic';

const GenerativeUIRenderer = dynamic(
  () => import('@/components/generative-ui').then((m) => m.GenerativeUIRenderer),
  { ssr: false, loading: () => <div className="h-32 animate-pulse rounded-xl bg-zinc-900/60 border border-zinc-800" /> }
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
        <div className="max-w-[72%] bg-violet-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 mb-5">
      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500/30 to-indigo-500/30 border border-violet-500/20 flex items-center justify-center text-sm flex-shrink-0 mt-0.5">
        🤖
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <div className="bg-white/[0.05] border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3">
          <p className="text-sm text-zinc-200 leading-relaxed">{message.content}</p>

          {message.exec_status && (
            <div className="flex flex-wrap items-center gap-3 mt-2.5 pt-2.5 border-t border-white/10">
              <span className={`text-xs font-medium flex items-center gap-1 ${message.exec_status === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {message.exec_status}
              </span>
              {message.row_count !== undefined && (
                <span className="text-xs text-zinc-500">{message.row_count} rows</span>
              )}
              {message.execution_time_ms !== undefined && (
                <span className="text-xs text-zinc-500">{message.execution_time_ms}ms</span>
              )}
              {message.generated_query && (
                <button onClick={() => setShowSQL(v => !v)}
                  className="ml-auto text-xs text-violet-400 hover:text-violet-300 transition-colors">
                  {showSQL ? 'Hide SQL' : 'View SQL'}
                </button>
              )}
            </div>
          )}
          {showSQL && message.generated_query && (
            <pre className="mt-2 text-xs bg-black/50 border border-white/10 rounded-xl px-3 py-2.5 overflow-x-auto text-zinc-300 font-mono">
              {message.generated_query}
            </pre>
          )}
        </div>

        {hasChart && (
          <div className="ml-0">
            <GenerativeUIRenderer
              execution={{
                rows: message.result_preview || [],
                columns: message.result_columns || [],
                rowCount: message.row_count || 0,
                executionTimeMs: message.execution_time_ms || 0,
              } as any}
              uiHint={message.ui_hint as any}
            />
          </div>
        )}

        <p className="text-[10px] text-zinc-600 px-1">
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

// ── Schema Sidebar Panel ────────────────────────────────────────
function SchemaPanel({ orgId, connId }: { orgId: string; connId: string }) {
  const [tables, setTables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<any[]>([]);
  const [colLoading, setColLoading] = useState(false);

  useEffect(() => { loadTables(); }, [orgId, connId]);

  async function loadTables() {
    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/orgs/${orgId}/connections/${connId}/schema/tables`, { credentials: 'include' });
      const { tables: t } = await r.json();
      setTables(t || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function loadColumns(tableName: string) {
    setActiveTable(tableName);
    setColLoading(true);
    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/orgs/${orgId}/connections/${connId}/schema/tables/${encodeURIComponent(tableName)}/columns`, { credentials: 'include' });
      const { columns: c } = await r.json();
      setColumns(c || []);
    } catch (e) { console.error(e); }
    finally { setColLoading(false); }
  }

  const filtered = tables.filter(t => t.table_name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-white/[0.06]">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search tables…"
          className="w-full px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500/50" />
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Table list */}
          <div className="py-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-6">No tables found. Sync schema first.</p>
            ) : (
              <>
                <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider px-3 pt-2 pb-1">{filtered.length} Tables</p>
                {filtered.map((t: any) => (
                  <div key={t.table_name}>
                    <button onClick={() => activeTable === t.table_name ? setActiveTable(null) : loadColumns(t.table_name)}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-white/[0.04] transition-colors ${activeTable === t.table_name ? 'text-violet-300 bg-violet-500/10' : 'text-zinc-400'}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-600 text-[10px]">▣</span>
                        <span className="font-mono truncate">{t.table_name}</span>
                      </div>
                      <span className="text-zinc-600 text-[10px] flex-shrink-0 ml-1">{t.column_count}</span>
                    </button>

                    {activeTable === t.table_name && (
                      <div className="bg-black/20 border-l-2 border-violet-500/30 ml-3 mr-2 mb-1 rounded-r-lg">
                        {colLoading ? (
                          <div className="flex justify-center py-3">
                            <div className="w-4 h-4 border border-violet-500 border-t-transparent rounded-full animate-spin" />
                          </div>
                        ) : (
                          columns.map(col => (
                            <div key={col.column_name} className="flex items-center justify-between px-2.5 py-1 text-[11px]">
                              <div className="flex items-center gap-1.5">
                                {col.is_primary_key && <span className="text-amber-400 text-[9px] font-bold">PK</span>}
                                {col.is_foreign_key && <span className="text-indigo-400 text-[9px] font-bold">FK</span>}
                                <span className="font-mono text-zinc-300">{col.column_name}</span>
                              </div>
                              <span className="text-zinc-600 font-mono text-[10px]">{col.data_type}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Chat Page ─────────────────────────────────────────────
export default function ConnectionChatPage() {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const chatId = searchParams.get('chatId') || 'new';
  const [activeTab, setActiveTab] = useState<'chat' | 'schema'>('chat');

  const [org, setOrg] = useState<any>(null);
  const [conn, setConn] = useState<any>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(chatId === 'new' ? null : chatId);
  const [chats, setChats] = useState<any[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadData(); }, [slug, connId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const { connection: c } = await connectionApi.get(o.id, connId);
      setConn(c);
      const { chats: chatList } = await chatApi.list(o.id, { connectionId: connId });
      setChats(chatList);

      // Load messages if we have a chat
      if (currentChatId && currentChatId !== 'new') {
        await loadMessages(o.id, currentChatId);
      }
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
    if (org) await loadMessages(org.id, cid);
    router.replace(`/orgs/${slug}/connections/${connId}/chat?chatId=${cid}`);
  }

  async function newChat() {
    setCurrentChatId(null);
    setMessages([]);
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
        if (result.userMessage) {
          newMsgs.push({
            ...result.userMessage,
            result_preview: result.execution?.rows?.slice(0, 50) || [],
            result_columns: result.execution?.columns || [],
          });
        }
        if (result.assistantMessage) {
          newMsgs.push({
            ...result.assistantMessage,
            exec_status: result.execution?.status,
            row_count: result.execution?.row_count,
            execution_time_ms: result.execution?.execution_time_ms,
            generated_query: result.execution?.generated_query,
            result_preview: result.execution?.rows?.slice(0, 50) || [],
            result_columns: result.execution?.columns || [],
            ui_hint: result.execution?.ui_hint,
          });
        }
        return [...filtered, ...newMsgs];
      });

      // Auto-update chat name count in list
      setChats(prev => prev.map(c => c.id === targetChatId ? { ...c, message_count: (c.message_count || 0) + 2 } : c));
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
    'Show me the column structure of each table',
  ];

  if (loading) return (
    <div className="h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="h-screen bg-[#0a0a0f] text-white flex overflow-hidden">
      {/* ── Left Sidebar ──────────────────────────────── */}
      <aside className="w-56 border-r border-white/[0.08] flex flex-col h-full bg-[#0c0c14] flex-shrink-0">
        {/* Connection header */}
        <div className="px-3 py-3 border-b border-white/[0.06] flex-shrink-0">
          <Link href={`/orgs/${slug}/connections/${connId}`}
            className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
            Back
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-500/20 border border-violet-500/20 flex items-center justify-center text-sm flex-shrink-0">
              {conn?.connector_type === 'mysql' ? '🔵' : conn?.connector_type === 'postgres' ? '🐘' : '🔌'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate">{conn?.name}</p>
              <p className="text-[10px] text-zinc-500 uppercase">{conn?.connector_type}</p>
            </div>
            <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
          </div>
        </div>

        {/* Nav tabs */}
        <div className="flex border-b border-white/[0.06] flex-shrink-0">
          <Link href={`/orgs/${slug}/connections/${connId}/dashboard`}
            className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-zinc-500 hover:text-zinc-300 transition-colors text-[11px]">
            <span className="text-sm">📊</span>
            Dashboard
          </Link>
          <button onClick={() => setActiveTab('chat')}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors text-[11px] border-b-2 ${activeTab === 'chat' ? 'text-violet-300 border-violet-500' : 'text-zinc-500 hover:text-zinc-300 border-transparent'}`}>
            <span className="text-sm">💬</span>
            Chat
          </button>
          <button onClick={() => setActiveTab('schema')}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors text-[11px] border-b-2 ${activeTab === 'schema' ? 'text-violet-300 border-violet-500' : 'text-zinc-500 hover:text-zinc-300 border-transparent'}`}>
            <span className="text-sm">📋</span>
            Schema
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'chat' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-3 py-2 flex-shrink-0">
              <button onClick={newChat}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs font-medium transition-colors">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                New Chat
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
              {chats.length === 0 ? (
                <p className="text-[11px] text-zinc-600 text-center py-6">No chats yet</p>
              ) : (
                chats.map((c: any) => (
                  <button key={c.id} onClick={() => switchChat(c.id)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-all ${currentChatId === c.id ? 'bg-violet-500/15 border border-violet-500/20 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'}`}>
                    <p className="truncate font-medium">{c.title || 'Untitled'}</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">{c.message_count || 0} messages</p>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'schema' && org && (
          <div className="flex-1 flex flex-col min-h-0">
            <SchemaPanel orgId={org.id} connId={connId} />
            <div className="px-3 py-2 border-t border-white/[0.06] flex-shrink-0">
              <Link href={`/orgs/${slug}/connections/${connId}/erd`}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 rounded-lg text-xs text-zinc-400 transition-colors">
                View ERD
              </Link>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main Chat Area ─────────────────────────────── */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Chat header */}
        <header className="border-b border-white/[0.08] px-5 py-3 flex items-center gap-3 flex-shrink-0 bg-[#0c0c14]">
          <div className="w-6 h-6 rounded-lg bg-violet-500/20 flex items-center justify-center text-sm">💬</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">
              {currentChatId ? (chats.find(c => c.id === currentChatId)?.title || 'Chat') : 'New Chat'}
            </p>
            <p className="text-xs text-zinc-500">{conn?.name}</p>
          </div>
          {sending && (
            <div className="flex items-center gap-2 text-xs text-violet-400">
              <div className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin" />
              Thinking…
            </div>
          )}
        </header>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-500/20 flex items-center justify-center text-3xl">
                🤖
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white mb-1">Ask your database anything</h2>
                <p className="text-zinc-500 text-sm">Natural language queries, instant answers. Just type what you want to know.</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => setInput(s)}
                    className="text-xs px-3 py-1.5 border border-white/10 rounded-full text-zinc-400 hover:text-white hover:border-violet-500/30 hover:bg-violet-500/5 transition-all">
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

        {/* Input bar */}
        <div className="border-t border-white/[0.08] p-4 flex-shrink-0 bg-[#0c0c14]">
          <form onSubmit={handleSend} className="flex gap-3 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your data… (Ctrl+K)"
              rows={1}
              disabled={sending}
              className="flex-1 resize-none px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ minHeight: '48px' }}
            />
            <button type="submit" disabled={!input.trim() || sending}
              className="w-11 h-11 flex-shrink-0 rounded-2xl bg-violet-600 hover:bg-violet-500 flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
          <p className="text-[11px] text-zinc-600 text-center mt-2">Press Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
