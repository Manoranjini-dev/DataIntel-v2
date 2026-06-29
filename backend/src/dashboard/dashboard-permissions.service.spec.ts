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

// ──────────────────────────────────────────────
// Page & widget-level sharing — narrower, additive grants on top of the
// dashboard-level model above. A page/widget share must NOT grant access to
// the rest of the dashboard, but full dashboard access must still see
// everything (no regression to the behavior tested above).
// ──────────────────────────────────────────────
describe('DashboardPermissionsService — page-level access', () => {
  let svc: DashboardPermissionsService;
  let db: { queryOne: jest.Mock };

  const pageId = 'page-1';
  const dashId = 'dash-1';
  const ownerId = 'owner-1';

  beforeEach(() => {
    db = { queryOne: jest.fn() };
    svc = new DashboardPermissionsService(db as any);
  });

  it('canViewPage: owner sees the page via dashboard ownership', async () => {
    db.queryOne
      .mockResolvedValueOnce({ dashboard_id: dashId })  // resolveDashIdForPage
      .mockResolvedValueOnce({ created_by: ownerId });  // canView: dashboard lookup (owner match)
    await expect(svc.canViewPage(pageId, ownerId)).resolves.toBe(true);
  });

  it('canViewPage: a full dashboard share sees the page even with no page-specific share', async () => {
    db.queryOne
      .mockResolvedValueOnce({ dashboard_id: dashId })   // resolveDashIdForPage
      .mockResolvedValueOnce({ created_by: ownerId })    // canView: dashboard lookup (not owner)
      .mockResolvedValueOnce({ id: 'share-1' });         // canView: dashboard_shares row exists
    await expect(svc.canViewPage(pageId, 'grantee-1')).resolves.toBe(true);
  });

  it('canViewPage: a page-specific share grants access with NO dashboard-level share', async () => {
    db.queryOne
      .mockResolvedValueOnce({ dashboard_id: dashId })   // resolveDashIdForPage
      .mockResolvedValueOnce({ created_by: ownerId })    // canView: dashboard lookup (not owner)
      .mockResolvedValueOnce(null)                       // canView: no dashboard share
      .mockResolvedValueOnce({ id: 'page-share-1' });    // dashboard_page_shares row exists
    await expect(svc.canViewPage(pageId, 'page-grantee-1')).resolves.toBe(true);
  });

  it('canViewPage: no dashboard share and no page share → no access', async () => {
    db.queryOne
      .mockResolvedValueOnce({ dashboard_id: dashId })
      .mockResolvedValueOnce({ created_by: ownerId })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    await expect(svc.canViewPage(pageId, 'stranger-1')).resolves.toBe(false);
  });

  it('canViewPage: a share on a widget WITHIN the page does NOT by itself grant page-level access (would leak unshared sibling cards via listWidgets)', async () => {
    db.queryOne
      .mockResolvedValueOnce({ dashboard_id: dashId })   // resolveDashIdForPage
      .mockResolvedValueOnce({ created_by: ownerId })    // canView: dashboard lookup (not owner)
      .mockResolvedValueOnce(null)                       // canView: no dashboard share
      .mockResolvedValueOnce(null);                      // no page-specific share
    await expect(svc.canViewPage(pageId, 'card-grantee-1')).resolves.toBe(false);
  });

  it('canEditPage: a page-specific EDIT share grants edit with no dashboard-level edit', async () => {
    db.queryOne
      .mockResolvedValueOnce({ dashboard_id: dashId })   // resolveDashIdForPage
      .mockResolvedValueOnce({ created_by: ownerId })    // canEdit: dashboard lookup (not owner)
      .mockResolvedValueOnce(null)                       // canEdit: no dashboard share
      .mockResolvedValueOnce({ can_edit: true });        // dashboard_page_shares row, can_edit=true
    await expect(svc.canEditPage(pageId, 'page-editor-1')).resolves.toBe(true);
  });

  it('canEditPage: a VIEW-only page share does not grant edit', async () => {
    db.queryOne
      .mockResolvedValueOnce({ dashboard_id: dashId })
      .mockResolvedValueOnce({ created_by: ownerId })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ can_edit: false });
    await expect(svc.canEditPage(pageId, 'page-viewer-1')).resolves.toBe(false);
  });

  it('requirePageAction throws ForbiddenException when access is denied', async () => {
    jest.spyOn(svc, 'canViewPage').mockResolvedValue(false);
    await expect(svc.requirePageAction(pageId, 'stranger-1', 'can_view')).rejects.toThrow(ForbiddenException);
  });

  it('requirePageAction resolves when access is granted', async () => {
    jest.spyOn(svc, 'canEditPage').mockResolvedValue(true);
    await expect(svc.requirePageAction(pageId, 'editor-1', 'can_edit')).resolves.toBeUndefined();
  });
});

