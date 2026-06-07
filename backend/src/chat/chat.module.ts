import { Module } from '@nestjs/common';
import { QueryModule } from '../query/query.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatStreamController } from './chat-stream.controller';

import { ChatQueryService } from './chat-query.service';
import { ChatPromotionService } from './chat-promotion.service';
import { QueryExecutionService } from './query-execution.service';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';

import { OrgModule } from '../org/org.module';
import { CardModule } from '../card/card.module';
import { LLMModule } from '../llm/llm.module';
import { MCPModule } from '../mcp/mcp.module';

@Module({
  imports: [DatabaseModule, AuditModule, OrgModule, LLMModule, CardModule, QueryModule, MCPModule],
  controllers: [ChatController, ChatStreamController],
  providers: [ChatService, ChatQueryService, QueryExecutionService, ChatPromotionService],
  exports: [ChatService, ChatQueryService, QueryExecutionService, ChatPromotionService],
})
export class ChatModule {}
