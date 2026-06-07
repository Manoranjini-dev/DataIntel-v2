'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { connectionApi, orgApi } from '@/lib/api';

const CONNECTOR_ICONS: Record<string, string> = {
  mysql: '🔵', postgres: '🐘', elasticsearch: '🟡', mongodb: '🍃', databricks: '⚡',
};

const STATUS_COLORS: Record<string, string> = {
  active:   'text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20',
  inactive: 'text-muted-foreground bg-muted border-border',
  error:    'text-destructive bg-destructive/10 border-destructive/20',
  testing:  'text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
};

export default function ConnectionOverviewPage() {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const router = useRouter();
  const [org, setOrg] = useState<any>(null);
  const [conn, setConn] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [slug, connId]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const { connection: c } = await connectionApi.get(o.id, connId);
      setConn(c);
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

  if (loading) return (
    <div className="flex-1 flex justify-center items-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="flex-1 overflow-auto p-8 animate-fade-in">
      <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-3">
            <span className="text-2xl">{CONNECTOR_ICONS[conn?.connector_type] || '🔌'}</span>
            {conn?.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {conn?.connector_type} · {conn?.host}:{conn?.port} · {conn?.database_name}
          </p>
        </div>
        <div className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[conn?.status] || STATUS_COLORS.inactive}`}>
          {conn?.status?.toUpperCase()}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-card border border-border p-5 rounded-2xl shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Connection Details</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Host</dt>
              <dd className="font-mono text-foreground">{conn?.host}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Port</dt>
              <dd className="font-mono text-foreground">{conn?.port}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Database</dt>
              <dd className="font-mono text-foreground">{conn?.database_name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">User</dt>
              <dd className="font-mono text-foreground">{conn?.username}</dd>
            </div>
          </dl>
        </div>

        <div className="bg-card border border-border p-5 rounded-2xl shadow-sm flex flex-col">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Actions</h3>
          <div className="space-y-3 flex-1 flex flex-col justify-center">
            <button onClick={handleTest} disabled={testing}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-secondary hover:bg-secondary/80 border border-border rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
              {testing ? '⏳ Testing Connection…' : '🔍 Test Connection'}
            </button>
            <button onClick={handleSync} disabled={syncing}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
              {syncing ? '⏳ Syncing Schema…' : '🔄 Sync Schema'}
            </button>
          </div>
          {conn?.schema_synced_at && (
            <p className="text-xs text-center text-muted-foreground mt-4">
              Last synced: {new Date(conn.schema_synced_at).toLocaleString()}
            </p>
          )}
        </div>
      </div>
      
      {/* Dashboard Preview Placeholder */}
      <div className="bg-card border border-border rounded-2xl p-8 flex flex-col items-center justify-center text-center shadow-sm">
        <div className="text-4xl mb-4">📊</div>
        <h3 className="text-lg font-semibold text-foreground mb-2">Connection Dashboard</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-md">
          View key metrics, query insights, and custom charts for this connection.
        </p>
        <Link href={`/orgs/${slug}/connections/${connId}/dashboard`}
          className="px-5 py-2.5 bg-primary text-white font-semibold rounded-xl text-sm hover:opacity-90 transition-opacity">
          Open Dashboard
        </Link>
      </div>

      </div> {/* max-w-4xl */}
    </div>
  );
}
