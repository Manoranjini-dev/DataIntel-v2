'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { orgApi, comboApi, dashboardApi, chatApi } from '@/lib/api';
import { DashboardBuilder } from '@/components/dashboard/DashboardBuilder';
import { LayoutDashboard, MessageSquare, Plus, ArrowLeft } from 'lucide-react';

export default function ComboDashboardPage() {
  const { slug, comboId } = useParams<{ slug: string; comboId: string }>();
  const router = useRouter();
  const [org, setOrg] = useState<any>(null);
  const [combo, setCombo] = useState<any>(null);
  const [dashId, setDashId] = useState<string>('');
  const [activeChatId, setActiveChatId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [hasDashboard, setHasDashboard] = useState<boolean | null>(null);

  useEffect(() => { loadData(); }, [slug, comboId]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const { combo: c } = await comboApi.get(o.id, comboId);
      setCombo(c);

      // Load active chat context to preserve navigation state
      const { chats: chatList } = await chatApi.list(o.id, { comboId });
      if (chatList.length > 0) {
        setActiveChatId(chatList[0].id);
      }

      // Find dashboard for this combo
      const { dashboards } = await dashboardApi.list(o.id);
      const dash = dashboards.find((d: any) => d.combo_id === comboId);
      if (dash) {
        setDashId(dash.id);
        setHasDashboard(true);
      } else {
        setHasDashboard(false);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateDashboard() {
    if (!org || !combo) return;
    setCreating(true);
    try {
      const { dashboard: newDash } = await dashboardApi.create(org.id, {
        name: `${combo.name} Dashboard`,
        comboId: comboId
      });
      setDashId(newDash.id);
      setHasDashboard(true);
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const chatUrl = activeChatId
    ? `/orgs/${slug}/combos/${comboId}/chat?chatId=${activeChatId}`
    : `/orgs/${slug}/combos/${comboId}/chat`;

  if (hasDashboard === false) {
    return (
      <div className="flex-1 flex flex-col h-full min-w-0 bg-background text-foreground animate-fade-in">
        {/* Header matching DashboardBuilder header */}
        <header className="border-b border-border bg-background/95 backdrop-blur-md px-4 py-2.5 flex items-center gap-3 shrink-0" style={{ boxShadow: 'var(--shadow-soft)' }}>
          <Link href={`/orgs/${slug}/combos`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-xs mr-1 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Combos
          </Link>

          <div className="w-px h-4 bg-border shrink-0" />

          <LayoutDashboard className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground truncate leading-tight">Dashboard</h1>
            <p className="text-[10px] text-muted-foreground">Insights for {combo?.name}</p>
          </div>

          <div className="flex items-center gap-2 ml-4 shrink-0">
            <Link
              href={chatUrl}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat</span>
            </Link>
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 text-primary border border-primary/20 shrink-0"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>Dashboard</span>
            </div>
          </div>
        </header>

        {/* Empty State Body */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
            style={{
              background: 'linear-gradient(135deg, rgba(217,122,30,.15), rgba(245,166,35,.15))',
              border: '1px solid rgba(217,122,30,.2)'
            }}
          >
            <LayoutDashboard className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">No Dashboard Yet</h2>
          <p className="text-muted-foreground text-sm leading-relaxed mb-6">
            Create a dashboard for this Combo to visualize insights, build KPI cards, and compile your data queries in one place.
          </p>
          <button
            onClick={handleCreateDashboard}
            disabled={creating}
            className="px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2 shadow-sm"
          >
            {creating ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Creating Dashboard…
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Create Dashboard
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {dashId ? (
        <DashboardBuilder
          orgSlug={slug}
          dashId={dashId}
          backUrl={`/orgs/${slug}/combos`}
          backLabel="Combos"
          titleOverride="Dashboard"
          subtitleOverride={`Insights for ${combo?.name}`}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-background text-muted-foreground text-sm">
          Failed to load combo dashboard.
        </div>
      )}
    </div>
  );
}
