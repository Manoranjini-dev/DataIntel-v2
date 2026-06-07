import { Controller, Get, Post, Put, Body, Param } from '@nestjs/common';
import { QueryApprovalService } from './query-approval.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';

@Controller('orgs/:orgId/query-approvals')
export class QueryApprovalController {
  constructor(private readonly approvalService: QueryApprovalService) {}

  @Get()
  async listPending(
    @Param('orgId') orgId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const approvals = await this.approvalService.listPending(orgId, user);
    return { approvals };
  }

  @Post()
  async requestApproval(
    @Param('orgId') orgId: string,
    @CurrentUser() user: SafeAccount,
    @Body() body: { executionId: string },
  ) {
    const approval = await this.approvalService.requestApproval(
      orgId, body.executionId, user,
    );
    return { approval };
  }

  @Put(':approvalId')
  async reviewApproval(
    @Param('orgId') orgId: string,
    @Param('approvalId') approvalId: string,
    @CurrentUser() user: SafeAccount,
    @Body() body: { status: 'approved' | 'rejected'; comment?: string },
  ) {
    const approval = await this.approvalService.reviewApproval(
      orgId, approvalId, user, body.status, body.comment,
    );
    return { approval };
  }
}
