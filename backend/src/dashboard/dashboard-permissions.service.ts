// ──────────────────────────────────────────────
// Dashboard Permissions Service
// ──────────────────────────────────────────────

import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OrgPermissionsService } from '../org/org-permissions.service';

@Injectable()
export class DashboardPermissionsService {
  private readonly logger = new Logger(DashboardPermissionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly orgPermissions: OrgPermissionsService,
  ) {}

  /** Grant access to a specific account */
  async grantAccountAccess(
    orgId: string, dashId: string, targetAccountId: string,
    permissions: { canView?: boolean; canEdit?: boolean; canPublish?: boolean; canDelete?: boolean },
    grantedByAccountId: string,
  ) {
    await this.orgPermissions.requireRole(orgId, grantedByAccountId, 'editor');

    return this.db.queryOne(
      `INSERT INTO dashboard_permissions
         (dashboard_id, account_id, can_view, can_edit, can_publish, can_delete, granted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         can_view = EXCLUDED.can_view,
         can_edit = EXCLUDED.can_edit,
         can_publish = EXCLUDED.can_publish,
         can_delete = EXCLUDED.can_delete
       RETURNING *`,
      [dashId, targetAccountId, permissions.canView ?? true, permissions.canEdit ?? false,
       permissions.canPublish ?? false, permissions.canDelete ?? false, grantedByAccountId],
    );
  }

  /** Grant access to a specific organization role */
  async grantRoleAccess(
    orgId: string, dashId: string, role: string,
    permissions: { canView?: boolean; canEdit?: boolean; canPublish?: boolean; canDelete?: boolean },
    grantedByAccountId: string,
  ) {
    await this.orgPermissions.requireRole(orgId, grantedByAccountId, 'editor');

    return this.db.queryOne(
      `INSERT INTO dashboard_permissions
         (dashboard_id, org_role, can_view, can_edit, can_publish, can_delete, granted_by)
       VALUES ($1, $2::org_role, $3, $4, $5, $6, $7)
       RETURNING *`,
      [dashId, role, permissions.canView ?? true, permissions.canEdit ?? false,
       permissions.canPublish ?? false, permissions.canDelete ?? false, grantedByAccountId],
    );
  }

  /** Check if user can perform action on dashboard */
  async requireAction(orgId: string, dashId: string, accountId: string, action: 'can_view' | 'can_edit' | 'can_publish' | 'can_delete') {
    // 1. If user is org admin, allow
    try {
      await this.orgPermissions.requireRole(orgId, accountId, 'admin');
      return; // Admin always has full access
    } catch (e) {
      // Not an admin, check specific permissions
    }

    // 2. Check specific grants
    const perms = await this.db.queryMany(
      `SELECT * FROM dashboard_permissions WHERE dashboard_id = $1 AND (account_id = $2 OR org_role IN (
         SELECT role FROM org_role_grants WHERE org_id = $3 AND account_id = $2
       ))`,
      [dashId, accountId, orgId],
    );

    // If any permission record allows the action, grant access
    const hasAccess = perms.some((p: any) => p[action] === true);
    
    if (!hasAccess) {
      // For backwards compatibility: if no permissions exist for this dashboard, fallback to org role
      // Editor can edit/publish, Viewer can view
      if (perms.length === 0) {
        if (action === 'can_view') return; // Viewers can view
        await this.orgPermissions.requireRole(orgId, accountId, 'editor');
        return;
      }
      throw new ForbiddenException(`You do not have permission to perform this action on this dashboard`);
    }
  }
}
