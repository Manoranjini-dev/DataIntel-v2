'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { connectionApi, orgApi, chatApi } from '@/lib/api';
import { MessageSquare, ArrowRight, Plus } from 'lucide-react';

const CONNECTOR_ICONS: Record<string, string> = {
  mysql: '🔵', postgres: '🐘', postgresql: '🐘', elasticsearch: '🟡',
  mongodb: '🍃', databricks: '⚡', mssql: '🟦', snowflake: '❄️',
  bigquery: '🔶', redshift: '🔴',
};

const STATUS_COLORS: Record<string, string> = {
  active:   'text-success bg-success/10 border-success/20',
  inactive: 'text-muted-foreground bg-muted border-border',
  error:    'text-destructive bg-destructive/10 border-destructive/20',
  testing:  'text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
};

export default function ConnectionOverviewPage() {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();
  const router = useRouter();
  const [org, setOrg] = useState<any>(null);
  const [conn, setConn] = useState<any>(null);
  const [recentChats, setRecentChats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);

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

  async function handleTest() {
    if (!org) return;
    setTesting(true);
    try {
      const result = await connectionApi.test(org.id, connId);
      setConn((c: any) => ({ ...c, status: result.success ? 'active' : 'error', last_health_ok: result.success }));
    } finally { setTesting(false); }
  }

  async function handleSync() {
    if (!org) return;
    setSyncing(true);
    try {
      await connectionApi.syncSchema(org.id, connId);
      setConn((c: any) => ({ ...c, schema_synced_at: new Date().toISOString() }));
    } finally { setSyncing(false); }
  }

  function startNewChat() {
    router.push(`/orgs/${slug}/connections/${connId}/chat?chatId=new`);
  }

  if (loading) return (
    <div className="flex-1 flex justify-center items-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="flex-1 overflow-auto p-8 animate-fade-in">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Title row */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-3">
              <span className="text-2xl">{CONNECTOR_ICONS[conn?.connector_type?.toLowerCase()] || '🔌'}</span>
              {conn?.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {conn?.connector_type} · {conn?.host}:{conn?.port} · {conn?.database_name}
            </p>
          </div>
          <span className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[conn?.status] || STATUS_COLORS.inactive}`}>
            {conn?.status?.toUpperCase()}
          </span>
        </div>

        {/* Connection details + Actions */}
        <div className="grid grid-cols-2 gap-5">
          <div className="bg-card border border-border p-5 rounded-2xl" style={{ boxShadow: 'var(--shadow-soft)' }}>
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-4">Connection Details</h3>
            <dl className="space-y-3 text-sm">
              {[
                ['Host', conn?.host],
                ['Port', conn?.port],
                ['Database', conn?.database_name],
                ['User', conn?.username],
              ].map(([dt, dd]) => (
                <div key={String(dt)} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{dt}</dt>
                  <dd className="font-mono text-foreground truncate">{dd || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="bg-card border border-border p-5 rounded-2xl flex flex-col" style={{ boxShadow: 'var(--shadow-soft)' }}>
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-4">Actions</h3>
            <div className="space-y-2.5 flex-1 flex flex-col justify-center">
              <button onClick={handleTest} disabled={testing}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-secondary hover:bg-secondary/80 border border-border rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                {testing ? '⏳ Testing…' : '🔍 Test Connection'}
              </button>
              <button onClick={handleSync} disabled={syncing}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                {syncing ? '⏳ Syncing…' : '🔄 Sync Schema'}
              </button>
              <button onClick={startNewChat}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:opacity-90 rounded-xl text-sm font-semibold text-white transition-opacity">
                <MessageSquare className="w-4 h-4" />
                New Chat
              </button>
            </div>
            {conn?.schema_synced_at && (
              <p className="text-xs text-center text-muted-foreground mt-4">
                Last synced: {new Date(conn.schema_synced_at).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        {/* Recent Chats */}
        <div className="bg-card border border-border rounded-2xl" style={{ boxShadow: 'var(--shadow-soft)' }}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <MessageSquare className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Recent Chats</h3>
              {recentChats.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                  {recentChats.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={startNewChat}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New Chat
              </button>
              <Link
                href={`/orgs/${slug}/chats?connectionId=${connId}`}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {recentChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageSquare className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground mb-4">No chats yet for this connection</p>
              <button
                onClick={startNewChat}
                className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Start your first chat
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentChats.map((chat: any) => (
                <Link
                  key={chat.id}
                  href={`/orgs/${slug}/connections/${connId}/chat?chatId=${chat.id}`}
                  className="flex items-center gap-4 px-6 py-3.5 hover:bg-muted/40 transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-sm shrink-0">
                    💬
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                      {chat.title || 'Untitled Chat'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {chat.message_count || 0} messages · {new Date(chat.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Dashboard preview */}
        <div className="bg-card border border-border rounded-2xl p-8 flex flex-col items-center justify-center text-center" style={{ boxShadow: 'var(--shadow-soft)' }}>
          <div className="text-4xl mb-4">📊</div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Connection Dashboard</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md">
            View key metrics, query insights, and custom charts for this connection.
          </p>
          <Link
            href={`/orgs/${slug}/connections/${connId}/dashboard`}
            className="px-5 py-2.5 bg-primary text-white font-semibold rounded-xl text-sm hover:opacity-90 transition-opacity"
          >
            Open Dashboard
          </Link>
        </div>

      </div>
    </div>
  );
}
