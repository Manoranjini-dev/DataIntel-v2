'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { chatApi, orgApi } from '@/lib/api';
import dynamic from 'next/dynamic';

const GenerativeUIRenderer = dynamic(
  () => import('@/components/generative-ui').then((m) => m.GenerativeUIRenderer),
  {
    ssr: false,
    loading: () => <div className="h-40 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />,
  },
);

// ── Visualization renderers ──────────────────────────────────
function ResultTable({ rows, columns }: { rows: any[]; columns: string[] }) {
  if (!rows.length) return <p className="text-zinc-500 text-sm">No results.</p>;
  return (
    <div className="overflow-x-auto mt-2 rounded-xl border border-white/10">
      <table className="text-xs text-left w-full">
        <thead className="bg-white/5">
          <tr>{columns.map(c => <th key={c} className="px-3 py-2 text-zinc-400 font-medium whitespace-nowrap">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((row, i) => (
            <tr key={i} className="border-t border-white/5 hover:bg-white/[0.03]">
              {columns.map(c => (
                <td key={c} className="px-3 py-2 text-zinc-300 whitespace-nowrap max-w-xs truncate">
                  {String(row[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 100 && (
        <p className="text-zinc-500 text-xs px-3 py-2 border-t border-white/5">
          Showing 100 of {rows.length} rows
        </p>
      )}
    </div>
  );
}

interface MessageBubble {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  exec_status?: string;
  row_count?: number;
  execution_time_ms?: number;
  generated_query?: string;
  result_preview?: any[];
  result_columns?: string[];
  ui_hint?: string;
  showQuery?: boolean;
}

function ChatBubble({ message }: { message: MessageBubble }) {
  const [showSQL, setShowSQL] = useState(false);
  const hasResults = message.result_preview?.length && message.result_columns?.length;
  const rows = message.result_preview || [];
  const columns = message.result_columns || [];

  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[75%] bg-violet-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 mb-4">
      <div className="w-8 h-8 rounded-xl bg-violet-500/20 border border-violet-500/20 flex items-center justify-center text-sm flex-shrink-0">
        🤖
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-white/[0.06] border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3">
          <p className="text-sm text-zinc-200 leading-relaxed">{message.content}</p>

          {message.exec_status && (
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/10">
              <span className={`text-xs font-medium ${message.exec_status === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                ● {message.exec_status}
              </span>
              {message.row_count !== undefined && <span className="text-xs text-zinc-500">{message.row_count} rows</span>}
              {message.execution_time_ms !== undefined && <span className="text-xs text-zinc-500">{message.execution_time_ms}ms</span>}
              {message.generated_query && (
                <button onClick={() => setShowSQL(v => !v)} className="ml-auto text-xs text-violet-400 hover:text-violet-300 transition-colors">
                  {showSQL ? 'Hide SQL' : 'View SQL'}
                </button>
              )}
            </div>
          )}

          {showSQL && message.generated_query && (
            <pre className="mt-2 text-xs bg-black/40 border border-white/10 rounded-xl px-3 py-2 overflow-x-auto text-zinc-300">
              {message.generated_query}
            </pre>
          )}
        </div>

        {hasResults && (
          <div className="mt-2 max-w-[600px]">
            <GenerativeUIRenderer
              execution={{ rows, columns, rowCount: rows.length, executionTimeMs: message.execution_time_ms || 0 } as any}
              uiHint={message.ui_hint as any}
            />
          </div>
        )}

        {message.created_at && (
          <p className="text-xs text-zinc-600 mt-1 px-1">
            {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main chat page ─────────────────────────────────────────
export default function ChatPage() {
  const { slug, chatId } = useParams<{ slug: string; chatId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const connectionId = searchParams.get('connectionId');

  const [org, setOrg] = useState<any>(null);
  const [chat, setChat] = useState<any>(null);
  const [allChats, setAllChats] = useState<any[]>([]);
  const [messages, setMessages] = useState<MessageBubble[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (chatId === 'new') {
      loadNewChatSetup();
    } else {
      loadData();
    }
  }, [slug, chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadNewChatSetup() {
    try {
      const { org: orgData } = await orgApi.get(slug);
      setOrg(orgData);
      
      const chatFilter = connectionId ? { connectionId } : {};
      const { chats: chatList } = await chatApi.list(orgData.id, chatFilter);
      setAllChats(chatList);
      
      setMessages([]);
      setChat({ id: 'new', title: 'New Chat' });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function loadData() {
    try {
      const { org: orgData } = await orgApi.get(slug);
      setOrg(orgData);

      // Load sidebar chats (filtered by connection if present)
      const chatFilter = connectionId ? { connectionId } : {};
      const { chats: chatList } = await chatApi.list(orgData.id, chatFilter);
      setAllChats(chatList);

      // Load current chat messages
      const { messages: msgs } = await chatApi.getMessages(orgData.id, chatId);
      const normalized = msgs.map((m: any) => ({
        ...m,
        result_preview: typeof m.result_preview === 'string'
          ? JSON.parse(m.result_preview)
          : (m.result_preview || []),
        result_columns: typeof m.result_columns === 'string'
          ? JSON.parse(m.result_columns)
          : (m.result_columns || []),
      }));
      setMessages(normalized);

      // Find current chat info from list for sidebar highlighting
      const currentChat = chatList.find((c: any) => c.id === chatId);
      setChat(currentChat || { id: chatId, title: 'Chat' });
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function createNewChat() {
    router.push(`/orgs/${slug}/chats/new${connectionId ? `?connectionId=${connectionId}` : ''}`);
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
      let targetChatId = chatId;
      let newChatCreated = false;

      // Create chat if this is the first message
      if (chatId === 'new') {
        const { chat: newChat } = await chatApi.create(org.id, { 
          connectionId: connectionId || searchParams.get('comboId') || undefined, 
          title: prompt.slice(0, 40) + (prompt.length > 40 ? '...' : '')
        });
        targetChatId = newChat.id;
        newChatCreated = true;
      }

      const result = await chatApi.ask(org.id, targetChatId, prompt);
      
      if (newChatCreated) {
        // Redirect to the new chat page which will re-fetch everything
        router.replace(`/orgs/${slug}/chats/${targetChatId}?connectionId=${connectionId || ''}`);
        return; 
      }

      setMessages(ms => {
        const filtered = ms.filter(m => m.id !== tempId);
        const newMsgs: MessageBubble[] = [];
        if (result.userMessage) {
          newMsgs.push({
            ...result.userMessage,
            result_preview: result.execution?.rows?.slice(0, 25) || [],
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
            result_preview: result.execution?.rows?.slice(0, 25) || [],
            result_columns: result.execution?.columns || [],
            ui_hint: result.execution?.ui_hint,
          });
        }
        return [...filtered, ...newMsgs];
      });

      // Update chat title in sidebar after first message
      setAllChats(prev => {
        const idx = prev.findIndex((c: any) => c.id === chatId);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = { ...updated[idx], message_count: (updated[idx].message_count || 0) + 2 };
        return updated;
      });
    } catch (err: any) {
      setMessages(ms => ms.filter(m => m.id !== tempId));
      setMessages(ms => [...ms, {
        id: `err-${Date.now()}`, role: 'assistant',
        content: `Error: ${err.message}`,
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const backHref = connectionId
    ? `/orgs/${slug}/connections/${connectionId}`
    : `/orgs/${slug}/chats`;

  const SUGGESTIONS = [
    'Show me all tables',
    'How many records are in each table?',
    'Show me the latest 10 records',
    'What are the top 5 by count?',
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex h-screen">
      {/* ── Sidebar: Chat History ─────────────────── */}
      <aside className="w-64 border-r border-white/10 flex flex-col h-screen flex-shrink-0">
        {/* Sidebar Header */}
        <div className="px-4 py-3 border-b border-white/10 flex-shrink-0 space-y-3">
          <Link href={backHref} className="flex items-center gap-2 text-xs text-zinc-400 hover:text-white transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Back to connection
          </Link>

          {connectionId && (
            <div className="flex flex-col gap-1.5 pt-2 border-t border-white/5">
              <Link href={`/orgs/${slug}/dashboards?connectionId=${connectionId}`} className="flex items-center gap-2.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors py-1.5 px-2 rounded-lg hover:bg-white/5">
                <span className="text-amber-500 text-sm">📊</span> Dashboards
              </Link>
              <Link href={`/orgs/${slug}/connections/${connectionId}/schema`} className="flex items-center gap-2.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors py-1.5 px-2 rounded-lg hover:bg-white/5">
                <span className="text-sky-500 text-sm">📋</span> Schema Explorer
              </Link>
            </div>
          )}

          <div className="pt-2 border-t border-white/5">
            <button
              onClick={createNewChat}
              disabled={!connectionId}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-500 rounded-xl text-xs font-medium transition-colors disabled:opacity-40"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New Chat
            </button>
          </div>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto py-2">
          {allChats.length === 0 ? (
            <p className="text-xs text-zinc-600 text-center py-8 px-4">No chats yet. Start one above!</p>
          ) : (
            <div className="space-y-0.5 px-2">
              {allChats.map((c: any) => (
                <Link
                  key={c.id}
                  href={`/orgs/${slug}/chats/${c.id}${connectionId ? `?connectionId=${connectionId}` : ''}`}
                  className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-xs transition-all group ${
                    c.id === chatId
                      ? 'bg-violet-500/15 border border-violet-500/20 text-white'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                  }`}
                >
                  <span className="mt-0.5 text-base flex-shrink-0">💬</span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{c.title || 'Untitled Chat'}</p>
                    <p className="text-zinc-600 text-[10px] mt-0.5">
                      {c.message_count || 0} messages · {new Date(c.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* ── Main Chat Area ───────────────────────── */}
      <div className="flex-1 flex flex-col h-screen min-w-0 bg-[#0a0a0f]">
        {/* Chat header */}
        <header className="border-b border-white/10 px-5 py-3 flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-violet-500/20 flex items-center justify-center text-sm">💬</div>
            <span className="text-sm font-medium text-white truncate">{chat?.title || 'Chat'}</span>
          </div>
          {sending && (
            <div className="flex items-center gap-2 text-xs text-violet-400">
              <div className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin" />
              Thinking…
            </div>
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-6">
              <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-3xl">
                🤖
              </div>
              <div className="text-center">
                <h2 className="text-lg font-semibold text-white mb-1">Ask about your data</h2>
                <p className="text-zinc-500 text-sm">Natural language queries, instant answers</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => setInput(s)}
                    className="text-xs px-3 py-1.5 border border-white/10 rounded-full text-zinc-400 hover:text-white hover:border-violet-500/30 transition-all">
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

        {/* Input */}
        <div className="border-t border-white/10 p-4 flex-shrink-0">
          <form onSubmit={handleSend} className="flex gap-3 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your data…"
              rows={1}
              disabled={sending}
              className="flex-1 resize-none px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ minHeight: '48px' }}
            />
            <button type="submit" disabled={!input.trim() || sending}
              className="w-12 h-12 flex-shrink-0 rounded-2xl bg-violet-600 hover:bg-violet-500 flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </form>
          <p className="text-xs text-zinc-600 text-center mt-2">Press Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
