'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { chatApi, orgApi } from '@/lib/api';

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

function MetricCard({ rows, columns }: { rows: any[]; columns: string[] }) {
  const row = rows[0] || {};
  return (
    <div className="flex flex-wrap gap-3 mt-2">
      {columns.map(col => (
        <div key={col} className="bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-3 min-w-[100px]">
          <p className="text-xs text-zinc-400 mb-1">{col}</p>
          <p className="text-2xl font-bold text-white">{String(row[col] ?? 0)}</p>
        </div>
      ))}
    </div>
  );
}

// ── Chat bubble ──────────────────────────────────────────────
interface MessageBubbleProps {
  message: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    created_at: string;
    exec_status?: string;
    row_count?: number;
    execution_time_ms?: number;
    result_preview?: any[];
    result_columns?: string[];
    generated_query?: string;
    ui_hint?: string;
  };
}

function MessageBubble({ message }: MessageBubbleProps) {
  const [showQuery, setShowQuery] = useState(false);
  const isUser = message.role === 'user';
  const hasResults = message.result_preview?.length || message.result_columns?.length;

  const rows: any[] = message.result_preview || [];
  const columns: string[] = message.result_columns || [];

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold
        ${isUser ? 'bg-violet-500' : 'bg-zinc-700'}`}>
        {isUser ? 'U' : 'AI'}
      </div>

      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed
          ${isUser ? 'bg-violet-600 text-white rounded-tr-sm' : 'bg-white/[0.07] text-zinc-200 rounded-tl-sm border border-white/10'}`}>
          {message.content}
        </div>

        {/* Execution metadata */}
        {message.exec_status && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className={message.exec_status === 'success' ? 'text-emerald-400' : 'text-red-400'}>
              ● {message.exec_status}
            </span>
            {message.row_count !== undefined && <span>{message.row_count} rows</span>}
            {message.execution_time_ms && <span>{message.execution_time_ms}ms</span>}
            {message.generated_query && (
              <button onClick={() => setShowQuery(!showQuery)} className="text-violet-400 hover:text-violet-300">
                {showQuery ? 'Hide' : 'View'} SQL
              </button>
            )}
          </div>
        )}

        {/* SQL query */}
        {showQuery && message.generated_query && (
          <pre className="text-xs bg-black/40 border border-white/10 rounded-xl px-3 py-2 overflow-x-auto text-zinc-300 max-w-full">
            {message.generated_query}
          </pre>
        )}

        {/* Results */}
        {hasResults && (
          <div className="w-full max-w-[600px]">
            {message.ui_hint === 'metric_card' || message.ui_hint === 'stat_grid' ? (
              <MetricCard rows={rows} columns={columns} />
            ) : (
              <ResultTable rows={rows} columns={columns} />
            )}
          </div>
        )}

        <time className="text-xs text-zinc-600">
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
    </div>
  );
}

// ── Main chat page ─────────────────────────────────────────
export default function ChatPage() {
  const { slug, chatId } = useParams<{ slug: string; chatId: string }>();
  const [org, setOrg] = useState<any>(null);
  const [chat, setChat] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { loadData(); }, [slug, chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadData() {
    try {
      const { org: orgData } = await orgApi.get(slug);
      setOrg(orgData);
      const { messages: msgs } = await chatApi.getMessages(orgData.id, chatId);
      // Normalize JSONB fields that may come back as strings
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
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || sending || !org) return;
    const prompt = input.trim();
    setInput('');
    setSending(true);

    // Optimistic user message
    const tempId = `temp-${Date.now()}`;
    setMessages(ms => [...ms, {
      id: tempId, role: 'user', content: prompt,
      created_at: new Date().toISOString(),
    }]);

    try {
      const result = await chatApi.ask(org.id, chatId, prompt);
      // Replace temp message + add real messages
      setMessages(ms => {
        const filtered = ms.filter(m => m.id !== tempId);
        const newMsgs = [];
        if (result.userMessage) {
          newMsgs.push({
            ...result.userMessage,
            result_preview: result.execution?.rows?.slice(0, 25),
            result_columns: result.execution?.columns,
          });
        }
        if (result.assistantMessage) {
          newMsgs.push({
            ...result.assistantMessage,
            exec_status: result.execution?.status,
            row_count: result.execution?.row_count,
            execution_time_ms: result.execution?.execution_time_ms,
            generated_query: result.execution?.generated_query,
            result_preview: result.execution?.rows?.slice(0, 25),
            result_columns: result.execution?.columns,
          });
        }
        return [...filtered, ...newMsgs];
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

  const SUGGESTIONS = [
    'Show me all tables',
    'How many records are in each table?',
    'Show me the latest 10 records',
    'What are the top 5 by count?',
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col h-screen">
      {/* Header */}
      <header className="border-b border-white/10 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <Link href={`/orgs/${slug}/chats`} className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-violet-500/20 flex items-center justify-center">💬</div>
          <span className="text-sm font-medium text-white">Chat</span>
        </div>
        {sending && (
          <div className="ml-auto flex items-center gap-2 text-xs text-violet-400">
            <div className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin" />
            Thinking…
          </div>
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
        {loading ? (
          <div className="flex justify-center h-full items-center">
            <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="text-5xl">🤖</div>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-white mb-1">Ready to Query</h2>
              <p className="text-zinc-400 text-sm">Ask me anything about your data in plain English</p>
            </div>
            <div className="grid grid-cols-2 gap-2 max-w-md w-full">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => setInput(s)}
                  className="text-left text-xs px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-zinc-400 hover:text-white hover:border-violet-500/30 hover:bg-white/[0.07] transition-all">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => <MessageBubble key={msg.id} message={msg} />)
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
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </form>
        <p className="text-xs text-zinc-600 text-center mt-2">Press Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
