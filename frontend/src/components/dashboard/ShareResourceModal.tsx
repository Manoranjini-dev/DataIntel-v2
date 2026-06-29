'use client';

import { useEffect, useState } from 'react';
import { X, Share2, Search, UserX, Crown, ShieldCheck } from 'lucide-react';

export interface ShareResourceApi {
  list: () => Promise<{ shares: any[]; owner: any }>;
  share: (data: { email: string; accessLevel: 'view' | 'edit' }) => Promise<any>;
  update: (accountId: string, data: { accessLevel: 'view' | 'edit' }) => Promise<any>;
  revoke: (accountId: string) => Promise<any>;
  search: (q: string) => Promise<{ users: any[] }>;
}

interface ShareResourceModalProps {
  /** Human label used in headings/copy, e.g. "Dashboard", "Page", "Card". */
  resourceLabel: string;
  resourceName: string;
  ownerName?: string;
  ownerId?: string;
  currentUserId?: string;
  api: ShareResourceApi;
  onClose: () => void;
}

interface Share {
  account_id: string;
  email: string;
  display_name: string;
  role: string;
  can_edit: boolean;
  created_at: string;
}

interface Owner {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

/** Generate initials from a display name or email */
function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name[0].toUpperCase();
}

/** Colour based on the first char — deterministic so the same user always gets the same colour */
const AVATAR_COLORS = [
  'bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-fuchsia-500', 'bg-orange-500',
];
function avatarColor(name: string): string {
  const idx = (name?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    ADMIN: 'bg-rose-500/10 text-rose-600 border-rose-500/20',
    ANALYST: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    VIEWER: 'bg-muted text-muted-foreground border-border',
  };
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${map[role] ?? map.VIEWER}`}>
      {role}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${avatarColor(name)}`}>
      {getInitials(name)}
    </div>
  );
}

/**
 * Generic sharing dialog reused at the dashboard, page, and card level — the
 * three levels share the exact same list/share/update/revoke/search shape,
 * so this component is parameterized by an `api` adapter instead of being
 * duplicated three times.
 */
