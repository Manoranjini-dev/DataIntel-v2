'use client';

import { useEffect, useState } from 'react';
import { connectionApi } from '../../lib/api';
import { X, Share2, Trash2, Mail } from 'lucide-react';

interface ShareConnectionModalProps {
  connectionId: string;
  connectionName: string;
  onClose: () => void;
}

interface Share {
  account_id: string;
  email: string;
  display_name: string;
  can_edit: boolean;
  created_at: string;
}

export function ShareConnectionModal({ connectionId, connectionName, onClose }: ShareConnectionModalProps) {
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [accessLevel, setAccessLevel] = useState<'view' | 'edit'>('view');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadShares(); }, []);

  async function loadShares() {
    setLoading(true);
    try {
      const { shares } = await connectionApi.listShares(connectionId);
      setShares(shares);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleShare(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await connectionApi.share(connectionId, { email, accessLevel });
      setEmail('');
      await loadShares();
    } catch (e: any) {
      setError(e?.message || 'Failed to share connection');
    } finally { setSubmitting(false); }
  }

  async function handleRevoke(accountId: string) {
    try {
      await connectionApi.revokeShare(connectionId, accountId);
      await loadShares();
    } catch (e) { console.error(e); }
  }

  async function handleAccessChange(accountId: string, level: 'view' | 'edit') {
    try {
      await connectionApi.updateShare(connectionId, accountId, { accessLevel: level });
      await loadShares();
    } catch (e) { console.error(e); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card w-full max-w-md rounded-xl shadow-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Share2 className="w-5 h-5 text-primary" /> Share Connection
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Give other users read-only or edit access to <strong>{connectionName}</strong>.
          </p>

          <form onSubmit={handleShare} className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <select
                value={accessLevel}
                onChange={e => setAccessLevel(e.target.value as 'view' | 'edit')}
                className="px-2 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="view">View only</option>
                <option value="edit">Can edit</option>
              </select>
            </div>
            {error && <p className="text-sm text-destructive font-medium">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !email}
              className="w-full px-4 py-2 bg-primary text-white text-sm font-medium rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {submitting ? 'Sharing…' : 'Share'}
            </button>
          </form>

          <div className="pt-2 border-t border-border space-y-2 max-h-64 overflow-auto">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">People with access</p>
            {loading ? (
              <p className="text-sm text-muted-foreground py-2">Loading…</p>
            ) : shares.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Not shared with anyone yet.</p>
            ) : (
              shares.map(s => (
                <div key={s.account_id} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{s.display_name || s.email}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={s.can_edit ? 'edit' : 'view'}
                      onChange={e => handleAccessChange(s.account_id, e.target.value as 'view' | 'edit')}
                      className="text-xs px-2 py-1 bg-muted border border-border rounded-md"
                    >
                      <option value="view">View only</option>
                      <option value="edit">Can edit</option>
                    </select>
                    <button
                      onClick={() => handleRevoke(s.account_id)}
                      className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-md transition-colors"
                      title="Revoke access"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
