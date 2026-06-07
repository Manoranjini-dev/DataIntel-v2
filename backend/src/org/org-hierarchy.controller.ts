import { Controller, Get, Post, Put, Body, Param } from '@nestjs/common';
import { OrgHierarchyService } from './org-hierarchy.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';

@Controller('orgs/:orgId/hierarchy')
export class OrgHierarchyController {
  constructor(private readonly hierarchyService: OrgHierarchyService) {}

  @Get('children')
  async getChildren(
    @Param('orgId') orgId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const children = await this.hierarchyService.getChildren(orgId, user.id);
    return { children };
  }

  @Get('ancestors')
  async getAncestors(
    @Param('orgId') orgId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const ancestors = await this.hierarchyService.getAncestors(orgId, user.id);
    return { ancestors };
  }

  @Get('subtree')
  async getSubtree(
    @Param('orgId') orgId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const subtree = await this.hierarchyService.getSubtree(orgId, user.id);
    return { subtree };
  }

  @Post('children')
  async createChild(
    @Param('orgId') orgId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: { name: string; slug: string; description?: string },
  ) {
    const child = await this.hierarchyService.createChild(orgId, user, dto);
    return { child };
  }

  @Put('move')
  async moveOrg(
    @Param('orgId') orgId: string,
    @CurrentUser() user: SafeAccount,
    @Body() body: { newParentOrgId: string },
  ) {
    await this.hierarchyService.moveOrg(orgId, body.newParentOrgId, user);
    return { success: true };
  }
}
