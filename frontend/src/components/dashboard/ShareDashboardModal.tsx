'use client';

import { dashboardApi } from '@/lib/api';
import { ShareResourceModal } from './ShareResourceModal';

interface ShareDashboardModalProps {
  dashId: string;
  dashName: string;
  ownerName?: string;
  ownerId?: string;
  currentUserId?: string;
  onClose: () => void;
}

/**
 * Thin adapter over the generic ShareResourceModal — kept as its own
 * component so existing call sites don't need to change.
 */
export function ShareDashboardModal({
  dashId, dashName, ownerName, ownerId, currentUserId, onClose,
}: ShareDashboardModalProps) {
  return (
    <ShareResourceModal
      resourceLabel="Dashboard"
      resourceName={dashName}
      ownerName={ownerName}
      ownerId={ownerId}
      currentUserId={currentUserId}
      onClose={onClose}
      api={{
        list: () => dashboardApi.listShares(dashId),
        share: (data) => dashboardApi.share(dashId, data),
        update: (accountId, data) => dashboardApi.updateShare(dashId, accountId, data),
        revoke: (accountId) => dashboardApi.revokeShare(dashId, accountId),
        search: (q) => dashboardApi.searchShareTargets(q),
      }}
    />
  );
}
