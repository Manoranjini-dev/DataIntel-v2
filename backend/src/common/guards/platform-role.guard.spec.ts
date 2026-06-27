// ──────────────────────────────────────────────
// PlatformRoleGuard unit tests (RBAC)
// ──────────────────────────────────────────────

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRoleGuard } from './platform-role.guard';

function ctxFor(user: any): any {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => null,
    getClass: () => null,
  };
}

describe('PlatformRoleGuard', () => {
  let reflector: Reflector;
  let guard: PlatformRoleGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PlatformRoleGuard(reflector);
  });

  it('allows the route when no platform role is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(ctxFor({ role: 'VIEWER' }))).toBe(true);
  });

  it('allows an ADMIN', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(guard.canActivate(ctxFor({ role: 'ADMIN' }))).toBe(true);
  });

  it('forbids an ANALYST from an ADMIN-only route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(ctxFor({ role: 'ANALYST' }))).toThrow(ForbiddenException);
  });

  it('forbids a VIEWER from an ADMIN-only route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(ctxFor({ role: 'VIEWER' }))).toThrow(ForbiddenException);
  });

  it('rejects an unauthenticated request', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(ctxFor(undefined))).toThrow(UnauthorizedException);
  });
});
