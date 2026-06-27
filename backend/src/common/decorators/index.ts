// ──────────────────────────────────────────────
// Common Decorators
// ──────────────────────────────────────────────

import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { SafeAccount } from '../../auth/auth.service';

// ── @CurrentUser ──────────────────────────────
// Extracts the authenticated user from request.user (set by JwtAuthGuard).
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SafeAccount => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

// ── @Public ───────────────────────────────────
// Marks an endpoint as public (bypasses JwtAuthGuard).
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// ── @RequirePlatformRole ──────────────────────
// Platform-wide RBAC.
// Used alongside PlatformRoleGuard to gate ADMIN-only routes such as
// User Management. Usage: @RequirePlatformRole('ADMIN') @UseGuards(PlatformRoleGuard)
export type PlatformRole = 'ADMIN' | 'ANALYST' | 'VIEWER';
export const REQUIRE_PLATFORM_ROLE_KEY = 'requirePlatformRole';
export const RequirePlatformRole = (...roles: PlatformRole[]) =>
  SetMetadata(REQUIRE_PLATFORM_ROLE_KEY, roles);

// ── @ConnectionId ─────────────────────────────
export const ConnectionId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    return ctx.switchToHttp().getRequest().params.connId;
  },
);

// ── @ComboId ──────────────────────────────────
export const ComboId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    return ctx.switchToHttp().getRequest().params.comboId;
  },
);
