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

// ── @CurrentOrg ───────────────────────────────
// Extracts orgId from route params (injected by RlsContextInterceptor).
export const CurrentOrg = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.params.orgId || request.orgId;
  },
);

// ── @Public ───────────────────────────────────
// Marks an endpoint as public (bypasses JwtAuthGuard).
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// ── @RequireRole ──────────────────────────────
// Used alongside OrgRoleGuard to specify minimum required role.
// Usage: @RequireRole('admin') @UseGuards(OrgRoleGuard)
export const REQUIRE_ROLE_KEY = 'requireRole';
export const RequireRole = (role: 'owner' | 'admin' | 'editor' | 'viewer') =>
  SetMetadata(REQUIRE_ROLE_KEY, role);

// ── @OrgId ────────────────────────────────────
// Shorthand to extract just the orgId param.
export const OrgId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    return ctx.switchToHttp().getRequest().params.orgId;
  },
);

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
