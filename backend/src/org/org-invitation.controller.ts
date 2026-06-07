import {
  Controller, Get, Post, Delete, Body, Param, HttpCode, HttpStatus,
} from '@nestjs/common';
import { OrgInvitationService } from './org-invitation.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';
import { OrgRole } from './org-permissions.service';

@Controller('orgs/:orgId/invitations')
export class OrgInvitationController {
  constructor(private readonly invitationService: OrgInvitationService) {}

  @Get()
  async listPending(
    @Param('orgId') orgId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const invitations = await this.invitationService.listPending(orgId, user.id);
    return { invitations };
  }

  @Post()
  async invite(
    @Param('orgId') orgId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: { email: string; role: OrgRole; message?: string },
  ) {
    const invitation = await this.invitationService.invite(
      orgId, user, dto.email, dto.role, dto.message,
    );
    return { invitation };
  }

  @Delete(':invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('orgId') orgId: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    await this.invitationService.revoke(orgId, invitationId, user);
  }
}

@Controller('invitations')
export class InvitationAcceptController {
  constructor(private readonly invitationService: OrgInvitationService) {}

  @Post('accept')
  async accept(
    @CurrentUser() user: SafeAccount,
    @Body() body: { token: string },
  ) {
    const result = await this.invitationService.accept(body.token, user);
    return result;
  }
}
