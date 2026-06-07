// ──────────────────────────────────────────────
// Combo Controller — /orgs/:orgId/combos
// ──────────────────────────────────────────────

import { Controller, Get, Post, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ComboService } from './combo.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';

@Controller('orgs/:orgId/combos')
export class ComboController {
  constructor(private readonly comboService: ComboService) {}

  @Get()
  async list(@CurrentUser() user: SafeAccount, @Param('orgId') orgId: string) {
    const combos = await this.comboService.list(orgId, user.id);
    return { combos };
  }

  @Post()
  async create(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Body() body: { name: string; description?: string; connectionIds: string[] },
  ) {
    const combo = await this.comboService.create(orgId, user, body);
    return { combo };
  }

  @Get(':comboId')
  async get(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('comboId') comboId: string,
  ) {
    const combo = await this.comboService.get(orgId, comboId, user.id);
    return { combo };
  }

  @Delete(':comboId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('comboId') comboId: string,
  ) {
    return this.comboService.delete(orgId, comboId, user);
  }

  @Post(':comboId/members')
  async addMember(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('comboId') comboId: string,
    @Body('connectionId') connectionId: string,
    @Body('alias') alias?: string,
  ) {
    const member = await this.comboService.addMember(orgId, comboId, connectionId, user, alias);
    return { member };
  }

  @Delete(':comboId/members/:connectionId')
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('comboId') comboId: string,
    @Param('connectionId') connectionId: string,
  ) {
    await this.comboService.removeMember(orgId, comboId, connectionId, user);
    return { success: true };
  }

  @Get(':comboId/schema')
  async getMergedSchema(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('comboId') comboId: string,
  ) {
    const schema = await this.comboService.getMergedSchema(orgId, comboId, user.id);
    return { schema };
  }

  @Post(':comboId/query')
  async executeQuery(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('comboId') comboId: string,
    @Body() body: { prompt: string; chatId?: string; messageId?: string },
  ) {
    return this.comboService.executeQuery(orgId, comboId, user, body.prompt, body.chatId, body.messageId);
  }
}
