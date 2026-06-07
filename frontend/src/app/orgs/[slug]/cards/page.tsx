'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { orgApi, cardApi } from '@/lib/api';

const CHART_ICONS: Record<string, string> = {
  table: '📋', bar: '📊', line: '📈', pie: '🥧', area: '📉',
  scatter: '⬡', metric: '🔢', heatmap: '🟧', treemap: '🌳', funnel: '🔽',
};
const STATUS_STYLES: Record<string, string> = {
  draft: 'text-amber-400 bg-amber-400/10',
  published: 'text-success bg-success/10',
  archived: 'text-muted-foreground bg-muted/50',
};
const VISIBILITY_STYLES: Record<string, string> = {
  private: 'text-muted-foreground bg-muted/50',
  org_shared: 'text-blue-400 bg-blue-400/10',
  public: 'text-primary bg-primary/10',
};

export default function CardsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [org, setOrg] = useState<any>(null);
  const [cards, setCards] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadOrg(); }, [slug]);

  async function loadOrg() {
    const { org: orgData } = await orgApi.get(slug);
    setOrg(orgData);
  }

  const loadCards = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (visibilityFilter) params.visibility = visibilityFilter;
      const data = await cardApi.list(org.id, params);
      setCards(data.cards);
      setTotal(data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [org, search, statusFilter, visibilityFilter]);

  useEffect(() => { loadCards(); }, [loadCards]);

  async function handleExpand(cardId: string) {
    if (expanded === cardId) {
      setExpanded(null);
      setVersions([]);
      return;
    }
    setExpanded(cardId);
    setVersionsLoading(true);
    try {
      const vers = await cardApi.get(org.id, cardId);
      setVersions(vers.card?.versions || []);
    } catch {
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  }

  async function handlePublish(cardId: string) {
    await cardApi.publish(org.id, cardId);
    loadCards();
  }

  return (
    <div className="flex-1 p-8 overflow-auto">
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Card Library</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {total} card{total !== 1 ? 's' : ''} in your organization
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search cards..."
            className="flex-1 max-w-xs px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
          <select
            value={visibilityFilter}
            onChange={e => setVisibilityFilter(e.target.value)}
            className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          >
            <option value="">All Visibility</option>
            <option value="private">Private</option>
            <option value="org_shared">Org Shared</option>
            <option value="public">Public</option>
          </select>
        </div>

        {/* Card Grid */}
        {loading ? (
          <div className="flex justify-center h-40 items-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : cards.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-white/10 rounded-2xl">
            <p className="text-muted-foreground text-sm">No cards found.</p>
            <p className="text-muted-foreground text-xs mt-1">Cards are created from chat queries or dashboards.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((card: any) => (
              <div key={card.id} className="flex flex-col">
                <button
                  onClick={() => handleExpand(card.id)}
                  className={`text-left p-5 bg-white/[0.02] border rounded-2xl hover:bg-white/[0.04] transition-all ${
                    expanded === card.id ? 'border-primary/40' : 'border-white/5 hover:border-white/10'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-xl">{CHART_ICONS[card.chart_type] || '📋'}</span>
                    <div className="flex gap-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLES[card.status] || STATUS_STYLES.draft}`}>
                        {card.status}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${VISIBILITY_STYLES[card.visibility] || VISIBILITY_STYLES.private}`}>
                        {card.visibility?.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                  <h3 className="font-medium text-white text-sm mb-1 line-clamp-1">{card.name}</h3>
                  {card.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{card.description}</p>
                  )}
                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/5">
                    <span className="text-[10px] text-muted-foreground">v{card.current_version}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {card.chart_type} · {card.query_language || 'sql'}
                    </span>
                  </div>
                  {card.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {card.tags.map((tag: string) => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-white/5 text-muted-foreground rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-2">
                    by {card.created_by_name} · {new Date(card.updated_at).toLocaleDateString()}
                  </p>
                </button>

                {/* Expanded panel */}
                {expanded === card.id && (
                  <div className="mt-2 p-4 bg-white/[0.03] border border-white/5 rounded-xl space-y-3">
                    {card.raw_query && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase font-medium mb-1">Query</p>
                        <pre className="text-xs text-muted-foreground/70 bg-black/30 p-2 rounded-lg overflow-x-auto whitespace-pre-wrap">
                          {card.raw_query}
                        </pre>
                      </div>
                    )}
                    <div className="flex gap-2">
                      {card.status === 'draft' && (
                        <button
                          onClick={() => handlePublish(card.id)}
                          className="text-xs px-3 py-1.5 bg-success/20 text-success rounded-lg hover:bg-success/30 transition-colors"
                        >
                          Publish
                        </button>
                      )}
                    </div>
                    {versionsLoading ? (
                      <p className="text-xs text-muted-foreground">Loading versions...</p>
                    ) : versions.length > 0 && (
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase font-medium mb-1">Versions</p>
                        <div className="space-y-1">
                          {versions.map((v: any) => (
                            <div key={v.version} className="flex items-center justify-between text-xs text-muted-foreground py-1 border-b border-white/5 last:border-0">
                              <span>v{v.version} {v.is_rollback && '(rollback)'}</span>
                              <span>{v.created_by_name} · {new Date(v.created_at).toLocaleDateString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
