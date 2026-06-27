'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import Link from 'next/link';
import { connectionApi, dashboardApi } from '@/lib/api';
import { DashboardBuilder } from '@/components/dashboard/DashboardBuilder';

export default function ConnectionDashboardPage() {
  const { slug, connId } = useParams<{ slug: string; connId: string }>();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [conn, setConn] = useState<any>(null);
  const [dashId, setDashId] = useState<string>('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [slug, connId]);

  async function loadData() {
    try {
      const { connection: c } = await connectionApi.get(connId);
      setConn(c);

      // Find or create the data-source dashboard owned by this connection.
      // Scoped to origin='datasource' so it is fully independent of any manual
      // dashboard that merely connects to the same data source.
      const { dashboards } = await dashboardApi.list({ origin: 'datasource', contextType: 'connection', contextId: connId });
      let dash = dashboards.find((d: any) => d.connection_id === connId);
      if (!dash) {
        const { dashboard: newDash } = await dashboardApi.create({ name: `${c.name} Dashboard`, connectionId: connId, origin: 'datasource' });
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
          dashId={dashId}
          titleOverride="Dashboard"
          subtitleOverride={`Insights for ${conn?.name}`}
          hideContextNav
        />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-background text-muted-foreground">
          Initializing dashboard...
        </div>
      )}
    </div>
  );
}
