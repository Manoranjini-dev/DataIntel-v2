// ──────────────────────────────────────────────
// SSO Config Service
// Instance-level provider configuration (ADMIN-managed). Secrets are stored
// encrypted (AES-256-GCM) via the shared credential key.
// ──────────────────────────────────────────────

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { encrypt, decrypt } from '../common/utils/encryption';
import { PlatformRole } from '../auth/auth.service';
import {
  AdminSsoProvider,
  PublicSsoProvider,
  SsoProvider,
  SsoProviderRow,
} from './types';

/** Fields an admin may set when configuring a provider. */
export interface UpsertProviderInput {
  enabled?: boolean;
  displayName?: string;
  config?: Record<string, any>;
  /** New secret in plaintext; omit to keep the existing one, null to clear. */
  secret?: string | null;
  autoProvision?: boolean;
  allowedDomains?: string[];
  defaultRole?: PlatformRole;
}

const VALID_ROLES: PlatformRole[] = ['ADMIN', 'ANALYST', 'VIEWER'];

@Injectable()
export class SsoConfigService {
  private readonly logger = new Logger(SsoConfigService.name);
  private readonly encKey: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {
    this.encKey = this.config.getOrThrow<string>('CREDENTIAL_ENCRYPTION_KEY');
  }

  /** Raw row for a provider (internal use — includes encrypted secret). */
  async getRow(provider: SsoProvider): Promise<SsoProviderRow | null> {
    return this.db.queryOne<SsoProviderRow>(
      'SELECT * FROM sso_providers WHERE provider = $1',
      [provider],
    );
  }

  /** An enabled provider row, or null if disabled/missing. */
  async getEnabledRow(provider: SsoProvider): Promise<SsoProviderRow | null> {
    const row = await this.getRow(provider);
    return row && row.enabled ? row : null;
  }

  /** Decrypt a provider's stored secret (client secret / bind password). */
  getDecryptedSecret(row: SsoProviderRow): string | null {
    if (!row.encrypted_secret) return null;
    return decrypt(row.encrypted_secret, this.encKey);
  }

  /** Providers exposed to the unauthenticated login page (enabled only). */
  async listEnabledPublic(): Promise<PublicSsoProvider[]> {
    const rows = await this.db.queryMany<SsoProviderRow>(
      'SELECT * FROM sso_providers WHERE enabled = true ORDER BY provider',
    );
    return rows.map((r) => ({
      provider: r.provider,
      displayName: r.display_name || r.provider,
      kind: r.provider === 'ldap' ? 'password' : 'redirect',
    }));
  }

  /** Full admin listing — config visible, secret redacted to a boolean. */
  async listAdmin(): Promise<AdminSsoProvider[]> {
    const rows = await this.db.queryMany<SsoProviderRow>(
      'SELECT * FROM sso_providers ORDER BY provider',
    );
    return rows.map((r) => this.toAdmin(r));
  }

  /** Upsert a provider's configuration. */
  async upsert(
    provider: SsoProvider,
    input: UpsertProviderInput,
    adminId: string,
  ): Promise<AdminSsoProvider> {
    const existing = await this.getRow(provider);
    if (!existing) throw new NotFoundException(`Unknown SSO provider: ${provider}`);

    if (input.defaultRole && !VALID_ROLES.includes(input.defaultRole)) {
      throw new NotFoundException(`Invalid default role: ${input.defaultRole}`);
    }

    // Secret: undefined = keep, null/'' = clear, string = (re)encrypt.
    let encryptedSecret: string | null | undefined;
    if (input.secret === undefined) encryptedSecret = undefined;
    else if (!input.secret) encryptedSecret = null;
    else encryptedSecret = encrypt(input.secret, this.encKey);

    const domains = input.allowedDomains?.map((d) => d.trim().toLowerCase()).filter(Boolean);

    const updated = await this.db.queryOne<SsoProviderRow>(
      `UPDATE sso_providers SET
         enabled          = COALESCE($2, enabled),
         display_name     = COALESCE($3, display_name),
         config           = COALESCE($4, config),
         encrypted_secret = CASE WHEN $5::boolean THEN $6 ELSE encrypted_secret END,
         auto_provision   = COALESCE($7, auto_provision),
         allowed_domains  = COALESCE($8, allowed_domains),
         default_role     = COALESCE($9, default_role),
         updated_by       = $10,
         updated_at       = NOW()
       WHERE provider = $1
       RETURNING *`,
      [
        provider,
        input.enabled ?? null,
        input.displayName ?? null,
        input.config ? JSON.stringify(input.config) : null,
        encryptedSecret !== undefined,          // whether to touch the secret column
        encryptedSecret ?? null,
        input.autoProvision ?? null,
        domains ?? null,
        input.defaultRole ?? null,
        adminId,
      ],
    );

    await this.audit.log({
      accountId: adminId,
      eventType: 'sso_provider_configured',
      resourceType: 'sso_provider',
      resourceId: provider,
      details: {
        enabled: updated!.enabled,
        autoProvision: updated!.auto_provision,
        secretChanged: encryptedSecret !== undefined,
      },
    });

    this.logger.log(`SSO provider '${provider}' updated by ${adminId} (enabled=${updated!.enabled})`);
    return this.toAdmin(updated!);
  }

  /** Whether an email is allowed by a provider's domain allowlist (empty = allow any). */
  isEmailDomainAllowed(row: SsoProviderRow, email: string | null): boolean {
    if (!row.allowed_domains || row.allowed_domains.length === 0) return true;
    if (!email) return false;
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return false;
    return row.allowed_domains.map((d) => d.toLowerCase()).includes(domain);
  }

  /** Normalize a stored role string to a valid PlatformRole (defaults to VIEWER). */
  normalizeRole(role: string | null | undefined): PlatformRole {
    const upper = (role || '').toUpperCase();
    return (VALID_ROLES as string[]).includes(upper) ? (upper as PlatformRole) : 'VIEWER';
  }

  private toAdmin(r: SsoProviderRow): AdminSsoProvider {
    return {
      provider: r.provider,
      enabled: r.enabled,
      displayName: r.display_name,
      config: r.config ?? {},
      hasSecret: !!r.encrypted_secret,
      autoProvision: r.auto_provision,
      allowedDomains: r.allowed_domains ?? [],
      defaultRole: this.normalizeRole(r.default_role),
      updatedBy: r.updated_by,
      updatedAt: r.updated_at,
    };
  }
}
