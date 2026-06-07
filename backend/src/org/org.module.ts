import { Module } from '@nestjs/common';
import { OrgService } from './org.service';
import { OrgController } from './org.controller';
import { OrgOverviewController, OrgAuditController } from './org-overview.controller';
import { OrgHierarchyController } from './org-hierarchy.controller';
import { OrgInvitationController, InvitationAcceptController } from './org-invitation.controller';
import { OrgPermissionsController } from './org-permissions.controller';
import { OrgSettingsController } from './org-settings.controller';
import { AiProviderConfigController } from './ai-provider-config.controller';

import { OrgPermissionsService } from './org-permissions.service';
import { OrgHierarchyService } from './org-hierarchy.service';
import { OrgInvitationService } from './org-invitation.service';
import { OrgSettingsService } from './org-settings.service';
import { AiProviderConfigService } from './ai-provider-config.service';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [DatabaseModule, RedisModule, AuditModule],
  controllers: [
    OrgController,
    OrgOverviewController,
    OrgAuditController,
    OrgHierarchyController,
    OrgInvitationController,
    InvitationAcceptController,
    OrgPermissionsController,
    OrgSettingsController,
    AiProviderConfigController,
  ],
  providers: [
    OrgService,
    OrgPermissionsService,
    OrgHierarchyService,
    OrgInvitationService,
    OrgSettingsService,
    AiProviderConfigService,
  ],
  exports: [OrgService, OrgPermissionsService],
})
export class OrgModule {}
