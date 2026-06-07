'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { orgApi } from '@/lib/api';

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
  admin: 'bg-violet-500/10 border-violet-500/20 text-violet-400',
  member: 'bg-zinc-500/10 border-zinc-500/20 text-zinc-400',
};

export default function MembersPage() {
  const { slug } = useParams<{ slug: string }>();
  const [org, setOrg] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');

  useEffect(() => { loadData(); }, [slug]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const { members: m } = await orgApi.getMembers(o.id);
      setMembers(m);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!org || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteError('');
    try {
      const { member } = await orgApi.inviteMember(org.id, inviteEmail.trim(), inviteRole);
      setMembers(ms => [...ms, member]);
      setInviteEmail('');
    } catch (err: any) {
      setInviteError(err.structured?.message || err.message || 'Failed to invite member');
    } finally { setInviting(false); }
  }

  async function removeMember(accountId: string) {
    if (!org || !confirm('Remove this member?')) return;
    try {
      await orgApi.removeMember(org.id, accountId);
      setMembers(ms => ms.filter(m => m.account_id !== accountId));
    } catch (e) { console.error(e); }
  }

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const isOwnerOrAdmin = ['owner', 'admin'].includes(org?.member_role);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link href={`/orgs/${slug}`} className="text-zinc-500 hover:text-zinc-300">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Members</h1>
            <p className="text-zinc-400 text-sm">{org?.name} · {members.length} member{members.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {/* Invite form */}
        {isOwnerOrAdmin && (
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 mb-6">
            <h2 className="text-sm font-medium text-zinc-300 mb-3">Invite Member</h2>
            <form onSubmit={handleInvite} className="flex gap-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="flex-1 px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-violet-500/50 appearance-none">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button type="submit" disabled={!inviteEmail.trim() || inviting}
                className="px-4 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-medium disabled:opacity-40 transition-colors whitespace-nowrap">
                {inviting ? 'Inviting…' : 'Invite'}
              </button>
            </form>
            {inviteError && <p className="text-red-400 text-xs mt-2">{inviteError}</p>}
          </div>
        )}

        {/* Members list */}
        <div className="space-y-2">
          {members.map((member: any) => (
            <div key={member.account_id || member.id}
              className="flex items-center gap-4 px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl">
              <div className="w-9 h-9 rounded-full bg-violet-500/20 border border-violet-500/20 flex items-center justify-center text-sm font-bold text-violet-300 flex-shrink-0">
                {(member.display_name || member.email || '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200 truncate">{member.display_name || 'Unknown'}</p>
                <p className="text-xs text-zinc-500 truncate">{member.email}</p>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full border font-medium capitalize ${ROLE_COLORS[member.role] || ROLE_COLORS.member}`}>
                {member.role}
              </span>
              {isOwnerOrAdmin && member.role !== 'owner' && (
                <button onClick={() => removeMember(member.account_id)}
                  className="text-zinc-600 hover:text-red-400 transition-colors text-sm">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/><path d="m19 6-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6m5 0V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/>
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
