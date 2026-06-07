// ──────────────────────────────────────────────
// Account Controller — /api/account
// ──────────────────────────────────────────────

import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { UserSettingsService } from './user-settings.service';
import { CurrentUser } from '../common/decorators';
import { SafeAccount } from '../auth/auth.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Account')
@Controller('account')
export class AccountController {
  constructor(private readonly settingsService: UserSettingsService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get current user settings' })
  async getSettings(@CurrentUser() user: SafeAccount) {
    const settings = await this.settingsService.getSettings(user.id);
    return { settings };
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update user settings' })
  async updateSettings(
    @CurrentUser() user: SafeAccount,
    @Body() data: { theme?: string; defaultOrgId?: string; notificationPreferences?: any },
  ) {
    const settings = await this.settingsService.updateSettings(user.id, data);
    return { settings };
  }
}
