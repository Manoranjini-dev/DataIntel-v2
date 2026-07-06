// ──────────────────────────────────────────────
// SSO Admin Controller — provider configuration (ADMIN only)
//   GET /auth/admin/sso/providers
//   PUT /auth/admin/sso/providers/:provider
// Separate base path from the public flows so 'admin' never collides with the
// public :provider route param.
// ──────────────────────────────────────────────

import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { RequirePlatformRole } from '../common/decorators';
import { PlatformRoleGuard } from '../common/guards/platform-role.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';
import { SsoConfigService } from './sso-config.service';
import { UpsertSsoProviderDto } from './dto/sso.dto';
import { isSsoProvider } from './types';

@Controller('auth/admin/sso')
@RequirePlatformRole('ADMIN')
@UseGuards(PlatformRoleGuard)
export class SsoAdminController {
  constructor(private readonly ssoConfig: SsoConfigService) {}

  /** All providers with config visible and secrets redacted. */
  @Get('providers')
  async list() {
    return { success: true, providers: await this.ssoConfig.listAdmin() };
  }

  /** Enable/disable + configure a provider. */
  @Put('providers/:provider')
  async upsert(
    @Param('provider') provider: string,
    @Body() dto: UpsertSsoProviderDto,
    @CurrentUser() user: SafeAccount,
  ) {
    if (!isSsoProvider(provider)) {
      throw new BadRequestException(`Unknown SSO provider: ${provider}`);
    }
    const updated = await this.ssoConfig.upsert(provider, dto, user.id);
    return { success: true, provider: updated };
  }
}
