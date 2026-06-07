'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { chatApi, connectionApi, orgApi, comboApi } from '@/lib/api';
import { MessageSquare, Plus, Archive, Trash2, Check, X, GitFork } from 'lucide-react';

export default function ChatsPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const connectionId = searchParams.get('connectionId') || undefined;
  const comboId      = searchParams.get('comboId')      || undefined;

  const [org, setOrg] = useState<any>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [combos, setCombos] = useState<any[]>([]);
  const [isArchived, setIsArchived] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [slug, connectionId, comboId, isArchived]);

  async function loadData() {
    setLoading(true);
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const [{ chats: c }, { connections: conns }, { combos: cbs }] = await Promise.all([
        chatApi.list(o.id, { connectionId, comboId, isArchived }),
        connectionApi.list(o.id),
        comboApi.list(o.id),
      ]);
      setChats(c);
      setConnections(conns);
      setCombos(cbs);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleArchive(chatId: string, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!org) return;
    try {
      await chatApi.archive(org.id, chatId);
      setChats(c => c.filter(ch => ch.id !== chatId));
    } catch (err) { console.error(err); }
  }

  async function handleUnarchive(chatId: string, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!org) return;
    try {
      await chatApi.unarchive(org.id, chatId);
      setChats(c => c.filter(ch => ch.id !== chatId));
    } catch (err) { console.error(err); }
  }

  async function handleDelete(chatId: string, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!org) return;
    if (confirmingDeleteId !== chatId) { setConfirmingDeleteId(chatId); return; }
    try {
      await chatApi.delete(org.id, chatId);
      setChats(c => c.filter(ch => ch.id !== chatId));
    } catch (err) { console.error(err); }
    finally { setConfirmingDeleteId(null); }
  }

  // Build "start new chat" href
  function newChatHref(connId?: string, cmbId?: string) {
    if (connId) return `/orgs/${slug}/connections/${connId}/chat?chatId=new`;
    if (cmbId)  return `/orgs/${slug}/combos/${cmbId}/chat?chatId=new`;
    return null;
  }

  const activeConnName = connections.find(c => c.id === connectionId)?.name;
  const activeComboName = combos.find(c => c.id === comboId)?.name;

  const cardCls = 'bg-card border border-border rounded-2xl';

  if (loading && !org) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Chats</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {activeConnName ? `${activeConnName} · ` : activeComboName ? `${activeComboName} · ` : ''}
              {org?.name}
            </p>
          </div>

          {/* Active / Archived toggle */}
          <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border">
            {(['Active', 'Archived'] as const).map(label => {
              const archived = label === 'Archived';
              return (
                <button
                  key={label}
                  onClick={() => setIsArchived(archived)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    isArchived === archived
                      ? 'bg-card shadow-sm text-foreground border border-border'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Filter chips — Connections */}
        {connections.length > 0 && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Connections</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => router.push(`/orgs/${slug}/chats`)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  !connectionId && !comboId
                    ? 'bg-primary/10 border-primary/40 text-primary'
                    : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                All chats
              </button>
              {connections.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => router.push(`/orgs/${slug}/chats?connectionId=${c.id}`)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    connectionId === c.id
                      ? 'bg-primary/10 border-primary/40 text-primary'
                      : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${c.status === 'active' ? 'bg-success' : 'bg-muted-foreground/30'}`} />
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Filter chips — Combos */}
        {combos.length > 0 && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Combos</p>
            <div className="flex flex-wrap gap-2">
              {combos.map((cb: any) => (
                <button
                  key={cb.id}
                  onClick={() => router.push(`/orgs/${slug}/chats?comboId=${cb.id}`)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    comboId === cb.id
                      ? 'bg-primary/10 border-primary/40 text-primary'
                      : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  🔗 {cb.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Start a new chat — shown only for active tab */}
        {!isArchived && (connectionId || comboId) && (
          <div className={`${cardCls} p-5 border-dashed`} style={{ boxShadow: 'var(--shadow-soft)' }}>
            {connectionId ? (
              <Link
                href={`/orgs/${slug}/connections/${connectionId}/chat?chatId=new`}
                className="flex items-center justify-center gap-2 w-full py-2 text-sm font-semibold text-primary hover:opacity-80 transition-opacity"
              >
                <Plus className="w-4 h-4" /> Start a new chat with {activeConnName}
              </Link>
            ) : comboId ? (
              <Link
                href={`/orgs/${slug}/combos/${comboId}/chat?chatId=new`}
                className="flex items-center justify-center gap-2 w-full py-2 text-sm font-semibold text-primary hover:opacity-80 transition-opacity"
              >
                <Plus className="w-4 h-4" /> Start a new chat with {activeComboName}
              </Link>
            ) : null}
          </div>
        )}

        {/* No filter selected — quick-start grid */}
        {!isArchived && !connectionId && !comboId && (connections.length > 0 || combos.length > 0) && (
          <div className={`${cardCls} p-5`} style={{ boxShadow: 'var(--shadow-soft)' }}>
            <h2 className="text-sm font-semibold text-foreground mb-3">Start a new chat</h2>
            <div className="flex flex-wrap gap-2">
              {connections.map((conn: any) => {
                const href = newChatHref(conn.id);
                return href ? (
                  <Link key={conn.id} href={href}
                    className="group flex items-center gap-2 px-4 py-2.5 bg-muted/50 border border-border hover:border-primary/30 hover:bg-primary/5 rounded-xl text-sm transition-all">
                    <span className={`w-2 h-2 rounded-full ${conn.status === 'active' ? 'bg-success' : 'bg-muted-foreground/30'}`} />
                    <span className="text-foreground">{conn.name}</span>
                    <span className="text-muted-foreground/60 text-xs">{conn.connector_type}</span>
                  </Link>
                ) : null;
              })}
              {combos.map((cb: any) => {
                const href = newChatHref(undefined, cb.id);
                return href ? (
                  <Link key={cb.id} href={href}
                    className="flex items-center gap-2 px-4 py-2.5 bg-muted/50 border border-border hover:border-primary/30 hover:bg-primary/5 rounded-xl text-sm transition-all">
                    🔗 <span className="text-foreground">{cb.name}</span>
                    <span className="text-muted-foreground/60 text-xs">combo</span>
                  </Link>
                ) : null;
              })}
            </div>
          </div>
        )}

        {/* Chat list */}
        <div className={cardCls} style={{ boxShadow: 'var(--shadow-soft)' }}>
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border">
            <MessageSquare className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              {isArchived ? 'Archived Chats' : connectionId ? `${activeConnName} chats` : comboId ? `${activeComboName} chats` : 'All Chats'}
            </h2>
            {!loading && (
              <span className="ml-auto text-xs text-muted-foreground">{chats.length} total</span>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : chats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <MessageSquare className="w-10 h-10 text-muted-foreground/25" />
              <p className="text-sm text-muted-foreground">
                {isArchived ? 'No archived chats.' : 'No chats yet — start one above.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {chats.map((chat: any) => {
                const chatHref = chat.connection_id
                  ? `/orgs/${slug}/connections/${chat.connection_id}/chat?chatId=${chat.id}`
                  : chat.combo_id
                  ? `/orgs/${slug}/combos/${chat.combo_id}/chat?chatId=${chat.id}`
                  : `/orgs/${slug}/chats/${chat.id}`;

                return (
                  <Link
                    key={chat.id}
                    href={chatHref}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/40 transition-colors group"
                  >
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      {chat.combo_id
                        ? <GitFork className="w-4 h-4 text-primary" />
                        : <MessageSquare className="w-4 h-4 text-primary" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {chat.title || 'Untitled Chat'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {chat.message_count || 0} messages · {new Date(chat.updated_at).toLocaleDateString()}
                        {chat.connection_name && (
                          <span className="ml-1.5 px-1.5 py-0.5 bg-muted rounded text-[10px]">{chat.connection_name}</span>
                        )}
                        {chat.combo_name && (
                          <span className="ml-1.5 px-1.5 py-0.5 bg-muted rounded text-[10px]">{chat.combo_name}</span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      {confirmingDeleteId === chat.id ? (
                        /* Inline confirm row */
                        <>
                          <span className="text-xs text-destructive font-medium pr-1">Delete?</span>
                          <button
                            onClick={e => handleDelete(chat.id, e)}
                            className="p-1.5 rounded-lg bg-destructive text-white hover:opacity-90 transition-opacity"
                            title="Confirm delete"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={e => { e.preventDefault(); e.stopPropagation(); setConfirmingDeleteId(null); }}
                            className="p-1.5 rounded-lg bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          {isArchived ? (
                            <button
                              onClick={e => handleUnarchive(chat.id, e)}
                              className="p-1.5 rounded-lg bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                              title="Unarchive"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={e => handleArchive(chat.id, e)}
                              className="p-1.5 rounded-lg bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                              title="Archive"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={e => handleDelete(chat.id, e)}
                            className="p-1.5 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
