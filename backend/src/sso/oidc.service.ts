// ──────────────────────────────────────────────
// OIDC Service — Google Workspace + Microsoft Entra ID
// One engine for both, via OpenID Connect discovery (openid-client v5).
// Handles PKCE + state + nonce; validates the ID token (incl. JWKS).
// ──────────────────────────────────────────────

import { Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Issuer, generators, Client } from 'openid-client';
import { SsoConfigService } from './sso-config.service';
import { ExternalProfile, OidcTransaction, SsoProvider } from './types';

const GOOGLE_ISSUER = 'https://accounts.google.com';

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private readonly backendUrl: string;

  /** Cache discovered issuers (discovery is the slow part; config is cheap). */
  private readonly issuerCache = new Map<string, Issuer<Client>>();

  constructor(
    private readonly config: ConfigService,
    private readonly ssoConfig: SsoConfigService,
  ) {
    this.backendUrl = (this.config.get<string>('BACKEND_PUBLIC_URL') ?? 'http://localhost:3001').replace(/\/+$/, '');
  }

  private redirectUri(provider: SsoProvider): string {
    return `${this.backendUrl}/api/auth/sso/${provider}/callback`;
  }

  /** Build an authorization request; returns the redirect URL + transaction state. */
  async createAuthRequest(
    provider: SsoProvider,
    returnTo?: string,
  ): Promise<{ url: string; tx: OidcTransaction }> {
    const client = await this.buildClient(provider);

    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = generators.state();
    const nonce = generators.nonce();

    const cfg = await this.getConfig(provider);
    const url = client.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
      // Google: optionally hard-scope to a Workspace domain.
      ...(provider === 'google' && cfg.hostedDomain ? { hd: cfg.hostedDomain } : {}),
    });

    return { url, tx: { provider, state, nonce, codeVerifier, returnTo } };
  }

  /** Exchange the authorization code and return the verified external profile. */
  async handleCallback(
    provider: SsoProvider,
    params: Record<string, any>,
    tx: OidcTransaction,
  ): Promise<ExternalProfile> {
    if (params.error) {
      throw new UnauthorizedException(`Identity provider error: ${params.error_description || params.error}`);
    }
    const client = await this.buildClient(provider);

    let tokenSet;
    try {
      tokenSet = await client.callback(this.redirectUri(provider), params, {
        state: tx.state,
        nonce: tx.nonce,
        code_verifier: tx.codeVerifier,
      });
    } catch (err: any) {
      this.logger.warn(`OIDC callback failed for ${provider}: ${err?.message}`);
      throw new UnauthorizedException('Sign-in could not be completed.');
    }

    const claims = tokenSet.claims();
    const subject = claims.sub;
    if (!subject) throw new UnauthorizedException('Identity provider did not return a subject.');

    const email =
      (claims.email as string) ||
      (claims.preferred_username as string) ||
      (claims['upn'] as string) ||
      null;
    const displayName =
      (claims.name as string) ||
      (claims.preferred_username as string) ||
      (email ? email.split('@')[0] : null);

    return { subject, email: email ? email.toLowerCase() : null, displayName };
  }

  // ── internals ────────────────────────────────

  private async getConfig(provider: SsoProvider): Promise<Record<string, any>> {
    const row = await this.ssoConfig.getEnabledRow(provider);
    if (!row) throw new BadRequestException(`SSO provider '${provider}' is not enabled.`);
    return row.config ?? {};
  }

  private issuerUrlFor(provider: SsoProvider, cfg: Record<string, any>): string {
    if (provider === 'google') return GOOGLE_ISSUER;
    if (provider === 'entra') {
      const tenant = cfg.tenantId || cfg.tenant || 'common';
      return cfg.issuer || `https://login.microsoftonline.com/${tenant}/v2.0`;
    }
    throw new BadRequestException(`Provider '${provider}' is not an OIDC provider.`);
  }

  private async buildClient(provider: SsoProvider): Promise<Client> {
    const row = await this.ssoConfig.getEnabledRow(provider);
    if (!row) throw new BadRequestException(`SSO provider '${provider}' is not enabled.`);
    const cfg = row.config ?? {};
    const clientId = cfg.clientId;
    const clientSecret = this.ssoConfig.getDecryptedSecret(row);
    if (!clientId || !clientSecret) {
      throw new BadRequestException(`SSO provider '${provider}' is missing client credentials.`);
    }

    const issuerUrl = this.issuerUrlFor(provider, cfg);
    let issuer = this.issuerCache.get(issuerUrl);
    if (!issuer) {
      issuer = await Issuer.discover(issuerUrl);
      this.issuerCache.set(issuerUrl, issuer);
    }

    return new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [this.redirectUri(provider)],
      response_types: ['code'],
    });
  }
}
