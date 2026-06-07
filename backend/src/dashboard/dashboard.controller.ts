// ──────────────────────────────────────────────
// Dashboard Controller — /orgs/:orgId/dashboards
// ──────────────────────────────────────────────

import {
  Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus,
} from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';

@Controller('orgs/:orgId/dashboards')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  async list(@CurrentUser() user: SafeAccount, @Param('orgId') orgId: string) {
    const dashboards = await this.dashboardService.list(orgId, user.id);
    return { dashboards };
  }

  @Post()
  async create(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Body() body: any,
  ) {
    const dashboard = await this.dashboardService.create(orgId, user, body);
    return { dashboard };
  }

  @Get(':dashId')
  async get(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('dashId') dashId: string,
  ) {
    return this.dashboardService.get(orgId, dashId, user.id);
  }

  @Post(':dashId/save')
  @HttpCode(HttpStatus.OK)
  async save(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('dashId') dashId: string,
  ) {
    return this.dashboardService.save(orgId, dashId, user);
  }

  @Post(':dashId/state')
  @HttpCode(HttpStatus.OK)
  async updateLiveState(
    @Param('dashId') dashId: string,
    @Body() state: any,
  ) {
    return this.dashboardService.updateLiveState(dashId, state);
  }

  @Post(':dashId/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('dashId') dashId: string,
  ) {
    return this.dashboardService.publish(orgId, dashId, user);
  }

  @Post(':dashId/pages')
  async addPage(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('dashId') dashId: string,
    @Body('name') name: string,
  ) {
    const page = await this.dashboardService.addPage(orgId, dashId, user, name || 'New Page');
    return { page };
  }

  @Post(':dashId/pages/:pageId/widgets')
  async addWidget(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('dashId') dashId: string,
    @Param('pageId') pageId: string,
    @Body() data: any,
  ) {
    const widget = await this.dashboardService.addWidget(orgId, dashId, pageId, user, data);
    return { widget };
  }

  @Delete(':dashId/widgets/:widgetId')
  @HttpCode(HttpStatus.OK)
  async deleteWidget(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('dashId') dashId: string,
    @Param('widgetId') widgetId: string,
  ) {
    return this.dashboardService.deleteWidget(orgId, dashId, widgetId, user);
  }
}
