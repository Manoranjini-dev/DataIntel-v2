// ──────────────────────────────────────────────
// DashboardBuilderService — move/copy permission gating
// Verifies move/copy of pages and cards require edit access on BOTH the
// source resource and the destination, and that a denial on either side
// blocks the operation before any DB mutation happens.
// ──────────────────────────────────────────────

import { ForbiddenException } from '@nestjs/common';
import { DashboardBuilderService } from './dashboard-builder.service';

function makeService() {
  const db = {
    queryOne: jest.fn(),
    queryMany: jest.fn(),
    query: jest.fn(),
    transaction: jest.fn(),
  };
  const audit = { log: jest.fn() };
  const dashboardPermissions = {
    requirePageAction: jest.fn(),
    requireWidgetAction: jest.fn(),
    requireAction: jest.fn(),
  };
  const cache = { del: jest.fn(), delPattern: jest.fn(), setJson: jest.fn() };
  const events = { emit: jest.fn() };
  const svc = new DashboardBuilderService(db as any, audit as any, dashboardPermissions as any, cache as any, events as any);
  return { svc, db, audit, dashboardPermissions, cache };
}

const mover = { id: 'mover-1', role: 'ANALYST' } as any;

describe('DashboardBuilderService.copyWidget', () => {
  it('denies the copy when the source card is not viewable', async () => {
    const { svc, dashboardPermissions } = makeService();
    dashboardPermissions.requireWidgetAction.mockRejectedValueOnce(new ForbiddenException('no view access'));
    await expect(svc.copyWidget('widget-1', 'page-2', mover)).rejects.toThrow(ForbiddenException);
    expect(dashboardPermissions.requirePageAction).not.toHaveBeenCalled();
  });

  it('denies the copy when the destination page is not editable', async () => {
    const { svc, dashboardPermissions } = makeService();
    dashboardPermissions.requireWidgetAction.mockResolvedValueOnce(undefined);
    dashboardPermissions.requirePageAction.mockRejectedValueOnce(new ForbiddenException('no edit access'));
    await expect(svc.copyWidget('widget-1', 'page-2', mover)).rejects.toThrow(ForbiddenException);
  });

  it('copies the widget row into the destination page when both checks pass', async () => {
    const { svc, db, dashboardPermissions } = makeService();
    dashboardPermissions.requireWidgetAction.mockResolvedValueOnce(undefined);
    dashboardPermissions.requirePageAction.mockResolvedValueOnce(undefined);
    db.queryOne
      .mockResolvedValueOnce({ // SELECT * FROM dashboard_widgets_v2 (source)
        id: 'widget-1', card_id: null, pinned_card_version: null, widget_type: 'bar_chart', title: 'Revenue',
        grid_w: 6, grid_h: 4, layout_desktop: {}, layout_tablet: {}, layout_mobile: {},
        datasource_context_type: 'connection', datasource_context_id: 'conn-1',
        query_definition: { sql: 'SELECT 1' }, query_language: 'sql', visualization_config: {},
        refresh_interval_sec: null, cache_ttl_sec: 300, sort_order: 0,
      })
      .mockResolvedValueOnce({ max_y: 4 }) // max grid_y on target page
      .mockResolvedValueOnce({ id: 'widget-2', title: 'Revenue' }) // INSERT ... RETURNING *
      .mockResolvedValueOnce({ dashboard_id: 'dash-2' }); // resolveDashboardIdForPage(targetPageId)

    const copy = await svc.copyWidget('widget-1', 'page-2', mover);
    expect(copy).toMatchObject({ id: 'widget-2' });
    expect(dashboardPermissions.requireWidgetAction).toHaveBeenCalledWith('widget-1', mover.id, 'can_view');
    expect(dashboardPermissions.requirePageAction).toHaveBeenCalledWith('page-2', mover.id, 'can_edit');
  });
});

describe('DashboardBuilderService.moveWidget', () => {
  it('requires EDIT (not just view) on the source card', async () => {
    const { svc, dashboardPermissions } = makeService();
    dashboardPermissions.requireWidgetAction.mockRejectedValueOnce(new ForbiddenException());
    await expect(svc.moveWidget('widget-1', 'page-2', mover)).rejects.toThrow(ForbiddenException);
    expect(dashboardPermissions.requireWidgetAction).toHaveBeenCalledWith('widget-1', mover.id, 'can_edit');
  });
});

describe('DashboardBuilderService.copyPage / movePage', () => {
  it('copyPage denies when the destination dashboard is not editable', async () => {
    const { svc, dashboardPermissions } = makeService();
    dashboardPermissions.requirePageAction.mockResolvedValueOnce(undefined); // source page view ok
    dashboardPermissions.requireAction.mockRejectedValueOnce(new ForbiddenException());
    await expect(svc.copyPage('page-1', 'dash-1', 'dash-2', mover)).rejects.toThrow(ForbiddenException);
    expect(dashboardPermissions.requireAction).toHaveBeenCalledWith('dash-2', mover.id, 'can_edit');
  });

  it('movePage refuses to move the last remaining page out of a dashboard', async () => {
    const { svc, db, dashboardPermissions } = makeService();
    dashboardPermissions.requirePageAction.mockResolvedValueOnce(undefined);
    dashboardPermissions.requireAction.mockResolvedValueOnce(undefined);
    db.queryOne
      .mockResolvedValueOnce({ id: 'page-1' })   // source page exists
      .mockResolvedValueOnce({ count: '1' });    // only 1 page left in source dashboard
    await expect(svc.movePage('page-1', 'dash-1', 'dash-2', mover)).rejects.toThrow(ForbiddenException);
  });
});
