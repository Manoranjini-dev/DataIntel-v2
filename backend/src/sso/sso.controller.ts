// ──────────────────────────────────────────────
// SSO Controller — public login flows
//   GET  /auth/sso/providers          → enabled providers for the login page
//   GET  /auth/sso/:provider/start     → begin an OIDC redirect (google|entra)
//   GET  /auth/sso/:provider/callback  → complete OIDC, mint session, redirect
//   POST /auth/sso/ldap                → username/password bind (AD)
// ──────────────────────────────────────────────

import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { encrypt, decrypt } from '../common/utils/encryption';
import { SsoConfigService } from './sso-config.service';
import { SsoProvisioningService } from './sso-provisioning.service';
import { OidcService } from './oidc.service';
import { LdapService } from './ldap.service';
import { LdapLoginDto } from './dto/sso.dto';
import { OidcTransaction, isSsoProvider, OIDC_PROVIDERS, SsoProvider } from './types';

const TX_COOKIE = 'c1x_sso_tx';
const TX_TTL_MS = 10 * 60 * 1000; // 10 minutes

@Public()
@Controller('auth/sso')
export class SsoController {
  private readonly logger = new Logger(SsoController.name);
  private readonly encKey: string;
  private readonly frontendUrl: string;
  private readonly cookieDomain: string;
  private readonly cookieSecure: boolean;
  private readonly sessionTtlHours: number;

  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    private readonly ssoConfig: SsoConfigService,
    private readonly provisioning: SsoProvisioningService,
    private readonly oidc: OidcService,
    private readonly ldap: LdapService,
  ) {
    this.encKey = this.config.getOrThrow<string>('CREDENTIAL_ENCRYPTION_KEY');
    this.frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    this.cookieDomain = this.config.get<string>('COOKIE_DOMAIN', 'localhost');
    this.cookieSecure = this.config.get<string>('COOKIE_SECURE', 'false') === 'true';
    this.sessionTtlHours = this.config.get<number>('SESSION_TTL_HOURS', 168);
  }

  /** Providers enabled for this deployment (drives the login page buttons). */
  @Get('providers')
  async providers() {
    return { success: true, providers: await this.ssoConfig.listEnabledPublic() };
  }

  /** Begin an OIDC redirect flow. */
  @Get(':provider/start')
  async start(
    @Param('provider') provider: string,
    @Res() res: Response,
  ): Promise<void> {
    const p = this.requireOidcProvider(provider);
    const { url, tx } = await this.oidc.createAuthRequest(p);
    this.setTxCookie(res, tx);
    res.redirect(url);
  }

  /** Complete an OIDC redirect flow. */
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query() query: Record<string, any>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const p = this.requireOidcProvider(provider);
    try {
      const tx = this.readTxCookie(req, p);
      const profile = await this.oidc.handleCallback(p, query, tx);
      const accountId = await this.provisioning.resolveOrProvision(p, profile);
      const { sessionToken } = await this.authService.issueSessionForAccount(
        accountId,
        req.ip || req.socket.remoteAddress,
        req.headers['user-agent'],
        `sso:${p}`,
      );
      this.clearTxCookie(res);
      this.setSessionCookie(res, sessionToken);
      res.redirect(this.frontendUrl);
    } catch (err: any) {
      this.logger.warn(`SSO callback failed for ${p}: ${err?.message}`);
      this.clearTxCookie(res);
      const msg = encodeURIComponent(err?.message || 'Sign-in failed');
      res.redirect(`${this.frontendUrl}/login?sso_error=${msg}`);
    }
  }

  /** LDAP / Active Directory username + password login. */
  @Post('ldap')
  @HttpCode(HttpStatus.OK)
  async ldapLogin(
    @Body() dto: LdapLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const profile = await this.ldap.authenticate(dto.username, dto.password);
    const accountId = await this.provisioning.resolveOrProvision('ldap', profile);
    const { account, sessionToken } = await this.authService.issueSessionForAccount(
      accountId,
      req.ip || req.socket.remoteAddress,
      req.headers['user-agent'],
      'sso:ldap',
    );
    this.setSessionCookie(res, sessionToken);
    return { success: true, account };
  }

  // ── helpers ──────────────────────────────────

  private requireOidcProvider(provider: string): SsoProvider {
    if (!isSsoProvider(provider) || !(OIDC_PROVIDERS as readonly string[]).includes(provider)) {
      throw new BadRequestException(`Unsupported SSO provider: ${provider}`);
    }
    return provider;
  }

  private setTxCookie(res: Response, tx: OidcTransaction): void {
    const value = encrypt(JSON.stringify(tx), this.encKey);
    res.cookie(TX_COOKIE, value, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: TX_TTL_MS,
      ...(this.cookieDomain && this.cookieDomain !== 'localhost' ? { domain: this.cookieDomain } : {}),
    });
  }

  private readTxCookie(req: Request, provider: SsoProvider): OidcTransaction {
    const raw = req.cookies?.[TX_COOKIE];
    if (!raw) throw new BadRequestException('Missing or expired SSO transaction.');
    let tx: OidcTransaction;
    try {
      tx = JSON.parse(decrypt(raw, this.encKey));
    } catch {
      throw new BadRequestException('Invalid SSO transaction.');
    }
    if (tx.provider !== provider) throw new BadRequestException('SSO provider mismatch.');
    return tx;
  }

  private clearTxCookie(res: Response): void {
    res.clearCookie(TX_COOKIE, { path: '/' });
  }

  private setSessionCookie(res: Response, sessionToken: string): void {
    res.cookie('c1x_session', sessionToken, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: this.sessionTtlHours * 60 * 60 * 1000,
      ...(this.cookieDomain && this.cookieDomain !== 'localhost' ? { domain: this.cookieDomain } : {}),
    });
  }
}
