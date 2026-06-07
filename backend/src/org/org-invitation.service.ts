// ──────────────────────────────────────────────
// OrgInvitationService — Token-based email invite flow
// ──────────────────────────────────────────────

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OrgPermissionsService, OrgRole } from './org-permissions.service';
import { SafeAccount } from '../auth/auth.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

const INVITATION_EXPIRY_DAYS = 7;

@Injectable()
export class OrgInvitationService {
  private readonly logger = new Logger(OrgInvitationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orgPermissions: OrgPermissionsService,
    private readonly events: EventEmitter2,
  ) {}

  /** Create and send an invitation. Requires admin+ in the org. */
  async invite(
    orgId: string,
    inviter: SafeAccount,
    email: string,
    role: OrgRole,
    message?: string,
  ) {
    await this.orgPermissions.requireRole(orgId, inviter.id, 'admin');

    const org = await this.db.queryOne<{ name: string }>(
      `SELECT name FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
      [orgId],
    );
    if (!org) throw new NotFoundException('Organization not found');

    // Reject if already a member
    const alreadyMember = await this.db.queryOne(
      `SELECT g.id FROM org_role_grants g
       JOIN accounts a ON a.id = g.account_id
       WHERE g.org_id = $1 AND a.email = $2 AND g.revoked_at IS NULL`,
      [orgId, email.toLowerCase()],
    );
    if (alreadyMember) throw new ConflictException('User is already a member of this organization');

    // Revoke any existing pending invitation for this email+org
    await this.db.query(
      `UPDATE org_invitations
       SET revoked_at = NOW()
       WHERE org_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [orgId, email.toLowerCase()],
    );

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 3600 * 1000);

    const invitation = await this.db.queryOne(
      `INSERT INTO org_invitations (org_id, email, role, invited_by, token, expires_at, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [orgId, email.toLowerCase(), role, inviter.id, token, expiresAt, message || null],
    );

    // Emit event for the notifications worker to pick up (sends email)
    this.events.emit('invitation.created', {
      invitationId: invitation!.id,
      orgName: org.name,
      email,
      role,
      token,
      inviterName: inviter.displayName,
      expiresAt,
    });

    await this.audit.log({
      orgId,
      accountId: inviter.id,
      eventType: 'org_invitation_sent',
      resourceType: 'org_invitation',
      resourceId: invitation!.id,
      details: { email, role },
    });

    return invitation;
  }

  /** Accept invitation by token — creates org_role_grant */
  async accept(token: string, user: SafeAccount) {
    const invitation = await this.db.queryOne<{
      id: string;
      org_id: string;
      email: string;
      role: OrgRole;
      expires_at: Date;
      accepted_at: Date | null;
      revoked_at: Date | null;
    }>(
      `SELECT * FROM org_invitations WHERE token = $1`,
      [token],
    );

    if (!invitation) throw new NotFoundException('Invitation not found or already used');

    if (invitation.accepted_at) throw new ConflictException('Invitation already accepted');
    if (invitation.revoked_at) throw new ConflictException('Invitation has been revoked');
    if (new Date(invitation.expires_at) < new Date()) {
      throw new ConflictException('Invitation has expired');
    }

    // Email must match
    if (invitation.email !== user.email.toLowerCase()) {
      throw new ConflictException('This invitation was sent to a different email address');
    }

    await this.db.transaction(async (query) => {
      // Mark invitation as accepted
      await query(
        `UPDATE org_invitations SET accepted_at = NOW(), accepted_by = $2 WHERE id = $1`,
        [invitation.id, user.id],
      );

      // Create role grant (upsert in case they somehow got one in the meantime)
      await query(
        `INSERT INTO org_role_grants (org_id, account_id, role, granted_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, account_id) DO UPDATE SET role = EXCLUDED.role, revoked_at = NULL`,
        [invitation.org_id, user.id, invitation.role, invitation.id],
      );
    });

    // Invalidate permission cache for this user+org
    await this.orgPermissions.invalidateCache(invitation.org_id, user.id);

    await this.audit.log({
      orgId: invitation.org_id,
      accountId: user.id,
      eventType: 'org_invitation_accepted',
      resourceType: 'org_invitation',
      resourceId: invitation.id,
      details: { role: invitation.role },
    });

    return { orgId: invitation.org_id, role: invitation.role };
  }

  /** Revoke a pending invitation */
  async revoke(orgId: string, invitationId: string, revoker: SafeAccount) {
    await this.orgPermissions.requireRole(orgId, revoker.id, 'admin');

    const result = await this.db.query(
      `UPDATE org_invitations
       SET revoked_at = NOW(), revoked_by = $2
       WHERE id = $1 AND org_id = $3 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [invitationId, revoker.id, orgId],
    );

    if (result.rowCount === 0) {
      throw new NotFoundException('Invitation not found or already used');
    }

    await this.audit.log({
      orgId,
      accountId: revoker.id,
      eventType: 'org_invitation_revoked',
      resourceType: 'org_invitation',
      resourceId: invitationId,
    });
  }

  /** List pending invitations for an org */
  async listPending(orgId: string, requesterId: string) {
    await this.orgPermissions.requireRole(orgId, requesterId, 'admin');
    return this.db.queryMany(
      `SELECT i.*, a.display_name AS inviter_name, a.email AS inviter_email
       FROM org_invitations i
       JOIN accounts a ON a.id = i.invited_by
       WHERE i.org_id = $1
         AND i.accepted_at IS NULL
         AND i.revoked_at IS NULL
         AND i.expires_at > NOW()
       ORDER BY i.created_at DESC`,
      [orgId],
    );
  }
}
