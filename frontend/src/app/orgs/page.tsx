'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { orgApi, authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Plus, ChevronRight, Building2, LogOut, Zap } from 'lucide-react';

interface Org {
  id: string;
  name: string;
  slug: string;
  description: string;
  member_role: string;
  created_at: string;
}

const ROLE_PILL: Record<string, string> = {
  owner:  'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  admin:  'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  editor: 'bg-green-500/10 text-green-600 dark:text-green-400',
  viewer: 'bg-muted text-muted-foreground',
};

export default function OrgsPage() {
  const router = useRouter();
  const { user, clearUser } = useAuthStore();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newOrg, setNewOrg] = useState({ name: '', slug: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadOrgs(); }, []);

  async function loadOrgs() {
    try {
      const { orgs } = await orgApi.list();
      setOrgs(orgs);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      const { org } = await orgApi.create(newOrg);
      setOrgs([org, ...orgs]);
      setShowCreate(false);
      setNewOrg({ name: '', slug: '', description: '' });
    } catch (err: any) {
      setError(err?.message || 'Failed to create organization');
    } finally {
      setCreating(false);
    }
  }

  async function handleLogout() {
    await authApi.logout().catch(() => {});
    clearUser();
    router.push('/login');
  }

  const inputCls = 'w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
            >
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-foreground">DataIntel</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user?.displayName}</span>
            <button onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Organizations</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your data intelligence workspaces</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            New Organization
          </button>
        </div>

        {/* Create modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md animate-fade-in"
              style={{ boxShadow: '0 8px 40px rgba(0,0,0,.15)' }}>
              <h2 className="text-lg font-bold text-foreground mb-4">Create Organization</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">Organization Name</label>
                  <input value={newOrg.name}
                    onChange={e => setNewOrg({ ...newOrg, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-') })}
                    placeholder="Acme Corp" required className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">Slug (URL identifier)</label>
                  <input value={newOrg.slug}
                    onChange={e => setNewOrg({ ...newOrg, slug: e.target.value })}
                    placeholder="acme-corp" required className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">Description <span className="text-muted-foreground/60 font-normal">(optional)</span></label>
                  <input value={newOrg.description}
                    onChange={e => setNewOrg({ ...newOrg, description: e.target.value })}
                    placeholder="What does this org do?" className={inputCls} />
                </div>
                {error && (
                  <p className="text-destructive text-xs px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-lg">{error}</p>
                )}
                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => setShowCreate(false)}
                    className="flex-1 py-2.5 rounded-xl border border-border text-muted-foreground text-sm font-medium hover:bg-muted/50 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={creating}
                    className="flex-1 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
                    {creating ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : orgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-border rounded-2xl">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Building2 className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">No organizations yet</h3>
            <p className="text-xs text-muted-foreground mb-4">Create your first organization to get started</p>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity">
              <Plus className="w-4 h-4" />
              Create Organization
            </button>
          </div>
        ) : (
          <div className="space-y-3 animate-fade-in">
            {orgs.map((org) => (
              <Link key={org.id} href={`/orgs/${org.slug}`}
                className="group flex items-center justify-between p-5 bg-card border border-border rounded-2xl hover:border-primary/30 hover:shadow-md transition-all"
                style={{ boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
                <div className="flex items-center gap-4">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                    style={{ background: 'linear-gradient(135deg, rgba(217,122,30,.7), rgba(139,92,246,.7))' }}
                  >
                    {org.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors text-sm">{org.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{org.description || `/${org.slug}`}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${ROLE_PILL[org.member_role] ?? ROLE_PILL.viewer}`}>
                    {org.member_role}
                  </span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
