'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { DashboardBuilder } from '@/components/dashboard/DashboardBuilder';

export default function DashboardEditorPage() {
  const { slug, dashId } = useParams<{ slug: string; dashId: string }>();
  const searchParams = useSearchParams();
  const isNew = searchParams.get('new') === '1';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <DashboardBuilder
        dashId={dashId}
        backUrl={`/dashboards`}
        backLabel="Dashboards"
        isNew={isNew}
      />
    </div>
  );
}
