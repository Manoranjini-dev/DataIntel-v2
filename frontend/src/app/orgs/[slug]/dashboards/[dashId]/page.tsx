'use client';

import { useParams } from 'next/navigation';
import { DashboardBuilder } from '@/components/dashboard/DashboardBuilder';

export default function DashboardEditorPage() {
  const { slug, dashId } = useParams<{ slug: string; dashId: string }>();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <DashboardBuilder orgSlug={slug} dashId={dashId} />
    </div>
  );
}
