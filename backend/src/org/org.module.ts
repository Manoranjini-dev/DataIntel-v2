import { Module } from '@nestjs/common';
import { OrgService } from './org.service';
import { OrgController } from './org.controller';
import { OrgOverviewController, OrgAuditController } from './org-overview.controller';

@Module({
  controllers: [OrgController, OrgOverviewController, OrgAuditController],
  providers: [OrgService],
  exports: [OrgService],
})
export class OrgModule {}
