// ──────────────────────────────────────────────
// Persistent Connection Controller
// Account-scoped routes: /connections
// ──────────────────────────────────────────────

import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, HttpCode, HttpStatus, ForbiddenException,
} from '@nestjs/common';
import { PersistentConnectionService } from './persistent-connection.service';
import { ConnectionPermissionsService } from './connection-permissions.service';
import { ConnectionRefreshService } from './connection-refresh.service';
import {
  CreateConnectionDto, UpdateConnectionDto,
  ShareConnectionDto, UpdateShareDto, RefreshScheduleDto,
} from './dto/persistent-connection.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';

@Controller('connections')
export class PersistentConnectionController {
  constructor(
    private readonly svc: PersistentConnectionService,
    private readonly permissionsSvc: ConnectionPermissionsService,
    private readonly refreshSvc: ConnectionRefreshService,
  ) {}

  @Get()
  async list(@CurrentUser() user: SafeAccount) {
    const connections = await this.svc.list(user);
    return { connections };
  }

  @Post()
  async create(
    @CurrentUser() user: SafeAccount,
    @Body() dto: CreateConnectionDto,
  ) {
    const connection = await this.svc.create(user, dto);
    return { connection };
  }

  // Registered before ':connId' so the literal 'share-targets' segment is
  // never swallowed by the :connId param route.
  @Get('share-targets')
  async searchShareTargets(
    @CurrentUser() user: SafeAccount,
    @Query('q') q: string = '',
  ) {
    if (user.role === 'VIEWER') {
      throw new ForbiddenException('Viewers cannot share data source connections');
    }
    const users = await this.permissionsSvc.searchShareTargets(q, user.id);
    return { users };
  }

  @Get(':connId')
  async get(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
  ) {
    const connection = await this.svc.get(connId, user.id);
    return { connection };
  }

  @Put(':connId')
  async update(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
    @Body() dto: UpdateConnectionDto,
  ) {
    const connection = await this.svc.update(connId, user, dto);
    return { connection };
  }

  @Delete(':connId')
  @HttpCode(HttpStatus.OK)
  async delete(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
  ) {
    await this.svc.delete(connId, user);
    return { success: true };
  }

  @Post(':connId/test')
  @HttpCode(HttpStatus.OK)
  async test(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
  ) {
    return this.svc.testConnection(connId, user);
  }

  @Post(':connId/schema/sync')
  @HttpCode(HttpStatus.OK)
  async syncSchema(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
  ) {
    return this.svc.syncSchema(connId, user);
  }

  @Get(':connId/schema')
  async getSchema(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
  ) {
    const schema = await this.svc.getSchema(connId, user.id);
    return { schema };
  }

  @Post(':connId/credentials/rotate')
  @HttpCode(HttpStatus.OK)
  async rotateCredentials(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
    @Body('password') newPassword?: string,
  ) {
    await this.svc.rotateCredentials(connId, user, newPassword);
    return { success: true };
  }

  // ── Sharing ──────────────────────────────

  @Get(':connId/share')
  async listShares(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
  ) {
    const shares = await this.permissionsSvc.listShares(connId, user.id);
    return { shares };
  }

  @Post(':connId/share')
  async share(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
    @Body() dto: ShareConnectionDto,
  ) {
    const share = await this.permissionsSvc.shareByEmail(connId, user, dto.email, dto.accessLevel, dto.expiresAt);
    return { share };
  }

  @Put(':connId/share/:accountId')
  async updateShare(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
    @Param('accountId') accountId: string,
    @Body() dto: UpdateShareDto,
  ) {
    const share = await this.permissionsSvc.updateShare(connId, user, accountId, dto.accessLevel, dto.expiresAt);
    return { share };
  }

  @Delete(':connId/share/me')
  @HttpCode(HttpStatus.OK)
  async leaveShared(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
  ) {
    await this.permissionsSvc.leaveSharedConnection(connId, user.id);
    return { success: true };
  }

  @Delete(':connId/share/:accountId')
  @HttpCode(HttpStatus.OK)
  async revokeShare(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
    @Param('accountId') accountId: string,
  ) {
    await this.permissionsSvc.revokeShare(connId, user, accountId);
    return { success: true };
  }

  // ── Auto-refresh ─────────────────────────

  @Get(':connId/refresh-schedule')
  async getRefreshSchedule(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
  ) {
    const schedule = await this.refreshSvc.getSchedule(connId, user.id);
    return { schedule };
  }

  @Put(':connId/refresh-schedule')
  async setRefreshSchedule(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
    @Body() dto: RefreshScheduleDto,
  ) {
    const schedule = await this.refreshSvc.configureSchedule(connId, user, dto);
    return { schedule };
  }

  @Post(':connId/refresh-schedule/trigger')
  @HttpCode(HttpStatus.OK)
  async triggerRefresh(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
  ) {
    return this.refreshSvc.triggerManualRefresh(connId, user);
  }
}
