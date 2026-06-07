'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { connectionApi, orgApi, chatApi } from '@/lib/api';

const CONNECTOR_ICONS: Record<string, string> = {
  mysql: '🔵',
  postgres: '🐘',
  postgresql: '🐘',
  elasticsearch: '🟡',
  mongodb: '🍃',
  databricks: '⚡',
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  error: 'bg-red-500/10 border-red-500/30 text-red-400',
  inactive: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400',
  testing: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
};

export default function ConnectionDetailPage() {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();
  const [org, setOrg] = useState<any>(null);
  const [conn, setConn] = useState<any>(null);
  const [recentChats, setRecentChats] = useState<any[]>([]);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);

  useEffect(() => { loadData(); }, [slug, connId]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const [{ connection: c }, { chats }] = await Promise.all([
        connectionApi.get(o.id, connId),
        chatApi.list(o.id, { connectionId: connId }),
      ]);
      setConn(c);
      setRecentChats(chats.slice(0, 5));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function testConnection() {
    if (!org) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await connectionApi.test(org.id, connId);
      setTestResult({ ok: r.success, latencyMs: r.latencyMs });
      await loadData();
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message });
    } finally { setTesting(false); }
  }

  async function syncSchema() {
    if (!org) return;
    setSyncing(true);
    try {
      await connectionApi.syncSchema(org.id, connId);
      await loadData();
    } catch (e) { console.error(e); }
    finally { setSyncing(false); }
  }

  async function startNewChat() {
    if (!org) return;
    window.location.href = `/orgs/${slug}/connections/${connId}/chat`;
  }

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const icon = CONNECTOR_ICONS[conn?.connector_type?.toLowerCase()] || '🔌';
  const statusStyle = STATUS_STYLES[conn?.status] || STATUS_STYLES.inactive;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link href={`/orgs/${slug}/connections`} className="text-zinc-500 hover:text-zinc-300 mt-1">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl">
                {icon}
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">{conn?.name}</h1>
                <p className="text-zinc-400 text-sm">{conn?.connector_type} · {conn?.host}:{conn?.port} · {conn?.database_name}</p>
              </div>
            </div>
          </div>
          <span className={`px-3 py-1 rounded-full border text-xs font-medium ${statusStyle}`}>
            ● {conn?.status}
          </span>
        </div>

        {/* Action Bar */}
        <div className="flex flex-wrap gap-3 mb-8">
          <button onClick={testConnection} disabled={testing}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 hover:border-white/20 rounded-xl text-sm transition-colors disabled:opacity-50">
            {testing ? <span className="w-3 h-3 border border-zinc-400 border-t-transparent rounded-full animate-spin" /> : '⚡'}
            Test Connection
          </button>
          <button onClick={syncSchema} disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 hover:border-white/20 rounded-xl text-sm transition-colors disabled:opacity-50">
            {syncing ? <span className="w-3 h-3 border border-zinc-400 border-t-transparent rounded-full animate-spin" /> : '🔄'}
            Sync Schema
          </button>
          <button onClick={startNewChat}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium transition-colors">
            💬 New Chat
          </button>
        </div>

        {/* Test result banner */}
        {testResult && (
          <div className={`mb-6 px-4 py-3 rounded-xl border text-sm ${testResult.ok ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-red-500/10 border-red-500/20 text-red-300'}`}>
            {testResult.ok
              ? `✅ Connection successful · ${testResult.latencyMs}ms latency`
              : `❌ Connection failed: ${testResult.error}`}
          </div>
        )}

        <div className="grid grid-cols-3 gap-6">
          {/* Left: Navigation cards */}
          <div className="col-span-2 space-y-4">
            {/* Schema Explorer */}
            <Link href={`/orgs/${slug}/connections/${connId}/schema`}
              className="group flex items-center gap-4 p-5 bg-white/[0.03] border border-white/[0.06] hover:border-violet-500/30 hover:bg-white/[0.06] rounded-2xl transition-all">
              <div className="w-12 h-12 rounded-xl bg-sky-500/10 flex items-center justify-center text-2xl flex-shrink-0">📋</div>
              <div className="flex-1">
                <p className="font-semibold text-white group-hover:text-violet-300 transition-colors">Schema Explorer</p>
                <p className="text-sm text-zinc-400 mt-0.5">Browse tables, columns, and data types</p>
              </div>
              <svg width="16" height="16" className="text-zinc-600 group-hover:text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
            </Link>

            {/* AI Chat — go to connection-level chat page */}
            <Link href={`/orgs/${slug}/connections/${connId}/chat`}
              className="group flex items-center gap-4 p-5 bg-white/[0.03] border border-white/[0.06] hover:border-violet-500/30 hover:bg-white/[0.06] rounded-2xl transition-all">
              <div className="w-12 h-12 rounded-xl bg-violet-500/10 flex items-center justify-center text-2xl flex-shrink-0">💬</div>
              <div className="flex-1">
                <p className="font-semibold text-white group-hover:text-violet-300 transition-colors">AI Chat</p>
                <p className="text-sm text-zinc-400 mt-0.5">Query this datasource in natural language</p>
              </div>
              <svg width="16" height="16" className="text-zinc-600 group-hover:text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
            </Link>

            {/* Dashboard — go to connection-level dashboard */}
            <Link href={`/orgs/${slug}/connections/${connId}/dashboard`}
              className="group flex items-center gap-4 p-5 bg-white/[0.03] border border-white/[0.06] hover:border-violet-500/30 hover:bg-white/[0.06] rounded-2xl transition-all">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-2xl flex-shrink-0">📊</div>
              <div className="flex-1">
                <p className="font-semibold text-white group-hover:text-violet-300 transition-colors">Dashboard</p>
                <p className="text-sm text-zinc-400 mt-0.5">Build analytics and visualizations</p>
              </div>
              <svg width="16" height="16" className="text-zinc-600 group-hover:text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
            </Link>

            {/* ERD */}
            <Link href={`/orgs/${slug}/connections/${connId}/erd`}
              className="group flex items-center gap-4 p-5 bg-white/[0.03] border border-white/[0.06] hover:border-violet-500/30 hover:bg-white/[0.06] rounded-2xl transition-all">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-2xl flex-shrink-0">🕸️</div>
              <div className="flex-1">
                <p className="font-semibold text-white group-hover:text-violet-300 transition-colors">Entity Relationship Diagram</p>
                <p className="text-sm text-zinc-400 mt-0.5">Visualize table relationships</p>
              </div>
              <svg width="16" height="16" className="text-zinc-600 group-hover:text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
            </Link>

            {/* Settings */}
            <Link href={`/orgs/${slug}/connections/${connId}/settings`}
              className="group flex items-center gap-4 p-5 bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.10] hover:bg-white/[0.06] rounded-2xl transition-all">
              <div className="w-12 h-12 rounded-xl bg-zinc-500/10 flex items-center justify-center text-2xl flex-shrink-0">⚙️</div>
              <div className="flex-1">
                <p className="font-semibold text-white group-hover:text-zinc-300 transition-colors">Settings</p>
                <p className="text-sm text-zinc-400 mt-0.5">Query display, result limits, session</p>
              </div>
              <svg width="16" height="16" className="text-zinc-600 group-hover:text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
            </Link>
          </div>

          {/* Right: Stats & Recent Chats */}
          <div className="space-y-4">
            {/* Connection Info */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
              <h3 className="text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wider">Connection Info</h3>
              <div className="space-y-2 text-xs">
                {[
                  { label: 'Type', value: conn?.connector_type },
                  { label: 'Host', value: `${conn?.host}:${conn?.port}` },
                  { label: 'Database', value: conn?.database_name },
                  { label: 'SSL', value: conn?.ssl_enabled ? 'Enabled' : 'Disabled' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between gap-2">
                    <span className="text-zinc-500">{label}</span>
                    <span className="text-zinc-300 font-mono truncate">{value || '—'}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Chats */}
            {recentChats.length > 0 && (
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
                <h3 className="text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wider">Recent Chats</h3>
                <div className="space-y-2">
                  {recentChats.map((chat: any) => (
                    <Link key={chat.id} href={`/orgs/${slug}/chats/${chat.id}`}
                      className="flex items-center gap-2 text-xs text-zinc-400 hover:text-violet-300 transition-colors py-1">
                      <span>💬</span>
                      <span className="truncate">{chat.title || 'Untitled'}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
