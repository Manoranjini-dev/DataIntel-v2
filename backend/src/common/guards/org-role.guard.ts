// ──────────────────────────────────────────────
// OrgRoleGuard — Enforces minimum role on org-scoped routes
// Must be used AFTER OrgMemberGuard (which sets req.orgRole)
// Usage: @RequireRole('admin') @UseGuards(OrgMemberGuard, OrgRoleGuard)
// ──────────────────────────────────────────────

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_ROLE_KEY } from '../decorators';

type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredRole = this.reflector.getAllAndOverride<OrgRole>(REQUIRE_ROLE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    // No role requirement → org membership alone is sufficient
    if (!requiredRole) return true;

    const req = ctx.switchToHttp().getRequest();
    const userRole = req.orgRole as OrgRole | undefined;

    if (!userRole) {
      throw new ForbiddenException('Organization role not resolved — ensure OrgMemberGuard runs first');
    }

    if (ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[requiredRole]) {
      throw new ForbiddenException(
        `This action requires the "${requiredRole}" role or higher. Your role: "${userRole}"`,
      );
    }

    return true;
  }
}
