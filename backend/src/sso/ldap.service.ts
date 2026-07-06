// ──────────────────────────────────────────────
// LDAP Service — on-premises Active Directory authentication
// Search-then-bind: bind as a service account, locate the user, then re-bind
// as that user to verify the supplied password. Falls back to a direct UPN
// bind when no service account is configured.
// ──────────────────────────────────────────────

import { Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Client } from 'ldapts';
import { SsoConfigService } from './sso-config.service';
import { ExternalProfile } from './types';

interface LdapConfig {
  url: string;
  baseDN?: string;
  bindDN?: string;
  /** e.g. "(sAMAccountName={{username}})" */
  userFilter?: string;
  /** UPN suffix for direct-bind mode, e.g. "corp.example.com". */
  upnSuffix?: string;
  mailAttribute?: string;
  nameAttribute?: string;
}

const DEFAULT_FILTER = '(sAMAccountName={{username}})';
const DEFAULT_ATTRS = ['mail', 'userPrincipalName', 'displayName', 'sAMAccountName', 'objectGUID'];

@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);

  constructor(private readonly ssoConfig: SsoConfigService) {}

  /** Authenticate a username/password against AD and return the profile. */
  async authenticate(username: string, password: string): Promise<ExternalProfile> {
    if (!username || !password) {
      throw new UnauthorizedException('Username and password are required.');
    }

    const row = await this.ssoConfig.getEnabledRow('ldap');
    if (!row) throw new BadRequestException("SSO provider 'ldap' is not enabled.");
    const cfg = (row.config ?? {}) as LdapConfig;
    if (!cfg.url) throw new BadRequestException('LDAP provider is missing a server URL.');

    const bindPassword = this.ssoConfig.getDecryptedSecret(row);

    // Direct-bind mode when no service account is configured.
    if (!cfg.bindDN) {
      if (!cfg.upnSuffix) {
        throw new BadRequestException('LDAP requires either a bind DN or a UPN suffix.');
      }
      const upn = username.includes('@') ? username : `${username}@${cfg.upnSuffix}`;
      await this.verifyBind(cfg.url, upn, password);
      return { subject: upn.toLowerCase(), email: upn.toLowerCase(), displayName: username };
    }

    // Search-then-bind.
    if (!cfg.baseDN || !bindPassword) {
      throw new BadRequestException('LDAP requires a base DN and bind credentials.');
    }

    const client = new Client({ url: cfg.url });
    try {
      await client.bind(cfg.bindDN, bindPassword);
    } catch (err: any) {
      this.logger.error(`LDAP service bind failed: ${err?.message}`);
      throw new BadRequestException('LDAP service account bind failed.');
    }

    let entry: Record<string, any> | undefined;
    try {
      const filter = (cfg.userFilter || DEFAULT_FILTER).replace(
        '{{username}}',
        this.escapeFilter(username),
      );
      const { searchEntries } = await client.search(cfg.baseDN, {
        scope: 'sub',
        filter,
        attributes: DEFAULT_ATTRS,
      });
      entry = searchEntries[0];
    } finally {
      await client.unbind().catch(() => undefined);
    }

    if (!entry) throw new UnauthorizedException('Invalid username or password.');

    // Verify the password by binding as the located user.
    await this.verifyBind(cfg.url, String(entry.dn), password);

    const mailAttr = cfg.mailAttribute || 'mail';
    const nameAttr = cfg.nameAttribute || 'displayName';
    const email =
      this.first(entry[mailAttr]) || this.first(entry.userPrincipalName) || null;
    const subject =
      this.guid(entry.objectGUID) || (email ? email.toLowerCase() : String(entry.dn));

    return {
      subject,
      email: email ? email.toLowerCase() : null,
      displayName: this.first(entry[nameAttr]) || username,
    };
  }

  private async verifyBind(url: string, dn: string, password: string): Promise<void> {
    const client = new Client({ url });
    try {
      await client.bind(dn, password);
    } catch {
      throw new UnauthorizedException('Invalid username or password.');
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  /** RFC 4515 filter-value escaping to prevent LDAP injection. */
  private escapeFilter(value: string): string {
    return value.replace(/[\\*()\0]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
  }

  private first(v: unknown): string | null {
    if (v == null) return null;
    if (Array.isArray(v)) return v.length ? this.first(v[0]) : null;
    if (Buffer.isBuffer(v)) return v.toString('utf8');
    return String(v);
  }

  private guid(v: unknown): string | null {
    if (v == null) return null;
    const buf = Array.isArray(v) ? v[0] : v;
    if (Buffer.isBuffer(buf)) return buf.toString('hex');
    return typeof buf === 'string' ? buf : null;
  }
}
