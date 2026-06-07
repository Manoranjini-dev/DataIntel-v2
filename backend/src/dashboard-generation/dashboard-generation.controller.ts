// ──────────────────────────────────────────────
// Dashboard Generation Controller
// ──────────────────────────────────────────────

import { Controller, Post, Get, Body, Param, UseGuards, UseInterceptors } from '@nestjs/common';
import { DashboardGenerationService } from './dashboard-generation.service';
import { CurrentUser, OrgId } from '../common/decorators';
import { SafeAccount } from '../auth/auth.service';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Dashboard Generation')
@UseGuards(OrgMemberGuard)
@UseInterceptors(RlsContextInterceptor)
@Controller('orgs/:orgId/dashboard-generation')
export class DashboardGenerationController {
  constructor(private readonly generationService: DashboardGenerationService) {}

  @Post('jobs')
  @ApiOperation({ summary: 'Queue a new dashboard generation job' })
  async queueJob(
    @OrgId() orgId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: { intent: string; contextType: string; contextId: string; templateId?: string }
  ) {
    const job = await this.generationService.queueGenerationJob(orgId, user, dto);
    return { job };
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Poll job status' })
  async getJobStatus(
    @OrgId() orgId: string,
    @Param('jobId') jobId: string,
  ) {
    const status = await this.generationService.getJobStatus(jobId, orgId);
    return { status };
  }
}
