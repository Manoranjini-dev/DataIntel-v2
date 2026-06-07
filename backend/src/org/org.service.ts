// ──────────────────────────────────────────────
// Org Service — Organization CRUD & Membership
// ──────────────────────────────────────────────

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { SafeAccount } from '../auth/auth.service';

export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

@Injectable()
export class OrgService {
  private readonly logger = new Logger(OrgService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Get all orgs the user is a member of */
  async listForUser(accountId: string) {
    return this.db.queryMany(
      `SELECT o.*, om.role AS member_role
       FROM organizations o
       JOIN org_members om ON om.org_id = o.id
       WHERE om.account_id = $1
       ORDER BY o.created_at DESC`,
      [accountId],
    );
  }

  /** Create an org (auto-adds creator as owner) */
  async create(
    user: SafeAccount,
    data: { name: string; slug: string; description?: string },
  ) {
    // Check slug uniqueness
    const existing = await this.db.queryOne(
      'SELECT id FROM organizations WHERE slug = $1',
      [data.slug],
    );
    if (existing) {
      throw new ConflictException(`Slug "${data.slug}" is already taken`);
    }

    const org = await this.db.transaction(async (query) => {
      // Create org
      const orgResult = await query(
        `INSERT INTO organizations (name, slug, description, owner_id, hierarchy_path)
         VALUES ($1, $2, $3, $4, text2ltree(regexp_replace($2, '[^a-zA-Z0-9]', '_', 'g'))) RETURNING *`,
        [data.name, data.slug, data.description || null, user.id],
      );
      const org = orgResult.rows[0];

      // Add creator as owner member
      await query(
        `INSERT INTO org_members (org_id, account_id, role, invited_by)
         VALUES ($1, $2, 'owner', $2)`,
        [org.id, user.id],
      );

      return org;
    });

    await this.audit.log({
      orgId: org.id,
      accountId: user.id,
      eventType: 'org_created',
      resourceType: 'org',
      resourceId: org.id,
      details: { name: org.name, slug: org.slug },
    });

    return org;
  }

  /** Get org by slug — throws if not member */
  async getBySlug(slug: string, accountId: string) {
    const org = await this.db.queryOne(
      `SELECT o.*, om.role AS member_role
       FROM organizations o
       JOIN org_members om ON om.org_id = o.id AND om.account_id = $2
       WHERE o.slug = $1`,
      [slug, accountId],
    );
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  /** Get org by ID — throws if not member */
  async getById(id: string, accountId: string) {
    const org = await this.db.queryOne(
      `SELECT o.*, om.role AS member_role
       FROM organizations o
       JOIN org_members om ON om.org_id = o.id AND om.account_id = $2
       WHERE o.id = $1`,
      [id, accountId],
    );
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  /** Update org — requires admin+ */
  async update(
    orgId: string,
    user: SafeAccount,
    data: { name?: string; description?: string },
  ) {
    await this.requireRole(orgId, user.id, 'admin');

    const org = await this.db.queryOne(
      `UPDATE organizations
       SET name = COALESCE($2, name),
           description = COALESCE($3, description),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [orgId, data.name || null, data.description || null],
    );

    await this.audit.log({
      orgId,
      accountId: user.id,
      eventType: 'org_updated',
      resourceType: 'org',
      resourceId: orgId,
      details: data,
    });

    return org;
  }

  /** List org members */
  async listMembers(orgId: string, requesterId: string) {
    await this.requireMember(orgId, requesterId);
    return this.db.queryMany(
      `SELECT om.*, a.email, a.display_name, a.avatar_url
       FROM org_members om
       JOIN accounts a ON a.id = om.account_id
       WHERE om.org_id = $1
       ORDER BY om.joined_at ASC`,
      [orgId],
    );
  }

  /** Invite a member by email */
  async inviteMember(
    orgId: string,
    inviter: SafeAccount,
    email: string,
    role: OrgRole,
  ) {
    await this.requireRole(orgId, inviter.id, 'admin');

    const account = await this.db.queryOne(
      'SELECT id FROM accounts WHERE email = $1',
      [email.toLowerCase()],
    );
    if (!account) {
      throw new NotFoundException(`No account found for email: ${email}`);
    }

    // Check not already a member
    const existing = await this.db.queryOne(
      'SELECT id FROM org_members WHERE org_id = $1 AND account_id = $2',
      [orgId, account.id],
    );
    if (existing) {
      throw new ConflictException('User is already a member');
    }

    const member = await this.db.queryOne(
      `INSERT INTO org_members (org_id, account_id, role, invited_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [orgId, account.id, role, inviter.id],
    );

    await this.audit.log({
      orgId,
      accountId: inviter.id,
      eventType: 'member_invited',
      resourceType: 'org_member',
      resourceId: member!.id,
      details: { email, role },
    });

    return member;
  }

  /** Remove a member */
  async removeMember(orgId: string, remover: SafeAccount, targetAccountId: string) {
    await this.requireRole(orgId, remover.id, 'admin');

    // Can't remove owner
    const target = await this.db.queryOne(
      'SELECT role FROM org_members WHERE org_id = $1 AND account_id = $2',
      [orgId, targetAccountId],
    );
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'owner') throw new ForbiddenException('Cannot remove the org owner');

    await this.db.query(
      'DELETE FROM org_members WHERE org_id = $1 AND account_id = $2',
      [orgId, targetAccountId],
    );

    await this.audit.log({
      orgId,
      accountId: remover.id,
      eventType: 'member_removed',
      resourceType: 'org_member',
      details: { removedAccountId: targetAccountId },
    });
  }

  /** Change a member's role */
  async changeMemberRole(
    orgId: string,
    changer: SafeAccount,
    targetAccountId: string,
    newRole: OrgRole,
  ) {
    await this.requireRole(orgId, changer.id, 'admin');

    const target = await this.db.queryOne(
      'SELECT role FROM org_members WHERE org_id = $1 AND account_id = $2',
      [orgId, targetAccountId],
    );
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'owner') throw new ForbiddenException('Cannot change owner role');

    await this.db.query(
      'UPDATE org_members SET role = $3 WHERE org_id = $1 AND account_id = $2',
      [orgId, targetAccountId, newRole],
    );

    await this.audit.log({
      orgId,
      accountId: changer.id,
      eventType: 'member_role_changed',
      details: { targetAccountId, newRole },
    });
  }

  // ── Helpers ────────────────────────────────

  async getMemberRole(orgId: string, accountId: string): Promise<OrgRole | null> {
    const row = await this.db.queryOne<{ role: OrgRole }>(
      'SELECT role FROM org_members WHERE org_id = $1 AND account_id = $2',
      [orgId, accountId],
    );
    return row?.role || null;
  }

  async requireMember(orgId: string, accountId: string): Promise<OrgRole> {
    const role = await this.getMemberRole(orgId, accountId);
    if (!role) throw new ForbiddenException('You are not a member of this organization');
    return role;
  }

  async requireRole(orgId: string, accountId: string, minRole: OrgRole): Promise<void> {
    const role = await this.getMemberRole(orgId, accountId);
    if (!role) throw new ForbiddenException('You are not a member of this organization');
    if (ROLE_HIERARCHY[role] < ROLE_HIERARCHY[minRole]) {
      throw new ForbiddenException(`This action requires ${minRole} role or higher`);
    }
  }
}
