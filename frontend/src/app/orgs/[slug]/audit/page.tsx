'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { orgApi } from '@/lib/api';

const EVENT_ICONS: Record<string, string> = {
  account_created: '🎉',
  login_success: '🔑',
  login_failed: '🚫',
  logout: '👋',
  org_created: '🏢',
  member_invited: '📧',
  member_removed: '🗑️',
  connection_created: '⚡',
  connection_deleted: '❌',
  connection_test_success: '✅',
  connection_test_failed: '⚠️',
  query_executed: '🔍',
  query_failed: '💥',
  chat_created: '💬',
  dashboard_created: '📊',
  combo_created: '🔗',
};

const EVENT_COLORS: Record<string, string> = {
  login_failed: 'border-red-500/20 bg-red-500/5',
  query_failed: 'border-red-500/20 bg-red-500/5',
  connection_test_failed: 'border-amber-500/20 bg-amber-500/5',
  login_success: 'border-emerald-500/20 bg-emerald-500/5',
};

const EVENT_TYPE_OPTIONS = [
  'All Events',
  'login_success', 'login_failed',
  'query_executed', 'query_failed',
  'connection_created', 'connection_deleted',
  'org_created', 'member_invited',
  'dashboard_created', 'combo_created',
];

export default function AuditPage() {
  const { slug } = useParams<{ slug: string }>();
  const [org, setOrg] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All Events');
  const [page, setPage] = useState(0);
  const PER_PAGE = 50;

  useEffect(() => { loadOrg(); }, [slug]);
  useEffect(() => { if (org) loadLogs(); }, [org, filter, page]);

  async function loadOrg() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
    } catch (e) { console.error(e); }
  }

  async function loadLogs() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        limit: String(PER_PAGE),
        offset: String(page * PER_PAGE),
        ...(filter !== 'All Events' ? { eventType: filter } : {}),
      });
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/orgs/${org.id}/audit?${qs}`,
        { credentials: 'include' }
      );
      const { logs: l } = await r.json();
      setLogs(l || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Link href={`/orgs/${slug}`} className="text-zinc-500 hover:text-zinc-300">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Audit Log</h1>
            <p className="text-zinc-400 text-sm">All activity for {org?.name}</p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex flex-wrap gap-2 mb-6">
          {EVENT_TYPE_OPTIONS.map(t => (
            <button key={t} onClick={() => { setFilter(t); setPage(0); }}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors border
                ${filter === t
                  ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                  : 'bg-white/5 border-white/10 text-zinc-400 hover:border-white/20'}`}>
              {t}
            </button>
          ))}
        </div>

        {/* Logs */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-zinc-600">
            No audit events found.
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log: any) => (
              <div key={log.id}
                className={`flex items-start gap-3 px-4 py-3 rounded-xl border
                  ${EVENT_COLORS[log.event_type] || 'border-white/[0.06] bg-white/[0.02]'}`}>
                <span className="text-base flex-shrink-0 mt-0.5">
                  {EVENT_ICONS[log.event_type] || '📋'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200">{log.event_type.replace(/_/g, ' ')}</span>
                    {log.resource_type && (
                      <span className="text-xs text-zinc-600">· {log.resource_type}</span>
                    )}
                  </div>
                  {log.details && Object.keys(log.details).length > 0 && (
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">
                      {JSON.stringify(log.details).slice(0, 120)}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-zinc-600">
                      {log.executor_name || 'System'}
                    </span>
                    {log.ip_address && (
                      <span className="text-xs text-zinc-700">{log.ip_address}</span>
                    )}
                  </div>
                </div>
                <time className="text-xs text-zinc-600 flex-shrink-0">
                  {new Date(log.created_at).toLocaleString()}
                </time>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && (logs.length === PER_PAGE || page > 0) && (
          <div className="flex gap-2 justify-center mt-6">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-sm disabled:opacity-30">
              ← Prev
            </button>
            <span className="px-3 py-1.5 text-sm text-zinc-400">Page {page + 1}</span>
            <button disabled={logs.length < PER_PAGE} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-sm disabled:opacity-30">
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
