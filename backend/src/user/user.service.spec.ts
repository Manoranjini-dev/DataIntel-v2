// ──────────────────────────────────────────────
// UserService unit tests
// ──────────────────────────────────────────────

import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';
import { PlatformRoleEnum, SettableUserStatus } from './dto/user.dto';
import type { SafeAccount, AccountRow } from '../auth/auth.service';

function makeRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'user-1',
    email: 'jane@company.com',
    display_name: 'Jane Doe',
    password_hash: 'hash',
    avatar_url: null,
    role: 'VIEWER',
    status: 'ACTIVE',
    is_active: true,
    email_verified: true,
    invitation_token: null,
    invitation_expires_at: null,
    reset_password_token: null,
    reset_password_expires_at: null,
    is_deleted: false,
    deleted_at: null,
    last_login_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const admin: SafeAccount = {
  id: 'admin-1',
  email: 'admin@company.com',
  displayName: 'Admin',
  avatarUrl: null,
  role: 'ADMIN',
  status: 'ACTIVE',
  isActive: true,
  emailVerified: true,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('UserService', () => {
  let service: UserService;
  let db: { queryOne: jest.Mock; queryMany: jest.Mock; query: jest.Mock };
  let audit: { log: jest.Mock };
  let email: { sendInvitationEmail: jest.Mock };
  let auth: { invalidateAccountSessions: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(() => {
    db = { queryOne: jest.fn(), queryMany: jest.fn(), query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    email = { sendInvitationEmail: jest.fn().mockResolvedValue(undefined) };
    auth = { invalidateAccountSessions: jest.fn().mockResolvedValue(undefined) };
    config = { get: jest.fn().mockReturnValue('http://localhost:3000') };

    service = new UserService(
      db as any, audit as any, email as any, auth as any, config as any,
    );
  });

  // ── USER-01 Create ───────────────────────────────────────────────
  describe('createUser', () => {
    it('creates a PENDING_INVITATION user, sends an invite, and never returns secrets', async () => {
      const created = makeRow({
        status: 'PENDING_INVITATION', role: 'ANALYST', invitation_token: 'tok',
      });
      db.queryOne.mockResolvedValueOnce(null);        // no existing email
      db.queryOne.mockResolvedValueOnce(created);     // INSERT RETURNING *

      const result = await service.createUser(admin, {
        name: 'Jane Doe', email: 'Jane@Company.com', role: PlatformRoleEnum.ANALYST,
      });

      // email is lower-cased into the insert
      expect(db.queryOne.mock.calls[1][1][0]).toBe('jane@company.com');
      expect(email.sendInvitationEmail).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'user_created' }));
      expect(result).toEqual({
        id: 'user-1', name: 'Jane Doe', email: 'jane@company.com', role: 'ANALYST',
        status: 'PENDING_INVITATION', createdAt: created.created_at,
        updatedAt: created.updated_at, lastLoginAt: null,
      });
      expect(result as any).not.toHaveProperty('password_hash');
      expect(result as any).not.toHaveProperty('invitation_token');
    });

    it('rejects a duplicate email', async () => {
      db.queryOne.mockResolvedValueOnce({ id: 'x', is_deleted: false });
      await expect(
        service.createUser(admin, { name: 'X', email: 'dupe@company.com', role: PlatformRoleEnum.VIEWER }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(email.sendInvitationEmail).not.toHaveBeenCalled();
    });
  });

  // ── USER-03 List ─────────────────────────────────────────────────
  describe('listUsers', () => {
    it('excludes deleted users and returns pagination metadata', async () => {
      db.queryOne.mockResolvedValueOnce({ count: 3 });
      db.queryMany.mockResolvedValueOnce([makeRow(), makeRow({ id: 'user-2' })]);

      const res = await service.listUsers({ page: 1, limit: 2 });

      expect(db.queryOne.mock.calls[0][0]).toContain('is_deleted = false');
      expect(res.total).toBe(3);
      expect(res.totalPages).toBe(2);
      expect(res.users).toHaveLength(2);
    });

    it('applies search + role + status filters', async () => {
      db.queryOne.mockResolvedValueOnce({ count: 0 });
      db.queryMany.mockResolvedValueOnce([]);

      await service.listUsers({ search: 'jane', role: PlatformRoleEnum.ADMIN, status: 'ACTIVE' });

      const params = db.queryMany.mock.calls[0][1];
      expect(params).toContain('%jane%');
      expect(params).toContain('ADMIN');
      expect(params).toContain('ACTIVE');
    });

    it('sorts by name ascending when requested', async () => {
      db.queryOne.mockResolvedValueOnce({ count: 0 });
      db.queryMany.mockResolvedValueOnce([]);
      await service.listUsers({ sortBy: 'name', sortOrder: 'asc' });
      expect(db.queryMany.mock.calls[0][0]).toContain('display_name ASC');
    });
  });

  // ── USER-03 Get single ───────────────────────────────────────────
  describe('getUser', () => {
    it('returns a single safe user', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow());
      const res = await service.getUser('user-1');
      expect(res.id).toBe('user-1');
      expect(res as any).not.toHaveProperty('password_hash');
    });

    it('throws NotFound when missing', async () => {
      db.queryOne.mockResolvedValueOnce(null);
      await expect(service.getUser('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── USER-04 Update ───────────────────────────────────────────────
  describe('updateUser', () => {
    it('is a no-op (no UPDATE) when nothing changes', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow({ display_name: 'Jane Doe' }));
      const res = await service.updateUser(admin, 'user-1', { name: 'Jane Doe' });
      expect(res.name).toBe('Jane Doe');
      // only the requireUser SELECT ran — no second queryOne for UPDATE
      expect(db.queryOne).toHaveBeenCalledTimes(1);
    });

    it('rejects an email already used by another account', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow());                 // requireUser
      db.queryOne.mockResolvedValueOnce({ id: 'other' });           // email clash
      await expect(
        service.updateUser(admin, 'user-1', { email: 'taken@company.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates role and writes an audit entry', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow());                 // requireUser
      db.queryOne.mockResolvedValueOnce(makeRow({ role: 'ADMIN' })); // UPDATE RETURNING

      const res = await service.updateUser(admin, 'user-1', { role: PlatformRoleEnum.ADMIN });

      expect(res.role).toBe('ADMIN');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'user_updated' }));
    });

    it('invalidates sessions when an edit deactivates the user', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow({ status: 'ACTIVE' }));
      db.queryOne.mockResolvedValueOnce(makeRow({ status: 'INACTIVE', is_active: false }));

      await service.updateUser(admin, 'user-1', { status: SettableUserStatus.INACTIVE });

      expect(auth.invalidateAccountSessions).toHaveBeenCalledWith('user-1');
    });

    it('throws NotFound for a missing user', async () => {
      db.queryOne.mockResolvedValueOnce(null);
      await expect(service.updateUser(admin, 'nope', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── USER-05 / USER-06 Deactivate / Reactivate ────────────────────
  describe('setStatus', () => {
    it('deactivates and invalidates sessions', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow({ status: 'ACTIVE' }));
      db.queryOne.mockResolvedValueOnce(makeRow({ status: 'INACTIVE', is_active: false }));

      const res = await service.setStatus(admin, 'user-1', SettableUserStatus.INACTIVE);

      expect(res.status).toBe('INACTIVE');
      expect(auth.invalidateAccountSessions).toHaveBeenCalledWith('user-1');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'user_deactivated' }));
    });

    it('reactivates without touching sessions', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow({ status: 'INACTIVE', is_active: false }));
      db.queryOne.mockResolvedValueOnce(makeRow({ status: 'ACTIVE' }));

      const res = await service.setStatus(admin, 'user-1', SettableUserStatus.ACTIVE);

      expect(res.status).toBe('ACTIVE');
      expect(auth.invalidateAccountSessions).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'user_reactivated' }));
    });

    it('forbids self-deactivation', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow({ id: admin.id, status: 'ACTIVE' }));
      await expect(
        service.setStatus(admin, admin.id, SettableUserStatus.INACTIVE),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects status change on a pending invitation', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow({ status: 'PENDING_INVITATION' }));
      await expect(
        service.setStatus(admin, 'user-1', SettableUserStatus.ACTIVE),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── USER-07 Soft delete ──────────────────────────────────────────
  describe('deleteUser', () => {
    it('soft-deletes, kills sessions, and audits', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow());
      await service.deleteUser(admin, 'user-1');

      const sql = db.query.mock.calls[0][0];
      expect(sql).toContain('is_deleted = true');
      expect(sql).toContain("status = 'DELETED'");
      expect(auth.invalidateAccountSessions).toHaveBeenCalledWith('user-1');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'user_deleted' }));
    });

    it('forbids self-deletion', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow({ id: admin.id }));
      await expect(service.deleteUser(admin, admin.id)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── Resend invitation ────────────────────────────────────────────
  describe('resendInvitation', () => {
    it('issues a fresh token and resends for a pending user', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow({ status: 'PENDING_INVITATION' }));
      db.queryOne.mockResolvedValueOnce(makeRow({ status: 'PENDING_INVITATION', invitation_token: 'new' }));

      await service.resendInvitation(admin, 'user-1');

      expect(email.sendInvitationEmail).toHaveBeenCalledWith(
        expect.objectContaining({ resend: true }),
      );
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'invitation_resent' }));
    });

    it('rejects resending to an already-active user', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow({ status: 'ACTIVE' }));
      await expect(service.resendInvitation(admin, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
