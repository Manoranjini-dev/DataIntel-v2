import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatQueryService } from './chat-query.service';
import { QueryExecutionService } from './query-execution.service';
import { OrgModule } from '../org/org.module';
import { LLMModule } from '../llm/llm.module';

@Module({
  imports: [OrgModule, LLMModule],
  controllers: [ChatController],
  providers: [ChatService, ChatQueryService, QueryExecutionService],
  exports: [ChatService, ChatQueryService, QueryExecutionService],
})
export class ChatModule {}
