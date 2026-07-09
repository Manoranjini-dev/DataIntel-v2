// ──────────────────────────────────────────────
// Chat Controller — /chats
// ──────────────────────────────────────────────

import {
  Controller, Get, Post, Delete, Body, Param, HttpCode, HttpStatus, Query, Patch, Logger, HttpException,
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

@Controller('chats')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly chatQueryService: ChatQueryService,
    private readonly llmService: LLMService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: SafeAccount,
    @Query('connectionId') connectionId?: string,
    @Query('comboId') comboId?: string,
    @Query('isArchived') isArchived?: string,
  ) {
    const isArchivedBool = isArchived === 'true' ? true : isArchived === 'false' ? false : undefined;
    const chats = await this.chatService.list(user.id, { connectionId, comboId, isArchived: isArchivedBool });
    return { chats };
  }

  /**
   * Part 1 — datasource-aware starter questions for the chat landing page.
   * Declared before the `:chatId` routes so "starter-questions" is not captured
   * as a chat id.
   */
  @Get('starter-questions')
  async starterQuestions(
    @CurrentUser() user: SafeAccount,
    @Query('connectionId') connectionId: string,
  ) {
    if (!connectionId) return { questions: [] };
    const questions = await this.chatQueryService.generateStarterQuestions(connectionId, user);
    return { questions };
  }

  @Post()
  async create(
    @CurrentUser() user: SafeAccount,
    @Body() dto: CreateChatDto,
  ) {
    const chat = await this.chatService.create(user, dto);
    return { chat };
  }



  @Post('suggest-title')
  @HttpCode(HttpStatus.OK)
  async suggestTitle(
    @CurrentUser() user: SafeAccount,
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

    // Use a generous token budget AND constrain reasoning: the model is a
    // reasoning model, so a tiny cap (the old value was 50) — or unconstrained
    // reasoning — gets the whole budget consumed by hidden reasoning and yields
    // empty content. A 256-token budget with 'low' reasoning effort leaves room
    // for the model to emit the title itself on the first attempt.
    this.logger.debug(`suggest-title prompt: "${dto.prompt.replace(/\s+/g, ' ').slice(0, 300)}"`);
    let raw = '';
    try {
      raw = await this.llmService.generateFreeText(systemPrompt, dto.prompt, 256, {
        reasoningEffort: 'low',
      });
    } catch (e) {
      this.logger.warn(`suggest-title LLM call threw: ${e instanceof Error ? e.message : e}`);
    }
    this.logger.debug(`suggest-title raw model response: "${(raw || '').replace(/\s+/g, ' ').slice(0, 300)}"`);

    const aiTitle = this.sanitizeTitle(raw);
    if (aiTitle) {
      this.logger.debug(`suggest-title generated: "${aiTitle}"`);
      return { title: aiTitle };
    }

    // Recoverable empty/failed AI response — never 500. Derive a deterministic
    // fallback title from the prompt context (business intent / columns).
    const fallback = this.fallbackTitle(dto.prompt);
    this.logger.warn(`suggest-title: AI returned no usable title; using fallback "${fallback}"`);
    return { title: fallback, fallback: true };
  }

  /** Clean an AI title: strip quotes/fences, collapse whitespace, clip length. */
  private sanitizeTitle(raw: string): string {
    if (!raw) return '';
    let t = raw.trim()
      .replace(/^```(?:\w+)?/i, '').replace(/```$/, '')
      .replace(/^["'`]|["'`]$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    // Guard against the model echoing an instruction or returning prose.
    if (!t || /^no\s|cannot|unable|as an ai/i.test(t)) return '';
    return t.slice(0, 80);
  }

  /**
   * Deterministic fallback title derived from the structured prompt the frontend
   * sends (Visualization Type / Columns / Business Intent / SQL Logic). Ensures
   * the endpoint always returns a meaningful title even when the AI is empty.
   */
  private fallbackTitle(prompt: string): string {
    const intent = /business intent:\s*(.+)/i.exec(prompt)?.[1]?.trim();
    if (intent) return this.toTitleCase(intent);

    const cols = /columns:\s*(.+)/i.exec(prompt)?.[1]?.trim();
    if (cols) {
      const first = cols.split(',')[0]?.trim();
      if (first) return `${this.toTitleCase(first)} Overview`;
    }

    const firstLine = prompt.replace(/\s+/g, ' ').trim().split(/[.\n]/)[0] || '';
    return this.toTitleCase(firstLine) || 'Insight';
  }

  private toTitleCase(s: string): string {
    const clean = s.replace(/["'`]/g, '').replace(/[_-]+/g, ' ').trim();
    const words = clean.split(/\s+/).filter(Boolean).slice(0, 8)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1));
    return words.join(' ').slice(0, 80);
  }

  @Get(':chatId')
  async get(
    @CurrentUser() user: SafeAccount,
    @Param('chatId') chatId: string,
  ) {
    const chat = await this.chatService.get(chatId, user.id);
    return { chat };
  }

  @Get(':chatId/messages')
  async getMessages(
    @CurrentUser() user: SafeAccount,
    @Param('chatId') chatId: string,
  ) {
    const messages = await this.chatService.getMessages(chatId, user.id);
    if (messages.length > 0) {
      const latest = messages[messages.length - 1];
      if (latest.role === 'assistant' && (!latest.followUpQuestions || latest.followUpQuestions.length === 0)) {
        try {
          const chat = await this.chatService.get(chatId, user.id) as any;
          if (chat?.connection_id) {
            const followUps = await this.chatQueryService.regenerateFollowUpsForMessage(chatId, latest, messages, chat.connection_id);
            if (followUps && followUps.length > 0) {
              latest.followUpQuestions = followUps;
              await this.chatService.updateFollowUps(latest.id, followUps).catch(() => {});
            }
          }
        } catch {}
      }
    }
    return { messages };
  }

  /** Execute an AI query in a connection-scoped chat */
  @Post(':chatId/ask')
  async ask(
    @CurrentUser() user: SafeAccount,
    @Param('chatId') chatId: string,
    @Body() dto: AskDto,
  ) {
    try {
      return await this.chatQueryService.query(chatId, user, dto.prompt);
    } catch (err: any) {
      if (err instanceof HttpException && err.getStatus() < 500) throw err;
      const response = err instanceof HttpException ? err.getResponse() : null;
      const rawMessage = typeof response === 'object' && response !== null ? (response as any).message || (response as any).error : (typeof response === 'string' ? response : err?.message);
      const friendlyMessage = Array.isArray(rawMessage) ? rawMessage.join('; ') : (rawMessage || 'Something went wrong while generating your query.');
      return {
        success: false,
        message: 'Unable to generate an answer for this query.',
        reason: friendlyMessage,
        suggestions: ['Show me all tables', 'How many records are in each table?'],
        sql: null,
        chart: null,
        userMessage: { id: `u-${Date.now()}`, chat_id: chatId, role: 'user', content: dto?.prompt || '', created_at: new Date().toISOString() },
        assistantMessage: { id: `err-${Date.now()}`, chat_id: chatId, role: 'assistant', content: friendlyMessage, created_at: new Date().toISOString() },
        followUpQuestions: ['Show me all tables', 'How many records are in each table?'],
        execution: { status: 'failed', error_message: friendlyMessage, rows: [], columns: [] },
      };
    }
  }

  /** Re-execute a (possibly user-edited) SQL draft */
  @Post(':chatId/execute-draft')
  @HttpCode(HttpStatus.OK)
  async executeDraft(
    @CurrentUser() user: SafeAccount,
    @Param('chatId') chatId: string,
    @Body() dto: ExecuteDraftDto,
  ) {
    try {
      return await this.chatQueryService.executeDraft(chatId, user, dto.executionId || '', dto.sql);
    } catch (err: any) {
      if (err instanceof HttpException && err.getStatus() < 500) throw err;
      const response = err instanceof HttpException ? err.getResponse() : null;
      const rawMessage = typeof response === 'object' && response !== null ? (response as any).message || (response as any).error : (typeof response === 'string' ? response : err?.message);
      const errorMsg = Array.isArray(rawMessage) ? rawMessage.join('; ') : (rawMessage || 'Execution failed');
      return {
        success: false,
        status: 'failed',
        rows: [],
        columns: [],
        row_count: 0,
        execution_time_ms: 0,
        error_message: errorMsg,
        message: 'Unable to execute query draft.',
        reason: errorMsg,
        suggestions: [],
        sql: dto?.sql || '',
        chart: null,
      };
    }
  }

  /**
   * Re-execute stored SQL for a list of execution IDs against the live database.
   * Returns fresh rows WITHOUT overwriting the stored result_preview snapshots.
   */
  @Post(':chatId/refresh-messages')
  @HttpCode(HttpStatus.OK)
  async refreshMessages(
    @CurrentUser() user: SafeAccount,
    @Param('chatId') chatId: string,
    @Body('executionIds') executionIds: string[],
  ) {
    try {
      if (!Array.isArray(executionIds) || executionIds.length === 0) {
        return { results: [] };
      }
      const results = await this.chatQueryService.refreshMessages(chatId, user, executionIds);
      return { results };
    } catch (err: any) {
      if (err instanceof HttpException && err.getStatus() < 500) throw err;
      return { results: [] };
    }
  }

  /**
   * Re-execute stored sub-queries for a COMBO chat and return merged live rows.
   * Does NOT overwrite stored result_preview snapshots.
   */
  @Post(':chatId/refresh-combo-messages')
  @HttpCode(HttpStatus.OK)
  async refreshComboMessages(
    @CurrentUser() user: SafeAccount,
    @Param('chatId') chatId: string,
    @Body('executionIds') executionIds: string[],
  ) {
    try {
      if (!Array.isArray(executionIds) || executionIds.length === 0) {
        return { results: [] };
      }
      const results = await this.chatQueryService.refreshComboMessages(chatId, user, executionIds);
      return { results };
    } catch (err: any) {
      if (err instanceof HttpException && err.getStatus() < 500) throw err;
      return { results: [] };
    }
  }


  @Patch(':chatId/title')
  async updateTitle(
    @CurrentUser() user: SafeAccount,
    @Param('chatId') chatId: string,
    @Body() body: { title: string },
  ) {
    const chat = await this.chatService.updateTitle(chatId, user.id, body.title);
    return { chat };
  }

  @Post(':chatId/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentUser() user: SafeAccount,
    @Param('chatId') chatId: string,
  ) {
    await this.chatService.archive(chatId, user);
    return { success: true };
  }

  @Post(':chatId/unarchive')
  @HttpCode(HttpStatus.OK)
  async unarchive(
    @CurrentUser() user: SafeAccount,
    @Param('chatId') chatId: string,
  ) {
    await this.chatService.unarchive(chatId, user);
    return { success: true };
  }

  @Delete(':chatId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: SafeAccount,
    @Param('chatId') chatId: string,
  ) {
    await this.chatService.delete(chatId, user);
  }
}
