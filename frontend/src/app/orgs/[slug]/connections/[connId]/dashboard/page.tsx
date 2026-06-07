'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import Link from 'next/link';
import { orgApi, connectionApi, dashboardApi } from '@/lib/api';
import { DashboardBuilder } from '@/components/dashboard/DashboardBuilder';

export default function ConnectionDashboardPage() {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [org, setOrg] = useState<any>(null);
  const [conn, setConn] = useState<any>(null);
  const [dashId, setDashId] = useState<string>('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [slug, connId]);

  async function loadData() {
    try {
      const { org: o } = await orgApi.get(slug);
      setOrg(o);
      const { connection: c } = await connectionApi.get(o.id, connId);
      setConn(c);

      // Find or create a dashboard for this connection
      const { dashboards } = await dashboardApi.list(o.id);
      let dash = dashboards.find((d: any) => d.connection_id === connId);
      if (!dash) {
        const { dashboard: newDash } = await dashboardApi.create(o.id, { name: `${c.name} Dashboard`, connectionId: connId });
        dash = newDash;
      }
      setDashId(dash.id);
    } catch (e) { 
      console.error(e); 
    } finally { 
      setLoading(false); 
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {dashId ? (
        <DashboardBuilder 
          orgSlug={slug} 
          dashId={dashId} 
          backUrl={`/orgs/${slug}/connections/${connId}`} 
          backLabel="Overview"
          titleOverride="Dashboard"
          subtitleOverride={`Insights for ${conn?.name}`}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-background text-muted-foreground">
          Initializing dashboard...
        </div>
      )}
    </div>
  );
}
