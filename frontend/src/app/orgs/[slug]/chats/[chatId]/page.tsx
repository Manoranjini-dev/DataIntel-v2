'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { chatApi, orgApi, dashboardApi, cardApi } from '@/lib/api';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Play, Save, Code2, LayoutDashboard, BookMarked, MessageSquare, Sparkles, Table2 } from 'lucide-react';

const GenerativeUIRenderer = dynamic(
  () => import('@/components/generative-ui').then((m) => m.GenerativeUIRenderer),
  {
    ssr: false,
    loading: () => <div className="h-40 animate-pulse rounded-xl border border-border bg-card/40" />,
  },
);

// ── Visualization renderers ──────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ResultTable({ rows, columns }: { rows: any[]; columns: string[] }) {
  if (!rows.length) return <p className="text-muted-foreground text-sm">No results.</p>;
  return (
    <div className="overflow-x-auto mt-2 rounded-xl border border-border">
      <table className="text-xs text-left w-full">
        <thead className="bg-muted/50">
          <tr>{columns.map(c => <th key={c} className="px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((row, i) => (
            <tr key={i} className="border-t border-white/5 hover:bg-muted/20">
              {columns.map(c => (
                <td key={c} className="px-3 py-2 text-foreground whitespace-nowrap max-w-xs truncate">
                  {String(row[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 100 && (
        <p className="text-muted-foreground text-xs px-3 py-2 border-t border-white/5">
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
  execution_id?: string;
}

function ChatBubble({ message, onExecuteDraft, onAddToDashboard, onSaveAsCard }: {
  message: MessageBubble;
  onExecuteDraft?: (executionId: string, sql: string) => void;
  onAddToDashboard?: (message: MessageBubble) => void;
  onSaveAsCard?: (message: MessageBubble) => void;
}) {
  const [showSQL, setShowSQL] = useState(false);
  const [draftSQL, setDraftSQL] = useState(message.generated_query || '');
  const [executingDraft, setExecutingDraft] = useState(false);
  const [sqlSaved, setSqlSaved] = useState(false);

  const hasResults = (message.result_preview?.length ?? 0) > 0 && (message.result_columns?.length ?? 0) > 0;
  const rows = message.result_preview || [];
  const columns = message.result_columns || [];

  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[75%] bg-primary text-white px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 mb-4">
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center text-xs shrink-0 mt-0.5"
        style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
      >
        <span className="text-white font-bold text-[11px]">AI</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3" style={{ boxShadow: 'var(--shadow-soft)' }}>
          <div className="text-sm text-foreground leading-relaxed prose prose-sm max-w-none prose-p:my-1 prose-strong:text-foreground prose-code:text-primary prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>

          {message.exec_status && message.exec_status !== 'draft' && (
            <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-border">
              <span className={`text-xs font-medium ${message.exec_status === 'success' ? 'text-success' : 'text-destructive'}`}>
                ● {message.exec_status}
              </span>
              {message.row_count !== undefined && <span className="text-xs text-muted-foreground">{message.row_count} rows</span>}
              {message.execution_time_ms !== undefined && <span className="text-xs text-muted-foreground">{message.execution_time_ms}ms</span>}
              {message.generated_query && (
                <button onClick={() => setShowSQL(v => !v)} className="ml-auto text-xs text-primary hover:opacity-80 flex items-center gap-1 transition-opacity">
                  <Code2 className="w-3 h-3" />{showSQL ? 'Hide SQL' : 'View SQL'}
                </button>
              )}
            </div>
          )}

          {showSQL && message.generated_query && message.exec_status !== 'draft' && (
            <pre className="mt-2 text-xs bg-muted border border-border rounded-xl px-3 py-2.5 overflow-x-auto text-foreground font-mono">
              {message.generated_query}
            </pre>
          )}

          {/* Draft SQL — editable with Save + Execute */}
          {message.exec_status === 'draft' && (
            <div className="mt-3 border border-primary/20 rounded-xl overflow-hidden">
              <div className="bg-primary/5 px-3 py-2 text-xs font-semibold text-primary flex items-center gap-1.5 border-b border-primary/20">
                <Code2 className="w-3.5 h-3.5" />
                Generated SQL
                <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20">Editable</span>
              </div>
              <div className="p-3 space-y-2">
                <textarea
                  className="w-full bg-muted/70 text-foreground font-mono text-xs p-3 rounded-lg border border-border outline-none focus:ring-2 focus:ring-primary/40 focus:border-transparent resize-y min-h-[100px]"
                  value={draftSQL}
                  onChange={e => { setDraftSQL(e.target.value); setSqlSaved(false); }}
                  disabled={executingDraft}
                  rows={Math.min(12, Math.max(4, draftSQL.split('\n').length + 1))}
                />
                <div className="flex gap-2">
                  {onSaveAsCard && (
                    <button
                      onClick={() => { onSaveAsCard({ ...message, generated_query: draftSQL }); setSqlSaved(true); setTimeout(() => setSqlSaved(false), 2000); }}
                      disabled={executingDraft || !draftSQL.trim()}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 border ${sqlSaved ? 'bg-success/10 border-success/30 text-success' : 'bg-muted/70 border-border text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                    >
                      <Save className="w-3.5 h-3.5" />
                      {sqlSaved ? 'Saved!' : 'Save'}
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      if (!onExecuteDraft || !message.execution_id) return;
                      setExecutingDraft(true);
                      await onExecuteDraft(message.execution_id, draftSQL);
                      setExecutingDraft(false);
                    }}
                    disabled={executingDraft || !draftSQL.trim()}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:opacity-90 text-white rounded-lg text-xs font-semibold transition-opacity disabled:opacity-50"
                  >
                    {executingDraft
                      ? <><div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />Executing…</>
                      : <><Play className="w-3.5 h-3.5" />Execute Query</>}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {hasResults && (
          <div className="mt-2">
            <GenerativeUIRenderer
              execution={{ rows, columns, rowCount: rows.length, executionTimeMs: message.execution_time_ms || 0 } as any}
              uiHint={message.ui_hint as any}
            />
            <div className="flex gap-2 mt-1 flex-wrap">
              {onAddToDashboard && (
                <button
                  onClick={() => onAddToDashboard(message)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 hover:bg-muted border border-border rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground transition-all"
                >
                  <LayoutDashboard className="w-3.5 h-3.5" /> Add to Dashboard
                </button>
              )}
              {onSaveAsCard && (
                <button
                  onClick={() => onSaveAsCard(message)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 hover:bg-muted border border-border rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground transition-all"
                >
                  <BookMarked className="w-3.5 h-3.5" /> Save as Card
                </button>
              )}
            </div>
          </div>
        )}

        {message.created_at && (
          <p className="text-[10px] text-muted-foreground/60 mt-1 px-1">
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
  const [autoExecute, setAutoExecute] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (chatId === 'new') {
      loadNewChatSetup();
    } else {
      loadData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        execution_id: m.execution_id,
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

      const result = await chatApi.ask(org.id, targetChatId, prompt, autoExecute);
      
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
            execution_id: result.execution?.id,
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

  async function handleExecuteDraft(executionId: string, sql: string) {
    if (!org || !chat) return;
    try {
      const result = await chatApi.executeDraft(org.id, chat.id, executionId, sql);
      
      setMessages(ms => {
        // We replace the draft message with the updated assistant message
        const updatedMsgs = ms.map(m => {
          if (m.execution_id === executionId && m.role === 'assistant') {
            return {
              ...result.assistantMessage,
              execution_id: result.execution?.id,
              exec_status: result.execution?.status,
              row_count: result.execution?.row_count,
              execution_time_ms: result.execution?.execution_time_ms,
              generated_query: result.execution?.generated_query,
              result_preview: result.execution?.rows?.slice(0, 25) || [],
              result_columns: result.execution?.columns || [],
              ui_hint: result.execution?.ui_hint,
            };
          }
          return m;
        });
        return updatedMsgs;
      });
    } catch (err: any) {
      console.error(err);
      alert(`Execution failed: ${err.message}`);
    }
  }

  async function handleAddToDashboard(message: MessageBubble) {
    if (!org || !chat) return;
    try {
      const { dashboards } = await dashboardApi.list(org.id);
      let targetDash = dashboards.find((d: any) => d.connection_id === chat.connection_id);
      if (!targetDash) {
        const res = await dashboardApi.create(org.id, { name: 'Main Dashboard', connection_id: chat.connection_id });
        targetDash = res.dashboard;
      }
      
      const { pages } = await dashboardApi.get(org.id, targetDash.id);
      let pageId = pages?.[0]?.id;
      if (!pageId) {
        const { page } = await dashboardApi.addPage(org.id, targetDash.id, 'Page 1');
        pageId = page.id;
      }

      await dashboardApi.addWidget(org.id, targetDash.id, pageId, {
        title: message.content || 'Chat Widget',
        widget_type: message.ui_hint || 'table',
        queryPrompt: message.content || 'Chat Query',
        datasourceScopeType: 'connection',
        resultRows: message.result_preview?.slice(0, 100),
        resultColumns: message.result_columns,
        uiHint: message.ui_hint || 'table',
      });
      alert('Added to dashboard successfully!');
    } catch (e) {
      console.error(e);
      alert('Failed to add to dashboard.');
    }
  }

  async function handleSaveAsCard(message: MessageBubble) {
    if (!org) return;
    const name = window.prompt('Enter a name for this Card:');
    if (!name) return;

    try {
      const connId = chat?.connection_id || connectionId;
      await cardApi.create(String(org.id), {
        name,
        description: message.content,
        datasourceContextType: 'connection',
        datasourceContextId: connId,
        queryDefinition: { sql: message.generated_query },
        rawQuery: message.generated_query,
        queryLanguage: 'sql',
        chartType: message.ui_hint || 'table',
        visualizationConfig: {},
      });
      alert('Card saved successfully!');
    } catch (e) {
      console.error(e);
      alert('Failed to save card.');
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
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
    <div className="flex-1 flex overflow-hidden">
      {/* ── Sidebar: Chat History ─────────────────── */}
      <aside className="w-64 border-r border-border flex flex-col h-screen flex-shrink-0">
        {/* Sidebar Header */}
        <div className="px-4 py-3 border-b border-border flex-shrink-0 space-y-3">
          <Link href={backHref} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Back to connection
          </Link>

          {connectionId && (
            <div className="flex flex-col gap-1.5 pt-2 border-t border-white/5">
              <Link href={`/orgs/${slug}/dashboards?connectionId=${connectionId}`} className="flex items-center gap-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 px-2 rounded-lg hover:bg-muted/50">
                <LayoutDashboard className="w-4 h-4 text-amber-500 shrink-0" /> Dashboards
              </Link>
              <Link href={`/orgs/${slug}/connections/${connectionId}/schema`} className="flex items-center gap-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 px-2 rounded-lg hover:bg-muted/50">
                <Table2 className="w-4 h-4 text-sky-500 shrink-0" /> Schema Explorer
              </Link>
            </div>
          )}

          <div className="pt-2 border-t border-white/5">
            <button
              onClick={createNewChat}
              disabled={!connectionId}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary hover:opacity-90 rounded-xl text-xs font-medium transition-colors disabled:opacity-40"
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
            <p className="text-xs text-muted-foreground/60 text-center py-8 px-4">No chats yet. Start one above!</p>
          ) : (
            <div className="space-y-0.5 px-2">
              {allChats.map((c: any) => (
                <Link
                  key={c.id}
                  href={`/orgs/${slug}/chats/${c.id}${connectionId ? `?connectionId=${connectionId}` : ''}`}
                  className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-xs transition-all group ${
                    c.id === chatId
                      ? 'bg-primary/15 border border-primary/20 text-white'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  <MessageSquare className="w-4 h-4 mt-0.5 shrink-0 text-primary/70" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{c.title || 'Untitled Chat'}</p>
                    <p className="text-muted-foreground/60 text-[10px] mt-0.5">
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
      <div className="flex-1 flex flex-col h-screen min-w-0 bg-background">
        {/* Chat header */}
        <header className="border-b border-border px-5 py-3 flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm font-medium text-foreground truncate">{chat?.title || 'Chat'}</span>
          </div>
          
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
              <span>Auto Execute</span>
              <div className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${autoExecute ? 'bg-success' : 'bg-muted-foreground/30'}`}>
                <input type="checkbox" className="sr-only" checked={autoExecute} onChange={(e) => setAutoExecute(e.target.checked)} />
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${autoExecute ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
              </div>
            </label>

            {sending && (
              <div className="flex items-center gap-2 text-xs text-primary">
                <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />
                Thinking…
              </div>
            )}
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-6">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(217,122,30,0.15), rgba(245,166,35,0.15))' }}>
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <div className="text-center">
                <h2 className="text-lg font-semibold text-foreground mb-1">Ask about your data</h2>
                <p className="text-muted-foreground text-sm">Natural language queries, instant answers</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => setInput(s)}
                    className="text-xs px-3 py-1.5 border border-border rounded-full text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <ChatBubble 
                key={m.id || i} 
                message={m} 
                onExecuteDraft={handleExecuteDraft}
                onAddToDashboard={handleAddToDashboard}
                onSaveAsCard={handleSaveAsCard}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border p-4 flex-shrink-0">
          <form onSubmit={handleSend} className="flex gap-3 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your data…"
              rows={1}
              disabled={sending}
              className="flex-1 resize-none px-4 py-3 bg-muted/50 border border-border rounded-2xl text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ minHeight: '48px' }}
            />
            <button type="submit" disabled={!input.trim() || sending}
              className="w-12 h-12 flex-shrink-0 rounded-2xl bg-primary hover:opacity-90 flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </form>
          <p className="text-xs text-muted-foreground/60 text-center mt-2">Press Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
