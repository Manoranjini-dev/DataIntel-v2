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

@Controller('orgs/:orgId/chats')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatQueryService: ChatQueryService,
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
