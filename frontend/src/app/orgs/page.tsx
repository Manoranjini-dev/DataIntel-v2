'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { orgApi, authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

interface Org {
  id: string;
  name: string;
  slug: string;
  description: string;
  member_role: string;
  created_at: string;
}

export default function OrgsPage() {
  const router = useRouter();
  const { user, clearUser } = useAuthStore();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newOrg, setNewOrg] = useState({ name: '', slug: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadOrgs();
  }, []);

  async function loadOrgs() {
    try {
      const { orgs } = await orgApi.list();
      setOrgs(orgs);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
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

  const roleColors: Record<string, string> = {
    owner: 'text-amber-400 bg-amber-400/10',
    admin: 'text-blue-400 bg-blue-400/10',
    editor: 'text-green-400 bg-green-400/10',
    viewer: 'text-zinc-400 bg-zinc-400/10',
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
              </svg>
            </div>
            <span className="font-bold text-white">DataIntel</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-400">{user?.displayName}</span>
            <button onClick={handleLogout} className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Organizations</h1>
            <p className="text-zinc-400 text-sm mt-1">Manage your data intelligence workspaces</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-xl transition-colors shadow-lg shadow-violet-500/20"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Organization
          </button>
        </div>

        {/* Create modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#111118] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
              <h2 className="text-lg font-semibold text-white mb-4">Create Organization</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1.5">Organization Name</label>
                  <input value={newOrg.name} onChange={e => setNewOrg({ ...newOrg, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-') })}
                    placeholder="Acme Corp" required className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1.5">Slug (URL identifier)</label>
                  <input value={newOrg.slug} onChange={e => setNewOrg({ ...newOrg, slug: e.target.value })}
                    placeholder="acme-corp" required className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1.5">Description (optional)</label>
                  <input value={newOrg.description} onChange={e => setNewOrg({ ...newOrg, description: e.target.value })}
                    placeholder="What does this org do?" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
                </div>
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowCreate(false)}
                    className="flex-1 py-2 rounded-xl border border-white/10 text-zinc-400 text-sm hover:bg-white/5 transition-colors">Cancel</button>
                  <button type="submit" disabled={creating}
                    className="flex-1 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors disabled:opacity-50">
                    {creating ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Orgs list */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : orgs.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-white/10 rounded-2xl">
            <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
            </div>
            <p className="text-zinc-400 text-sm">No organizations yet. Create your first one.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {orgs.map((org) => (
              <Link key={org.id} href={`/orgs/${org.slug}`}
                className="group flex items-center justify-between p-5 bg-white/5 border border-white/10 rounded-2xl hover:border-violet-500/30 hover:bg-white/[0.07] transition-all duration-200">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-500/20 flex items-center justify-center text-violet-400 font-bold text-sm">
                    {org.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-medium text-white group-hover:text-violet-300 transition-colors">{org.name}</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">{org.description || `/${org.slug}`}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[org.member_role] || roleColors.viewer}`}>
                    {org.member_role}
                  </span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-600 group-hover:text-zinc-400 transition-colors"><path d="m9 18 6-6-6-6"/></svg>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
