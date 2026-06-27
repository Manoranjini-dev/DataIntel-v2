// ──────────────────────────────────────────────
// Dashboard Generation Controller
// ──────────────────────────────────────────────

import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { DashboardGenerationService } from './dashboard-generation.service';
import { CurrentUser } from '../common/decorators';
import { SafeAccount } from '../auth/auth.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Dashboard Generation')
@Controller('dashboard-generation')
export class DashboardGenerationController {
  constructor(private readonly generationService: DashboardGenerationService) {}

  @Post('jobs')
  @ApiOperation({ summary: 'Queue a new dashboard generation job' })
  async queueJob(
    @CurrentUser() user: SafeAccount,
    @Body() dto: { intent: string; contextType: string; contextId: string; templateId?: string }
  ) {
    const job = await this.generationService.queueGenerationJob(user, dto);
    return { job };
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Poll job status' })
  async getJobStatus(
    @CurrentUser() user: SafeAccount,
    @Param('jobId') jobId: string,
  ) {
    const status = await this.generationService.getJobStatus(jobId, user.id);
    return { status };
  }
}
