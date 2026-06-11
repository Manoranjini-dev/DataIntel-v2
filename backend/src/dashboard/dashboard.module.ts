import { Module } from '@nestjs/common';

import { DashboardController } from './dashboard.controller';
import { OrgModule } from '../org/org.module';

import { DatabaseModule } from '../database/database.module';
import { CacheModule } from '../cache/cache.module';
import { AuditModule } from '../audit/audit.module';
import { MCPModule } from '../mcp/mcp.module';
import { LLMModule } from '../llm/llm.module';
import { ComboModule } from '../combo/combo.module';
import { DashboardBuilderService } from './dashboard-builder.service';
import { DashboardCacheService } from './dashboard-cache.service';
import { DashboardPermissionsService } from './dashboard-permissions.service';
import { WidgetExecutionService } from './widget-execution.service';



@Module({
  imports: [
    OrgModule,
    DatabaseModule,
    CacheModule,
    AuditModule,
    MCPModule,
    LLMModule,
    ComboModule,
  ],
  controllers: [DashboardController],
  providers: [
    DashboardBuilderService,
    DashboardCacheService,
    DashboardPermissionsService,
    WidgetExecutionService,
  ],
  exports: [
    DashboardBuilderService,
    DashboardCacheService,
    DashboardPermissionsService,
    WidgetExecutionService,
  ],
})
export class DashboardModule {}