describe('DashboardPermissionsService — widget (card)-level access', () => {
  let svc: DashboardPermissionsService;
  let db: { queryOne: jest.Mock };

  const widgetId = 'widget-1';
  const pageId = 'page-1';

  beforeEach(() => {
    db = { queryOne: jest.fn() };
    svc = new DashboardPermissionsService(db as any);
  });

  it('canViewWidget: falls through to page-level access when no widget-specific share', async () => {
    jest.spyOn(svc, 'canViewPage').mockResolvedValue(true);
    db.queryOne.mockResolvedValueOnce({ page_id: pageId }); // resolvePageIdForWidget
    await expect(svc.canViewWidget(widgetId, 'page-grantee-1')).resolves.toBe(true);
  });

  it('canViewWidget: a widget-specific share grants access with NO page or dashboard access', async () => {
    jest.spyOn(svc, 'canViewPage').mockResolvedValue(false);
    db.queryOne
      .mockResolvedValueOnce({ page_id: pageId })       // resolvePageIdForWidget
      .mockResolvedValueOnce({ id: 'widget-share-1' });  // dashboard_widget_shares row exists
    await expect(svc.canViewWidget(widgetId, 'card-grantee-1')).resolves.toBe(true);
  });

  it('canViewWidget: no page access and no widget share → no access', async () => {
    jest.spyOn(svc, 'canViewPage').mockResolvedValue(false);
    db.queryOne
      .mockResolvedValueOnce({ page_id: pageId })
      .mockResolvedValueOnce(null);
    await expect(svc.canViewWidget(widgetId, 'stranger-1')).resolves.toBe(false);
  });

  it('canEditWidget: a widget-specific EDIT share grants edit with no page-level edit', async () => {
    jest.spyOn(svc, 'canEditPage').mockResolvedValue(false);
    db.queryOne
      .mockResolvedValueOnce({ page_id: pageId })
      .mockResolvedValueOnce({ can_edit: true });
    await expect(svc.canEditWidget(widgetId, 'card-editor-1')).resolves.toBe(true);
  });

  it('requireWidgetAction throws ForbiddenException when access is denied', async () => {
    jest.spyOn(svc, 'canViewWidget').mockResolvedValue(false);
    await expect(svc.requireWidgetAction(widgetId, 'stranger-1', 'can_view')).rejects.toThrow(ForbiddenException);
  });
});

describe('DashboardPermissionsService.canViewDashboardAtAll', () => {
  let svc: DashboardPermissionsService;
  let db: { queryOne: jest.Mock };

  const dashId = 'dash-1';
  const ownerId = 'owner-1';

  beforeEach(() => {
    db = { queryOne: jest.fn() };
    svc = new DashboardPermissionsService(db as any);
  });

  it('true for the owner (via canView)', async () => {
    db.queryOne.mockResolvedValueOnce({ created_by: ownerId });
    await expect(svc.canViewDashboardAtAll(dashId, ownerId)).resolves.toBe(true);
  });

  it('true for a user with ONLY a page-level share, no dashboard share', async () => {
    db.queryOne
      .mockResolvedValueOnce({ created_by: ownerId })  // canView: dashboard lookup (not owner)
      .mockResolvedValueOnce(null)                      // canView: no dashboard share
      .mockResolvedValueOnce({ '?column?': 1 });        // page-share existence join: found
    await expect(svc.canViewDashboardAtAll(dashId, 'page-grantee-1')).resolves.toBe(true);
  });

  it('true for a user with ONLY a widget-level share, no dashboard or page share', async () => {
    db.queryOne
      .mockResolvedValueOnce({ created_by: ownerId })  // canView: dashboard lookup (not owner)
      .mockResolvedValueOnce(null)                      // canView: no dashboard share
      .mockResolvedValueOnce(null)                      // no page share
      .mockResolvedValueOnce({ '?column?': 1 });        // widget-share existence join: found
    await expect(svc.canViewDashboardAtAll(dashId, 'card-grantee-1')).resolves.toBe(true);
  });

  it('false when nothing at any level grants access', async () => {
    db.queryOne
      .mockResolvedValueOnce({ created_by: ownerId })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    await expect(svc.canViewDashboardAtAll(dashId, 'stranger-1')).resolves.toBe(false);
  });
});
