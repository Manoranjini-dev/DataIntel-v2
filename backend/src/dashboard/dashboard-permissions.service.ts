// ──────────────────────────────────────────────
// Dashboard Permissions Service
// User-based sharing for dashboards — mirrors card.service.ts sharing pattern.
// Uses the `dashboard_shares` table (migration 022) which exactly mirrors
// `card_shares` (migration 020). The dashboard owner (dashboards.created_by)
// always has full access.
// ──────────────────────────────────────────────

import { Injectable, Logger, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type DashboardAccess = 'owner' | 'edit' | 'view';

@Injectable()
export class DashboardPermissionsService {
  private readonly logger = new Logger(DashboardPermissionsService.name);

  constructor(
    private readonly db: DatabaseService,
  ) {}

  /** Verify the requester owns the dashboard (throws ForbiddenException if not) */
  private async requireOwner(dashId: string, requesterId: string): Promise<void> {
    const dash = await this.db.queryOne<{ created_by: string }>(
      `SELECT created_by FROM dashboards WHERE id = $1 AND deleted_at IS NULL`,
      [dashId],
    );
    if (!dash) throw new NotFoundException('Dashboard not found');
    if (dash.created_by !== requesterId) {
      throw new ForbiddenException('Only the dashboard owner can manage sharing');
    }
  }

  /**
   * List all active shares for a dashboard.
   * Returns the owner details plus all shared users.
   * Only the owner or admins can see this full list.
   */
  async listShares(dashId: string, requesterId: string): Promise<{ shares: any[]; owner: any }> {
    const dash = await this.db.queryOne<{ created_by: string; id: string }>(
      `SELECT created_by, id FROM dashboards WHERE id = $1 AND deleted_at IS NULL`,
      [dashId],
    );
    if (!dash) throw new NotFoundException('Dashboard not found');

    const isOwner = dash.created_by === requesterId;
    if (!isOwner) {
      // Non-owners must at least have a share record to see the list
      const share = await this.db.queryOne(
        `SELECT id FROM dashboard_shares WHERE dashboard_id = $1 AND shared_with = $2`,
        [dashId, requesterId],
      );
      if (!share) throw new ForbiddenException('You do not have access to this dashboard');
    }

    const owner = await this.db.queryOne<{ id: string; email: string; display_name: string; role: string }>(
      `SELECT id, email, display_name, role FROM accounts WHERE id = $1`,
      [dash.created_by],
    );

    const shares = await this.db.queryMany<any>(
      `SELECT ds.id, ds.dashboard_id, ds.shared_with AS account_id,
              ds.can_edit, ds.shared_by, ds.created_at,
              a.email, a.display_name, a.role
       FROM dashboard_shares ds
       JOIN accounts a ON a.id = ds.shared_with
       WHERE ds.dashboard_id = $1
       ORDER BY ds.created_at ASC`,
      [dashId],
    );

    return { shares, owner };
  }

  /** Share a dashboard by looking up the target by email — upserts on conflict */
  async shareByEmail(
    dashId: string,
    email: string,
    canEdit: boolean,
    grantedByAccountId: string,
  ) {
    await this.requireOwner(dashId, grantedByAccountId);

    const target = await this.db.queryOne<{ id: string; role: string; email: string; display_name: string }>(
      `SELECT id, role, email, display_name
       FROM accounts
       WHERE LOWER(email) = LOWER($1) AND is_deleted = FALSE AND status = 'ACTIVE'`,
      [email],
    );
    if (!target) throw new NotFoundException(`No active user found with email "${email}"`);
    if (target.id === grantedByAccountId) {
      throw new BadRequestException('You cannot share a dashboard with yourself');
    }

    // Viewers can only ever have view (read-only) access — never edit
    const effectiveCanEdit = target.role === 'VIEWER' ? false : canEdit;

    const share = await this.db.queryOne(
      `INSERT INTO dashboard_shares (dashboard_id, shared_with, can_edit, shared_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (dashboard_id, shared_with) DO UPDATE
         SET can_edit = EXCLUDED.can_edit, updated_at = NOW()
       RETURNING *`,
      [dashId, target.id, effectiveCanEdit, grantedByAccountId],
    );

    return { ...share, email: target.email, display_name: target.display_name };
  }

  /** Update the access level for an existing share */
  async updateShare(dashId: string, accountId: string, canEdit: boolean, updaterId: string) {
    await this.requireOwner(dashId, updaterId);

    const target = await this.db.queryOne<{ role: string }>(
      `SELECT role FROM accounts WHERE id = $1`,
      [accountId],
    );
    const effectiveCanEdit = target?.role === 'VIEWER' ? false : canEdit;

    await this.db.query(
      `UPDATE dashboard_shares SET can_edit = $3, updated_at = NOW()
       WHERE dashboard_id = $1 AND shared_with = $2`,
      [dashId, accountId, effectiveCanEdit],
    );
  }

  /** Revoke a previously granted share */
  async revokeAccess(dashId: string, targetAccountId: string, revokerId: string) {
    await this.requireOwner(dashId, revokerId);
    await this.db.query(
      `DELETE FROM dashboard_shares WHERE dashboard_id = $1 AND shared_with = $2`,
      [dashId, targetAccountId],
    );
  }

  /** Search active workspace users for the share picker */
  async searchShareTargets(query: string, excludeAccountId: string) {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    return this.db.queryMany<{ id: string; email: string; display_name: string; role: string }>(
      `SELECT id, email, display_name, role
       FROM accounts
       WHERE is_deleted = FALSE
         AND status = 'ACTIVE'
         AND id != $1
         AND (email ILIKE $2 OR display_name ILIKE $2)
       ORDER BY display_name ASC
       LIMIT 10`,
      [excludeAccountId, `%${trimmed}%`],
    );
  }

  /**
   * Check if a user can view/access a dashboard.
   * Owner (dashboards.created_by) always has full access.
   * Others need an entry in dashboard_shares.
   */
  async canView(dashId: string, accountId: string): Promise<boolean> {
    const dash = await this.db.queryOne<{ created_by: string }>(
      `SELECT created_by FROM dashboards WHERE id = $1 AND deleted_at IS NULL`,
      [dashId],
    );
    if (!dash) return false;
    if (dash.created_by === accountId) return true;

    const share = await this.db.queryOne(
      `SELECT id FROM dashboard_shares WHERE dashboard_id = $1 AND shared_with = $2`,
      [dashId, accountId],
    );
    return !!share;
  }

  /**
   * Check if a user can edit a dashboard.
   * Owner always can. Others need a share with can_edit = TRUE.
   */
  async canEdit(dashId: string, accountId: string): Promise<boolean> {
    const dash = await this.db.queryOne<{ created_by: string }>(
      `SELECT created_by FROM dashboards WHERE id = $1 AND deleted_at IS NULL`,
      [dashId],
    );
    if (!dash) return false;
    if (dash.created_by === accountId) return true;

    const share = await this.db.queryOne<{ can_edit: boolean }>(
      `SELECT can_edit FROM dashboard_shares WHERE dashboard_id = $1 AND shared_with = $2`,
      [dashId, accountId],
    );
    return !!share?.can_edit;
  }

  /**
   * Does this account have ANY access to the dashboard at all — owner,
   * dashboard-level share, a share on one of its pages, a share on one of
   * its widgets, or admin-on-published? Used to decide whether to let a
   * page-only/widget-only recipient open the dashboard shell at all; the
   * subsequent listPages/listWidgets calls filter down to exactly what they
   * were granted (see DashboardBuilderService).
   */
  async canViewDashboardAtAll(dashId: string, accountId: string): Promise<boolean> {
    if (await this.canView(dashId, accountId)) return true;

    const pageShare = await this.db.queryOne(
      `SELECT 1 FROM dashboard_page_shares ps
       JOIN dashboard_pages p ON p.id = ps.page_id
       WHERE p.dashboard_id = $1 AND ps.shared_with = $2 AND p.deleted_at IS NULL
       LIMIT 1`,
      [dashId, accountId],
    );
    if (pageShare) return true;

    const widgetShare = await this.db.queryOne(
      `SELECT 1 FROM dashboard_widget_shares ws
       JOIN dashboard_widgets_v2 w ON w.id = ws.widget_id
       JOIN dashboard_pages p ON p.id = w.page_id
       WHERE p.dashboard_id = $1 AND ws.shared_with = $2 AND w.deleted_at IS NULL AND p.deleted_at IS NULL
       LIMIT 1`,
      [dashId, accountId],
    );
    return !!widgetShare;
  }

  // ── Page-level sharing ────────────────────────────────

  private async resolveDashIdForPage(pageId: string): Promise<string> {
    const page = await this.db.queryOne<{ dashboard_id: string }>(
      `SELECT dashboard_id FROM dashboard_pages WHERE id = $1`,
      [pageId],
    );
    if (!page) throw new NotFoundException('Page not found');
    return page.dashboard_id;
  }

  /**
   * Page-level view access: dashboard-level access first, else a
   * page-specific share. This is deliberately NOT widened by widget-level
   * shares — listWidgets uses this exact check to decide "show me every
   * widget on the page" vs. "filter to just the shared ones", so widening
   * it here would leak unshared sibling cards to a card-only recipient.
   * (listPages handles surfacing the page's tab for a card-only recipient
   * via its own, separate widget-share check — see listPages.)
   */
  async canViewPage(pageId: string, accountId: string): Promise<boolean> {
    const dashId = await this.resolveDashIdForPage(pageId);
    if (await this.canView(dashId, accountId)) return true;
    const share = await this.db.queryOne(
      `SELECT id FROM dashboard_page_shares WHERE page_id = $1 AND shared_with = $2`,
      [pageId, accountId],
    );
    return !!share;
  }

  /** Page-level edit access: dashboard-level edit first, else a page-specific edit share. */
  async canEditPage(pageId: string, accountId: string): Promise<boolean> {
    const dashId = await this.resolveDashIdForPage(pageId);
    if (await this.canEdit(dashId, accountId)) return true;
    const share = await this.db.queryOne<{ can_edit: boolean }>(
      `SELECT can_edit FROM dashboard_page_shares WHERE page_id = $1 AND shared_with = $2`,
      [pageId, accountId],
    );
    return !!share?.can_edit;
  }

  async requirePageAction(pageId: string, accountId: string, action: 'can_view' | 'can_edit') {
    const ok = action === 'can_view'
      ? await this.canViewPage(pageId, accountId)
      : await this.canEditPage(pageId, accountId);
    if (!ok) throw new ForbiddenException('You do not have access to this page');
  }

  async listPageShares(pageId: string, requesterId: string): Promise<{ shares: any[]; owner: any }> {
    const dashId = await this.resolveDashIdForPage(pageId);
    await this.requireOwner(dashId, requesterId);

    const dash = await this.db.queryOne<{ created_by: string }>(`SELECT created_by FROM dashboards WHERE id = $1`, [dashId]);
    const owner = await this.db.queryOne<{ id: string; email: string; display_name: string; role: string }>(
      `SELECT id, email, display_name, role FROM accounts WHERE id = $1`,
      [dash!.created_by],
    );

    const shares = await this.db.queryMany<any>(
      `SELECT ps.id, ps.page_id, ps.shared_with AS account_id,
              ps.can_edit, ps.shared_by, ps.created_at,
              a.email, a.display_name, a.role
       FROM dashboard_page_shares ps
       JOIN accounts a ON a.id = ps.shared_with
       WHERE ps.page_id = $1
       ORDER BY ps.created_at ASC`,
      [pageId],
    );

    return { shares, owner };
  }

  async sharePageByEmail(pageId: string, email: string, canEdit: boolean, grantedByAccountId: string) {
    const dashId = await this.resolveDashIdForPage(pageId);
    await this.requireOwner(dashId, grantedByAccountId);

    const target = await this.db.queryOne<{ id: string; role: string; email: string; display_name: string }>(
      `SELECT id, role, email, display_name FROM accounts WHERE LOWER(email) = LOWER($1) AND is_deleted = FALSE AND status = 'ACTIVE'`,
      [email],
    );
    if (!target) throw new NotFoundException(`No active user found with email "${email}"`);
    if (target.id === grantedByAccountId) {
      throw new BadRequestException('You cannot share a page with yourself');
    }

    const effectiveCanEdit = target.role === 'VIEWER' ? false : canEdit;

    const share = await this.db.queryOne(
      `INSERT INTO dashboard_page_shares (page_id, shared_with, can_edit, shared_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (page_id, shared_with) DO UPDATE
         SET can_edit = EXCLUDED.can_edit, updated_at = NOW()
       RETURNING *`,
      [pageId, target.id, effectiveCanEdit, grantedByAccountId],
    );

    return { ...share, email: target.email, display_name: target.display_name };
  }

  async updatePageShare(pageId: string, accountId: string, canEdit: boolean, updaterId: string) {
    const dashId = await this.resolveDashIdForPage(pageId);
    await this.requireOwner(dashId, updaterId);

    const target = await this.db.queryOne<{ role: string }>(`SELECT role FROM accounts WHERE id = $1`, [accountId]);
    const effectiveCanEdit = target?.role === 'VIEWER' ? false : canEdit;

    await this.db.query(
      `UPDATE dashboard_page_shares SET can_edit = $3, updated_at = NOW() WHERE page_id = $1 AND shared_with = $2`,
      [pageId, accountId, effectiveCanEdit],
    );
  }

  async revokePageAccess(pageId: string, targetAccountId: string, revokerId: string) {
    const dashId = await this.resolveDashIdForPage(pageId);
    await this.requireOwner(dashId, revokerId);
    await this.db.query(
      `DELETE FROM dashboard_page_shares WHERE page_id = $1 AND shared_with = $2`,
      [pageId, targetAccountId],
    );
  }

  // ── Widget (card)-level sharing ────────────────────────

  private async resolvePageIdForWidget(widgetId: string): Promise<string> {
    const widget = await this.db.queryOne<{ page_id: string }>(
      `SELECT page_id FROM dashboard_widgets_v2 WHERE id = $1`,
      [widgetId],
    );
    if (!widget) throw new NotFoundException('Card not found');
    return widget.page_id;
  }

  /** Widget-level view access: page-level access first (which itself escalates to dashboard), else a widget-specific share. */
  async canViewWidget(widgetId: string, accountId: string): Promise<boolean> {
    const pageId = await this.resolvePageIdForWidget(widgetId);
    if (await this.canViewPage(pageId, accountId)) return true;
    const share = await this.db.queryOne(
      `SELECT id FROM dashboard_widget_shares WHERE widget_id = $1 AND shared_with = $2`,
      [widgetId, accountId],
    );
    return !!share;
  }

  /** Widget-level edit access: page-level edit first, else a widget-specific edit share. */
  async canEditWidget(widgetId: string, accountId: string): Promise<boolean> {
    const pageId = await this.resolvePageIdForWidget(widgetId);
    if (await this.canEditPage(pageId, accountId)) return true;
    const share = await this.db.queryOne<{ can_edit: boolean }>(
      `SELECT can_edit FROM dashboard_widget_shares WHERE widget_id = $1 AND shared_with = $2`,
      [widgetId, accountId],
    );
    return !!share?.can_edit;
  }

  async requireWidgetAction(widgetId: string, accountId: string, action: 'can_view' | 'can_edit') {
    const ok = action === 'can_view'
      ? await this.canViewWidget(widgetId, accountId)
      : await this.canEditWidget(widgetId, accountId);
    if (!ok) throw new ForbiddenException('You do not have access to this card');
  }

  async listWidgetShares(widgetId: string, requesterId: string): Promise<{ shares: any[]; owner: any }> {
    const pageId = await this.resolvePageIdForWidget(widgetId);
    const dashId = await this.resolveDashIdForPage(pageId);
    await this.requireOwner(dashId, requesterId);

    const dash = await this.db.queryOne<{ created_by: string }>(`SELECT created_by FROM dashboards WHERE id = $1`, [dashId]);
    const owner = await this.db.queryOne<{ id: string; email: string; display_name: string; role: string }>(
      `SELECT id, email, display_name, role FROM accounts WHERE id = $1`,
      [dash!.created_by],
    );

    const shares = await this.db.queryMany<any>(
      `SELECT ws.id, ws.widget_id, ws.shared_with AS account_id,
              ws.can_edit, ws.shared_by, ws.created_at,
              a.email, a.display_name, a.role
       FROM dashboard_widget_shares ws
       JOIN accounts a ON a.id = ws.shared_with
       WHERE ws.widget_id = $1
       ORDER BY ws.created_at ASC`,
      [widgetId],
    );

    return { shares, owner };
  }

  async shareWidgetByEmail(widgetId: string, email: string, canEdit: boolean, grantedByAccountId: string) {
    const pageId = await this.resolvePageIdForWidget(widgetId);
    const dashId = await this.resolveDashIdForPage(pageId);
    await this.requireOwner(dashId, grantedByAccountId);

    const target = await this.db.queryOne<{ id: string; role: string; email: string; display_name: string }>(
      `SELECT id, role, email, display_name FROM accounts WHERE LOWER(email) = LOWER($1) AND is_deleted = FALSE AND status = 'ACTIVE'`,
      [email],
    );
    if (!target) throw new NotFoundException(`No active user found with email "${email}"`);
    if (target.id === grantedByAccountId) {
      throw new BadRequestException('You cannot share a card with yourself');
    }

    const effectiveCanEdit = target.role === 'VIEWER' ? false : canEdit;

    const share = await this.db.queryOne(
      `INSERT INTO dashboard_widget_shares (widget_id, shared_with, can_edit, shared_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (widget_id, shared_with) DO UPDATE
         SET can_edit = EXCLUDED.can_edit, updated_at = NOW()
       RETURNING *`,
      [widgetId, target.id, effectiveCanEdit, grantedByAccountId],
    );

    return { ...share, email: target.email, display_name: target.display_name };
  }

  async updateWidgetShare(widgetId: string, accountId: string, canEdit: boolean, updaterId: string) {
    const pageId = await this.resolvePageIdForWidget(widgetId);
    const dashId = await this.resolveDashIdForPage(pageId);
    await this.requireOwner(dashId, updaterId);

    const target = await this.db.queryOne<{ role: string }>(`SELECT role FROM accounts WHERE id = $1`, [accountId]);
    const effectiveCanEdit = target?.role === 'VIEWER' ? false : canEdit;

    await this.db.query(
      `UPDATE dashboard_widget_shares SET can_edit = $3, updated_at = NOW() WHERE widget_id = $1 AND shared_with = $2`,
      [widgetId, accountId, effectiveCanEdit],
    );
  }

  async revokeWidgetAccess(widgetId: string, targetAccountId: string, revokerId: string) {
    const pageId = await this.resolvePageIdForWidget(widgetId);
    const dashId = await this.resolveDashIdForPage(pageId);
    await this.requireOwner(dashId, revokerId);
    await this.db.query(
      `DELETE FROM dashboard_widget_shares WHERE widget_id = $1 AND shared_with = $2`,
      [widgetId, targetAccountId],
    );
  }

  /**
   * Legacy helper kept for backward compatibility with any existing callers
   * that use requireAction. Redirects to owner check or edit check.
   */
  async requireAction(dashId: string, accountId: string, action: 'can_view' | 'can_edit' | 'can_publish' | 'can_delete') {
    const dash = await this.db.queryOne<{ created_by: string }>(
      `SELECT created_by FROM dashboards WHERE id = $1 AND deleted_at IS NULL`,
      [dashId],
    );
    if (!dash) throw new NotFoundException('Dashboard not found');
    if (dash.created_by === accountId) return; // Owner always has full access

    if (action === 'can_view') {
      const share = await this.db.queryOne(
        `SELECT id FROM dashboard_shares WHERE dashboard_id = $1 AND shared_with = $2`,
        [dashId, accountId],
      );
      if (share) return;

      // Admins may view ANY published dashboard, even without an explicit share —
      // this backs the "Admin sees all published dashboards" visibility rule and
      // covers every view path (get/pages/widgets/execute) that funnels here.
      const acct = await this.db.queryOne<{ role: string }>(
        `SELECT role FROM accounts WHERE id = $1`,
        [accountId],
      );
      if (acct?.role === 'ADMIN') {
        const published = await this.db.queryOne(
          `SELECT 1 FROM dashboards WHERE id = $1 AND status = 'published' AND deleted_at IS NULL`,
          [dashId],
        );
        if (published) return;
      }

      throw new ForbiddenException('You do not have access to this dashboard');
    }

    // For edit/publish/delete — require can_edit
    const share = await this.db.queryOne<{ can_edit: boolean }>(
      `SELECT can_edit FROM dashboard_shares WHERE dashboard_id = $1 AND shared_with = $2`,
      [dashId, accountId],
    );
    if (!share?.can_edit) throw new ForbiddenException('Action not permitted on this dashboard');
  }
}
