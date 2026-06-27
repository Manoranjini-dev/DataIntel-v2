import { Module } from '@nestjs/common';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';
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
  ],
  controllers: [QueryController],
  providers: [QueryService],
  exports: [QueryService],
})
export class QueryModule {}
