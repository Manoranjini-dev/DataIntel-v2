// ──────────────────────────────────────────────
// SSO Provisioning Service
// Resolves an external identity to a local account:
//   1. existing link (sso_provider + sso_subject)
//   2. existing account by email → link the identity
//   3. JIT-create (only when the provider allows auto-provisioning and the
//      email domain is permitted)
// ──────────────────────────────────────────────

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { AccountRow } from '../auth/auth.service';
import { SsoConfigService } from './sso-config.service';
import { ExternalProfile, SsoProvider } from './types';

@Injectable()
export class SsoProvisioningService {
  private readonly logger = new Logger(SsoProvisioningService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly ssoConfig: SsoConfigService,
  ) {}

  /**
   * Resolve (and if permitted, create) the local account for a verified
   * external identity. Returns the account id; throws UnauthorizedException
   * when no account exists and provisioning is not allowed.
   */
  async resolveOrProvision(
    provider: SsoProvider,
    profile: ExternalProfile,
  ): Promise<string> {
    const email = profile.email?.toLowerCase() ?? null;

    // 1. Existing identity link.
    const linked = await this.db.queryOne<AccountRow>(
      `SELECT * FROM accounts
        WHERE sso_provider = $1 AND sso_subject = $2 AND is_deleted = false`,
      [provider, profile.subject],
    );
    if (linked) {
      this.assertUsable(linked);
      return linked.id;
    }

    // 2. Existing account by email → link this identity to it.
    if (email) {
      const byEmail = await this.db.queryOne<AccountRow>(
        'SELECT * FROM accounts WHERE email = $1 AND is_deleted = false',
        [email],
      );
      if (byEmail) {
        if (byEmail.status === 'PENDING_INVITATION') {
          // Allow SSO login to automatically activate an invited user
          await this.db.query(
            `UPDATE accounts
                SET sso_provider = $1, sso_subject = $2,
                    email_verified = true, 
                    status = 'ACTIVE', is_active = true,
                    invitation_token = NULL, invitation_expires_at = NULL,
                    updated_at = NOW()
              WHERE id = $3`,
            [provider, profile.subject, byEmail.id],
          );
        } else {
          this.assertUsable(byEmail);
          await this.db.query(
            `UPDATE accounts
                SET sso_provider = $1, sso_subject = $2,
                    email_verified = true, updated_at = NOW()
              WHERE id = $3`,
            [provider, profile.subject, byEmail.id],
          );
        }
        await this.audit.log({
          accountId: byEmail.id,
          eventType: 'sso_identity_linked',
          resourceType: 'account',
          resourceId: byEmail.id,
          details: { provider, email },
        });
        return byEmail.id;
      }
    }

    // 3. Just-in-time provisioning (gated by admin config).
    return this.provision(provider, profile, email);
  }

  private async provision(
    provider: SsoProvider,
    profile: ExternalProfile,
    email: string | null,
  ): Promise<string> {
    const row = await this.ssoConfig.getRow(provider);
    if (!row || !row.auto_provision) {
      throw new UnauthorizedException(
        'No account is provisioned for this identity. Contact your administrator.',
      );
    }
    if (!email) {
      throw new UnauthorizedException('The identity provider did not return an email address.');
    }
    if (!this.ssoConfig.isEmailDomainAllowed(row, email)) {
      throw new UnauthorizedException('Your email domain is not permitted for this provider.');
    }

    const role = this.ssoConfig.normalizeRole(row.default_role);
    const displayName = profile.displayName || email.split('@')[0];

    const created = await this.db.queryOne<AccountRow>(
      `INSERT INTO accounts
         (email, display_name, role, status, is_active, email_verified,
          sso_provider, sso_subject)
       VALUES ($1, $2, $3, 'ACTIVE', true, true, $4, $5)
       RETURNING *`,
      [email, displayName, role, provider, profile.subject],
    );

    await this.audit.log({
      accountId: created!.id,
      eventType: 'account_created',
      resourceType: 'account',
      resourceId: created!.id,
      details: { email, method: 'sso_provision', provider, role },
    });
    this.logger.log(`JIT-provisioned account ${email} (${role}) via ${provider}`);

    return created!.id;
  }

  /** Reject deleted / inactive accounts (revealed only after IdP verification). */
  private assertUsable(account: AccountRow): void {
    if (account.is_deleted || account.status === 'DELETED') {
      throw new UnauthorizedException('This account no longer exists.');
    }
    if (account.status !== 'ACTIVE' || !account.is_active) {
      throw new UnauthorizedException('This account is not active. Contact your administrator.');
    }
  }
}
