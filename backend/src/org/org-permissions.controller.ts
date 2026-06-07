import { Controller, Get, Param } from '@nestjs/common';
import { OrgPermissionsService } from './org-permissions.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';

@Controller('orgs/:orgId/permissions')
export class OrgPermissionsController {
  constructor(private readonly permissionsService: OrgPermissionsService) {}

  @Get('role')
  async getMyRole(
    @Param('orgId') orgId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const role = await this.permissionsService.getEffectiveRole(orgId, user.id);
    return { role };
  }

  @Get('role/:accountId')
  async getUserRole(
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    await this.permissionsService.requireRole(orgId, user.id, 'admin');
    const role = await this.permissionsService.getEffectiveRole(orgId, accountId);
    return { role };
  }
}
