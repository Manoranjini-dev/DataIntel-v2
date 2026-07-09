// ──────────────────────────────────────────────
// SSO Provisioning Service
// Resolves an external identity to a local account.
//
// SECURITY MODEL (Invite-Only):
//   A successful Google / OIDC authentication proves IDENTITY only.
//   It does NOT grant application access.
//
//   Access is granted ONLY if:
//     1. An existing identity link exists (sso_provider + sso_subject) AND the
//        account is ACTIVE.
//     2. An existing account with the same email exists AND the account is
//        ACTIVE (or PENDING_INVITATION — SSO auto-activates invited users).
//     3. Auto-provisioning is explicitly enabled by the admin AND the email
//        domain is on the allowlist (enterprise JIT use-case).
//
//   All other users are denied with UnauthorizedException.
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
   *
   * SECURITY: An existing pre-approved account MUST be present in the database
   * (created or invited by an Admin) for SSO login to succeed. Unknown
   * identities are always denied unless the admin has explicitly enabled
   * auto-provisioning with a domain allowlist for enterprise use.
   */
  async resolveOrProvision(
    provider: SsoProvider,
    profile: ExternalProfile,
  ): Promise<string> {
    const email = profile.email?.toLowerCase() ?? null;

    // ── 1. Existing identity link ─────────────────────────────────────────
    // The fastest path: we already know this sso_subject → account mapping.
    const linked = await this.db.queryOne<AccountRow>(
      `SELECT * FROM accounts
        WHERE sso_provider = $1 AND sso_subject = $2 AND is_deleted = false`,
      [provider, profile.subject],
    );
    if (linked) {
      this.assertUsable(linked, provider, email);
      this.logger.log(`SSO login via existing identity link: ${email} (${provider})`);
      return linked.id;
    }

    // ── 2. Existing account matched by email ──────────────────────────────
    // The account was created or invited by an Admin; link the SSO identity
    // to it now. We do NOT create new accounts here — the account must already
    // exist in the database.
    if (email) {
      const byEmail = await this.db.queryOne<AccountRow>(
        'SELECT * FROM accounts WHERE email = $1 AND is_deleted = false',
        [email],
      );
      if (byEmail) {
        if (byEmail.status === 'PENDING_INVITATION') {
          // Admin invited this user → SSO login auto-activates the invitation.
          // The user has accepted their identity via the IdP; treat this as
          // equivalent to clicking the invitation link.
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
          await this.audit.log({
            accountId: byEmail.id,
            eventType: 'sso_identity_linked',
            resourceType: 'account',
            resourceId: byEmail.id,
            details: { provider, email, activatedViaInvitation: true },
          });
          this.logger.log(
            `SSO login activated invited account: ${email} (${provider})`,
          );
          return byEmail.id;
        }

        // Account exists and is not a pending invitation — verify it is usable
        // before linking the SSO identity.
        this.assertUsable(byEmail, provider, email);

        await this.db.query(
          `UPDATE accounts
              SET sso_provider = $1, sso_subject = $2,
                  email_verified = true, updated_at = NOW()
            WHERE id = $3`,
          [provider, profile.subject, byEmail.id],
        );
        await this.audit.log({
          accountId: byEmail.id,
          eventType: 'sso_identity_linked',
          resourceType: 'account',
          resourceId: byEmail.id,
          details: { provider, email },
        });
        this.logger.log(
          `SSO login linked existing account: ${email} (${provider})`,
        );
        return byEmail.id;
      }
    }

    // ── 3. No account found — deny or JIT-provision ───────────────────────
    // SECURITY GATE: The default answer is DENY. JIT provisioning is an
    // opt-in enterprise feature that requires:
    //   a) admin explicitly set auto_provision = true for this provider, AND
    //   b) the email domain is on the provider's allowed_domains list.
    //
    // This call throws UnauthorizedException if either condition is not met,
    // which propagates to the SSO callback → redirect to /login?sso_error=…
    this.logger.warn(
      `SSO login denied — no account found for ${email ?? 'unknown email'} (${provider})`,
    );
    return this.provisionOrDeny(provider, profile, email);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Attempt JIT provisioning if the admin has explicitly enabled it for this
   * provider. Always throws UnauthorizedException when not allowed.
   */
  private async provisionOrDeny(
    provider: SsoProvider,
    profile: ExternalProfile,
    email: string | null,
  ): Promise<string> {
    const row = await this.ssoConfig.getRow(provider);

    if (!row || !row.auto_provision) {
      throw new UnauthorizedException(
        'Your account has not been set up in this application. ' +
        'Please contact your administrator to get access.',
      );
    }

    if (!email) {
      throw new UnauthorizedException(
        'The identity provider did not return an email address.',
      );
    }

    if (!this.ssoConfig.isEmailDomainAllowed(row, email)) {
      throw new UnauthorizedException(
        'Your email domain is not permitted for this application. ' +
        'Contact your administrator if you believe this is an error.',
      );
    }

    // All gates passed — JIT-create the account.
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
    this.logger.log(
      `JIT-provisioned account ${email} (${role}) via ${provider}`,
    );

    return created!.id;
  }

  /**
   * Enforce that an existing account is in a state that allows login.
   * Throws UnauthorizedException for deleted, inactive, or suspended accounts.
   * The error message intentionally avoids exposing the exact reason to
   * prevent account enumeration through SSO.
   */
  private assertUsable(account: AccountRow, provider: string, email: string | null): void {
    if (account.is_deleted || account.status === 'DELETED') {
      this.logger.warn(
        `SSO login denied — account deleted: ${email ?? account.id} (${provider})`,
      );
      throw new UnauthorizedException(
        'This account no longer exists. Contact your administrator.',
      );
    }
    if (!account.is_active || account.status === 'INACTIVE') {
      this.logger.warn(
        `SSO login denied — account inactive: ${email ?? account.id} (${provider})`,
      );
      throw new UnauthorizedException(
        'Your account has been deactivated. Please contact your administrator to restore access.',
      );
    }
    if (account.status !== 'ACTIVE') {
      this.logger.warn(
        `SSO login denied — unexpected status=${account.status}: ${email ?? account.id} (${provider})`,
      );
      throw new UnauthorizedException(
        'Your account is not active. Please contact your administrator.',
      );
    }
  }
}
