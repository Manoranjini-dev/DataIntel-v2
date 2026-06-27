// ──────────────────────────────────────────────
// Dashboard Permissions Service
// Simple, user-based sharing for dashboards — mirrors
// ConnectionPermissionsService. The dashboard owner
// (dashboards.created_by) has full control and may grant other users
// view, edit, publish, or delete access.
// ──────────────────────────────────────────────

import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type DashboardAccess = 'owner' | 'edit' | 'view';
export type DashboardAction = 'can_view' | 'can_edit' | 'can_publish' | 'can_delete';

@Injectable()
export class DashboardPermissionsService {
  private readonly logger = new Logger(DashboardPermissionsService.name);

  constructor(
    private readonly db: DatabaseService,
  ) {}

  /** Grant access to a specific account */
  async grantAccountAccess(
    dashId: string, targetAccountId: string,
    permissions: { canView?: boolean; canEdit?: boolean; canPublish?: boolean; canDelete?: boolean },
    grantedByAccountId: string,
  ) {
    await this.requireAction(dashId, grantedByAccountId, 'can_delete');

    return this.db.queryOne(
      `INSERT INTO dashboard_permissions
         (dashboard_id, account_id, can_view, can_edit, can_publish, can_delete, granted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [dashId, targetAccountId, permissions.canView ?? true, permissions.canEdit ?? false,
       permissions.canPublish ?? false, permissions.canDelete ?? false, grantedByAccountId],
    );
  }

  /** Revoke a previously granted share */
  async revokeAccess(dashId: string, targetAccountId: string, revokerId: string) {
    await this.requireAction(dashId, revokerId, 'can_delete');
    await this.db.query(
      `DELETE FROM dashboard_permissions WHERE dashboard_id = $1 AND account_id = $2`,
      [dashId, targetAccountId],
    );
  }

  /** List all active shares for a dashboard (owner only) */
  async listShares(dashId: string, requesterId: string) {
    await this.requireAction(dashId, requesterId, 'can_delete');
    return this.db.queryMany(
      `SELECT p.*, a.email, a.display_name
       FROM dashboard_permissions p
       JOIN accounts a ON a.id = p.account_id
       WHERE p.dashboard_id = $1
       ORDER BY p.created_at DESC`,
      [dashId],
    );
  }

  /**
   * Check if a user can perform an action on a dashboard.
   *   • Owner (dashboards.created_by) always has full access.
   *   • Otherwise, an explicit grant in dashboard_permissions must allow it.
   */
  async requireAction(dashId: string, accountId: string, action: DashboardAction) {
    const dash = await this.db.queryOne<{ created_by: string }>(
      `SELECT created_by FROM dashboards WHERE id = $1 AND deleted_at IS NULL`,
      [dashId],
    );
    if (!dash) throw new NotFoundException('Dashboard not found');
    if (dash.created_by === accountId) return; // Owner always has full access

    const perms = await this.db.queryMany<any>(
      `SELECT * FROM dashboard_permissions
       WHERE dashboard_id = $1 AND account_id = $2
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [dashId, accountId],
    );

    const hasAccess = perms.some((p) => p[action] === true);
    if (!hasAccess) {
      throw new ForbiddenException('You do not have permission to perform this action on this dashboard');
    }
  }
}
