'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { connectionApi, orgApi } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

const CONNECTORS = [
  { type: 'postgres', label: 'PostgreSQL', icon: '🐘', defaultPort: 5432 },
  { type: 'mysql', label: 'MySQL', icon: '🔵', defaultPort: 3306 },
  { type: 'elasticsearch', label: 'Elasticsearch', icon: '🟡', defaultPort: 9200 },
  { type: 'mongodb', label: 'MongoDB', icon: '🍃', defaultPort: 27017 },
  { type: 'databricks', label: 'Databricks', icon: '⚡', defaultPort: 443 },
];

export default function NewConnectionPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [selected, setSelected] = useState(CONNECTORS[0]);
  const [form, setForm] = useState({
    name: '', host: '', port: 5432, databaseName: '', username: '', password: '',
    sslEnabled: false, description: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function handleConnectorSelect(c: typeof CONNECTORS[0]) {
    setSelected(c);
    setForm(f => ({ ...f, port: c.defaultPort }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { org } = await orgApi.get(slug);
      const { connection } = await connectionApi.create(org.id, {
        ...form,
        connectorType: selected.type,
      });
      router.push(`/orgs/${slug}/connections`);
    } catch (err: any) {
      setError(err?.message || 'Failed to create connection');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex">
      <aside className="w-56 border-r border-white/10 h-screen sticky top-0 p-4">
        <Link href={`/orgs/${slug}/connections`} className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 mb-4">
          ← Connections
        </Link>
      </aside>

      <main className="flex-1 p-8">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold mb-2">New Connection</h1>
          <p className="text-zinc-400 text-sm mb-8">Connect a datasource to your organization</p>

          {/* Connector type selector */}
          <div className="mb-6">
            <label className="block text-sm text-zinc-400 mb-3">Connector Type</label>
            <div className="grid grid-cols-5 gap-2">
              {CONNECTORS.map(c => (
                <button key={c.type} type="button" onClick={() => handleConnectorSelect(c)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-sm transition-all
                    ${selected.type === c.type
                      ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
                      : 'border-white/10 bg-white/5 text-zinc-400 hover:border-white/20'}`}>
                  <span className="text-xl">{c.icon}</span>
                  <span className="text-xs">{c.label}</span>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 bg-white/5 border border-white/10 rounded-2xl p-6">
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Connection Name</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder={`My ${selected.label}`} required
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Description (optional)</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="What does this connection do?"
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-sm text-zinc-400 mb-1.5">Host</label>
                <input value={form.host} onChange={e => setForm({ ...form, host: e.target.value })}
                  placeholder="localhost" required
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1.5">Port</label>
                <input type="number" value={form.port} onChange={e => setForm({ ...form, port: parseInt(e.target.value) })}
                  required
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
              </div>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1.5">Database Name</label>
              <input value={form.databaseName} onChange={e => setForm({ ...form, databaseName: e.target.value })}
                placeholder="my_database" required
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-zinc-400 mb-1.5">Username</label>
                <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1.5">Password</label>
                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="ssl" checked={form.sslEnabled}
                onChange={e => setForm({ ...form, sslEnabled: e.target.checked })}
                className="w-4 h-4 accent-violet-500" />
              <label htmlFor="ssl" className="text-sm text-zinc-400">Enable SSL</label>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex gap-3 pt-2">
              <Link href={`/orgs/${slug}/connections`}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-zinc-400 text-sm text-center hover:bg-white/5 transition-colors">
                Cancel
              </Link>
              <button type="submit" disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors disabled:opacity-50">
                {loading ? 'Creating…' : 'Create Connection'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
