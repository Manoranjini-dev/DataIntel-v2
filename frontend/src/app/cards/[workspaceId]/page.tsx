'use client';

import { useParams } from 'next/navigation';
import { DashboardBuilder } from '@/components/dashboard/DashboardBuilder';

// Direct /cards/:workspaceId access — used for shared workspaces or
// deep-link bookmarks. Renders the builder without a back link since
// there is no parent workspace list.
export default function CardWorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <DashboardBuilder
        dashId={workspaceId}
        hideBackLink
      />
    </div>
  );
}
