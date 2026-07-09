// ──────────────────────────────────────────────
// AuthService — activation, password reset, and login lockout tests
// ──────────────────────────────────────────────

import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService, AccountRow } from './auth.service';

function makeRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'user-1', email: 'jane@company.com', display_name: 'Jane', password_hash: null,
    avatar_url: null, role: 'VIEWER', status: 'ACTIVE', is_active: true, email_verified: false,
    invitation_token: null, invitation_expires_at: null,
    reset_password_token: null, reset_password_expires_at: null,
    is_deleted: false, deleted_at: null, last_login_at: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const future = new Date(Date.now() + 3600_000).toISOString();
const past = new Date(Date.now() - 3600_000).toISOString();

describe('AuthService — user management flows', () => {
  let service: AuthService;
  let db: { queryOne: jest.Mock; queryMany: jest.Mock; query: jest.Mock };
  let audit: { log: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(() => {
    db = { queryOne: jest.fn(), queryMany: jest.fn(), query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    config = { get: jest.fn((key: string, def?: any) => def) };
    service = new AuthService(db as any, audit as any, config as any);
  });

  // ── USER-02 Activate account ─────────────────────────────────────
  describe('activateAccount', () => {
    it('sets a bcrypt password, marks ACTIVE, and clears the token', async () => {
      const invited = makeRow({ status: 'PENDING_INVITATION', invitation_token: 'tok', invitation_expires_at: future });
      db.queryOne.mockResolvedValueOnce(invited);                       // token lookup
      db.queryOne.mockResolvedValueOnce(makeRow({ status: 'ACTIVE', email_verified: true })); // UPDATE

      const result = await service.activateAccount('tok', 'newPassword1');

      const updateSql = db.queryOne.mock.calls[1][0];
      expect(updateSql).toContain("status = 'ACTIVE'");
      expect(updateSql).toContain('invitation_token = NULL');
      // password passed to UPDATE is a bcrypt hash, not the plaintext
      const passedHash = db.queryOne.mock.calls[1][1][1];
      expect(passedHash).not.toBe('newPassword1');
      expect(await bcrypt.compare('newPassword1', passedHash)).toBe(true);
      expect(result.status).toBe('ACTIVE');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'user_activated' }));
    });

    it('rejects an invalid token', async () => {
      db.queryOne.mockResolvedValueOnce(null);
      await expect(service.activateAccount('bad', 'newPassword1')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow({ invitation_token: 'tok', invitation_expires_at: past }));
      await expect(service.activateAccount('tok', 'newPassword1')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  // ── Forgot password ──────────────────────────────────────────────
  describe('createPasswordResetToken', () => {
    it('stores a token for an eligible account and audits the request', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow({ status: 'ACTIVE' }));
      const res = await service.createPasswordResetToken('jane@company.com');
      expect(res).not.toBeNull();
      expect(res!.token).toHaveLength(64);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('reset_password_token'),
        expect.arrayContaining([res!.account.id, res!.token]),
      );
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'password_reset_requested' }));
    });

    it('returns null (no enumeration) when no account matches', async () => {
      db.queryOne.mockResolvedValueOnce(null);
      expect(await service.createPasswordResetToken('ghost@company.com')).toBeNull();
    });
  });

  // ── Reset password ───────────────────────────────────────────────
  describe('resetPassword', () => {
    it('updates the password, clears the token, and kills sessions', async () => {
      db.queryOne.mockResolvedValueOnce(
        makeRow({ reset_password_token: 'rt', reset_password_expires_at: future }),
      );
      await service.resetPassword('rt', 'brandNew123');

      const updateSql = db.query.mock.calls[0][0];
      expect(updateSql).toContain('reset_password_token = NULL');
      // sessions deleted for the account
      expect(db.query).toHaveBeenCalledWith('DELETE FROM sessions WHERE account_id = $1', ['user-1']);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'password_reset_completed' }));
    });

    it('rejects an expired reset token', async () => {
      db.queryOne.mockResolvedValueOnce(
        makeRow({ reset_password_token: 'rt', reset_password_expires_at: past }),
      );
      await expect(service.resetPassword('rt', 'brandNew123')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  // ── Login lockout (security requirements) ────────────────────────
  describe('login lockout', () => {
    it('blocks a deactivated (INACTIVE) account even with the right password', async () => {
      const hash = await bcrypt.hash('secret123', 12);
      db.queryOne.mockResolvedValueOnce(makeRow({ password_hash: hash, status: 'INACTIVE', is_active: false }));
      await expect(service.login('jane@company.com', 'secret123')).rejects.toThrow(/not active/i);
    });

    it('blocks a deleted account', async () => {
      const hash = await bcrypt.hash('secret123', 12);
      db.queryOne.mockResolvedValueOnce(makeRow({ password_hash: hash, is_deleted: true, status: 'DELETED' }));
      await expect(service.login('jane@company.com', 'secret123')).rejects.toThrow(/no longer exists/i);
    });

    it('rejects an account that has not set a password yet', async () => {
      db.queryOne.mockResolvedValueOnce(makeRow({ password_hash: null, status: 'PENDING_INVITATION' }));
      await expect(service.login('jane@company.com', 'secret123')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  // ── AUTH-03 Sliding inactivity-based session expiry ──────────────
  describe('AUTH-03 session inactivity expiry', () => {
    /** Build a service whose config returns the given session policy values. */
    function serviceWith(policy: {
      inactivityMinutes?: number; absoluteHours?: number; throttleSeconds?: number;
    }) {
      const cfg = {
        get: jest.fn((key: string, def?: any) => {
          if (key === 'SESSION_INACTIVITY_MINUTES') return policy.inactivityMinutes ?? def;
          if (key === 'SESSION_TTL_HOURS') return policy.absoluteHours ?? def;
          if (key === 'SESSION_SLIDE_THROTTLE_SECONDS') return policy.throttleSeconds ?? def;
          return def;
        }),
      };
      const localDb = { queryOne: jest.fn(), queryMany: jest.fn(), query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      return { svc: new AuthService(localDb as any, audit as any, cfg as any), db: localDb };
    }

    it('login creates a session whose expiry is the inactivity window (capped by absolute TTL)', async () => {
      const { svc, db: localDb } = serviceWith({ inactivityMinutes: 30, absoluteHours: 168 });
      const hash = await bcrypt.hash('secret123', 12);
      localDb.queryOne.mockResolvedValueOnce(makeRow({ password_hash: hash, status: 'ACTIVE' }));

      await svc.login('jane@company.com', 'secret123');

      // db.query call 0 = UPDATE last_login, call 1 = INSERT session
      const insert = localDb.query.mock.calls.find((c: any[]) => /INSERT INTO sessions/.test(c[0]));
      expect(insert).toBeDefined();
      const expiresAt = new Date(insert![1][4]).getTime();
      const expectedSlide = Date.now() + 30 * 60 * 1000;
      expect(Math.abs(expiresAt - expectedSlide)).toBeLessThan(5000); // ~30 min out
    });

    it('validateSession slides the deadline via a throttled, capped, validity-guarded UPDATE', async () => {
      const { svc, db: localDb } = serviceWith({ inactivityMinutes: 30, absoluteHours: 168, throttleSeconds: 60 });
      const session = {
        id: 'sess-1', account_id: 'user-1', token_hash: 'h',
        ip_address: null, user_agent: null,
        expires_at: future, created_at: '2026-01-01T00:00:00Z', last_active_at: past,
      };
      localDb.queryOne.mockResolvedValueOnce(session);                 // SELECT session
      localDb.queryOne.mockResolvedValueOnce(makeRow({ status: 'ACTIVE' })); // SELECT account

      const account = await svc.validateSession('raw-token');
      expect(account).not.toBeNull();

      const slide = localDb.query.mock.calls.find((c: any[]) => /UPDATE sessions/.test(c[0]));
      expect(slide).toBeDefined();
      const [sql, params] = slide!;
      // capped at absolute lifetime, resets last_active, and re-checks validity + throttle
      expect(sql).toContain('LEAST(');
      expect(sql).toContain('last_active_at = NOW()');
      expect(sql).toContain('expires_at > NOW()');           // validity re-check (race-safe)
      expect(sql).toContain('last_active_at <= NOW() - make_interval');  // throttle guard
      expect(params).toEqual(['sess-1', 30, 168, 60]);        // id, inactivityMin, absHours, throttleSec
    });

    it('validateSession returns null and never slides an expired/absent session', async () => {
      const { svc, db: localDb } = serviceWith({});
      localDb.queryOne.mockResolvedValueOnce(null); // SELECT session finds nothing (expires_at > NOW() filter)

      const account = await svc.validateSession('raw-token');
      expect(account).toBeNull();
      const slide = localDb.query.mock.calls.find((c: any[]) => /UPDATE sessions/.test(c[0]));
      expect(slide).toBeUndefined();
    });

    it('rotateSession caps the new deadline at created_at + absolute TTL', async () => {
      // absolute cap 1h; session created 50 min ago → only ~10 min of life left,
      // even though the 7-day inactivity window would otherwise extend it.
      const { svc, db: localDb } = serviceWith({ inactivityMinutes: 10080, absoluteHours: 1 });
      const createdAt = new Date(Date.now() - 50 * 60 * 1000).toISOString();
      localDb.queryOne.mockResolvedValueOnce({ id: 'sess-1', account_id: 'user-1', created_at: createdAt });

      await svc.rotateSession('old-token');

      const upd = localDb.query.mock.calls.find((c: any[]) => /UPDATE sessions/.test(c[0]));
      const expiresAt = new Date(upd![1][1]).getTime();
      const hardCap = new Date(createdAt).getTime() + 60 * 60 * 1000; // created + 1h
      expect(Math.abs(expiresAt - hardCap)).toBeLessThan(5000);       // pinned to the cap
    });

    it('clamps the slide-write throttle below half the inactivity window', async () => {
      // 2-minute inactivity window, configured 60s throttle → clamped to 60s
      // (half of 120s). A 5-minute configured throttle would clamp to 60s too.
      const { svc, db: localDb } = serviceWith({ inactivityMinutes: 2, absoluteHours: 168, throttleSeconds: 300 });
      const session = {
        id: 'sess-1', account_id: 'user-1', token_hash: 'h', ip_address: null, user_agent: null,
        expires_at: future, created_at: '2026-01-01T00:00:00Z', last_active_at: past,
      };
      localDb.queryOne.mockResolvedValueOnce(session);
      localDb.queryOne.mockResolvedValueOnce(makeRow({ status: 'ACTIVE' }));

      await svc.validateSession('raw-token');

      const slide = localDb.query.mock.calls.find((c: any[]) => /UPDATE sessions/.test(c[0]));
      const throttleSec = slide![1][3];
      expect(throttleSec).toBe(60); // min(300, floor(120/2)=60)
    });
  });
});
