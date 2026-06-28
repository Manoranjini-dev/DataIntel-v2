// ──────────────────────────────────────────────
// DashboardPermissionsService — view/publish access rules
// ──────────────────────────────────────────────

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DashboardPermissionsService } from './dashboard-permissions.service';

describe('DashboardPermissionsService.requireAction', () => {
  let svc: DashboardPermissionsService;
  let db: { queryOne: jest.Mock };

  const dashId = 'dash-1';
  const ownerId = 'owner-1';

  beforeEach(() => {
    db = { queryOne: jest.fn() };
    svc = new DashboardPermissionsService(db as any);
  });

  it('allows the owner any action', async () => {
    db.queryOne.mockResolvedValueOnce({ created_by: ownerId }); // dashboard lookup
    await expect(svc.requireAction(dashId, ownerId, 'can_edit')).resolves.toBeUndefined();
  });

  it('404s when the dashboard does not exist', async () => {
    db.queryOne.mockResolvedValueOnce(null);
    await expect(svc.requireAction(dashId, 'someone', 'can_view')).rejects.toThrow(NotFoundException);
  });

  it('lets a shared user view', async () => {
    db.queryOne
      .mockResolvedValueOnce({ created_by: ownerId })       // dashboard
      .mockResolvedValueOnce({ id: 'share-1' });            // share row exists
    await expect(svc.requireAction(dashId, 'grantee-1', 'can_view')).resolves.toBeUndefined();
  });

  it('lets an Admin view a PUBLISHED dashboard they neither own nor are shared on', async () => {
    db.queryOne
      .mockResolvedValueOnce({ created_by: ownerId })       // dashboard
      .mockResolvedValueOnce(null)                          // no share
      .mockResolvedValueOnce({ role: 'ADMIN' })            // requester role
      .mockResolvedValueOnce({ '?column?': 1 });            // dashboard is published
    await expect(svc.requireAction(dashId, 'admin-1', 'can_view')).resolves.toBeUndefined();
  });

  it('forbids an Admin from viewing a NON-published dashboard they are not shared on', async () => {
    db.queryOne
      .mockResolvedValueOnce({ created_by: ownerId })       // dashboard
      .mockResolvedValueOnce(null)                          // no share
      .mockResolvedValueOnce({ role: 'ADMIN' })            // requester role
      .mockResolvedValueOnce(null);                         // not published
    await expect(svc.requireAction(dashId, 'admin-1', 'can_view')).rejects.toThrow(ForbiddenException);
  });

  it('forbids a non-admin, non-shared user from viewing', async () => {
    db.queryOne
      .mockResolvedValueOnce({ created_by: ownerId })       // dashboard
      .mockResolvedValueOnce(null)                          // no share
      .mockResolvedValueOnce({ role: 'ANALYST' });         // requester role (not admin → no published bypass)
    await expect(svc.requireAction(dashId, 'analyst-2', 'can_view')).rejects.toThrow(ForbiddenException);
  });

  it('forbids edit/publish for a view-only shared user', async () => {
    db.queryOne
      .mockResolvedValueOnce({ created_by: ownerId })       // dashboard
      .mockResolvedValueOnce({ can_edit: false });          // share is view-only
    await expect(svc.requireAction(dashId, 'grantee-1', 'can_publish')).rejects.toThrow(ForbiddenException);
  });
});
