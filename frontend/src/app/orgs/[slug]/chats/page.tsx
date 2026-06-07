'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { chatApi, connectionApi, orgApi } from '@/lib/api';

export default function ChatsPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const connectionId = searchParams.get('connectionId');

  const [org, setOrg] = useState<any>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [selectedConn, setSelectedConn] = useState<string>(connectionId || '');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadData(); }, [slug, connectionId]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const [{ chats: c }, { connections: conns }] = await Promise.all([
        chatApi.list(o.id, connectionId ? { connectionId } : {}),
        connectionApi.list(o.id),
      ]);
      setChats(c);
      setConnections(conns);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function createChat(connId: string) {
    if (!org) return;
    setCreating(true);
    try {
      const { chat } = await chatApi.create(org.id, { connectionId: connId, title: 'New Chat' });
      router.push(`/orgs/${slug}/chats/${chat.id}?connectionId=${connId}`);
    } catch (e) { console.error(e); }
    finally { setCreating(false); }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link href={`/orgs/${slug}`} className="text-zinc-500 hover:text-zinc-300">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Chats</h1>
            <p className="text-zinc-400 text-sm">{org?.name}</p>
          </div>
        </div>

        {/* Connection filter chips */}
        {connections.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => router.push(`/orgs/${slug}/chats`)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                !connectionId ? 'bg-violet-500/20 border-violet-500/30 text-violet-300' : 'bg-white/5 border-white/10 text-zinc-400 hover:text-zinc-200'
              }`}>
              All
            </button>
            {connections.map((c: any) => (
              <button key={c.id}
                onClick={() => router.push(`/orgs/${slug}/chats?connectionId=${c.id}`)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  connectionId === c.id ? 'bg-violet-500/20 border-violet-500/30 text-violet-300' : 'bg-white/5 border-white/10 text-zinc-400 hover:text-zinc-200'
                }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${c.status === 'active' ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* New Chat */}
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 mb-6">
          <h2 className="text-sm font-medium text-zinc-300 mb-3">Start a new chat</h2>
          {connections.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-zinc-500 text-sm mb-3">No connections yet. Create one first.</p>
              <Link href={`/orgs/${slug}/connections/new`}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium transition-colors">
                Add Connection
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {connections.map((conn: any) => (
                <button key={conn.id} onClick={() => createChat(conn.id)}
                  disabled={creating}
                  className="group flex items-center gap-2 px-4 py-2.5 bg-white/5 border border-white/10 hover:border-violet-500/30 hover:bg-white/[0.07] rounded-xl text-sm transition-all">
                  <span className={`w-2 h-2 rounded-full ${conn.status === 'active' ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                  <span className="text-zinc-300">{conn.name}</span>
                  <span className="text-zinc-600 text-xs">{conn.connector_type}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Existing Chats */}
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-400 mb-3">
            {connectionId ? `Chats in ${connections.find(c => c.id === connectionId)?.name || 'connection'}` : 'Recent Chats'}
          </h2>
          {chats.length === 0 ? (
            <div className="text-center py-12 text-zinc-600">
              {connectionId ? 'No chats for this connection yet.' : 'No chats yet. Start one above!'}
            </div>
          ) : (
            chats.map((chat: any) => (
              <Link key={chat.id} href={`/orgs/${slug}/chats/${chat.id}${connectionId ? `?connectionId=${connectionId}` : ''}`}
                className="flex items-center gap-4 px-4 py-3 bg-white/[0.03] border border-white/[0.06] hover:border-white/20 hover:bg-white/[0.06] rounded-xl transition-all group">
                <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center text-base">💬</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-200 group-hover:text-white truncate">{chat.title || 'Untitled Chat'}</p>
                  <p className="text-xs text-zinc-500">
                    {chat.message_count} messages · {new Date(chat.updated_at).toLocaleDateString()}
                  </p>
                </div>
                <svg width="14" height="14" className="text-zinc-600 group-hover:text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
