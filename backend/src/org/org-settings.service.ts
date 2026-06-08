// ──────────────────────────────────────────────
// OrgSettingsService — Organization-level configuration
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OrgPermissionsService } from './org-permissions.service';
import { SafeAccount } from '../auth/auth.service';
import { CacheService } from '../cache/cache.service';

export interface OrgSettingsData {
  default_query_mode?: 'auto' | 'manual';
  query_approval_required?: boolean;
  max_query_rows?: number;
  query_timeout_ms?: number;
  dashboard_defaults?: Record<string, unknown>;
  cache_ttl_sec?: number;
  widget_cache_ttl_sec?: number;
  retention_days?: number;
  ai_config?: Record<string, unknown>;
  feature_flags?: Record<string, unknown>;
  max_connections?: number;
  max_combos?: number;
  max_dashboards?: number;
  max_cards?: number;
}

@Injectable()
export class OrgSettingsService {
  private readonly logger = new Logger(OrgSettingsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orgPermissions: OrgPermissionsService,
    private readonly cache: CacheService,
  ) {}

  async get(orgId: string, requesterId: string) {
    await this.orgPermissions.requireMember(orgId, requesterId);
    return this.db.queryOne(
      `SELECT * FROM org_settings WHERE org_id = $1`,
      [orgId],
    );
  }

  async update(orgId: string, updater: SafeAccount, data: OrgSettingsData) {
    await this.orgPermissions.requireRole(orgId, updater.id, 'admin');

    const result = await this.db.queryOne(
      `UPDATE org_settings
       SET
         default_query_mode       = COALESCE($2, default_query_mode),
         query_approval_required  = COALESCE($3, query_approval_required),
         max_query_rows           = COALESCE($4, max_query_rows),
         query_timeout_ms         = COALESCE($5, query_timeout_ms),
         dashboard_defaults       = CASE WHEN $6::jsonb IS NULL THEN dashboard_defaults ELSE $6::jsonb END,
         cache_ttl_sec            = COALESCE($7, cache_ttl_sec),
         widget_cache_ttl_sec     = COALESCE($8, widget_cache_ttl_sec),
         retention_days           = COALESCE($9, retention_days),
         ai_config                = CASE WHEN $10::jsonb IS NULL THEN ai_config ELSE $10::jsonb END,
         feature_flags            = CASE WHEN $11::jsonb IS NULL THEN feature_flags ELSE $11::jsonb END,
         max_connections          = COALESCE($12, max_connections),
         max_combos               = COALESCE($13, max_combos),
         max_dashboards           = COALESCE($14, max_dashboards),
         max_cards                = COALESCE($15, max_cards),
         updated_at               = NOW(),
         updated_by               = $16
       WHERE org_id = $1
       RETURNING *`,
      [
        orgId,
        data.default_query_mode || null,
        data.query_approval_required ?? null,
        data.max_query_rows || null,
        data.query_timeout_ms || null,
        data.dashboard_defaults ? JSON.stringify(data.dashboard_defaults) : null,
        data.cache_ttl_sec || null,
        data.widget_cache_ttl_sec || null,
        data.retention_days || null,
        data.ai_config ? JSON.stringify(data.ai_config) : null,
        data.feature_flags ? JSON.stringify(data.feature_flags) : null,
        data.max_connections || null,
        data.max_combos || null,
        data.max_dashboards || null,
        data.max_cards || null,
        updater.id,
      ],
    );

    // Bust the org settings cache if we stored one
    await this.cache.del(`di:org:settings:${orgId}`);

    await this.audit.log({
      orgId,
      accountId: updater.id,
      eventType: 'org_updated',
      resourceType: 'org_settings',
      resourceId: orgId,
      details: data as Record<string, unknown>,
    });

    return result;
  }

  /**
   * Get feature flag value for an org.
   * Checks org_settings.feature_flags first, then falls back to global defaults.
   */
  async getFeatureFlag(orgId: string, flag: string): Promise<boolean> {
    const cacheKey = `di:org:settings:${orgId}`;
    let settings = await this.cache.getJson<{ feature_flags?: Record<string, boolean> }>(cacheKey);

    if (!settings) {
      settings = await this.db.queryOne<{ feature_flags: Record<string, boolean> }>(
        `SELECT feature_flags FROM org_settings WHERE org_id = $1`,
        [orgId],
      );
      if (settings) await this.cache.setJson(cacheKey, settings, 300);
    }

    return settings?.feature_flags?.[flag] ?? false;
  }
}