export function ShareResourceModal({
  resourceLabel, resourceName, ownerName, ownerId, currentUserId, api, onClose,
}: ShareResourceModalProps) {
  const [shares, setShares]           = useState<Share[]>([]);
  const [owner, setOwner]             = useState<Owner | null>(null);
  const [loading, setLoading]         = useState(true);
  const [query, setQuery]             = useState('');
  const [results, setResults]         = useState<any[]>([]);
  const [searching, setSearching]     = useState(false);
  const [selected, setSelected]       = useState<any | null>(null);
  const [accessLevel, setAccessLevel] = useState<'view' | 'edit'>('view');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

  const isOwner = currentUserId && ownerId && currentUserId === ownerId;

  useEffect(() => { loadShares(); }, []);

  async function loadShares() {
    setLoading(true);
    try {
      const res = await api.list();
      setShares(res.shares ?? []);
      setOwner(res.owner ?? null);
    } catch (e: any) {
      setError(e?.message || `Could not load ${resourceLabel.toLowerCase()} share list`);
    } finally { setLoading(false); }
  }

  // Debounced user search
  useEffect(() => {
    setSelected(null);
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const { users } = await api.search(q);
        const sharedIds = new Set(shares.map((s: any) => s.account_id));
        if (ownerId) sharedIds.add(ownerId);
        setResults(users.filter((u: any) => !sharedIds.has(u.id)));
      } catch (e) { console.error(e); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, shares, ownerId]);

  async function handleShare(e: React.FormEvent) {
    e.preventDefault();
    const email = selected?.email || query.trim();
    if (!email) return;

    setError('');
    setSubmitting(true);
    try {
      await api.share({ email, accessLevel });
      setQuery('');
      setSelected(null);
      setResults([]);
      await loadShares();
    } catch (e: any) {
      setError(e?.message || `Failed to share ${resourceLabel.toLowerCase()}`);
    } finally { setSubmitting(false); }
  }

  async function handleRevoke(accountId: string) {
    try {
      await api.revoke(accountId);
      await loadShares();
    } catch (e) { console.error(e); }
  }

  async function handleAccessChange(accountId: string, level: 'view' | 'edit') {
    try {
      await api.update(accountId, { accessLevel: level });
      await loadShares();
    } catch (e) { console.error(e); }
  }

  const totalAccess = 1 + shares.length; // owner + shared users

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card w-full max-w-md rounded-2xl shadow-2xl border border-border overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Share2 className="w-4 h-4 text-primary" />
            Share {resourceLabel}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          <p className="text-sm text-muted-foreground">
            Control who can view or edit{' '}
            <strong className="text-foreground font-medium">{resourceName}</strong>.
          </p>

          {/* ── Share form (owner-only) ── */}
          {isOwner && (
            <form onSubmit={handleShare} className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="Search by name or email…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  {/* Dropdown results */}
                  {(results.length > 0 || searching) && (
                    <div className="absolute top-full mt-1 left-0 right-0 bg-card border border-border rounded-lg shadow-xl z-10 max-h-44 overflow-y-auto">
                      {searching ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
                      ) : results.map((u: any) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => { setSelected(u); setQuery(u.email); setResults([]); }}
                          className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/60 transition-colors"
                        >
                          <Avatar name={u.display_name || u.email} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">{u.display_name || u.email}</p>
                            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          </div>
                          <RoleBadge role={u.role} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <select
                  value={accessLevel}
                  onChange={e => setAccessLevel(e.target.value as 'view' | 'edit')}
                  className="px-2 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="view">View only</option>
                  <option value="edit">Can edit</option>
                </select>
              </div>

              {error && <p className="text-sm text-destructive font-medium">{error}</p>}

              <button
                type="submit"
                disabled={submitting || !query.trim()}
                className="w-full px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {submitting ? 'Sharing…' : selected ? `Share with ${selected.display_name || selected.email}` : 'Share'}
              </button>
            </form>
          )}

          {/* ── People with Access ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                People with access
              </p>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {loading ? '…' : totalAccess}
              </span>
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground py-2">Loading…</p>
            ) : (
              <div className="space-y-1">
                {/* Owner row — always first */}
                {owner && (
                  <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-muted/40">
                    <Avatar name={owner.display_name || owner.email} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                        {owner.display_name || owner.email}
                        {owner.id === currentUserId && (
                          <span className="text-[10px] text-muted-foreground font-normal">(you)</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{owner.email}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <RoleBadge role={owner.role} />
                      <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                        <Crown className="w-3 h-3" /> Owner
                      </span>
                    </div>
                  </div>
                )}

                {/* Shared users */}
                {shares.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2 px-2">
                    Not shared with anyone else yet.
                  </p>
                ) : (
                  shares.map(s => (
                    <div key={s.account_id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted/30 transition-colors">
                      <Avatar name={s.display_name || s.email} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{s.display_name || s.email}</p>
                        <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <RoleBadge role={s.role} />
                        {isOwner ? (
                          <select
                            value={s.can_edit ? 'edit' : 'view'}
                            onChange={e => handleAccessChange(s.account_id, e.target.value as 'view' | 'edit')}
                            className="text-xs px-2 py-1 bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="view">View only</option>
                            <option value="edit">Can edit</option>
                          </select>
                        ) : (
                          <span className="text-xs text-muted-foreground">{s.can_edit ? 'Can edit' : 'View only'}</span>
                        )}
                        {isOwner && (
                          <button
                            onClick={() => handleRevoke(s.account_id)}
                            title="Remove access"
                            className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-md transition-colors"
                          >
                            <UserX className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── Published status notice ── */}
          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
              {resourceLabel === 'Dashboard'
                ? 'Publishing does not automatically grant access. Only listed people can see this dashboard.'
                : `This grant is independent of dashboard-level sharing — only listed people can see this ${resourceLabel.toLowerCase()}.`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
