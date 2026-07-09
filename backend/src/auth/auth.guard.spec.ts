// ──────────────────────────────────────────────
// AuthGuard ↔ AuthService integration (AUTH-03)
// Exercises the full authenticated-request path: cookie → guard →
// AuthService.validateSession → sliding-expiry write + user attach. Uses the
// REAL AuthService (only the DB is mocked) so the guard and the sliding-session
// logic are verified together.
// ──────────────────────────────────────────────

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { AuthService, AccountRow } from './auth.service';

function makeAccount(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'user-1', email: 'jane@company.com', display_name: 'Jane', password_hash: 'x',
    avatar_url: null, role: 'ANALYST', status: 'ACTIVE', is_active: true, email_verified: true,
    invitation_token: null, invitation_expires_at: null,
    reset_password_token: null, reset_password_expires_at: null,
    is_deleted: false, deleted_at: null, last_login_at: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Minimal ExecutionContext exposing an Express-like request. */
function contextFor(request: any, isPublic = false): { ctx: ExecutionContext; reflector: Reflector } {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(isPublic) } as unknown as Reflector;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

describe('AuthGuard + AuthService (AUTH-03 integration)', () => {
  let db: { queryOne: jest.Mock; queryMany: jest.Mock; query: jest.Mock };
  let authService: AuthService;

  const future = new Date(Date.now() + 3600_000).toISOString();
  const past = new Date(Date.now() - 3600_000).toISOString();

  beforeEach(() => {
    db = { queryOne: jest.fn(), queryMany: jest.fn(), query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: jest.fn((key: string, def?: any) => {
        if (key === 'SESSION_INACTIVITY_MINUTES') return 30;
        if (key === 'SESSION_TTL_HOURS') return 168;
        if (key === 'SESSION_SLIDE_THROTTLE_SECONDS') return 60;
        return def;
      }),
    };
    authService = new AuthService(db as any, audit as any, config as any);
  });

  it('authenticates a valid cookie session, slides the deadline, and attaches the user', async () => {
    db.queryOne
      .mockResolvedValueOnce({ id: 'sess-1', account_id: 'user-1', expires_at: future, created_at: '2026-01-01T00:00:00Z', last_active_at: past }) // SELECT session
      .mockResolvedValueOnce(makeAccount()); // SELECT account

    const request: any = { cookies: { c1x_session: 'raw-token' }, headers: {} };
    const { ctx, reflector } = contextFor(request);
    const guard = new AuthGuard(authService, reflector);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // sliding-expiry write happened as part of validation
    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE sessions[\s\S]*expires_at = LEAST/),
      ['sess-1', 30, 168, 60],
    );
    // user projected onto the request for downstream handlers
    expect(request.user).toMatchObject({ id: 'user-1', role: 'ANALYST' });
  });

  it('accepts a Bearer token as a fallback to the cookie', async () => {
    db.queryOne
      .mockResolvedValueOnce({ id: 'sess-2', account_id: 'user-1', expires_at: future, created_at: '2026-01-01T00:00:00Z', last_active_at: past })
      .mockResolvedValueOnce(makeAccount());

    const request: any = { cookies: {}, headers: { authorization: 'Bearer raw-token' } };
    const { ctx, reflector } = contextFor(request);
    const guard = new AuthGuard(authService, reflector);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toBeDefined();
  });

  it('rejects an expired session with 401 (no user attached)', async () => {
    db.queryOne.mockResolvedValueOnce(null); // SELECT session filters on expires_at > NOW()

    const request: any = { cookies: { c1x_session: 'stale-token' }, headers: {} };
    const { ctx, reflector } = contextFor(request);
    const guard = new AuthGuard(authService, reflector);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(request.user).toBeUndefined();
    expect(db.query).not.toHaveBeenCalledWith(expect.stringMatching(/UPDATE sessions/), expect.anything());
  });

  it('short-circuits public routes without touching the session store', async () => {
    const request: any = { cookies: {}, headers: {} };
    const { ctx, reflector } = contextFor(request, /* isPublic */ true);
    const guard = new AuthGuard(authService, reflector);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(db.queryOne).not.toHaveBeenCalled();
  });
});
