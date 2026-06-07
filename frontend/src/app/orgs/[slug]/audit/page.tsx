'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { orgApi } from '@/lib/api';
import { Shield } from 'lucide-react';

const EVENT_ICONS: Record<string, string> = {
  account_created:       '🎉', login_success: '🔑', login_failed: '🚫',
  logout:                '👋', org_created: '🏢', member_invited: '📧',
  member_removed:        '🗑️', connection_created: '⚡', connection_deleted: '❌',
  connection_test_success: '✅', connection_test_failed: '⚠️',
  query_executed:        '🔍', query_failed: '💥', chat_created: '💬',
  dashboard_created:     '📊', combo_created: '🔗',
};

const EVENT_COLORS: Record<string, string> = {
  login_failed:            'border-destructive/20 bg-destructive/5',
  query_failed:            'border-destructive/20 bg-destructive/5',
  connection_test_failed:  'border-yellow-500/20 bg-yellow-500/5',
  login_success:           'border-green-500/20 bg-green-500/5',
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
        limit: String(PER_PAGE), offset: String(page * PER_PAGE),
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
    <div className="flex-1 p-8 overflow-auto animate-fade-in">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Audit Log</h1>
            <p className="text-muted-foreground text-sm">All activity for <span className="text-foreground font-medium">{org?.name}</span></p>
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2">
          {EVENT_TYPE_OPTIONS.map(t => (
            <button key={t} onClick={() => { setFilter(t); setPage(0); }}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${
                filter === t
                  ? 'bg-primary/10 border-primary/40 text-primary'
                  : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground hover:border-primary/20'
              }`}>
              {t.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        {/* Logs */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            No audit events found.
          </div>
        ) : (
          <div className="space-y-1.5">
            {logs.map((log: any) => (
              <div key={log.id}
                className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${
                  EVENT_COLORS[log.event_type] || 'border-border bg-card'
                }`}
                style={{ boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
                <span className="text-base shrink-0 mt-0.5">{EVENT_ICONS[log.event_type] || '📋'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground capitalize">
                      {log.event_type.replace(/_/g, ' ')}
                    </span>
                    {log.resource_type && (
                      <span className="text-xs text-muted-foreground">· {log.resource_type}</span>
                    )}
                  </div>
                  {log.details && Object.keys(log.details).length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">
                      {JSON.stringify(log.details).slice(0, 120)}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-muted-foreground">{log.executor_name || 'System'}</span>
                    {log.ip_address && <span className="text-xs text-muted-foreground/60">{log.ip_address}</span>}
                  </div>
                </div>
                <time className="text-xs text-muted-foreground shrink-0">
                  {new Date(log.created_at).toLocaleString()}
                </time>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && (logs.length === PER_PAGE || page > 0) && (
          <div className="flex gap-2 justify-center">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              className="px-4 py-2 bg-muted border border-border rounded-xl text-sm font-medium disabled:opacity-30 hover:bg-muted/80 transition-colors">
              ← Prev
            </button>
            <span className="px-4 py-2 text-sm text-muted-foreground">Page {page + 1}</span>
            <button disabled={logs.length < PER_PAGE} onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 bg-muted border border-border rounded-xl text-sm font-medium disabled:opacity-30 hover:bg-muted/80 transition-colors">
              Next →
            </button>
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  );
}
