'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { dashboardApi } from '@/lib/api';
import { applyVisualizationConfig, type VisualizationConfig } from '@/lib/aggregation';
import { GenerativeUIRenderer } from '@/components/generative-ui';
import {
  X, RefreshCw, ExternalLink, Eye, Edit2, LayoutDashboard,
  FileText, User, Calendar, ChevronRight, LayoutGrid, Inbox,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface SharedCard {
  id: string;
  title: string;
  widget_type: string;
  query_definition: Record<string, unknown> | string | null;
  visualization_config: VisualizationConfig | null;
  cached_result: unknown;
  cached_at: string | null;
  updated_at: string;
  created_at: string;
  can_edit: boolean;
  shared_by: string;
  shared_at: string;
  shared_by_name: string;
  shared_by_email: string;
  page_id: string;
  page_name: string;
  dashboard_id: string;
  dashboard_name: string;
  dashboard_origin: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseQd(raw: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return {}; } }
  return raw as Record<string, unknown>;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function absoluteDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Focus modal — full chart view + metadata ─────────────────────────────────

function SharedCardFocusModal({
  card,
  onClose,
}: {
  card: SharedCard;
  onClose: () => void;
}) {
  const [freshRows, setFreshRows] = useState<Record<string, unknown>[] | null>(null);
  const [freshCols, setFreshCols] = useState<string[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const qd = parseQd(card.query_definition);
  const rawRows = (freshRows ?? (qd.result_rows as Record<string, unknown>[] | undefined) ?? []);
  const rawCols = (freshCols ?? (qd.result_columns as string[] | undefined) ?? []);
  const vizConfig = card.visualization_config ?? undefined;
  const { rows, columns } = applyVisualizationConfig(rawRows, rawCols, vizConfig);
  const hint = (card.visualization_config as any)?.vizType || qd.ui_hint as string || card.widget_type || 'table';
  const hasData = rows.length > 0 && columns.length > 0;

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError('');
    try {
      const result = await dashboardApi.executeWidget(card.dashboard_id, card.page_id, card.id, true);
      if (result.rows) {
        setFreshRows(result.rows as Record<string, unknown>[]);
        setFreshCols(result.columns as string[]);
      }
    } catch {
      setRefreshError('Refresh failed — you may not have permission to execute queries on this card.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh', boxShadow: 'var(--shadow-elevated)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground truncate">{card.title || 'Untitled Card'}</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                card.can_edit
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {card.can_edit ? <Edit2 className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                {card.can_edit ? 'Edit access' : 'View only'}
              </span>
              <span className="text-[10px] text-muted-foreground">•</span>
              <span className="text-[10px] text-muted-foreground">
                Shared by <strong className="text-foreground">{card.shared_by_name}</strong> {relativeTime(card.shared_at)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-4 shrink-0">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Re-execute this widget against the live database"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <Link
              href={`/dashboards/${card.dashboard_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open source
            </Link>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Chart area */}
        <div className="flex-1 min-h-0 p-4 overflow-auto" style={{ minHeight: 300 }}>
          {refreshError && (
            <div className="mb-3 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-xl px-3 py-2">
              {refreshError}
            </div>
          )}
          {hasData ? (
            <div className="h-full min-h-[260px]">
              <GenerativeUIRenderer
                execution={{ rows, columns, rowCount: rows.length, executionTimeMs: 0 } as any}
                uiHint={hint as any}
                title={card.title}
                showLegend={(card.visualization_config as any)?.showLegend}
              />
            </div>
          ) : (
            <div className="h-full min-h-[260px] flex items-center justify-center text-sm text-muted-foreground">
              No data to display — click Refresh to execute the query.
            </div>
          )}
        </div>

        {/* Metadata footer */}
        <div className="border-t border-border px-5 py-3 shrink-0 bg-muted/20">
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <User className="w-3 h-3 shrink-0" />
              <span>Shared by <span className="text-foreground font-medium">{card.shared_by_name}</span></span>
            </div>
            <div className="flex items-center gap-1.5">
              <LayoutDashboard className="w-3 h-3 shrink-0" />
              <span className="text-foreground font-medium">{card.dashboard_name}</span>
              <ChevronRight className="w-3 h-3" />
              <FileText className="w-3 h-3 shrink-0" />
              <span className="text-foreground font-medium">{card.page_name}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3 h-3 shrink-0" />
              <span title={absoluteDate(card.shared_at)}>Shared {relativeTime(card.shared_at)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Card tile in the grid ─────────────────────────────────────────────────────

function SharedCardTile({
  card,
  onClick,
}: {
  card: SharedCard;
  onClick: () => void;
}) {
  const qd = parseQd(card.query_definition);
  const rawRows = (qd.result_rows as Record<string, unknown>[] | undefined) ?? [];
  const rawCols = (qd.result_columns as string[] | undefined) ?? [];
  const vizConfig = card.visualization_config ?? undefined;
  const { rows, columns } = applyVisualizationConfig(rawRows, rawCols, vizConfig);
  const hint = (card.visualization_config as any)?.vizType || qd.ui_hint as string || card.widget_type || 'table';
  const hasData = rows.length > 0 && columns.length > 0;

  return (
    <div
      onClick={onClick}
      className="group bg-card border border-border rounded-2xl overflow-hidden cursor-pointer hover:border-primary/30 hover:shadow-lg transition-all duration-200"
    >
      {/* Chart preview */}
      <div className="h-44 border-b border-border bg-muted/20 relative overflow-hidden">
        {hasData ? (
          <div className="absolute inset-0 p-2 pointer-events-none">
            <GenerativeUIRenderer
              execution={{ rows, columns, rowCount: rows.length, executionTimeMs: 0 } as any}
              uiHint={hint as any}
              title={card.title}
              compact
              showLegend={false}
            />
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground/40">
            <LayoutDashboard className="w-8 h-8" />
            <p className="text-xs">No preview — click to refresh</p>
          </div>
        )}

        {/* Permission badge */}
        <div
          className={`absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur-sm ${
            card.can_edit
              ? 'bg-primary/90 text-white'
              : 'bg-black/50 text-white'
          }`}
        >
          {card.can_edit ? <Edit2 className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
          {card.can_edit ? 'Edit' : 'View'}
        </div>
      </div>

      {/* Metadata */}
      <div className="p-3.5 space-y-2.5">
        <h3 className="text-sm font-semibold text-foreground truncate leading-tight group-hover:text-primary transition-colors">
          {card.title || 'Untitled Card'}
        </h3>

        <div className="space-y-1.5">
          {/* Shared by */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="w-3 h-3 shrink-0" />
            <span className="truncate">
              Shared by <span className="text-foreground font-medium">{card.shared_by_name}</span>
            </span>
          </div>

          {/* Source: Dashboard → Page */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
            <LayoutDashboard className="w-3 h-3 shrink-0" />
            <span className="truncate max-w-[80px]">{card.dashboard_name}</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
            <FileText className="w-3 h-3 shrink-0" />
            <span className="truncate">{card.page_name}</span>
          </div>

          {/* Date shared */}
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={absoluteDate(card.shared_at)}
          >
            <Calendar className="w-3 h-3 shrink-0" />
            <span>{relativeTime(card.shared_at)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────

export function SharedWithMeCards({
  headerTabBar,
}: {
  headerTabBar?: React.ReactNode;
}) {
  const [cards, setCards] = useState<SharedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [focusedCard, setFocusedCard] = useState<SharedCard | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const { cards: data } = await dashboardApi.listSharedCards();
      if (mountedRef.current) setCards(data as SharedCard[]);
    } catch {
      if (mountedRef.current) setError('Failed to load shared cards. Please try again.');
    } finally {
      if (mountedRef.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    // Poll every 30 s for new shares / revocations without full-page reload.
    const timer = setInterval(() => load(true), 30_000);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [load]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Header — matches DashboardBuilder header exactly ── */}
      <header
        className="border-b border-border bg-background/95 backdrop-blur-md px-4 py-2.5 flex items-center gap-3 shrink-0"
        style={{ boxShadow: 'var(--shadow-soft)' }}
      >


        {headerTabBar}

        <div className="ml-auto flex items-center gap-2">
          {!loading && (
            <span className="text-xs text-muted-foreground">
              {cards.length === 0 ? 'No cards' : `${cards.length} card${cards.length !== 1 ? 's' : ''}`}
            </span>
          )}
          <button
            onClick={() => load()}
            disabled={loading}
            title="Refresh list"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-border bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-50 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <p className="text-sm text-destructive">{error}</p>
            <button
              onClick={() => load()}
              className="text-xs text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        ) : cards.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted/40 border border-border flex items-center justify-center">
              <Inbox className="w-7 h-7 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground mb-1">No cards shared with you yet</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                When someone shares a card with you, it will appear here. You can also ask a dashboard owner to share individual cards with you.
              </p>
            </div>
          </div>
        ) : (
          /* Card grid */
          <div className="p-5">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {cards.map(card => (
                <SharedCardTile
                  key={card.id}
                  card={card}
                  onClick={() => setFocusedCard(card)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Focus modal ── */}
      {focusedCard && (
        <SharedCardFocusModal
          card={focusedCard}
          onClose={() => setFocusedCard(null)}
        />
      )}
    </div>
  );
}
