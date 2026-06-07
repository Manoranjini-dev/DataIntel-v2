import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { OrgSettingsService, OrgSettingsData } from './org-settings.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';

@Controller('orgs/:orgId/org-settings')
export class OrgSettingsController {
  constructor(private readonly settingsService: OrgSettingsService) {}

  @Get()
  async get(
    @Param('orgId') orgId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const settings = await this.settingsService.get(orgId, user.id);
    return { settings };
  }

  @Put()
  async update(
    @Param('orgId') orgId: string,
    @CurrentUser() user: SafeAccount,
    @Body() data: OrgSettingsData,
  ) {
    const settings = await this.settingsService.update(orgId, user, data);
    return { settings };
  }

  @Get('features/:flag')
  async getFeatureFlag(
    @Param('orgId') orgId: string,
    @Param('flag') flag: string,
  ) {
    const value = await this.settingsService.getFeatureFlag(orgId, flag);
    return { flag, value };
  }
}
