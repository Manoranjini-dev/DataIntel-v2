// ──────────────────────────────────────────────
// OrgPermissionsService — Global, Redis-cached role resolution
// Resolves a user's effective role at a given org, walking the
// ancestor hierarchy to find the highest inherited role.
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RedisService, RedisKeys, RedisTTL } from '../redis/redis.service';

export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

const ALL_ROLES = Object.keys(ROLE_HIERARCHY) as OrgRole[];

@Injectable()
export class OrgPermissionsService {
  private readonly logger = new Logger(OrgPermissionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Returns the user's effective role at the given org.
   * Effective role = MAX role across own org grant + any ancestor org grants.
   * Returns null if the user has no grant at or above this org.
   *
   * Cached in Redis for 5 minutes.
   */
  async getEffectiveRole(orgId: string, accountId: string): Promise<OrgRole | null> {
    // 1. Check Redis cache first
    const cacheKey = RedisKeys.orgPerm(orgId, accountId);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return (cached === 'none' ? null : cached) as OrgRole | null;
    }

    // 2. Query own + inherited grants in one shot using ltree
    const row = await this.db.queryOne<{ max_role: OrgRole | null }>(
      `
      WITH org_path AS (
        SELECT hierarchy_path FROM organizations WHERE id = $1 AND deleted_at IS NULL
      ),
      ancestor_orgs AS (
        SELECT o.id
        FROM organizations o, org_path op
        WHERE o.hierarchy_path @> op.hierarchy_path
          AND o.deleted_at IS NULL
      )
      SELECT
        (
          SELECT role FROM org_role_grants g
          JOIN ancestor_orgs a ON a.id = g.org_id
          WHERE g.account_id = $2
            AND (g.expires_at IS NULL OR g.expires_at > NOW())
            AND g.revoked_at IS NULL
          ORDER BY
            CASE g.role
              WHEN 'owner'  THEN 4
              WHEN 'admin'  THEN 3
              WHEN 'editor' THEN 2
              WHEN 'viewer' THEN 1
            END DESC
          LIMIT 1
        ) AS max_role
      `,
      [orgId, accountId],
    );

    const role = row?.max_role || null;

    // 3. Cache result (cache 'none' sentinel if no grant)
    await this.redis.set(cacheKey, role || 'none', RedisTTL.ORG_PERM);

    return role;
  }

  /**
   * Get all org IDs where the user has at least viewer access.
   * Used for list queries that should return all accessible orgs.
   */
  async getAccessibleOrgIds(accountId: string): Promise<string[]> {
    const rows = await this.db.queryMany<{ org_id: string }>(
      `SELECT DISTINCT org_id FROM org_role_grants
       WHERE account_id = $1
         AND (expires_at IS NULL OR expires_at > NOW())
         AND revoked_at IS NULL`,
      [accountId],
    );
    return rows.map((r) => r.org_id);
  }

  /**
   * Get all descendant org IDs (used when owner of parent org
   * should have implicit access to child orgs).
   */
  async getDescendantOrgIds(orgId: string): Promise<string[]> {
    const cacheKey = RedisKeys.orgHierarchy(orgId);
    const cached = await this.redis.getJson<string[]>(cacheKey);
    if (cached) return cached;

    const rows = await this.db.queryMany<{ id: string }>(
      `SELECT o.id
       FROM organizations o
       JOIN organizations parent ON o.hierarchy_path <@ parent.hierarchy_path
       WHERE parent.id = $1
         AND o.id != $1
         AND o.deleted_at IS NULL`,
      [orgId],
    );

    const ids = rows.map((r) => r.id);
    await this.redis.setJson(cacheKey, ids, RedisTTL.ORG_HIERARCHY);
    return ids;
  }

  /**
   * Require a minimum role — throws ForbiddenException if not met.
   */
  async requireRole(orgId: string, accountId: string, minRole: OrgRole): Promise<OrgRole> {
    const { ForbiddenException } = await import('@nestjs/common');
    const role = await this.getEffectiveRole(orgId, accountId);
    if (!role) throw new ForbiddenException('You are not a member of this organization');
    if (ROLE_HIERARCHY[role] < ROLE_HIERARCHY[minRole]) {
      throw new ForbiddenException(`This action requires the "${minRole}" role or higher`);
    }
    return role;
  }

  /**
   * Require at least viewer (any membership).
   */
  async requireMember(orgId: string, accountId: string): Promise<OrgRole> {
    return this.requireRole(orgId, accountId, 'viewer');
  }

  /**
   * Invalidate cached role for a user+org (call after role change).
   */
  async invalidateCache(orgId: string, accountId: string): Promise<void> {
    await this.redis.del(RedisKeys.orgPerm(orgId, accountId));
  }

  /**
   * Invalidate all cached roles for an org (call after membership change).
   */
  async invalidateOrgCache(orgId: string): Promise<void> {
    await this.redis.delPattern(`di:org-perm:${orgId}:*`);
    await this.redis.del(RedisKeys.orgHierarchy(orgId));
  }

  /**
   * Check if role A is at least role B.
   */
  hasMinRole(userRole: OrgRole, minRole: OrgRole): boolean {
    return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole];
  }
}
