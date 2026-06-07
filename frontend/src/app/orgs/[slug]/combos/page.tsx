'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { comboApi, connectionApi, orgApi } from '@/lib/api';

export default function CombosPage() {
  const { slug } = useParams<{ slug: string }>();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const router = useRouter();
  const [org, setOrg] = useState<any>(null);
  const [combos, setCombos] = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', description: '', connectionIds: [] as string[] });
  const [submitting, setSubmitting] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [slug]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const [{ combos: c }, { connections: conns }] = await Promise.all([
        comboApi.list(o.id),
        connectionApi.list(o.id),
      ]);
      setCombos(c);
      setConnections(conns);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!org || form.connectionIds.length < 2) return;
    setSubmitting(true);
    try {
      const { combo } = await comboApi.create(org.id, form);
      setCombos(cs => [combo, ...cs]);
      setShowCreate(false);
      setForm({ name: '', description: '', connectionIds: [] });
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  }

  function toggleConnection(id: string) {
    setForm(f => ({
      ...f,
      connectionIds: f.connectionIds.includes(id)
        ? f.connectionIds.filter(c => c !== id)
        : [...f.connectionIds, id],
    }));
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link href={`/orgs/${slug}`} className="text-muted-foreground hover:text-foreground">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white">Combos</h1>
              <p className="text-muted-foreground text-sm">Multi-source query groups</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:opacity-90 rounded-xl text-sm font-medium transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Combo
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="bg-muted/30 border border-primary/30 rounded-2xl p-6 mb-6 animate-in fade-in">
            <h2 className="text-base font-semibold mb-4">Create Combo</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">Combo Name</label>
                <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                  placeholder="e.g., MySQL + Elasticsearch"
                  className="w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"/>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">Description (optional)</label>
                <input value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))}
                  placeholder="What is this combo for?"
                  className="w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"/>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-2">Select Connections (min 2)</label>
                <div className="flex flex-wrap gap-2">
                  {connections.map((conn: any) => (
                    <button type="button" key={conn.id}
                      onClick={() => toggleConnection(conn.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-all
                        ${form.connectionIds.includes(conn.id)
                          ? 'bg-primary/10 border-primary text-primary'
                          : 'bg-muted/50 border-border text-muted-foreground hover:border-white/20'}`}>
                      <span className={`w-2 h-2 rounded-full ${conn.status === 'active' ? 'bg-success' : 'bg-muted-foreground/30'}`} />
                      {conn.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={!form.name || form.connectionIds.length < 2 || submitting}
                  className="px-4 py-2 bg-primary hover:opacity-90 rounded-xl text-sm font-medium disabled:opacity-40 transition-colors">
                  {submitting ? 'Creating…' : 'Create Combo'}
                </button>
                <button type="button" onClick={() => setShowCreate(false)}
                  className="px-4 py-2 bg-muted/50 hover:bg-white/10 rounded-xl text-sm text-muted-foreground transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Combos list */}
        <div className="space-y-3">
          {combos.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">🔗</div>
              <p className="text-muted-foreground text-sm">No combos yet. Create one to query across multiple data sources.</p>
            </div>
          ) : (
            combos.map((combo: any) => (
              <div key={combo.id}
                className="flex items-start gap-4 px-5 py-4 bg-muted/30 border border-white/[0.06] hover:border-white/20 rounded-2xl transition-all group">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-lg flex-shrink-0">🔗</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground group-hover:text-foreground">{combo.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{combo.description}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(combo.connection_names || []).filter(Boolean).map((n: string, i: number) => (
                      <span key={i} className="text-xs px-2 py-0.5 bg-muted/50 rounded-lg text-muted-foreground">{n}</span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link href={`/orgs/${slug}/combos/${combo.id}/chat?chatId=new`}
                    className="px-3 py-1.5 bg-primary/20 border border-primary/30 hover:bg-primary/30 rounded-lg text-xs text-primary font-medium transition-colors">
                    New Chat
                  </Link>
                  <Link href={`/orgs/${slug}/chats?comboId=${combo.id}`}
                    className="px-3 py-1.5 bg-muted/50 border border-border hover:bg-white/10 rounded-lg text-xs text-muted-foreground transition-colors">
                    History
                  </Link>
                  <Link href={`/orgs/${slug}/combos/${combo.id}/dashboard`}
                    className="px-3 py-1.5 bg-muted/50 border border-border hover:bg-white/10 rounded-lg text-xs text-muted-foreground transition-colors">
                    Dashboard
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
