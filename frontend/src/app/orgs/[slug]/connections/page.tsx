'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { connectionApi, orgApi } from '@/lib/api';
import { Database, Plus, RefreshCw, Zap, ChevronRight } from 'lucide-react';

const CONNECTOR_LABELS: Record<string, string> = {
  postgres:      'PostgreSQL',
  mysql:         'MySQL',
  mssql:         'SQL Server',
  snowflake:     'Snowflake',
  bigquery:      'BigQuery',
  redshift:      'Redshift',
  mongodb:       'MongoDB',
  elasticsearch: 'Elasticsearch',
  databricks:    'Databricks',
  oracle:        'Oracle',
};

const CONNECTOR_COLORS: Record<string, { bg: string; text: string }> = {
  postgres:      { bg: 'bg-sky-500/10',    text: 'text-sky-500' },
  mysql:         { bg: 'bg-blue-500/10',   text: 'text-blue-500' },
  mssql:         { bg: 'bg-indigo-500/10', text: 'text-indigo-500' },
  snowflake:     { bg: 'bg-cyan-500/10',   text: 'text-cyan-500' },
  bigquery:      { bg: 'bg-primary/10',    text: 'text-primary' },
  redshift:      { bg: 'bg-red-500/10',    text: 'text-red-500' },
  mongodb:       { bg: 'bg-green-500/10',  text: 'text-green-500' },
  elasticsearch: { bg: 'bg-yellow-500/10', text: 'text-yellow-500' },
  databricks:    { bg: 'bg-orange-500/10', text: 'text-orange-500' },
  oracle:        { bg: 'bg-red-600/10',    text: 'text-red-600' },
};

const STATUS_CONFIG: Record<string, { dot: string; label: string; pill: string }> = {
  active:   { dot: 'bg-green-400',           label: 'Active',   pill: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  inactive: { dot: 'bg-muted-foreground',    label: 'Inactive', pill: 'bg-muted text-muted-foreground' },
  error:    { dot: 'bg-destructive',         label: 'Error',    pill: 'bg-destructive/10 text-destructive' },
  testing:  { dot: 'bg-yellow-400 animate-pulse', label: 'Testing', pill: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' },
};

export default function ConnectionsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [org, setOrg] = useState<any>(null);
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => { loadData(); }, [slug]);

  async function loadData() {
    try {
      const { org: orgData } = await orgApi.get(slug);
      setOrg(orgData);
      const { connections: conns } = await connectionApi.list(orgData.id);
      setConnections(conns);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleTest(connId: string) {
    if (!org) return;
    setTesting(connId);
    try {
      const result = await connectionApi.test(org.id, connId);
      setConnections(cs => cs.map(c => c.id === connId
        ? { ...c, status: result.success ? 'active' : 'error' }
        : c
      ));
    } finally { setTesting(null); }
  }

  async function handleSync(connId: string) {
    if (!org) return;
    setSyncing(connId);
    try {
      await connectionApi.syncSchema(org.id, connId);
      setConnections(cs => cs.map(c => c.id === connId
        ? { ...c, schema_synced_at: new Date().toISOString() }
        : c
      ));
    } finally { setSyncing(null); }
  }

  return (
    <div className="flex-1 p-8 overflow-auto animate-fade-in">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Connections</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your datasource connections</p>
          </div>
          <Link
            href={`/orgs/${slug}/connections/new`}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            New Connection
          </Link>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-border rounded-2xl">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Database className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">No connections yet</h3>
            <p className="text-xs text-muted-foreground mb-4 text-center max-w-xs">
              Connect a database, data warehouse, or analytics service to start querying with AI
            </p>
            <Link
              href={`/orgs/${slug}/connections/new`}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              Add your first connection
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {connections.map((conn: any) => {
              const colors = CONNECTOR_COLORS[conn.connector_type] ?? { bg: 'bg-muted', text: 'text-muted-foreground' };
              const status = STATUS_CONFIG[conn.status] ?? STATUS_CONFIG.inactive;
              const isTestingThis = testing === conn.id;
              const isSyncingThis = syncing === conn.id;

              return (
                <div key={conn.id}
                  className="group bg-card border border-border rounded-2xl p-5 hover:border-primary/20 transition-all"
                  style={{ boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
                  <div className="flex items-center gap-4">
                    {/* Icon */}
                    <div className={`w-11 h-11 rounded-xl ${colors.bg} flex items-center justify-center shrink-0 text-base font-bold ${colors.text}`}>
                      {(conn.connector_type?.[0] ?? '?').toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/orgs/${slug}/connections/${conn.id}`}
                          className="text-sm font-semibold text-foreground hover:text-primary transition-colors"
                        >
                          {conn.name}
                        </Link>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${status.pill}`}>
                          {status.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {CONNECTOR_LABELS[conn.connector_type] ?? conn.connector_type}
                        {conn.host && ` · ${conn.host}${conn.port ? `:${conn.port}` : ''}`}
                        {conn.database_name && ` · ${conn.database_name}`}
                      </p>
                      {conn.schema_synced_at && (
                        <p className="text-[11px] text-muted-foreground/60 mt-1">
                          Schema synced {new Date(conn.schema_synced_at).toLocaleString()}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => { e.preventDefault(); handleTest(conn.id); }}
                        disabled={isTestingThis}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 border border-border"
                      >
                        <Zap className={`w-3.5 h-3.5 ${isTestingThis ? 'animate-pulse' : ''}`} />
                        {isTestingThis ? 'Testing…' : 'Test'}
                      </button>
                      <button
                        onClick={e => { e.preventDefault(); handleSync(conn.id); }}
                        disabled={isSyncingThis}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 border border-border"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isSyncingThis ? 'animate-spin' : ''}`} />
                        {isSyncingThis ? 'Syncing…' : 'Sync'}
                      </button>
                      <Link
                        href={`/orgs/${slug}/connections/${conn.id}`}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold transition-colors"
                      >
                        Open <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
