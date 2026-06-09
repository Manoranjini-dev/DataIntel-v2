// ──────────────────────────────────────────────
// Chat Controller — /orgs/:orgId/chats
// ──────────────────────────────────────────────

import {
  Controller, Get, Post, Delete, Body, Param, HttpCode, HttpStatus, Query, Patch,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatQueryService } from './chat-query.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';
import { LLMService } from '../llm/llm.service';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

class CreateChatDto {
  @IsString() @IsOptional() connectionId?: string;
  @IsString() @IsOptional() comboId?: string;
  @IsString() @IsOptional() title?: string;
}

class AskDto {
  @IsString() @IsNotEmpty() prompt!: string;
  @IsOptional() stream?: boolean;
  @IsOptional() autoExecute?: boolean;
}

class ExecuteDraftDto {
  @IsString() @IsOptional() executionId?: string;
  @IsString() @IsNotEmpty() sql!: string;
}

class SuggestTitleDto {
  @IsString() @IsNotEmpty() prompt!: string;
}

@Controller('orgs/:orgId/chats')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatQueryService: ChatQueryService,
    private readonly llmService: LLMService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Query('connectionId') connectionId?: string,
    @Query('comboId') comboId?: string,
    @Query('isArchived') isArchived?: string,
  ) {
    const isArchivedBool = isArchived === 'true' ? true : isArchived === 'false' ? false : undefined;
    const chats = await this.chatService.list(orgId, user.id, { connectionId, comboId, isArchived: isArchivedBool });
    return { chats };
  }

  @Post()
  async create(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Body() dto: CreateChatDto,
  ) {
    const chat = await this.chatService.create(orgId, user, dto);
    return { chat };
  }



  @Post('suggest-title')
  @HttpCode(HttpStatus.OK)
  async suggestTitle(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Body() dto: SuggestTitleDto,
  ) {
    const systemPrompt = `You are an expert Data Analyst and UI Designer. Your task is to generate high-quality, professional, and concise titles for dashboard cards based on the provided context (business intent, SQL logic, visualization type, and columns).

Rules:
1. Title length must be strictly between 3 and 8 words.
2. Focus on the primary metric, dimension, or business trend being visualized.
3. Avoid generic terms like "Chart", "Dashboard", "Analysis", "Report", "Card", or "Visualization".
4. Use clear, business-friendly language.
5. If the SQL contains filters (e.g. 'WHERE status = active') or aggregations (e.g. 'SUM(revenue)'), reflect them gracefully in the title (e.g. 'Active User Revenue').
6. Do NOT wrap the title in quotes.
7. Return ONLY the title text, nothing else.`;

    const title = await this.llmService.generateFreeText(systemPrompt, dto.prompt, 50);
    if (title.includes('AI service error')) {
      throw new Error(title);
    }
    return { title };
  }

  @Get(':chatId')
  async get(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('chatId') chatId: string,
  ) {
    const chat = await this.chatService.get(orgId, chatId, user.id);
    return { chat };
  }

  @Get(':chatId/messages')
  async getMessages(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('chatId') chatId: string,
  ) {
    const messages = await this.chatService.getMessages(orgId, chatId, user.id);
    return { messages };
  }

  /** Execute an AI query in a connection-scoped chat */
  @Post(':chatId/ask')
  async ask(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('chatId') chatId: string,
    @Body() dto: AskDto,
  ) {
    return this.chatQueryService.query(orgId, chatId, user, dto.prompt);
  }

  /** Re-execute a (possibly user-edited) SQL draft */
  @Post(':chatId/execute-draft')
  @HttpCode(HttpStatus.OK)
  async executeDraft(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('chatId') chatId: string,
    @Body() dto: ExecuteDraftDto,
  ) {
    return this.chatQueryService.executeDraft(orgId, chatId, user, dto.executionId || '', dto.sql);
  }

  @Patch(':chatId/title')
  async updateTitle(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('chatId') chatId: string,
    @Body() body: { title: string },
  ) {
    const chat = await this.chatService.updateTitle(orgId, chatId, user.id, body.title);
    return { chat };
  }

  @Post(':chatId/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('chatId') chatId: string,
  ) {
    await this.chatService.archive(orgId, chatId, user);
    return { success: true };
  }

  @Post(':chatId/unarchive')
  @HttpCode(HttpStatus.OK)
  async unarchive(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('chatId') chatId: string,
  ) {
    await this.chatService.unarchive(orgId, chatId, user);
    return { success: true };
  }

  @Delete(':chatId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('chatId') chatId: string,
  ) {
    await this.chatService.delete(orgId, chatId, user);
  }
}
