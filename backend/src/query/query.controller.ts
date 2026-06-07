// ──────────────────────────────────────────────
// Query Controller — Thin API Surface
// ──────────────────────────────────────────────

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { QueryService } from './query.service';
import { AskDto, ExecuteQueryDto, ExplainSchemaDto, GenerateQueryDto, DashboardQueryDto, DashboardWidgetDto } from './dto/query.dto';
import { ConnectorFamily } from '../common/types';
import { Public } from '../auth/auth.guard';

@Public()
@Controller('query')
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  /**
   * Generate a SQL plan from natural language.
   * Does NOT execute — returns plan for frontend approval.
   */
  @Post('generate')
  async generatePlan(@Body() dto: GenerateQueryDto) {
    return this.queryService.generatePlan(dto.sessionId, dto.prompt);
  }

  /**
   * Execute an approved, validated SQL query.
   * Requires explicit approval from frontend.
   */
  @Post('execute')
  @HttpCode(HttpStatus.OK)
  async executeQuery(@Body() dto: ExecuteQueryDto) {
    if (dto.approved !== true) {
      throw new HttpException(
        { type: 'APPROVAL_REQUIRED', message: 'Execution requires explicit approval (approved: true)' },
        HttpStatus.FORBIDDEN,
      );
    }
    return this.queryService.executeApproved(dto.sessionId, dto.sql, dto.prompt);
  }

  /**
   * Combined ask endpoint — generate + optionally execute.
   */
  @Post('ask')
  async ask(@Body() dto: AskDto) {
    return this.queryService.ask(dto.sessionId, dto.prompt);
  }

  /**
   * Stream query pipeline events (SSE).
   */
  @Post('stream')
  async streamQuery(@Body() dto: GenerateQueryDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      for await (const event of this.queryService.streamQuery(dto.sessionId, dto.prompt)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stream error';
      res.write(`data: ${JSON.stringify({ type: 'error', data: { message } })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'done', data: {} })}\n\n`);
    res.end();
  }

  /**
   * Explain a database schema in plain English using AI.
   * Accepts a pre-built schema summary string — no SQL execution.
   */
  @Post('explain')
  @HttpCode(HttpStatus.OK)
  async explainSchema(@Body() dto: ExplainSchemaDto) {
    return this.queryService.explainSchema(
      dto.schemaSummary,
      dto.databaseName,
      dto.connectorFamily as ConnectorFamily | undefined,
    );
  }

  /**
   * Get query history for a session.
   */
  @Get('history/:sessionId')
  getHistory(@Param('sessionId') sessionId: string) {
    return { queries: this.queryService.getQueryHistory(sessionId) };
  }

  /**
   * Generate dashboard widget definitions for a connected datasource.
   * Returns widget configs with prompts, ui_hints, and sizes.
   */
  @Post('dashboard/widgets')
  @HttpCode(HttpStatus.OK)
  async getDashboardWidgets(@Body() dto: DashboardQueryDto) {
    return this.queryService.generateDashboardQueries(dto.sessionId);
  }

  /**
   * Execute a single dashboard widget query.
   * Takes a natural language prompt, generates plan, executes, returns results.
   */
  @Post('dashboard/execute')
  @HttpCode(HttpStatus.OK)
  async executeDashboardWidget(@Body() dto: DashboardWidgetDto) {
    return this.queryService.executeDashboardWidget(dto.sessionId, dto.prompt);
  }
}
