'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { orgApi } from '@/lib/api';

const ICONS = {
  mysql: '🔵', postgres: '🐘', elasticsearch: '🟡', mongodb: '🍃', databricks: '⚡',
} as const;

export default function OrgOverviewPage() {
  const { slug } = useParams<{ slug: string }>();
  const [org, setOrg] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [slug]);

  async function loadData() {
    try {
      const { org: orgData } = await orgApi.get(slug);
      setOrg(orgData);
      const data = await orgApi.getOverview(orgData.id);
      setOverview(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!org) return <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">Not found</div>;

  const healthColors: Record<string, string> = {
    active: 'text-emerald-400', error: 'text-red-400',
    inactive: 'text-zinc-500', testing: 'text-amber-400',
  };

  const navItems = [
    { label: 'Overview', href: `/orgs/${slug}`, icon: '◉' },
    { label: 'Connections', href: `/orgs/${slug}/connections`, icon: '⚡' },
    { label: 'Chats', href: `/orgs/${slug}/chats`, icon: '💬' },
    { label: 'Combos', href: `/orgs/${slug}/combos`, icon: '🔗' },
    { label: 'Dashboards', href: `/orgs/${slug}/dashboards`, icon: '📊' },
    { label: 'Members', href: `/orgs/${slug}/members`, icon: '👥' },
    { label: 'Audit Log', href: `/orgs/${slug}/audit`, icon: '📋' },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex">
      {/* Sidebar */}
      <aside className="w-56 border-r border-white/10 flex flex-col h-screen sticky top-0">
        <div className="p-4 border-b border-white/10">
          <Link href="/orgs" className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors mb-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
            All orgs
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/20 flex items-center justify-center text-violet-400 font-bold text-sm">
              {org.name?.charAt(0)}
            </div>
            <div>
              <p className="text-sm font-medium text-white truncate">{org.name}</p>
              <p className="text-xs text-zinc-500 capitalize">{org.member_role}</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
            <Link key={item.href} href={item.href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-zinc-400 hover:text-white hover:bg-white/5 transition-all">
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-4xl">
          <h1 className="text-2xl font-bold text-white mb-1">{org.name} Overview</h1>
          <p className="text-zinc-400 text-sm mb-8">{org.description || 'Your organization dashboard'}</p>

          {/* Stat Cards */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Connections', value: overview?.healthSummary?.total ?? 0, color: 'text-violet-400' },
              { label: 'Active', value: overview?.healthSummary?.active ?? 0, color: 'text-emerald-400' },
              { label: 'Members', value: overview?.memberCount ?? 0, color: 'text-blue-400' },
              { label: 'Queries (24h)', value: overview?.queryStats?.queries_24h ?? 0, color: 'text-amber-400' },
            ].map(stat => (
              <div key={stat.label} className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <p className="text-xs text-zinc-500 mb-1">{stat.label}</p>
                <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Connection Health */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-white">Datasource Health</h2>
                <Link href={`/orgs/${slug}/connections`} className="text-xs text-violet-400 hover:text-violet-300">
                  Manage →
                </Link>
              </div>
              {!overview?.connections?.length ? (
                <p className="text-zinc-500 text-sm">No connections yet</p>
              ) : (
                <div className="space-y-2">
                  {overview.connections.slice(0, 5).map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{ICONS[c.connector_type as keyof typeof ICONS] || '🔌'}</span>
                        <span className="text-sm text-zinc-300">{c.name}</span>
                      </div>
                      <div className={`text-xs font-medium ${healthColors[c.status] || 'text-zinc-500'}`}>
                        ● {c.status}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Queries */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-white mb-4">Recent Queries</h2>
              {!overview?.recentQueries?.length ? (
                <p className="text-zinc-500 text-sm">No queries yet</p>
              ) : (
                <div className="space-y-2">
                  {overview.recentQueries.slice(0, 5).map((q: any) => (
                    <div key={q.id} className="py-2 border-b border-white/5 last:border-0">
                      <p className="text-xs text-zinc-300 truncate">{q.prompt || q.generated_query?.slice(0, 60)}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs ${q.status === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {q.status}
                        </span>
                        {q.execution_time_ms && (
                          <span className="text-xs text-zinc-600">{q.execution_time_ms}ms</span>
                        )}
                        <span className="text-xs text-zinc-600">{q.executor_name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div className="mt-6 grid grid-cols-3 gap-4">
            {[
              { label: 'New Connection', href: `/orgs/${slug}/connections/new`, desc: 'Connect a datasource', icon: '⚡' },
              { label: 'Start a Chat', href: `/orgs/${slug}/chats`, desc: 'Query with AI', icon: '💬' },
              { label: 'New Dashboard', href: `/orgs/${slug}/dashboards`, desc: 'Build analytics', icon: '📊' },
            ].map(action => (
              <Link key={action.href} href={action.href}
                className="group p-4 bg-white/5 border border-white/10 rounded-2xl hover:border-violet-500/30 hover:bg-white/[0.07] transition-all">
                <div className="text-2xl mb-2">{action.icon}</div>
                <p className="text-sm font-medium text-white group-hover:text-violet-300 transition-colors">{action.label}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{action.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
