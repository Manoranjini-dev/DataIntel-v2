'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { dashboardApi, connectionApi, orgApi } from '@/lib/api';
import { LayoutDashboard, Plus, X, ChevronRight } from 'lucide-react';

const inputCls = 'w-full px-3 py-2.5 bg-muted/60 border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all';

export default function DashboardsPage() {
  const { slug } = useParams<{ slug: string }>();
  const router   = useRouter();

  const [org,         setOrg]         = useState<any>(null);
  const [dashboards,  setDashboards]  = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showCreate,  setShowCreate]  = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [form, setForm] = useState({ name: '', description: '', connectionId: '' });

  useEffect(() => { loadData(); }, [slug]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const [{ dashboards: d }, { connections: conns }] = await Promise.all([
        dashboardApi.list(o.id),
        connectionApi.list(o.id),
      ]);
      setDashboards(d);
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

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="max-w-5xl mx-auto px-8 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{org?.name}</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-xl text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" /> New Dashboard
          </button>
        </div>

        {/* Create modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-5 border-b border-border">
                <h2 className="text-base font-semibold text-foreground">New Dashboard</h2>
                <button onClick={() => setShowCreate(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleCreate} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Dashboard name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Sales Overview" className={inputCls} autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Description</label>
                  <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Optional description" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Data source</label>
                  <select value={form.connectionId} onChange={e => setForm(f => ({ ...f, connectionId: e.target.value }))}
                    className={inputCls}>
                    <option value="">Select a data source…</option>
                    {connections.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.connector_type})</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="submit" disabled={!form.name || submitting}
                    className="flex-1 py-2.5 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition-colors">
                    {submitting ? 'Creating…' : 'Create Dashboard'}
                  </button>
                  <button type="button" onClick={() => setShowCreate(false)}
                    className="px-5 py-2.5 bg-muted hover:bg-muted/80 rounded-xl text-sm text-muted-foreground transition-colors">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex justify-center py-24">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : dashboards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 border-2 border-dashed border-border rounded-2xl">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <LayoutDashboard className="w-7 h-7 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">No dashboards yet</p>
            <p className="text-xs text-muted-foreground mb-5">Create your first dashboard to start visualizing data</p>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#2B2B2B] text-white rounded-xl text-sm font-semibold hover:bg-[#3a3a3a] transition-colors">
              <Plus className="w-4 h-4" /> New Dashboard
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {dashboards.map((dash: any) => (
              <Link
                key={dash.id}
                href={`/orgs/${slug}/dashboards/${dash.id}`}
                className="group block bg-card border border-border hover:border-[#2B2B2B]/30 rounded-2xl overflow-hidden transition-all hover:shadow-md"
              >
                {/* Preview strip */}
                <div className="h-28 bg-gradient-to-br from-muted/60 to-muted flex items-center justify-center">
                  <LayoutDashboard className="w-10 h-10 text-muted-foreground/20" />
                </div>

                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <p className="font-semibold text-foreground text-sm leading-snug group-hover:text-primary transition-colors line-clamp-1">
                      {dash.name}
                    </p>
                    {dash.is_published && (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded-full font-semibold">
                        Published
                      </span>
                    )}
                  </div>
                  {dash.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{dash.description}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(dash.updated_at).toLocaleDateString()}
                    </p>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
