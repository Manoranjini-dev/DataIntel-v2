'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Plus, Pencil, Trash2, Power, Mail, ChevronLeft, ChevronRight, ShieldAlert,
} from 'lucide-react';
import { userApi, type ManagedUser, type ListUsersParams } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { CreateUserModal } from '@/components/admin/CreateUserModal';
import { EditUserModal } from '@/components/admin/EditUserModal';

const ROLE_STYLES: Record<string, string> = {
  ADMIN: 'bg-primary/10 border-primary/20 text-primary',
  ANALYST: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
  VIEWER: 'bg-zinc-500/10 border-zinc-500/20 text-muted-foreground',
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
  INACTIVE: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
  PENDING_INVITATION: 'bg-violet-500/10 border-violet-500/20 text-violet-400',
  DELETED: 'bg-red-500/10 border-red-500/20 text-red-400',
};

export default function UserManagementPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuthStore();

  const [result, setResult] = useState<{ users: ManagedUser[]; total: number; totalPages: number }>({
    users: [], total: 0, totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [toast, setToast] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmResend, setConfirmResend] = useState<ManagedUser | null>(null);
  const [resending, setResending] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: ListUsersParams = {
        page, limit: 10, sortBy: 'createdAt', sortOrder,
        search: search || undefined,
        role: roleFilter || undefined,
        status: statusFilter || undefined,
      };
      const res = await userApi.list(params);
      setResult({ users: res.users, total: res.total, totalPages: res.totalPages });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, statusFilter, sortOrder]);

  useEffect(() => {
    if (isAuthenticated && isAdmin) load();
  }, [isAuthenticated, isAdmin, load]);

  // Debounce search → reset to page 1
  useEffect(() => {
    const t = setTimeout(() => setPage(1), 50);
    return () => clearTimeout(t);
  }, [search, roleFilter, statusFilter]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  async function toggleStatus(u: ManagedUser) {
    try {
      const next = u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await userApi.setStatus(u.id, next);
      flash(next === 'ACTIVE' ? 'User reactivated.' : 'User deactivated.');
      load();
    } catch (e: any) {
      flash(e?.structured?.message || e?.message || 'Failed to update status');
    }
  }

  async function remove(u: ManagedUser) {
    if (confirmDelete !== u.id) { setConfirmDelete(u.id); return; }
    try {
      await userApi.remove(u.id);
      flash('User deleted.');
      load();
    } catch (e: any) {
      flash(e?.structured?.message || e?.message || 'Failed to delete user');
    } finally {
      setConfirmDelete(null);
    }
  }

  async function resend(u: ManagedUser) {
    // Guard against duplicate sends from rapid double-clicks.
    if (resending) return;
    setResending(true);
    try {
      await userApi.resendInvitation(u.id);
      flash('Invitation resent successfully.');
    } catch (e: any) {
      flash(e?.structured?.message || e?.message || 'Failed to resend invitation');
    } finally {
      setResending(false);
      setConfirmResend(null);
    }
  }

  if (isAuthenticated && !isAdmin) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <ShieldAlert className="w-12 h-12 text-amber-400 mb-4" />
        <h1 className="text-xl font-bold text-foreground">Access denied</h1>
        <p className="text-muted-foreground text-sm mt-1">User management is restricted to administrators.</p>
        <button onClick={() => router.push('/dashboards')} className="mt-5 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium">
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">User Management</h1>
            <p className="text-muted-foreground text-sm">{result.total} user{result.total !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-white font-semibold rounded-xl text-sm"
            style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
          >
            <Plus className="w-4 h-4" /> Create User
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              aria-label="Search users"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full pl-9 pr-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <select aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none">
            <option value="">All roles</option>
            <option value="ADMIN">Admin</option>
            <option value="ANALYST">Analyst</option>
            <option value="VIEWER">Viewer</option>
          </select>
          <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="PENDING_INVITATION">Pending</option>
          </select>
          <button
            onClick={() => setSortOrder((s) => (s === 'desc' ? 'asc' : 'desc'))}
            className="px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-foreground hover:bg-muted"
          >
            Created {sortOrder === 'desc' ? '↓' : '↑'}
          </button>
        </div>

        {/* Table */}
        <div className="border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-3">Name</th>
                <th className="text-left font-medium px-4 py-3">Email</th>
                <th className="text-left font-medium px-4 py-3">Role</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-left font-medium px-4 py-3">Created</th>
                <th className="text-right font-medium px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">Loading…</td></tr>
              ) : result.users.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No users found.</td></tr>
              ) : (
                result.users.map((u) => (
                  <tr key={u.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium text-foreground">{u.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${ROLE_STYLES[u.role]}`}>{u.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${STATUS_STYLES[u.status]}`}>
                        {u.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditing(u)} title="Edit" aria-label={`Edit ${u.name}`}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
                          <Pencil className="w-4 h-4" />
                        </button>
                        {u.status === 'PENDING_INVITATION' && (
                          <button onClick={() => setConfirmResend(u)} title="Resend invitation" aria-label={`Resend invitation to ${u.name}`}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10">
                            <Mail className="w-4 h-4" />
                          </button>
                        )}
                        {(u.status === 'ACTIVE' || u.status === 'INACTIVE') && (
                          <button onClick={() => toggleStatus(u)}
                            title={u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                            aria-label={`${u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} ${u.name}`}
                            className={`p-1.5 rounded-md hover:bg-muted ${u.status === 'ACTIVE' ? 'text-amber-400' : 'text-emerald-400'}`}>
                            <Power className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => remove(u)}
                          title="Delete" aria-label={`Delete ${u.name}`}
                          className={`p-1.5 rounded-md hover:bg-destructive/10 ${confirmDelete === u.id ? 'text-destructive bg-destructive/10' : 'text-muted-foreground hover:text-destructive'}`}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-muted-foreground">Page {page} of {result.totalPages}</p>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="p-2 rounded-lg border border-border text-foreground disabled:opacity-40 hover:bg-muted">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button disabled={page >= result.totalPages} onClick={() => setPage((p) => p + 1)}
              className="p-2 rounded-lg border border-border text-foreground disabled:opacity-40 hover:bg-muted">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-foreground text-background text-sm font-medium shadow-lg">
          {toast}
        </div>
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={(msg) => { setShowCreate(false); flash(msg); load(); }}
        />
      )}
      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); flash('User updated.'); load(); }}
        />
      )}

      {confirmResend && (
        <div
          role="dialog"
          aria-label="Resend Invitation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => { if (!resending) setConfirmResend(null); }}
        >
          <div
            className="w-full max-w-sm bg-card border border-border rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-violet-500/10 flex items-center justify-center">
                <Mail className="w-4 h-4 text-violet-400" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Resend Invitation</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              Are you sure you want to resend the invitation email to this user?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmResend(null)}
                disabled={resending}
                className="flex-1 py-2.5 px-4 rounded-xl border border-border text-foreground text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => resend(confirmResend)}
                disabled={resending}
                className="flex-1 py-2.5 px-4 text-white font-semibold rounded-xl text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
              >
                {resending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Resending…
                  </span>
                ) : 'Resend'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
