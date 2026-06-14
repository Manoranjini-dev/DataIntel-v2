'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { dashboardApi, connectionApi, orgApi } from '@/lib/api';
import { LayoutDashboard, Plus, X, ChevronRight, MoreVertical, Edit, Trash2 } from 'lucide-react';

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

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dashToRename, setDashToRename] = useState<any>(null);
  const [renameForm, setRenameForm] = useState({ name: '', description: '' });
  const [dashToDelete, setDashToDelete] = useState<any>(null);
  const [toastMsg, setToastMsg] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const handleClose = () => setOpenMenuId(null);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, []);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToastMsg({ message, type });
    setTimeout(() => setToastMsg(null), 3000);
  };

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

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dashToRename || !renameForm.name) return;
    setSubmitting(true);
    try {
      await dashboardApi.update(org.id, dashToRename.id, renameForm);
      showToast('Dashboard renamed successfully', 'success');
      setDashToRename(null);
      loadData();
    } catch (err) {
      console.error(err);
      showToast('Failed to rename dashboard', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!dashToDelete) return;
    setSubmitting(true);
    try {
      await dashboardApi.delete(org.id, dashToDelete.id);
      showToast('Dashboard deleted successfully', 'success');
      setDashToDelete(null);
      loadData();
    } catch (err) {
      console.error(err);
      showToast('Failed to delete dashboard', 'error');
    } finally {
      setSubmitting(false);
    }
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
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Data source (Optional)</label>
                  <select value={form.connectionId} onChange={e => setForm(f => ({ ...f, connectionId: e.target.value }))}
                    className={inputCls}>
                    <option value="">None (General Dashboard)</option>
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
              <div key={dash.id} className="relative group block bg-card border border-border hover:border-[#2B2B2B]/30 rounded-2xl overflow-hidden transition-all hover:shadow-md">
                <Link
                  href={`/orgs/${slug}/dashboards/${dash.id}`}
                  className="block h-full w-full"
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

                {/* Context Menu */}
                <div className="absolute top-3 right-3 z-10" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setOpenMenuId(openMenuId === dash.id ? null : dash.id);
                    }}
                    className="p-1.5 rounded-lg bg-background/80 hover:bg-muted text-muted-foreground transition-colors shadow-sm border border-border/50"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {openMenuId === dash.id && (
                    <div className="absolute right-0 mt-1 w-40 bg-card border border-border rounded-xl shadow-lg py-1.5 z-20">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setOpenMenuId(null);
                          setDashToRename(dash);
                          setRenameForm({ name: dash.name, description: dash.description || '' });
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
                      >
                        <Edit className="w-4 h-4 text-muted-foreground" /> Rename
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setOpenMenuId(null);
                          setDashToDelete(dash);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left"
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rename Modal */}
      {dashToRename && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setDashToRename(null)}>
          <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-border">
              <h2 className="text-base font-semibold text-foreground">Rename Dashboard</h2>
              <button onClick={() => setDashToRename(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleRenameSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Dashboard name *</label>
                <input value={renameForm.name} onChange={e => setRenameForm(f => ({ ...f, name: e.target.value }))}
                  className={inputCls} autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Description</label>
                <input value={renameForm.description} onChange={e => setRenameForm(f => ({ ...f, description: e.target.value }))}
                  className={inputCls} />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={!renameForm.name || submitting}
                  className="flex-1 py-2.5 bg-[#2B2B2B] hover:bg-[#3a3a3a] text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition-colors">
                  {submitting ? 'Saving…' : 'Save Changes'}
                </button>
                <button type="button" onClick={() => setDashToRename(null)}
                  className="px-5 py-2.5 bg-muted hover:bg-muted/80 rounded-xl text-sm text-muted-foreground transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {dashToDelete && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setDashToDelete(null)}>
          <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-xl p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-foreground mb-2">Delete Dashboard</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Are you sure you want to delete <span className="font-semibold text-foreground">{dashToDelete.name}</span>? This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={handleDeleteConfirm} disabled={submitting}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition-colors">
                {submitting ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button onClick={() => setDashToDelete(null)}
                className="flex-1 py-2.5 bg-muted hover:bg-muted/80 rounded-xl text-sm text-muted-foreground transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-5">
          <div className={`px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg border ${
            toastMsg.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
          }`}>
            {toastMsg.message}
          </div>
        </div>
      )}
    </div>
  );
}
