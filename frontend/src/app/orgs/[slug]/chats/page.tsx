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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [selectedConn, setSelectedConn] = useState<string>(connectionId || '');
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [creating, setCreating] = useState(false);

  const [isArchived, setIsArchived] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [slug, connectionId, isArchived]);

  async function loadData() {
    try {
      setLoading(true);
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const [{ chats: c }, { connections: conns }] = await Promise.all([
        chatApi.list(o.id, { connectionId: connectionId || undefined, isArchived }),
        connectionApi.list(o.id),
      ]);
      setChats(c);
      setConnections(conns);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function createChat(connId: string) {
    router.push(`/orgs/${slug}/chats/new?connectionId=${connId}`);
  }

  async function handleArchive(chatId: string, e: React.MouseEvent) {
    e.preventDefault();
    if (!org) return;
    try {
      await chatApi.archive(org.id, chatId);
      setChats(c => c.filter(chat => chat.id !== chatId));
    } catch (error) { console.error(error); }
  }

  async function handleUnarchive(chatId: string, e: React.MouseEvent) {
    e.preventDefault();
    if (!org) return;
    try {
      await chatApi.unarchive(org.id, chatId);
      setChats(c => c.filter(chat => chat.id !== chatId));
    } catch (error) { console.error(error); }
  }

  async function handleDelete(chatId: string, e: React.MouseEvent) {
    e.preventDefault();
    if (!org) return;
    if (!window.confirm('Are you sure you want to delete this chat?')) return;
    try {
      await chatApi.delete(org.id, chatId);
      setChats(c => c.filter(chat => chat.id !== chatId));
    } catch (error) { console.error(error); }
  }

  if (loading && !org) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link href={`/orgs/${slug}`} className="text-muted-foreground hover:text-foreground">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white">Chats</h1>
              <p className="text-muted-foreground text-sm">{org?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-muted/50 p-1 rounded-xl">
            <button
              onClick={() => setIsArchived(false)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${!isArchived ? 'bg-white/10 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Active
            </button>
            <button
              onClick={() => setIsArchived(true)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${isArchived ? 'bg-white/10 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Archived
            </button>
          </div>
        </div>

        {/* Connection filter chips */}
        {connections.length > 0 && !isArchived && (
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => router.push(`/orgs/${slug}/chats`)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                !connectionId ? 'bg-primary/20 border-primary/30 text-primary' : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground'
              }`}>
              All
            </button>
            {connections.map((c: any) => (
              <button key={c.id}
                onClick={() => router.push(`/orgs/${slug}/chats?connectionId=${c.id}`)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  connectionId === c.id ? 'bg-primary/20 border-primary/30 text-primary' : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground'
                }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${c.status === 'active' ? 'bg-success' : 'bg-muted-foreground/30'}`} />
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* New Chat */}
        {!isArchived && (
          <div className="bg-muted/30 border border-border rounded-2xl p-5 mb-6">
            <h2 className="text-sm font-medium text-foreground mb-3">Start a new chat</h2>
            {connections.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-muted-foreground text-sm mb-3">No connections yet. Create one first.</p>
                <Link href={`/orgs/${slug}/connections/new`}
                  className="px-4 py-2 bg-primary hover:opacity-90 rounded-xl text-sm font-medium transition-colors">
                  Add Connection
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {connections.map((conn: any) => (
                  <button key={conn.id} onClick={() => createChat(conn.id)}
                    disabled={creating}
                    className="group flex items-center gap-2 px-4 py-2.5 bg-muted/50 border border-border hover:border-primary/30 hover:bg-muted/30 rounded-xl text-sm transition-all">
                    <span className={`w-2 h-2 rounded-full ${conn.status === 'active' ? 'bg-success' : 'bg-muted-foreground/30'}`} />
                    <span className="text-foreground">{conn.name}</span>
                    <span className="text-muted-foreground/60 text-xs">{conn.connector_type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Existing Chats */}
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            {isArchived ? 'Archived Chats' : connectionId ? `Chats in ${connections.find(c => c.id === connectionId)?.name || 'connection'}` : 'Recent Chats'}
          </h2>
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : chats.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground/60">
              {isArchived ? 'No archived chats found.' : connectionId ? 'No chats for this connection yet.' : 'No chats yet. Start one above!'}
            </div>
          ) : (
            chats.map((chat: any) => (
              <Link key={chat.id} href={`/orgs/${slug}/chats/${chat.id}${connectionId ? `?connectionId=${connectionId}` : ''}`}
                className="flex items-center gap-4 px-4 py-3 bg-muted/30 border border-white/[0.06] hover:border-white/20 hover:bg-muted/30 rounded-xl transition-all group">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-base">💬</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground group-hover:text-foreground truncate">{chat.title || 'Untitled Chat'}</p>
                  <p className="text-xs text-muted-foreground">
                    {chat.message_count} messages · {new Date(chat.updated_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isArchived ? (
                    <button onClick={(e) => handleUnarchive(chat.id, e)} className="px-2 py-1 bg-muted/50 hover:bg-white/10 border border-border rounded text-xs text-foreground transition-colors">
                      Unarchive
                    </button>
                  ) : (
                    <button onClick={(e) => handleArchive(chat.id, e)} className="px-2 py-1 bg-muted/50 hover:bg-white/10 border border-border rounded text-xs text-foreground transition-colors">
                      Archive
                    </button>
                  )}
                  <button onClick={(e) => handleDelete(chat.id, e)} className="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded text-xs text-red-400 transition-colors">
                    Delete
                  </button>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
