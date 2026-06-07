// ──────────────────────────────────────────────
// OrgHierarchyService — Org tree operations using ltree
// ──────────────────────────────────────────────

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OrgPermissionsService } from './org-permissions.service';
import { SafeAccount } from '../auth/auth.service';

const MAX_HIERARCHY_DEPTH = 5; // Soft limit on nesting depth

@Injectable()
export class OrgHierarchyService {
  private readonly logger = new Logger(OrgHierarchyService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orgPermissions: OrgPermissionsService,
  ) {}

  /** Get all direct children of an org */
  async getChildren(orgId: string, requesterId: string) {
    await this.orgPermissions.requireMember(orgId, requesterId);
    return this.db.queryMany(
      `SELECT o.*, og.role AS member_role
       FROM organizations o
       LEFT JOIN org_role_grants og ON og.org_id = o.id AND og.account_id = $2
         AND (og.expires_at IS NULL OR og.expires_at > NOW())
         AND og.revoked_at IS NULL
       WHERE o.parent_org_id = $1
         AND o.deleted_at IS NULL
       ORDER BY o.name`,
      [orgId, requesterId],
    );
  }

  /** Get all ancestors of an org (from root to immediate parent) */
  async getAncestors(orgId: string, requesterId: string) {
    await this.orgPermissions.requireMember(orgId, requesterId);
    return this.db.queryMany(
      `SELECT o.*
       FROM organizations o
       JOIN organizations target ON target.hierarchy_path <@ o.hierarchy_path
       WHERE target.id = $1
         AND o.id != $1
         AND o.deleted_at IS NULL
       ORDER BY o.depth ASC`,
      [orgId],
    );
  }

  /** Get full subtree of an org (all descendants recursively) */
  async getSubtree(orgId: string, requesterId: string) {
    await this.orgPermissions.requireMember(orgId, requesterId);
    return this.db.queryMany(
      `SELECT o.*
       FROM organizations o
       JOIN organizations root ON o.hierarchy_path <@ root.hierarchy_path
       WHERE root.id = $1
         AND o.id != $1
         AND o.deleted_at IS NULL
       ORDER BY o.depth ASC, o.name`,
      [orgId],
    );
  }

  /** Create a child org under a parent org */
  async createChild(
    parentOrgId: string,
    creator: SafeAccount,
    data: { name: string; slug: string; description?: string },
  ) {
    // Creator must be admin+ in parent org
    await this.orgPermissions.requireRole(parentOrgId, creator.id, 'admin');

    // Get parent info for hierarchy_path calculation
    const parent = await this.db.queryOne<{
      id: string;
      hierarchy_path: string;
      depth: number;
    }>(
      `SELECT id, hierarchy_path, depth FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
      [parentOrgId],
    );
    if (!parent) throw new NotFoundException('Parent organization not found');

    // Enforce max depth
    if (parent.depth >= MAX_HIERARCHY_DEPTH) {
      throw new ConflictException(
        `Maximum organization nesting depth of ${MAX_HIERARCHY_DEPTH} reached`,
      );
    }

    // Check slug uniqueness
    const slugTaken = await this.db.queryOne(
      `SELECT id FROM organizations WHERE slug = $1`,
      [data.slug],
    );
    if (slugTaken) throw new ConflictException(`Slug "${data.slug}" is already taken`);

    // Sanitize slug for ltree path segment
    const pathSegment = data.slug.replace(/[^a-zA-Z0-9]/g, '_');
    const newPath = `${parent.hierarchy_path}.${pathSegment}`;

    const org = await this.db.transaction(async (query) => {
      // Create child org
      const result = await query(
        `INSERT INTO organizations
           (name, slug, description, owner_id, parent_org_id, hierarchy_path, depth)
         VALUES ($1, $2, $3, $4, $5, $6::ltree, $7)
         RETURNING *`,
        [
          data.name,
          data.slug,
          data.description || null,
          creator.id,
          parentOrgId,
          newPath,
          parent.depth + 1,
        ],
      );
      const org = result.rows[0];

      // Add creator as owner of child org
      await query(
        `INSERT INTO org_role_grants (org_id, account_id, role, granted_by)
         VALUES ($1, $2, 'owner', $2)`,
        [org.id, creator.id],
      );

      return org;
    });

    // Invalidate hierarchy cache for parent
    await this.orgPermissions.invalidateOrgCache(parentOrgId);

    await this.audit.log({
      orgId: org.id,
      accountId: creator.id,
      eventType: 'org_created',
      resourceType: 'org',
      resourceId: org.id,
      details: { name: org.name, slug: org.slug, parentOrgId },
    });

    return org;
  }

  /** Move an org to a new parent (re-paths entire subtree) */
  async moveOrg(
    orgId: string,
    newParentOrgId: string | null,
    mover: SafeAccount,
  ) {
    await this.orgPermissions.requireRole(orgId, mover.id, 'owner');

    const org = await this.db.queryOne<{ hierarchy_path: string; depth: number }>(
      `SELECT hierarchy_path, depth FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
      [orgId],
    );
    if (!org) throw new NotFoundException('Organization not found');

    let newPath: string;
    let newDepth: number;

    if (newParentOrgId) {
      await this.orgPermissions.requireRole(newParentOrgId, mover.id, 'admin');
      const newParent = await this.db.queryOne<{ hierarchy_path: string; depth: number }>(
        `SELECT hierarchy_path, depth FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
        [newParentOrgId],
      );
      if (!newParent) throw new NotFoundException('New parent organization not found');

      const ownSegment = org.hierarchy_path.split('.').pop();
      newPath = `${newParent.hierarchy_path}.${ownSegment}`;
      newDepth = newParent.depth + 1;
    } else {
      // Move to root
      newPath = org.hierarchy_path.split('.').pop()!;
      newDepth = 0;
    }

    // Update entire subtree paths
    await this.db.query(
      `UPDATE organizations
       SET hierarchy_path = ($2::ltree || subpath(hierarchy_path, nlevel($1::ltree)))::ltree,
           depth = nlevel($2::ltree) + nlevel(hierarchy_path) - nlevel($1::ltree),
           parent_org_id = CASE WHEN id = $3 THEN $4::uuid ELSE parent_org_id END,
           updated_at = NOW()
       WHERE hierarchy_path <@ $1::ltree`,
      [org.hierarchy_path, newPath, orgId, newParentOrgId],
    );

    await this.orgPermissions.invalidateOrgCache(orgId);
  }
}
