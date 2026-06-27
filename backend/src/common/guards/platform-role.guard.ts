// ──────────────────────────────────────────────
// PlatformRoleGuard — Enforces platform-wide role on a route.
// Runs after the global AuthGuard, which populates req.user (SafeAccount with `role`).
// Usage: @RequirePlatformRole('ADMIN') @UseGuards(PlatformRoleGuard)
// ──────────────────────────────────────────────

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole, REQUIRE_PLATFORM_ROLE_KEY } from '../decorators';

@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<PlatformRole[]>(
      REQUIRE_PLATFORM_ROLE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    // No platform-role requirement → authentication alone is sufficient.
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { role?: PlatformRole } | undefined;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!user.role || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `This action requires one of the following roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
