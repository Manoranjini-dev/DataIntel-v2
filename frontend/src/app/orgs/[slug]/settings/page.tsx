'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { orgApi } from '@/lib/api';

const ICON_COLORS = [
  { bg: 'bg-violet-500/20', border: 'border-violet-500/20', text: 'text-violet-400' },
  { bg: 'bg-blue-500/20', border: 'border-blue-500/20', text: 'text-blue-400' },
  { bg: 'bg-emerald-500/20', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  { bg: 'bg-amber-500/20', border: 'border-amber-500/20', text: 'text-amber-400' },
  { bg: 'bg-rose-500/20', border: 'border-rose-500/20', text: 'text-rose-400' },
];

export default function OrgSettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [org, setOrg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [activeSection, setActiveSection] = useState<'general' | 'danger'>('general');

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIcon, setSelectedIcon] = useState(0);

  useEffect(() => { loadData(); }, [slug]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      setName(o.name || '');
      setDescription(o.description || '');
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    setSaving(true);
    try {
      await orgApi.update?.(org.id, { name, description });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      await loadData();
    } catch (e: any) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  const navItems = [
    { label: 'Overview', href: `/orgs/${slug}`, icon: '◉' },
    { label: 'Connections', href: `/orgs/${slug}/connections`, icon: '⚡' },
    { label: 'Chats', href: `/orgs/${slug}/chats`, icon: '💬' },
    { label: 'Combos', href: `/orgs/${slug}/combos`, icon: '🔗' },
    { label: 'Dashboards', href: `/orgs/${slug}/dashboards`, icon: '📊' },
    { label: 'Members', href: `/orgs/${slug}/members`, icon: '👥' },
    { label: 'Audit Log', href: `/orgs/${slug}/audit`, icon: '📋' },
    { label: 'Settings', href: `/orgs/${slug}/settings`, icon: '⚙️', active: true },
  ];

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex">
      {/* Sidebar */}
      <aside className="w-56 border-r border-white/10 flex flex-col h-screen sticky top-0">
        <div className="p-4 border-b border-white/10">
          <Link href="/orgs" className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors mb-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
            All orgs
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/20 flex items-center justify-center text-violet-400 font-bold text-sm">
              {org?.name?.charAt(0)}
            </div>
            <div>
              <p className="text-sm font-medium text-white truncate">{org?.name}</p>
              <p className="text-xs text-zinc-500 capitalize">{org?.member_role}</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${
                item.active
                  ? 'bg-violet-500/10 text-violet-300 border border-violet-500/20'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}>
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-2xl">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white mb-1">Organization Settings</h1>
            <p className="text-zinc-400 text-sm">Manage your organization's configuration and preferences</p>
          </div>

          {/* Section tabs */}
          <div className="flex gap-1 mb-8 border-b border-white/10">
            {(['general', 'danger'] as const).map(s => (
              <button key={s} onClick={() => setActiveSection(s)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
                  activeSection === s
                    ? `border-violet-500 text-white ${s === 'danger' ? 'border-red-500 text-red-400' : ''}`
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}>
                {s === 'danger' ? '⚠️ Danger Zone' : 'General'}
              </button>
            ))}
          </div>

          {activeSection === 'general' && (
            <div className="space-y-6">
              {saveSuccess && (
                <div className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm">
                  ✅ Settings saved successfully
                </div>
              )}

              <form onSubmit={handleSave} className="space-y-6">
                {/* Org Identity */}
                <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 space-y-4">
                  <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-4">Identity</h2>

                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Organization Name</label>
                    <input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      required
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Description <span className="text-zinc-600">(optional)</span></label>
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      rows={3}
                      placeholder="Describe your organization..."
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Organization Slug</label>
                    <div className="px-3 py-2.5 bg-white/[0.02] border border-white/5 rounded-xl text-sm text-zinc-500 font-mono">
                      {org?.slug}
                    </div>
                    <p className="text-xs text-zinc-600 mt-1">Slug cannot be changed</p>
                  </div>
                </div>

                {/* Metadata Info */}
                <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
                  <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-4">Organization Info</h2>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    {[
                      { label: 'Organization ID', value: org?.id },
                      { label: 'Your Role', value: org?.member_role },
                      { label: 'Created', value: org?.created_at ? new Date(org.created_at).toLocaleDateString() : '—' },
                      { label: 'Plan', value: org?.plan || 'Free' },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-zinc-500 mb-0.5">{label}</p>
                        <p className="text-zinc-200 font-mono truncate">{value || '—'}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <button type="submit" disabled={saving || !name.trim()}
                  className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </form>
            </div>
          )}

          {activeSection === 'danger' && (
            <div className="space-y-6">
              <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6">
                <h2 className="text-sm font-semibold text-red-400 mb-1">Delete Organization</h2>
                <p className="text-xs text-zinc-400 mb-4">
                  Permanently delete this organization and all its data — connections, chats, dashboards and members.
                  This action <strong className="text-white">cannot be undone</strong>.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                      Type <span className="font-mono text-white bg-white/10 px-1.5 py-0.5 rounded">{org?.slug}</span> to confirm
                    </label>
                    <input
                      value={deleteConfirm}
                      onChange={e => setDeleteConfirm(e.target.value)}
                      placeholder={org?.slug}
                      className="w-full px-3 py-2.5 bg-white/5 border border-red-500/20 rounded-xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                    />
                  </div>
                  <button
                    disabled={deleteConfirm !== org?.slug}
                    onClick={() => alert('Delete functionality — confirm on backend API before enabling')}
                    className="px-5 py-2.5 bg-red-600/20 border border-red-500/30 text-red-400 rounded-xl text-sm font-medium transition-colors disabled:opacity-30 hover:bg-red-600/30">
                    Delete Organization
                  </button>
                </div>
              </div>

              <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-6">
                <h2 className="text-sm font-semibold text-amber-400 mb-1">Leave Organization</h2>
                <p className="text-xs text-zinc-400 mb-4">
                  Remove yourself from this organization. You will lose access to all its resources.
                </p>
                <button
                  className="px-5 py-2.5 bg-amber-600/20 border border-amber-500/30 text-amber-400 rounded-xl text-sm font-medium transition-colors hover:bg-amber-600/30">
                  Leave Organization
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
