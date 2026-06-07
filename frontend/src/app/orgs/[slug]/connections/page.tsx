'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { connectionApi, orgApi } from '@/lib/api';

const CONNECTOR_ICONS: Record<string, string> = {
  mysql: '🔵', postgres: '🐘', elasticsearch: '🟡', mongodb: '🍃', databricks: '⚡',
};
const STATUS_COLORS: Record<string, string> = {
  active: 'text-emerald-400 bg-emerald-400/10',
  inactive: 'text-zinc-400 bg-zinc-400/10',
  error: 'text-red-400 bg-red-400/10',
  testing: 'text-amber-400 bg-amber-400/10',
};

export default function ConnectionsPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [org, setOrg] = useState<any>(null);
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => { loadData(); }, [slug]);

  async function loadData() {
    const { org: orgData } = await orgApi.get(slug);
    setOrg(orgData);
    const { connections: conns } = await connectionApi.list(orgData.id);
    setConnections(conns);
    setLoading(false);
  }

  async function handleTest(connId: string) {
    setTesting(connId);
    try {
      const result = await connectionApi.test(org.id, connId);
      setConnections(cs => cs.map(c => c.id === connId
        ? { ...c, status: result.success ? 'active' : 'error', last_health_ok: result.success }
        : c
      ));
    } finally { setTesting(null); }
  }

  async function handleSync(connId: string) {
    setSyncing(connId);
    try {
      await connectionApi.syncSchema(org.id, connId);
      setConnections(cs => cs.map(c => c.id === connId
        ? { ...c, schema_synced_at: new Date().toISOString() }
        : c
      ));
    } finally { setSyncing(null); }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex">
      <aside className="w-56 border-r border-white/10 h-screen sticky top-0 p-4">
        <Link href={`/orgs/${slug}`} className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 mb-4">
          ← {org?.name || 'Org'}
        </Link>
        <nav className="space-y-1">
          {[
            ['Overview', `/orgs/${slug}`, '◉'],
            ['Connections', `/orgs/${slug}/connections`, '⚡'],
            ['Chats', `/orgs/${slug}/chats`, '💬'],
            ['Dashboards', `/orgs/${slug}/dashboards`, '📊'],
            ['Combos', `/orgs/${slug}/combos`, '🔗'],
          ].map(([label, href, icon]) => (
            <Link key={href} href={href}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all
                ${href === `/orgs/${slug}/connections` ? 'bg-violet-500/10 text-violet-300' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
              <span>{icon}</span>{label}
            </Link>
          ))}
        </nav>
      </aside>

      <main className="flex-1 p-8">
        <div className="max-w-4xl">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold">Connections</h1>
              <p className="text-zinc-400 text-sm mt-1">Manage your datasource connections</p>
            </div>
            <Link href={`/orgs/${slug}/connections/new`}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-sm font-medium rounded-xl transition-colors">
              + New Connection
            </Link>
          </div>

          {loading ? (
            <div className="flex justify-center h-40 items-center">
              <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : connections.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-white/10 rounded-2xl">
              <p className="text-zinc-400 text-sm">No connections yet.</p>
              <Link href={`/orgs/${slug}/connections/new`} className="text-violet-400 text-sm mt-2 inline-block hover:text-violet-300">
                Add your first connection →
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {connections.map((conn: any) => (
                <div key={conn.id} className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-all">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{CONNECTOR_ICONS[conn.connector_type] || '🔌'}</span>
                      <div>
                        <h3 className="font-medium text-white">{conn.name}</h3>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {conn.connector_type} · {conn.host}:{conn.port} · {conn.database_name}
                        </p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[conn.status] || STATUS_COLORS.inactive}`}>
                      {conn.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-4">
                    <button onClick={() => handleTest(conn.id)} disabled={testing === conn.id}
                      className="text-xs px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50">
                      {testing === conn.id ? '⏳ Testing…' : '🔍 Test'}
                    </button>
                    <button onClick={() => handleSync(conn.id)} disabled={syncing === conn.id}
                      className="text-xs px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50">
                      {syncing === conn.id ? '⏳ Syncing…' : '🔄 Sync Schema'}
                    </button>
                    <Link href={`/orgs/${slug}/connections/${conn.id}/schema`}
                      className="text-xs px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors">
                      📋 Schema
                    </Link>
                    <Link href={`/orgs/${slug}/chats/new?connectionId=${conn.id}`}
                      className="text-xs px-3 py-1.5 bg-violet-500/10 border border-violet-500/20 text-violet-400 rounded-lg hover:bg-violet-500/20 transition-colors">
                      💬 Chat
                    </Link>
                  </div>

                  {conn.schema_synced_at && (
                    <p className="text-xs text-zinc-600 mt-2">
                      Schema synced {new Date(conn.schema_synced_at).toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
