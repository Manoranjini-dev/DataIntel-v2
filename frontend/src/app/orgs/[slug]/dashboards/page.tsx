'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { dashboardApi, connectionApi, orgApi } from '@/lib/api';

export default function DashboardsPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const filterConn = searchParams.get('connectionId');

  const [org, setOrg] = useState<any>(null);
  const [dashboards, setDashboards] = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', description: '', connectionId: filterConn || '', comboId: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadData(); }, [slug]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const [{ dashboards: d }, { connections: conns }] = await Promise.all([
        dashboardApi.list(o.id),
        connectionApi.list(o.id),
      ]);
      setDashboards(filterConn ? d.filter((db: any) => db.connection_id === filterConn) : d);
      setConnections(conns);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!org || !form.name) return;
    setSubmitting(true);
    try {
      const { dashboard } = await dashboardApi.create(org.id, form);
      router.push(`/orgs/${slug}/dashboards/${dashboard.id}`);
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  }

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link href={`/orgs/${slug}`} className="text-zinc-500 hover:text-zinc-300">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Dashboards</h1>
              <p className="text-zinc-400 text-sm">{org?.name}</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Dashboard
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="bg-white/[0.04] border border-violet-500/30 rounded-2xl p-6 mb-6">
            <h2 className="text-base font-semibold mb-4">Create Dashboard</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Dashboard Name</label>
                  <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                    placeholder="My Analytics Dashboard"
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50"/>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Data Source</label>
                  <select value={form.connectionId} onChange={e => setForm(f => ({...f, connectionId: e.target.value}))}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-violet-500/50 appearance-none">
                    <option value="">Select a connection…</option>
                    {connections.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.connector_type})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Description (optional)</label>
                <input value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))}
                  placeholder="What is this dashboard about?"
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50"/>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={!form.name || submitting}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium disabled:opacity-40 transition-colors">
                  {submitting ? 'Creating…' : 'Create Dashboard'}
                </button>
                <button type="button" onClick={() => setShowCreate(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-sm text-zinc-400 transition-colors">Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* Dashboard grid */}
        {dashboards.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">📊</div>
            <p className="text-zinc-300 font-medium mb-1">No dashboards yet</p>
            <p className="text-zinc-500 text-sm">Create one to visualize your data</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {dashboards.map((dash: any) => (
              <Link key={dash.id} href={`/orgs/${slug}/dashboards/${dash.id}`}
                className="group p-5 bg-white/[0.03] border border-white/[0.06] hover:border-violet-500/30 hover:bg-white/[0.06] rounded-2xl transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-xl">📊</div>
                  {dash.is_published && (
                    <span className="text-xs px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full">Published</span>
                  )}
                </div>
                <p className="font-medium text-zinc-200 group-hover:text-white truncate">{dash.name}</p>
                {dash.description && (
                  <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{dash.description}</p>
                )}
                <p className="text-xs text-zinc-600 mt-3">
                  {new Date(dash.updated_at).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
