// ──────────────────────────────────────────────
// Auth Service — Registration, Login, Session Management
// ──────────────────────────────────────────────

import { Injectable, Logger, UnauthorizedException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

export interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  avatar_url: string | null;
  is_active: boolean;
  email_verified: boolean;
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
      'SELECT * FROM accounts WHERE email = $1 AND is_active = true',
      [email.toLowerCase()],
    );

    if (!account) {
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
      'SELECT * FROM accounts WHERE id = $1 AND is_active = true',
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
      'SELECT * FROM accounts WHERE id = $1 AND is_active = true',
      [id],
    );
    return account ? this.toSafeAccount(account) : null;
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
      isActive: row.is_active,
      emailVerified: row.email_verified,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
    };
  }
}
