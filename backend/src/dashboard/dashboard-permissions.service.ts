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

  /** List all active shares for a dashboard (owner only) */
  async listShares(dashId: string, requesterId: string) {
    await this.requireOwner(dashId, requesterId);
    return this.db.queryMany(
      `SELECT ds.id, ds.dashboard_id, ds.shared_with AS account_id,
              ds.can_edit, ds.shared_by, ds.created_at,
              a.email, a.display_name
       FROM dashboard_shares ds
       JOIN accounts a ON a.id = ds.shared_with
       WHERE ds.dashboard_id = $1
       ORDER BY ds.created_at ASC`,
      [dashId],
    );
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
      if (!share) throw new ForbiddenException('You do not have access to this dashboard');
      return;
    }

    // For edit/publish/delete — require can_edit
    const share = await this.db.queryOne<{ can_edit: boolean }>(
      `SELECT can_edit FROM dashboard_shares WHERE dashboard_id = $1 AND shared_with = $2`,
      [dashId, accountId],
    );
    if (!share?.can_edit) throw new ForbiddenException('Action not permitted on this dashboard');
  }
}
