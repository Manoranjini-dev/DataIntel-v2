'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { comboApi, chatApi, orgApi } from '@/lib/api';
import dynamic from 'next/dynamic';

const GenerativeUIRenderer = dynamic(
  () => import('@/components/generative-ui').then((m) => m.GenerativeUIRenderer),
  {
    ssr: false,
    loading: () => <div className="h-40 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />,
  },
);

function SubQueryPlan({ plan, stepResults }: { plan: any; stepResults: any[] }) {
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-zinc-500 font-medium">Query Plan · {plan.merge?.strategy} merge</p>
      {stepResults.map((sr: any, i: number) => (
        <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-xl border text-xs
          ${sr.status === 'success' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
          <span className={sr.status === 'success' ? 'text-emerald-400' : 'text-red-400'}>●</span>
          <div className="flex-1 min-w-0">
            <span className="font-medium text-zinc-300">{sr.alias}</span>
            <pre className="text-zinc-500 truncate mt-0.5 font-mono">{sr.query?.substring(0, 80)}…</pre>
          </div>
          <div className="text-right text-zinc-600 whitespace-nowrap">
            {sr.rowCount} rows · {sr.executionTimeMs}ms
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultTable({ rows, columns }: { rows: any[]; columns: string[] }) {
  if (!rows.length) return <p className="text-zinc-500 text-sm mt-2">No results.</p>;
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
    </div>
  );
}

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
}

export default function ComboChatPage() {
  const { slug, comboId } = useParams<{ slug: string; comboId: string }>();
  const [org, setOrg] = useState<any>(null);
  const [combo, setCombo] = useState<any>(null);
  const [messages, setMessages] = useState<ComboMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadData(); }, [slug, comboId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const c = await comboApi.list(o.id);
      const found = (c as any).combos?.find((x: any) => x.id === comboId);
      setCombo(found);
    } catch (e) { console.error(e); }
  }

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || sending || !org) return;
    const prompt = input.trim();
    setInput('');
    setSending(true);

    const tempId = `u-${Date.now()}`;
    setMessages(ms => [...ms, { id: tempId, role: 'user', content: prompt, created_at: new Date().toISOString() }]);

    try {
      const result = await comboApi.query(org.id, comboId, prompt);
      setMessages(ms => ms.filter(m => m.id !== tempId));
      setMessages(ms => [
        ...ms,
        { id: `u2-${Date.now()}`, role: 'user', content: prompt, created_at: new Date().toISOString() },
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: `Executed across ${result.stepResults?.length || 0} sources using **${result.mergeStrategy}** merge strategy. Found ${result.rowCount} merged results.`,
          created_at: new Date().toISOString(),
          plan: result.plan,
          stepResults: result.stepResults,
          rows: result.rows,
          columns: result.columns,
          totalMs: result.totalExecutionTimeMs,
          mergeStrategy: result.mergeStrategy,
          ui_hint: result.ui_hint,
        },
      ]);
    } catch (err: any) {
      setMessages(ms => ms.filter(m => m.id !== tempId));
      setMessages(ms => [...ms, {
        id: `err-${Date.now()}`, role: 'assistant',
        content: `Error: ${err.message}`,
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col h-screen">
      <header className="border-b border-white/10 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <Link href={`/orgs/${slug}/combos`} className="text-zinc-500 hover:text-zinc-300">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-purple-500/20 flex items-center justify-center">🔗</div>
          <div>
            <span className="text-sm font-medium text-white">{combo?.name || 'Combo Chat'}</span>
            <span className="text-xs text-zinc-500 ml-2">Multi-source</span>
          </div>
        </div>
        {sending && (
          <div className="ml-auto flex items-center gap-2 text-xs text-violet-400">
            <div className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin" />
            Planning queries…
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-5xl">🔗</div>
            <div className="text-center">
              <h2 className="text-lg font-semibold mb-1">Combo Query</h2>
              <p className="text-zinc-400 text-sm max-w-sm">Ask questions that span multiple data sources. The AI will query each source separately and merge the results.</p>
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold
                ${msg.role === 'user' ? 'bg-violet-500' : 'bg-purple-700'}`}>
                {msg.role === 'user' ? 'U' : 'AI'}
              </div>
              <div className={`max-w-[80%] flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed
                  ${msg.role === 'user' ? 'bg-violet-600 text-white rounded-tr-sm' : 'bg-white/[0.07] text-zinc-200 rounded-tl-sm border border-white/10'}`}>
                  {msg.content}
                </div>
                {msg.stepResults && <SubQueryPlan plan={msg.plan} stepResults={msg.stepResults} />}
                {msg.rows?.length ? (
                  <div className="w-full max-w-[600px] mt-2">
                    <div className="flex items-center gap-2 text-xs text-zinc-500 mb-2">
                      <span>{msg.rows.length} merged rows</span>
                      <span>·</span>
                      <span>{msg.totalMs}ms total</span>
                    </div>
                    {msg.ui_hint && msg.ui_hint !== 'data_table' ? (
                      <GenerativeUIRenderer
                        execution={{
                          rows: msg.rows,
                          columns: msg.columns || [],
                          rowCount: msg.rows.length,
                          executionTimeMs: msg.totalMs || 0
                        } as any}
                        uiHint={msg.ui_hint as any}
                      />
                    ) : (
                      <ResultTable rows={msg.rows} columns={msg.columns || []} />
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-white/10 p-4 flex-shrink-0">
        <form onSubmit={handleSend} className="flex gap-3 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Ask across all your data sources…"
            rows={1}
            disabled={sending}
            className="flex-1 resize-none px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 disabled:opacity-50"
          />
          <button type="submit" disabled={!input.trim() || sending}
            className="w-12 h-12 flex-shrink-0 rounded-2xl bg-violet-600 hover:bg-violet-500 flex items-center justify-center transition-colors disabled:opacity-30">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
