'use client';

import { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { userApi } from '@/lib/api';

const ROLES = ['ADMIN', 'ANALYST', 'VIEWER'] as const;

export function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('VIEWER');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim() || !email.trim()) return;
    setSubmitting(true);
    try {
      const res = await userApi.create({ name: name.trim(), email: email.trim(), role });
      onCreated(res.message || 'User created successfully. Invitation email sent.');
    } catch (err: any) {
      setError(err?.structured?.message || err?.message || 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Create user"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-card border border-border rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-foreground">Create User</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="cu-name" className="block text-xs font-semibold text-foreground mb-1.5">Full Name</label>
            <input
              id="cu-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Jane Doe"
              className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label htmlFor="cu-email" className="block text-xs font-semibold text-foreground mb-1.5">Email Address</label>
            <input
              id="cu-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="jane@company.com"
              className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label htmlFor="cu-role" className="block text-xs font-semibold text-foreground mb-1.5">Role</label>
            <select
              id="cu-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-4 py-2.5 bg-muted/50 border border-border rounded-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {error && (
            <div className="px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-xl border border-border text-foreground text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim() || !email.trim()}
              className="flex-1 py-2.5 px-4 text-white font-semibold rounded-xl text-sm disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
            >
              {submitting ? 'Creating…' : 'Create & Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
