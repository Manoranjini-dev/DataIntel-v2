import { Module } from '@nestjs/common';
import { OrgModule } from '../org/org.module';
import { QueryController } from './query.controller';
import { QueryApprovalController } from './query-approval.controller';
import { QueryService } from './query.service';
import { QueryOrchestrationService } from './query-orchestration.service';
import { QueryApprovalService } from './query-approval.service';
import { LLMModule } from '../llm/llm.module';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { ComboModule } from '../combo/combo.module';
import { MCPModule } from '../mcp/mcp.module';

@Module({
  imports: [
    LLMModule,
    DatabaseModule,
    AuditModule,
    ComboModule,
    MCPModule,
    OrgModule,
  ],
  controllers: [QueryController, QueryApprovalController],
  providers: [QueryService, QueryOrchestrationService, QueryApprovalService],
  exports: [QueryService, QueryOrchestrationService, QueryApprovalService],
})
export class QueryModule {}
