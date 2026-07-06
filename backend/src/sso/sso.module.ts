// ──────────────────────────────────────────────
// SSO Module — enterprise Single Sign-On (Google / Entra / LDAP)
// ──────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformRoleGuard } from '../common/guards/platform-role.guard';
import { SsoConfigService } from './sso-config.service';
import { SsoProvisioningService } from './sso-provisioning.service';
import { OidcService } from './oidc.service';
import { LdapService } from './ldap.service';
import { SsoController } from './sso.controller';
import { SsoAdminController } from './sso-admin.controller';

@Module({
  imports: [AuthModule],
  controllers: [SsoController, SsoAdminController],
  providers: [
    SsoConfigService,
    SsoProvisioningService,
    OidcService,
    LdapService,
    PlatformRoleGuard,
  ],
  exports: [SsoConfigService],
})
export class SsoModule {}
