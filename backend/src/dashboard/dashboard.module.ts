import { Module } from '@nestjs/common';

import { DashboardController } from './dashboard.controller';
import { OrgModule } from '../org/org.module';

import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { AuditModule } from '../audit/audit.module';
import { MCPModule } from '../mcp/mcp.module';
import { LLMModule } from '../llm/llm.module';
import { DashboardBuilderService } from './dashboard-builder.service';
import { DashboardCacheService } from './dashboard-cache.service';
import { DashboardPermissionsService } from './dashboard-permissions.service';
import { WidgetExecutionService } from './widget-execution.service';
import { WidgetRefreshProcessor } from './widget-refresh.processor';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    OrgModule,
    DatabaseModule,
    RedisModule,
    AuditModule,
    MCPModule,
    LLMModule,
    BullModule.registerQueue({ name: 'widget-refresh' }),
  ],
  controllers: [DashboardController],
  providers: [
    DashboardBuilderService,
    DashboardCacheService,
    DashboardPermissionsService,
    WidgetExecutionService,
    WidgetRefreshProcessor,
  ],
  exports: [
    DashboardBuilderService,
    DashboardCacheService,
    DashboardPermissionsService,
    WidgetExecutionService,
  ],
})
export class DashboardModule {}
