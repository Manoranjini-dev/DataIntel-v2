'use client';

import { useEffect, useState } from 'react';
import { dashboardApi } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { DashboardBuilder } from '@/components/dashboard/DashboardBuilder';
import { SharedWithMeCards } from '@/components/cards/SharedWithMeCards';

type CardsView = 'my-cards' | 'shared';

/** Pill-style tab switcher rendered inside the DashboardBuilder / SharedWithMeCards header. */
function TabBar({ view, onSwitch }: { view: CardsView; onSwitch: (v: CardsView) => void }) {
  return (
    <div className="flex items-center bg-muted/50 rounded-xl p-0.5 ml-3 shrink-0">
      <button
        onClick={() => onSwitch('my-cards')}
        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
          view === 'my-cards'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        My Cards
      </button>
      <button
        onClick={() => onSwitch('shared')}
        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
          view === 'shared'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Shared with Me
      </button>
    </div>
  );
}

export default function CardsPage() {
  const currentUser = useAuthStore(s => s.user);
  const isViewer = currentUser?.role === 'VIEWER';
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<CardsView>('my-cards');

  useEffect(() => {
    async function boot() {
      try {
        const { dashboards } = await dashboardApi.list({ origin: 'cards' });
        if (dashboards.length > 0) {
          // Sort ascending so the oldest workspace is always "My Cards",
          // regardless of how many may have been created previously.
          const sorted = [...dashboards].sort(
            (a: any, b: any) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          );
          setWorkspaceId(sorted[0].id);
        } else if (!isViewer) {
          const { dashboard } = await dashboardApi.create({
            name: 'My Cards',
            origin: 'cards',
          } as any);
          setWorkspaceId(dashboard.id);
        } else {
          setError('No Cards workspace available. Ask an admin to share one with you.');
        }
      } catch {
        setError('Failed to load Cards workspace.');
      } finally {
        setLoading(false);
      }
    }
    boot();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs = <TabBar view={view} onSwitch={setView} />;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (view === 'shared') {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <SharedWithMeCards headerTabBar={tabs} />
      </div>
    );
  }

  if (!workspaceId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">{error || 'No Cards workspace found.'}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <DashboardBuilder
        dashId={workspaceId}
        hideBackLink
        headerTabBar={tabs}
      />
    </div>
  );
}
