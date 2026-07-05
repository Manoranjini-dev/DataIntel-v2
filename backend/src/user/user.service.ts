// ──────────────────────────────────────────────
// User Service — Phase 1 User Management
// Admin-driven user lifecycle over the existing `accounts` table:
// invite → activate → edit → deactivate/reactivate → soft-delete.
// Never exposes password_hash or any token.
// ──────────────────────────────────────────────

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { AuthService, AccountRow, SafeAccount } from '../auth/auth.service';
import {
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
  SettableUserStatus,
} from './dto/user.dto';

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

const INVITATION_TTL_HOURS = 24;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {
    this.frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
  }

  // ── USER-01: Create user (invitation flow) ──────────────────────
  async createUser(
    actor: SafeAccount,
    dto: CreateUserDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<SafeUser> {
    const email = dto.email.toLowerCase();

    const existing = await this.db.queryOne<{ id: string; is_deleted: boolean }>(
      'SELECT id, is_deleted FROM accounts WHERE email = $1',
      [email],
    );
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 3600 * 1000);

    const created = await this.db.queryOne<AccountRow>(
      `INSERT INTO accounts
         (email, display_name, role, status, invitation_token, invitation_expires_at, is_active, email_verified)
       VALUES ($1, $2, $3, 'PENDING_INVITATION', $4, $5, true, false)
       RETURNING *`,
      [email, dto.name, dto.role, token, expiresAt.toISOString()],
    );
    if (!created) throw new Error('Failed to create user');

    await this.sendInvitation(created, token, expiresAt, false);

    await this.audit.log({
      accountId: actor.id,
      eventType: 'user_created',
      resourceType: 'account',
      resourceId: created.id,
      details: { email, role: dto.role, name: dto.name },
      ipAddress,
      userAgent,
    });

    this.logger.log(`User created by ${actor.email}: ${email} (${dto.role})`);
    return this.toSafeUser(created);
  }

  // ── USER-03: List users (paginated, searchable, filterable) ─────
  async listUsers(query: ListUsersQueryDto): Promise<{
    users: SafeUser[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['is_deleted = false'];
    const params: any[] = [];

    if (query.search) {
      params.push(`%${query.search.toLowerCase()}%`);
      conditions.push(`(LOWER(display_name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`);
    }
    if (query.role) {
      params.push(query.role);
      conditions.push(`role = $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      conditions.push(`status = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const sortColumnMap: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      name: 'display_name',
      email: 'email',
    };
    const sortColumn = sortColumnMap[query.sortBy ?? 'createdAt'] ?? 'created_at';
    const sortOrder = (query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countRow = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM accounts ${where}`,
      params,
    );
    const total = Number(countRow?.count ?? 0);

    const rows = await this.db.queryMany<AccountRow>(
      `SELECT * FROM accounts ${where}
       ORDER BY ${sortColumn} ${sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    return {
      users: rows.map((r) => this.toSafeUser(r)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  // ── USER-03: Get single user ────────────────────────────────────
  async getUser(id: string): Promise<SafeUser> {
    const row = await this.requireUser(id);
    return this.toSafeUser(row);
  }

  // ── USER-04: Edit user ──────────────────────────────────────────
  async updateUser(
    actor: SafeAccount,
    id: string,
    dto: UpdateUserDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<SafeUser> {
    const current = await this.requireUser(id);

    const sets: string[] = [];
    const params: any[] = [];
    const changes: Record<string, any> = {};

    if (dto.name !== undefined && dto.name !== current.display_name) {
      params.push(dto.name);
      sets.push(`display_name = $${params.length}`);
      changes.name = dto.name;
    }

    if (dto.email !== undefined) {
      const email = dto.email.toLowerCase();
      if (email !== current.email) {
        const clash = await this.db.queryOne<{ id: string }>(
          'SELECT id FROM accounts WHERE email = $1 AND id <> $2',
          [email, id],
        );
        if (clash) throw new ConflictException('Email is already in use by another account');
        params.push(email);
        sets.push(`email = $${params.length}`);
        changes.email = email;
      }
    }

    if (dto.role !== undefined && dto.role !== current.role) {
      params.push(dto.role);
      sets.push(`role = $${params.length}`);
      changes.role = dto.role;
    }

    // Status changes route through the same transition logic as PATCH /status.
    let statusChanged: SettableUserStatus | null = null;
    if (dto.status !== undefined && dto.status !== current.status) {
      if (current.status === 'PENDING_INVITATION') {
        throw new BadRequestException(
          'Cannot change status of a user who has not yet activated their account',
        );
      }
      params.push(dto.status);
      sets.push(`status = $${params.length}`);
      sets.push(`is_active = ${dto.status === 'ACTIVE'}`);
      changes.status = dto.status;
      statusChanged = dto.status;
    }

    if (sets.length === 0) {
      return this.toSafeUser(current);
    }

    params.push(id);
    const updated = await this.db.queryOne<AccountRow>(
      `UPDATE accounts SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length} RETURNING *`,
      params,
    );

    // Deactivating via edit must also kill existing sessions.
    if (statusChanged === 'INACTIVE') {
      await this.auth.invalidateAccountSessions(id);
    }

    await this.audit.log({
      accountId: actor.id,
      eventType: 'user_updated',
      resourceType: 'account',
      resourceId: id,
      details: { changes },
      ipAddress,
      userAgent,
    });

    return this.toSafeUser(updated!);
  }

  // ── USER-05 / USER-06: Deactivate / Reactivate ──────────────────
  async setStatus(
    actor: SafeAccount,
    id: string,
    status: SettableUserStatus,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<SafeUser> {
    const current = await this.requireUser(id);

    if (current.status === 'PENDING_INVITATION') {
      throw new BadRequestException(
        'Cannot change status of a user who has not yet activated their account',
      );
    }

    if (actor.id === id && status === 'INACTIVE') {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    const updated = await this.db.queryOne<AccountRow>(
      `UPDATE accounts
          SET status = $2, is_active = $3, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [id, status, status === 'ACTIVE'],
    );

    if (status === 'INACTIVE') {
      // USER-05: existing sessions become invalid.
      await this.auth.invalidateAccountSessions(id);
    }

    await this.audit.log({
      accountId: actor.id,
      eventType: status === 'ACTIVE' ? 'user_reactivated' : 'user_deactivated',
      resourceType: 'account',
      resourceId: id,
      details: { status },
      ipAddress,
      userAgent,
    });

    return this.toSafeUser(updated!);
  }

  // ── USER-07: Soft delete ────────────────────────────────────────
  async deleteUser(
    actor: SafeAccount,
    id: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const current = await this.requireUser(id);

    if (actor.id === id) {
      throw new BadRequestException('You cannot delete your own account');
    }

    await this.db.query(
      `UPDATE accounts
          SET is_deleted = true,
              deleted_at = NOW(),
              status = 'DELETED',
              is_active = false,
              invitation_token = NULL,
              reset_password_token = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [id],
    );

    // Deleted users must not retain valid sessions.
    await this.auth.invalidateAccountSessions(id);

    await this.audit.log({
      accountId: actor.id,
      eventType: 'user_deleted',
      resourceType: 'account',
      resourceId: id,
      details: { email: current.email },
      ipAddress,
      userAgent,
    });

    this.logger.log(`User soft-deleted by ${actor.email}: ${current.email}`);
  }

  // ── Resend invitation ───────────────────────────────────────────
  async resendInvitation(
    actor: SafeAccount,
    id: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<SafeUser> {
    const current = await this.requireUser(id);

    if (current.status !== 'PENDING_INVITATION') {
      throw new BadRequestException('This user has already activated their account');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 3600 * 1000);

    const updated = await this.db.queryOne<AccountRow>(
      `UPDATE accounts
          SET invitation_token = $2, invitation_expires_at = $3, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [id, token, expiresAt.toISOString()],
    );

    await this.sendInvitation(updated!, token, expiresAt, true);

    await this.audit.log({
      accountId: actor.id,
      eventType: 'invitation_resent',
      resourceType: 'account',
      resourceId: id,
      details: { email: current.email },
      ipAddress,
      userAgent,
    });

    return this.toSafeUser(updated!);
  }

  // ── Private helpers ─────────────────────────────────────────────

  private async sendInvitation(
    account: AccountRow,
    token: string,
    expiresAt: Date,
    resend: boolean,
  ): Promise<void> {
    const activationUrl = `${this.frontendUrl}/activate?token=${token}`;
    // Fire-and-forget: real SMTP delivery can take anywhere from seconds to
    // minutes (or hang until timeout). Awaiting it here blocked the create/
    // resend-user request for the full duration — the admin would see no
    // feedback, resubmit, and hit a false "account already exists" error even
    // though the first request had actually succeeded in the background.
    this.email
      .sendInvitationEmail({
        to: account.email,
        name: account.display_name,
        role: account.role,
        activationUrl,
        expiresAt,
        resend,
      })
      .catch((err) =>
        this.logger.error(`Failed to send invitation email to ${account.email}: ${err?.message}`, err?.stack),
      );

    await this.audit.log({
      accountId: account.id,
      eventType: resend ? 'invitation_resent' : 'invitation_sent',
      resourceType: 'account',
      resourceId: account.id,
      details: { email: account.email },
    });
  }

  private async requireUser(id: string): Promise<AccountRow> {
    const row = await this.db.queryOne<AccountRow>(
      'SELECT * FROM accounts WHERE id = $1 AND is_deleted = false',
      [id],
    );
    if (!row) throw new NotFoundException('User not found');
    return row;
  }

  /** Maps a row to the public shape — strips password_hash and all tokens. */
  private toSafeUser(row: AccountRow): SafeUser {
    return {
      id: row.id,
      name: row.display_name,
      email: row.email,
      role: row.role,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at,
    };
  }
}
