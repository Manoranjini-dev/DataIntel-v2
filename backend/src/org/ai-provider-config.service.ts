// ──────────────────────────────────────────────
// AI Provider Config Service — Manage Org-level AI Overrides
// ──────────────────────────────────────────────

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OrgPermissionsService } from './org-permissions.service';
import { SafeAccount } from '../auth/auth.service';
import { encrypt } from '../common/utils/encryption';

export interface AiProviderConfigDto {
  providerName: 'openrouter' | 'cerebras' | 'anthropic' | 'openai';
  modelName: string;
  apiKey: string;
  apiBaseUrl?: string;
}

@Injectable()
export class AiProviderConfigService {
  private readonly encKey: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orgPermissions: OrgPermissionsService,
    private readonly config: ConfigService,
  ) {
    this.encKey = this.config.getOrThrow('CREDENTIAL_ENCRYPTION_KEY');
  }

  /** Get the configured AI provider for an org (if any) */
  async getConfig(orgId: string, requester: SafeAccount) {
    await this.orgPermissions.requireRole(orgId, requester.id, 'admin');

    const config = await this.db.queryOne(
      `SELECT provider_name, model_name, api_key_encrypted, api_base_url
       FROM ai_provider_configs
       WHERE org_id = $1`,
      [orgId]
    );

    if (!config) return null;

    return {
      providerName: config.provider_name,
      modelName: config.model_name,
      apiBaseUrl: config.api_base_url,
      hasApiKey: !!config.api_key_encrypted, // Never return the actual key
    };
  }

  /** Upsert AI provider config */
  async upsertConfig(orgId: string, requester: SafeAccount, dto: AiProviderConfigDto) {
    await this.orgPermissions.requireRole(orgId, requester.id, 'admin');

    const apiKeyEncrypted = encrypt(dto.apiKey, this.encKey);

    const config = await this.db.queryOne(
      `INSERT INTO ai_provider_configs (org_id, provider_name, model_name, api_key_encrypted, api_base_url, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (org_id) DO UPDATE SET
         provider_name = EXCLUDED.provider_name,
         model_name = EXCLUDED.model_name,
         api_key_encrypted = COALESCE(EXCLUDED.api_key_encrypted, ai_provider_configs.api_key_encrypted),
         api_base_url = EXCLUDED.api_base_url,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING *`,
      [orgId, dto.providerName, dto.modelName, apiKeyEncrypted, dto.apiBaseUrl || null, requester.id]
    );

    await this.audit.log({
      orgId, accountId: requester.id,
      eventType: 'ai_provider_config_updated' as any, resourceType: 'org', resourceId: orgId,
      details: { providerName: dto.providerName, modelName: dto.modelName }
    });

    return { success: true };
  }

  /** Delete AI config, reverting to system default */
  async deleteConfig(orgId: string, requester: SafeAccount) {
    await this.orgPermissions.requireRole(orgId, requester.id, 'admin');
    await this.db.query(`DELETE FROM ai_provider_configs WHERE org_id = $1`, [orgId]);
    
    await this.audit.log({
      orgId, accountId: requester.id,
      eventType: 'ai_provider_config_deleted' as any, resourceType: 'org', resourceId: orgId,
    });

    return { success: true };
  }
}
