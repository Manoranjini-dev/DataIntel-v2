// ──────────────────────────────────────────────
// Connection Permissions Service
// Simple, user-based sharing for datasource connections.
//
// Access model (no organization roles involved):
//   • Owner   — the account in datasource_connections.created_by.
//               Has full control: view, edit, manage (share/revoke/delete).
//   • Granted — a user the owner explicitly shared the connection with,
//               at 'view' (read-only) or 'edit' access level.
// ──────────────────────────────────────────────

import { Injectable, Logger, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { SafeAccount } from '../auth/auth.service';
import { ConnectionAccessLevel } from './dto/persistent-connection.dto';

export type ConnectionAccess = 'owner' | 'edit' | 'view';
export type ConnectionAction = 'view' | 'edit' | 'manage';

@Injectable()
export class ConnectionPermissionsService {
  private readonly logger = new Logger(ConnectionPermissionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resolve the access level a user has on a connection, or null if none.
   * The connection owner (created_by) always resolves to 'owner'. Platform
   * Admins also resolve to 'owner' on every connection — Admin always
   * overrides ownership restrictions, regardless of who created it.
   */
  async getAccessLevel(connId: string, accountId: string): Promise<ConnectionAccess | null> {
    const conn = await this.db.queryOne<{ created_by: string }>(
      'SELECT created_by FROM datasource_connections WHERE id = $1 AND deleted_at IS NULL',
      [connId],
    );
    if (!conn) throw new NotFoundException('Connection not found');
    if (conn.created_by === accountId) return 'owner';

    const account = await this.db.queryOne<{ role: string }>(
      'SELECT role FROM accounts WHERE id = $1',
      [accountId],
    );
    if (account?.role === 'ADMIN') return 'owner';

    const grant = await this.db.queryOne<{ can_view: boolean; can_edit: boolean }>(
      `SELECT can_view, can_edit FROM datasource_permissions
       WHERE connection_id = $1 AND account_id = $2
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [connId, accountId],
    );
    if (!grant) return null;
    if (grant.can_edit) return 'edit';
    if (grant.can_view) return 'view';
    return null;
  }

  /**
   * Authorize an action against a connection.
   *   • 'view'   — owner or any granted user.
   *   • 'edit'   — owner or a user granted edit access.
   *   • 'manage' — owner only (share/revoke/delete/rotate).
   */
  async requireAction(connId: string, accountId: string, action: ConnectionAction): Promise<void> {
    const level = await this.getAccessLevel(connId, accountId);
    if (!level) throw new ForbiddenException('You do not have access to this connection');

    if (action === 'view') return;
    if (action === 'edit' && (level === 'owner' || level === 'edit')) return;
    if (action === 'manage' && level === 'owner') return;

    throw new ForbiddenException('You do not have permission to perform this action on this connection');
  }

  /** Share a connection with a user by email, at view or edit level (owner only) */
  async shareByEmail(
    connId: string,
    granter: SafeAccount,
    email: string,
    accessLevel: ConnectionAccessLevel,
    expiresAt?: string,
  ) {
    await this.requireAction(connId, granter.id, 'manage');

    const target = await this.db.queryOne<{ id: string; role: string }>(
      'SELECT id, role FROM accounts WHERE email = $1',
      [email.toLowerCase()],
    );
    if (!target) throw new NotFoundException(`No account found for email: ${email}`);
    if (target.id === granter.id) throw new ConflictException('You cannot share a connection with yourself');
    if (target.role === 'VIEWER') {
      throw new ForbiddenException('Data sources cannot be shared with a Viewer');
    }

    const canEdit = accessLevel === 'edit';

    const grant = await this.db.queryOne(
      `INSERT INTO datasource_permissions
         (connection_id, account_id, can_view, can_edit, granted_by, expires_at)
       VALUES ($1, $2, TRUE, $3, $4, $5)
       ON CONFLICT (connection_id, account_id) DO UPDATE SET
         can_view   = TRUE,
         can_edit   = EXCLUDED.can_edit,
         granted_by = EXCLUDED.granted_by,
         expires_at = EXCLUDED.expires_at,
         created_at = NOW()
       RETURNING *`,
      [connId, target.id, canEdit, granter.id, expiresAt || null],
    );

    await this.audit.log({
      accountId: granter.id,
      eventType: 'connection_shared',
      resourceType: 'connection', resourceId: connId,
      details: { sharedWithEmail: email, sharedWithAccountId: target.id, accessLevel },
    });

    return grant;
  }

  /** Update an existing share's access level (owner only) */
  async updateShare(
    connId: string,
    updater: SafeAccount,
    targetAccountId: string,
    accessLevel: ConnectionAccessLevel,
    expiresAt?: string,
  ) {
    await this.requireAction(connId, updater.id, 'manage');

    const target = await this.db.queryOne<{ role: string }>(
      'SELECT role FROM accounts WHERE id = $1',
      [targetAccountId],
    );
    if (target?.role === 'VIEWER') {
      throw new ForbiddenException('Data sources cannot be shared with a Viewer');
    }

    const grant = await this.db.queryOne(
      `UPDATE datasource_permissions
       SET can_edit = $3, expires_at = $4
       WHERE connection_id = $1 AND account_id = $2
       RETURNING *`,
      [connId, targetAccountId, accessLevel === 'edit', expiresAt || null],
    );
    if (!grant) throw new NotFoundException('Share not found for this account');

    await this.audit.log({
      accountId: updater.id,
      eventType: 'connection_shared',
      resourceType: 'connection', resourceId: connId,
      details: { sharedWithAccountId: targetAccountId, accessLevel },
    });

    return grant;
  }

  /**
   * Search accounts a connection can be shared with — Admins and Analysts
   * only (Viewers can never receive direct access). Excludes the caller.
   * Used by the Share dialog's "search users" field; intentionally not
   * gated behind the Admin-only user-management endpoints so any owner
   * (Admin or Analyst) can find share recipients.
   */
  async searchShareTargets(query: string, excludeAccountId: string) {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    return this.db.queryMany<{ id: string; email: string; display_name: string; role: string }>(
      `SELECT id, email, display_name, role
       FROM accounts
       WHERE role IN ('ADMIN', 'ANALYST')
         AND is_deleted = FALSE
         AND status = 'ACTIVE'
         AND id != $1
         AND (email ILIKE $2 OR display_name ILIKE $2)
       ORDER BY display_name ASC
       LIMIT 10`,
      [excludeAccountId, `%${trimmed}%`],
    );
  }

  /** List all active shares for a connection (owner only) */
  async listShares(connId: string, accountId: string) {
    await this.requireAction(connId, accountId, 'manage');

    return this.db.queryMany(
      `SELECT p.id, p.account_id, p.can_view, p.can_edit,
              p.granted_by, p.created_at, p.expires_at,
              a.email, a.display_name
       FROM datasource_permissions p
       JOIN accounts a ON a.id = p.account_id
       WHERE p.connection_id = $1
       ORDER BY p.created_at DESC`,
      [connId],
    );
  }

  /** Revoke a previously granted share (owner only) */
  async revokeShare(connId: string, revoker: SafeAccount, targetAccountId: string) {
    await this.requireAction(connId, revoker.id, 'manage');

    const result = await this.db.query(
      'DELETE FROM datasource_permissions WHERE connection_id = $1 AND account_id = $2',
      [connId, targetAccountId],
    );
    if (result.rowCount === 0) throw new NotFoundException('Share not found for this account');

    await this.audit.log({
      accountId: revoker.id,
      eventType: 'connection_share_revoked',
      resourceType: 'connection', resourceId: connId,
      details: { revokedAccountId: targetAccountId },
    });
  }

  /**
   * Let a user who a connection was shared with remove it from their own
   * workspace. This only deletes *their* grant — it never touches the
   * connection, the owner's access, or any other grantee's access.
   */
  async leaveSharedConnection(connId: string, accountId: string): Promise<void> {
    const conn = await this.db.queryOne<{ created_by: string }>(
      'SELECT created_by FROM datasource_connections WHERE id = $1 AND deleted_at IS NULL',
      [connId],
    );
    if (!conn) throw new NotFoundException('Connection not found');
    if (conn.created_by === accountId) {
      throw new ForbiddenException('Owners cannot remove themselves from their own connection — delete it instead');
    }

    const result = await this.db.query(
      'DELETE FROM datasource_permissions WHERE connection_id = $1 AND account_id = $2',
      [connId, accountId],
    );
    if (result.rowCount === 0) throw new NotFoundException('This connection is not shared with you');

    await this.audit.log({
      accountId,
      eventType: 'connection_share_revoked',
      resourceType: 'connection', resourceId: connId,
      details: { selfRemoved: true },
    });
  }
}
