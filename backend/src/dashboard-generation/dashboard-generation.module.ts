// ──────────────────────────────────────────────
// Dashboard Generation Module
// ──────────────────────────────────────────────

import { Module } from '@nestjs/common';

import { DashboardGenerationController } from './dashboard-generation.controller';
import { DashboardGenerationService } from './dashboard-generation.service';
import { LayoutEngineService } from './layout-engine.service';
import { WidgetRecommendationService } from './widget-recommendation.service';

import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';

import { DashboardModule } from '../dashboard/dashboard.module';
import { LLMModule } from '../llm/llm.module';

import { OrgModule } from '../org/org.module';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    DashboardModule,
    LLMModule,
    OrgModule,
  ],
  controllers: [DashboardGenerationController],
  providers: [
    DashboardGenerationService,
    LayoutEngineService,
    WidgetRecommendationService,
  ],
  exports: [DashboardGenerationService]
})
export class DashboardGenerationModule {}
