// ──────────────────────────────────────────────
// Org Controller
// ──────────────────────────────────────────────

import {
  Controller, Get, Post, Put, Delete, Body, Param,
  HttpCode, HttpStatus, Req,
} from '@nestjs/common';
import { OrgService } from './org.service';
import { CreateOrgDto, UpdateOrgDto, InviteMemberDto } from './dto/org.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';

@Controller('orgs')
export class OrgController {
  constructor(private readonly orgService: OrgService) {}

  @Get()
  async list(@CurrentUser() user: SafeAccount) {
    const orgs = await this.orgService.listForUser(user.id);
    return { orgs };
  }

  @Post()
  async create(@CurrentUser() user: SafeAccount, @Body() dto: CreateOrgDto) {
    const org = await this.orgService.create(user, dto);
    return { org };
  }

  @Get(':slug')
  async get(@CurrentUser() user: SafeAccount, @Param('slug') slug: string) {
    const org = await this.orgService.getBySlug(slug, user.id);
    return { org };
  }

  @Put(':id')
  async update(
    @CurrentUser() user: SafeAccount,
    @Param('id') id: string,
    @Body() dto: UpdateOrgDto,
  ) {
    const org = await this.orgService.update(id, user, dto);
    return { org };
  }

  @Get(':id/members')
  async listMembers(@CurrentUser() user: SafeAccount, @Param('id') id: string) {
    const members = await this.orgService.listMembers(id, user.id);
    return { members };
  }

  @Post(':id/members')
  async inviteMember(
    @CurrentUser() user: SafeAccount,
    @Param('id') id: string,
    @Body() dto: InviteMemberDto,
  ) {
    const member = await this.orgService.inviteMember(id, user, dto.email, dto.role);
    return { member };
  }

  @Delete(':id/members/:accountId')
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @CurrentUser() user: SafeAccount,
    @Param('id') id: string,
    @Param('accountId') accountId: string,
  ) {
    await this.orgService.removeMember(id, user, accountId);
    return { success: true };
  }

  @Put(':id/members/:accountId/role')
  async changeRole(
    @CurrentUser() user: SafeAccount,
    @Param('id') id: string,
    @Param('accountId') accountId: string,
    @Body('role') role: 'admin' | 'editor' | 'viewer',
  ) {
    await this.orgService.changeMemberRole(id, user, accountId, role);
    return { success: true };
  }
}
