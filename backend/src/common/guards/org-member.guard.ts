// ──────────────────────────────────────────────
// OrgMemberGuard — Verifies user belongs to the org in :orgId
// ──────────────────────────────────────────────

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrgPermissionsService } from '../../org/org-permissions.service';

@Injectable()
export class OrgMemberGuard implements CanActivate {
  private readonly logger = new Logger(OrgMemberGuard.name);

  constructor(private readonly orgPermissions: OrgPermissionsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const orgId: string = req.params.orgId;
    const user = req.user;

    if (!user) throw new ForbiddenException('Unauthenticated');
    if (!orgId) throw new NotFoundException('Organization ID not found in route');

    const role = await this.orgPermissions.getEffectiveRole(orgId, user.id);
    if (!role) {
      throw new ForbiddenException('You are not a member of this organization');
    }

    // Attach role to request for downstream guards/handlers
    req.orgRole = role;
    req.orgId = orgId;

    return true;
  }
}
