// ──────────────────────────────────────────────
// AI Provider Config Controller
// ──────────────────────────────────────────────

import { Controller, Get, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { AiProviderConfigService, AiProviderConfigDto } from './ai-provider-config.service';
import { CurrentUser } from '../common/decorators';
import { SafeAccount } from '../auth/auth.service';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Organization Settings')
@UseGuards(OrgMemberGuard)
@Controller('orgs/:orgId/settings/ai-provider')
export class AiProviderConfigController {
  constructor(private readonly configService: AiProviderConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Get org AI provider configuration' })
  async getConfig(@Param('orgId') orgId: string, @CurrentUser() user: SafeAccount) {
    const config = await this.configService.getConfig(orgId, user);
    return { config };
  }

  @Put()
  @ApiOperation({ summary: 'Update org AI provider configuration' })
  async upsertConfig(
    @Param('orgId') orgId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: AiProviderConfigDto,
  ) {
    await this.configService.upsertConfig(orgId, user, dto);
    return { success: true };
  }

  @Delete()
  @ApiOperation({ summary: 'Delete org AI provider configuration' })
  async deleteConfig(@Param('orgId') orgId: string, @CurrentUser() user: SafeAccount) {
    await this.configService.deleteConfig(orgId, user);
    return { success: true };
  }
}
