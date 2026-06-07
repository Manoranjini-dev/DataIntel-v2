// ──────────────────────────────────────────────
// Persistent Connection Controller
// Org-scoped routes: /orgs/:orgId/connections
// ──────────────────────────────────────────────

import {
  Controller, Get, Post, Put, Delete,
  Body, Param, HttpCode, HttpStatus,
} from '@nestjs/common';
import { PersistentConnectionService } from './persistent-connection.service';
import { CreateConnectionDto, UpdateConnectionDto } from './dto/persistent-connection.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';

@Controller('orgs/:orgId/connections')
export class PersistentConnectionController {
  constructor(private readonly svc: PersistentConnectionService) {}

  @Get()
  async list(@CurrentUser() user: SafeAccount, @Param('orgId') orgId: string) {
    const connections = await this.svc.list(orgId, user.id);
    return { connections };
  }

  @Post()
  async create(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Body() dto: CreateConnectionDto,
  ) {
    const connection = await this.svc.create(orgId, user, dto);
    return { connection };
  }

  @Get(':connId')
  async get(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('connId') connId: string,
  ) {
    const connection = await this.svc.get(orgId, connId, user.id);
    return { connection };
  }

  @Put(':connId')
  async update(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('connId') connId: string,
    @Body() dto: UpdateConnectionDto,
  ) {
    const connection = await this.svc.update(orgId, connId, user, dto);
    return { connection };
  }

  @Delete(':connId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('connId') connId: string,
  ) {
    await this.svc.delete(orgId, connId, user);
    return { success: true };
  }

  @Post(':connId/test')
  @HttpCode(HttpStatus.OK)
  async test(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('connId') connId: string,
  ) {
    return this.svc.testConnection(orgId, connId, user);
  }

  @Post(':connId/schema/sync')
  @HttpCode(HttpStatus.OK)
  async syncSchema(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('connId') connId: string,
  ) {
    return this.svc.syncSchema(orgId, connId, user);
  }

  @Get(':connId/schema')
  async getSchema(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('connId') connId: string,
  ) {
    const schema = await this.svc.getSchema(orgId, connId, user.id);
    return { schema };
  }

  @Post(':connId/credentials/rotate')
  @HttpCode(HttpStatus.OK)
  async rotateCredentials(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('connId') connId: string,
    @Body('password') newPassword?: string,
  ) {
    await this.svc.rotateCredentials(orgId, connId, user, newPassword);
    return { success: true };
  }
}
