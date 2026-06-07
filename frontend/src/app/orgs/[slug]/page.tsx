'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { orgApi } from '@/lib/api';
import { Database, Plus, MessageSquare, LayoutDashboard, ArrowRight, Activity, Users, Clock } from 'lucide-react';

const CONNECTOR_COLORS: Record<string, string> = {
  mysql:         'bg-blue-500/10 text-blue-500',
  postgres:      'bg-sky-500/10 text-sky-500',
  elasticsearch: 'bg-yellow-500/10 text-yellow-500',
  mongodb:       'bg-green-500/10 text-green-500',
  databricks:    'bg-orange-500/10 text-orange-500',
  mssql:         'bg-indigo-500/10 text-indigo-500',
  snowflake:     'bg-cyan-500/10 text-cyan-500',
  bigquery:      'bg-primary/10 text-primary',
};

const STATUS_DOT: Record<string, string> = {
  active:   'bg-green-400',
  error:    'bg-red-400',
  inactive: 'bg-muted-foreground',
  testing:  'bg-yellow-400',
};

export default function OrgOverviewPage() {
  const { slug } = useParams<{ slug: string }>();
  const [org, setOrg] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [slug]);

  async function loadData() {
    try {
      const { org: orgData } = await orgApi.get(slug);
      setOrg(orgData);
      const data = await orgApi.getOverview(orgData.id);
      setOverview(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Organization not found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 overflow-auto animate-fade-in">
      <div className="max-w-4xl mx-auto space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{org.name}</h1>
          <p className="text-muted-foreground text-sm mt-1">{org.description || 'Your workspace overview'}</p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Connections', value: overview?.healthSummary?.total ?? 0, icon: Database, color: 'text-primary', bg: 'bg-primary/10' },
            { label: 'Active',      value: overview?.healthSummary?.active ?? 0, icon: Activity, color: 'text-green-500', bg: 'bg-green-500/10' },
            { label: 'Members',     value: overview?.memberCount ?? 0,            icon: Users,    color: 'text-secondary', bg: 'bg-secondary/10' },
            { label: 'Queries 24h', value: overview?.queryStats?.queries_24h ?? 0, icon: Clock,   color: 'text-accent',    bg: 'bg-accent/10' },
          ].map(stat => {
            const Icon = stat.icon;
            return (
              <div key={stat.label}
                className="bg-card border border-border rounded-2xl p-5"
                style={{ boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
                <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center mb-3`}>
                  <Icon className={`w-[18px] h-[18px] ${stat.color}`} />
                </div>
                <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
              </div>
            );
          })}
        </div>

        {/* Two-col content */}
        <div className="grid grid-cols-2 gap-6">

          {/* Connection health */}
          <div className="bg-card border border-border rounded-2xl p-5"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground">Datasource Health</h2>
              <Link href={`/orgs/${slug}/connections`}
                className="text-xs text-primary hover:opacity-80 flex items-center gap-1 transition-opacity">
                Manage <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {!overview?.connections?.length ? (
              <div className="text-center py-8">
                <Database className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-muted-foreground text-xs">No connections yet</p>
                <Link href={`/orgs/${slug}/connections/new`}
                  className="text-primary text-xs mt-1.5 inline-block hover:opacity-80">
                  Add one →
                </Link>
              </div>
            ) : (
              <div className="space-y-1">
                {overview.connections.slice(0, 6).map((c: any) => (
                  <Link key={c.id} href={`/orgs/${slug}/connections/${c.id}`}
                    className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-muted/50 transition-colors group">
                    <div className="flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-lg text-[11px] font-bold flex items-center justify-center ${CONNECTOR_COLORS[c.connector_type] ?? 'bg-muted text-muted-foreground'}`}>
                        {(c.connector_type?.[0] ?? '?').toUpperCase()}
                      </div>
                      <span className="text-sm text-foreground group-hover:text-primary transition-colors">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[c.status] ?? STATUS_DOT.inactive}`} />
                      <span className="text-xs text-muted-foreground capitalize">{c.status}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Recent queries */}
          <div className="bg-card border border-border rounded-2xl p-5"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
            <h2 className="text-sm font-semibold text-foreground mb-4">Recent Queries</h2>
            {!overview?.recentQueries?.length ? (
              <div className="text-center py-8">
                <MessageSquare className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-muted-foreground text-xs">No queries yet</p>
              </div>
            ) : (
              <div className="space-y-1">
                {overview.recentQueries.slice(0, 5).map((q: any) => (
                  <div key={q.id} className="py-2.5 px-3 rounded-xl hover:bg-muted/50 transition-colors">
                    <p className="text-sm text-foreground truncate">
                      {q.prompt || q.generated_query?.slice(0, 55) + '…'}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${q.status === 'success' ? 'bg-green-400' : 'bg-red-400'}`} />
                      <span className="text-xs text-muted-foreground capitalize">{q.status}</span>
                      {q.execution_time_ms && (
                        <span className="text-xs text-muted-foreground">{q.execution_time_ms}ms</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'New Connection', href: `/orgs/${slug}/connections/new`, desc: 'Connect a datasource', icon: Plus, color: 'text-primary', bg: 'bg-primary/10' },
            { label: 'Start a Chat',   href: `/orgs/${slug}/chats`,           desc: 'Query with AI',       icon: MessageSquare, color: 'text-secondary', bg: 'bg-secondary/10' },
            { label: 'New Dashboard',  href: `/orgs/${slug}/dashboards`,      desc: 'Build analytics',     icon: LayoutDashboard, color: 'text-accent', bg: 'bg-accent/10' },
          ].map(action => {
            const Icon = action.icon;
            return (
              <Link key={action.href} href={action.href}
                className="group p-5 bg-card border border-border rounded-2xl hover:border-primary/30 hover:shadow-md transition-all"
                style={{ boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
                <div className={`w-10 h-10 rounded-xl ${action.bg} flex items-center justify-center mb-3 group-hover:scale-105 transition-transform`}>
                  <Icon className={`w-5 h-5 ${action.color}`} />
                </div>
                <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{action.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{action.desc}</p>
              </Link>
            );
          })}
        </div>

      </div>
    </div>
  );
}
