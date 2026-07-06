// ──────────────────────────────────────────────
// Auth Service — Registration, Login, Session Management
// ──────────────────────────────────────────────

import { Injectable, Logger, UnauthorizedException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

export type PlatformRole = 'ADMIN' | 'ANALYST' | 'VIEWER';
export type UserStatus = 'PENDING_INVITATION' | 'ACTIVE' | 'INACTIVE' | 'DELETED';

export interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  avatar_url: string | null;
  role: PlatformRole;
  status: UserStatus;
  is_active: boolean;
  email_verified: boolean;
  invitation_token: string | null;
  invitation_expires_at: string | null;
  reset_password_token: string | null;
  reset_password_expires_at: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  account_id: string;
  token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string;
  created_at: string;
  last_active_at: string;
}

export interface SafeAccount {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: PlatformRole;
  status: UserStatus;
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly BCRYPT_ROUNDS = 12;
  private readonly sessionTtlHours: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    this.sessionTtlHours = this.config.get<number>('SESSION_TTL_HOURS', 168); // 7 days
  }

  /** Register a new account */
  async register(
    email: string,
    displayName: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ account: SafeAccount; sessionToken: string }> {
    // Check if email already exists
    const existing = await this.db.queryOne<AccountRow>(
      'SELECT id FROM accounts WHERE email = $1',
      [email.toLowerCase()],
    );

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, this.BCRYPT_ROUNDS);

    // Create account
    const account = await this.db.queryOne<AccountRow>(
      `INSERT INTO accounts (email, display_name, password_hash) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      [email.toLowerCase(), displayName, passwordHash],
    );

    if (!account) {
      throw new Error('Failed to create account');
    }

    // Audit
    await this.audit.log({
      accountId: account.id,
      eventType: 'account_created',
      resourceType: 'account',
      resourceId: account.id,
      details: { email: account.email },
      ipAddress,
      userAgent,
    });

    // Create session
    const sessionToken = await this.createSession(account.id, ipAddress, userAgent);

    // Log successful login
    await this.audit.log({
      accountId: account.id,
      eventType: 'login_success',
      resourceType: 'session',
      details: { method: 'register' },
      ipAddress,
      userAgent,
    });

    return {
      account: this.toSafeAccount(account),
      sessionToken,
    };
  }

  /** Login with email and password */
  async login(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ account: SafeAccount; sessionToken: string }> {
    const account = await this.db.queryOne<AccountRow>(
      'SELECT * FROM accounts WHERE email = $1',
      [email.toLowerCase()],
    );

    if (!account || !account.password_hash) {
      await this.audit.log({
        eventType: 'login_failed',
        details: { email, reason: 'account_not_found' },
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(password, account.password_hash);
    if (!isPasswordValid) {
      await this.audit.log({
        accountId: account.id,
        eventType: 'login_failed',
        details: { email, reason: 'invalid_password' },
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    // Block deleted / inactive accounts from authenticating (only revealed
    // after a correct password, to avoid account enumeration).
    if (account.is_deleted || account.status === 'DELETED') {
      throw new UnauthorizedException('This account no longer exists');
    }
    if (account.status !== 'ACTIVE' || !account.is_active) {
      throw new UnauthorizedException('This account is not active. Contact your administrator.');
    }

    // Update last login
    await this.db.query(
      'UPDATE accounts SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1',
      [account.id],
    );

    // Create session
    const sessionToken = await this.createSession(account.id, ipAddress, userAgent);

    // Audit
    await this.audit.log({
      accountId: account.id,
      eventType: 'login_success',
      resourceType: 'session',
      details: { method: 'password' },
      ipAddress,
      userAgent,
    });

    return {
      account: this.toSafeAccount(account),
      sessionToken,
    };
  }

  /** Rotate a session token (generate a new one, invalidate the old) */
  async rotateSession(
    oldToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<string> {
    const oldTokenHash = crypto.createHash('sha256').update(oldToken).digest('hex');
    
    // Find valid session
    const session = await this.db.queryOne<SessionRow>(
      'SELECT id, account_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW()',
      [oldTokenHash],
    );

    if (!session) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Generate new token
    const newToken = crypto.randomBytes(32).toString('hex');
    const newTokenHash = crypto.createHash('sha256').update(newToken).digest('hex');
    
    // Calculate new expiration
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.sessionTtlHours);

    // Update session with new token
    await this.db.query(
      `UPDATE sessions 
       SET token_hash = $1, expires_at = $2, last_active_at = NOW(), 
           ip_address = COALESCE($3, ip_address), user_agent = COALESCE($4, user_agent)
       WHERE id = $5`,
      [newTokenHash, expiresAt.toISOString(), ipAddress || null, userAgent || null, session.id]
    );

    return newToken;
  }

  /** Validate a session token and return the account */
  async validateSession(sessionToken: string): Promise<SafeAccount | null> {
    const tokenHash = this.hashToken(sessionToken);

    const session = await this.db.queryOne<SessionRow>(
      'SELECT * FROM sessions WHERE token_hash = $1 AND expires_at > NOW()',
      [tokenHash],
    );

    if (!session) {
      return null;
    }

    // Update last_active_at
    await this.db.query(
      'UPDATE sessions SET last_active_at = NOW() WHERE id = $1',
      [session.id],
    );

    const account = await this.db.queryOne<AccountRow>(
      `SELECT * FROM accounts
       WHERE id = $1 AND is_active = true AND is_deleted = false AND status = 'ACTIVE'`,
      [session.account_id],
    );

    if (!account) {
      return null;
    }

    return this.toSafeAccount(account);
  }

  /** Logout — invalidate a session */
  async logout(
    sessionToken: string,
    accountId?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const tokenHash = this.hashToken(sessionToken);
    await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);

    if (accountId) {
      await this.audit.log({
        accountId,
        eventType: 'logout',
        ipAddress,
        userAgent,
      });
    }
  }

  /** Get account by ID */
  async getAccountById(id: string): Promise<SafeAccount | null> {
    const account = await this.db.queryOne<AccountRow>(
      'SELECT * FROM accounts WHERE id = $1 AND is_active = true AND is_deleted = false',
      [id],
    );
    return account ? this.toSafeAccount(account) : null;
  }

  /**
   * Activate an invited account: validate the one-time invitation token,
   * set the chosen password (bcrypt), mark ACTIVE, and clear the token.
   */
  async activateAccount(
    token: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<SafeAccount> {
    const account = await this.db.queryOne<AccountRow>(
      `SELECT * FROM accounts WHERE invitation_token = $1 AND is_deleted = false`,
      [token],
    );

    if (!account) {
      throw new UnauthorizedException('Invalid or already-used invitation link');
    }
    if (
      !account.invitation_expires_at ||
      new Date(account.invitation_expires_at) < new Date()
    ) {
      throw new UnauthorizedException('This invitation link has expired');
    }

    const passwordHash = await bcrypt.hash(password, this.BCRYPT_ROUNDS);

    const updated = await this.db.queryOne<AccountRow>(
      `UPDATE accounts
          SET password_hash = $2,
              status = 'ACTIVE',
              is_active = true,
              email_verified = true,
              invitation_token = NULL,
              invitation_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [account.id, passwordHash],
    );

    await this.audit.log({
      accountId: account.id,
      eventType: 'user_activated',
      resourceType: 'account',
      resourceId: account.id,
      details: { email: account.email, method: 'invitation' },
      ipAddress,
      userAgent,
    });

    return this.toSafeAccount(updated!);
  }

  /**
   * Begin a password reset. Always resolves successfully (no account
   * enumeration). Returns the token + account only when one is eligible.
   */
  async createPasswordResetToken(
    email: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ account: AccountRow; token: string; expiresAt: Date } | null> {
    const account = await this.db.queryOne<AccountRow>(
      `SELECT * FROM accounts
        WHERE email = $1 AND is_deleted = false AND status IN ('ACTIVE', 'INACTIVE')`,
      [email.toLowerCase()],
    );

    if (!account) return null;

    const token = crypto.randomBytes(32).toString('hex');
    const ttlMin = this.config.get<number>('RESET_TOKEN_TTL_MINUTES', 60);
    const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000);

    await this.db.query(
      `UPDATE accounts
          SET reset_password_token = $2, reset_password_expires_at = $3, updated_at = NOW()
        WHERE id = $1`,
      [account.id, token, expiresAt.toISOString()],
    );

    await this.audit.log({
      accountId: account.id,
      eventType: 'password_reset_requested',
      resourceType: 'account',
      resourceId: account.id,
      details: { email: account.email },
      ipAddress,
      userAgent,
    });

    return { account, token, expiresAt };
  }

  /** Complete a password reset: validate token, set new password, invalidate sessions. */
  async resetPassword(
    token: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const account = await this.db.queryOne<AccountRow>(
      `SELECT * FROM accounts WHERE reset_password_token = $1 AND is_deleted = false`,
      [token],
    );

    if (!account) {
      throw new UnauthorizedException('Invalid or already-used reset link');
    }
    if (
      !account.reset_password_expires_at ||
      new Date(account.reset_password_expires_at) < new Date()
    ) {
      throw new UnauthorizedException('This reset link has expired');
    }

    const passwordHash = await bcrypt.hash(password, this.BCRYPT_ROUNDS);

    await this.db.query(
      `UPDATE accounts
          SET password_hash = $2,
              reset_password_token = NULL,
              reset_password_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [account.id, passwordHash],
    );

    // Security: invalidate all existing sessions after a password reset.
    await this.invalidateAccountSessions(account.id);

    await this.audit.log({
      accountId: account.id,
      eventType: 'password_reset_completed',
      resourceType: 'account',
      resourceId: account.id,
      details: { email: account.email },
      ipAddress,
      userAgent,
    });
  }

  /** Invalidate every active session for an account (used on deactivate/delete/reset). */
  async invalidateAccountSessions(accountId: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE account_id = $1', [accountId]);
  }

  /**
   * Issue a session for an already-authenticated account (used by the SSO
   * flows once an external identity has been verified + provisioned). Applies
   * the same active/deleted guards as password login and returns the session
   * token plus the safe account projection.
   */
  async issueSessionForAccount(
    accountId: string,
    ipAddress?: string,
    userAgent?: string,
    method = 'sso',
  ): Promise<{ account: SafeAccount; sessionToken: string }> {
    const account = await this.db.queryOne<AccountRow>(
      'SELECT * FROM accounts WHERE id = $1',
      [accountId],
    );
    if (!account) {
      throw new UnauthorizedException('Account not found');
    }
    if (account.is_deleted || account.status === 'DELETED') {
      throw new UnauthorizedException('This account no longer exists');
    }
    if (account.status !== 'ACTIVE' || !account.is_active) {
      throw new UnauthorizedException('This account is not active. Contact your administrator.');
    }

    await this.db.query(
      'UPDATE accounts SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1',
      [accountId],
    );

    const sessionToken = await this.createSession(accountId, ipAddress, userAgent);

    await this.audit.log({
      accountId,
      eventType: 'login_success',
      resourceType: 'session',
      details: { method },
      ipAddress,
      userAgent,
    });

    return { account: this.toSafeAccount(account), sessionToken };
  }

  // ── Private helpers ────────────────────────────

  private async createSession(accountId: string, ipAddress?: string, userAgent?: string): Promise<string> {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + this.sessionTtlHours * 60 * 60 * 1000);

    await this.db.query(
      `INSERT INTO sessions (account_id, token_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [accountId, tokenHash, ipAddress || null, userAgent || null, expiresAt.toISOString()],
    );

    return sessionToken;
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private toSafeAccount(row: AccountRow): SafeAccount {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      role: row.role,
      status: row.status,
      isActive: row.is_active,
      emailVerified: row.email_verified,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
    };
  }
}
