// ──────────────────────────────────────────────
// Dashboard Controller (v2) — /api/orgs/:orgId/dashboards
// ──────────────────────────────────────────────

import {
  Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus, Query, UseGuards, UseInterceptors
} from '@nestjs/common';
import { DashboardBuilderService, CreateDashboardDto, CreateWidgetDto, LayoutItem } from './dashboard-builder.service';
import { WidgetExecutionService } from './widget-execution.service';
import { CurrentUser, OrgId } from '../common/decorators';
import { SafeAccount } from '../auth/auth.service';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { RlsContextInterceptor } from '../common/interceptors/rls-context.interceptor';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Dashboards')
@UseGuards(OrgMemberGuard)
@UseInterceptors(RlsContextInterceptor)
@Controller('orgs/:orgId/dashboards')
export class DashboardController {
  constructor(
    private readonly builder: DashboardBuilderService,
    private readonly executionService: WidgetExecutionService
  ) {}

  // ── Dashboards ────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List dashboards' })
  async list(
    @OrgId() orgId: string,
    @CurrentUser() user: SafeAccount,
    @Query('contextType') contextType?: string,
    @Query('contextId') contextId?: string,
    @Query('status') status?: string,
  ) {
    const dashboards = await this.builder.listDashboards(orgId, user.id, { contextType, contextId, status });
    return { dashboards };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new dashboard' })
  async create(
    @OrgId() orgId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: CreateDashboardDto,
  ) {
    const dashboard = await this.builder.createDashboard(orgId, user, dto);
    return { dashboard };
  }

  @Get(':dashId')
  @ApiOperation({ summary: 'Get dashboard with draft state' })
  async get(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const dashboard = await this.builder.getDashboard(dashId, orgId, user.id);
    const pages = await this.builder.listPages(dashId, orgId, user.id);
    const pagesWithWidgets = await Promise.all(pages.map(async p => {
      const widgets = await this.builder.listWidgets(p.id, orgId, user.id);
      return { ...p, widgets };
    }));
    return { dashboard, pages: pagesWithWidgets };
  }

  @Post(':dashId/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish draft layout' })
  async publish(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const dashboard = await this.builder.publishDashboard(dashId, orgId, user);
    return { dashboard };
  }

  @Delete(':dashId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a dashboard' })
  async delete(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    await this.builder.softDeleteDashboard(dashId, orgId, user);
  }

  @Post(':dashId/layout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update draft layout' })
  async updateLayout(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
    @Body('layout') layout: LayoutItem[],
  ) {
    await this.builder.updateLayout(dashId, orgId, user, layout);
    return { success: true };
  }

  // ── Pages ─────────────────────────────────────

  @Get(':dashId/pages')
  @ApiOperation({ summary: 'List pages' })
  async listPages(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const pages = await this.builder.listPages(dashId, orgId, user.id);
    return { pages };
  }

  @Post(':dashId/pages')
  @ApiOperation({ summary: 'Create page' })
  async createPage(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
    @Body('name') name: string,
  ) {
    const page = await this.builder.createPage(dashId, orgId, user, name);
    return { page };
  }

  @Put(':dashId/pages/:pageId')
  @ApiOperation({ summary: 'Update page details' })
  async updatePage(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @Param('pageId') pageId: string,
    @CurrentUser() user: SafeAccount,
    @Body() data: { name?: string; isDefault?: boolean },
  ) {
    const page = await this.builder.updatePage(pageId, dashId, orgId, user, data);
    return { page };
  }

  @Delete(':dashId/pages/:pageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete page' })
  async deletePage(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @Param('pageId') pageId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    await this.builder.deletePage(pageId, dashId, orgId, user);
  }

  @Post(':dashId/pages/:pageId/duplicate')
  @ApiOperation({ summary: 'Duplicate page' })
  async duplicatePage(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @Param('pageId') pageId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const page = await this.builder.duplicatePage(pageId, dashId, orgId, user);
    return { page };
  }

  @Put(':dashId/pages/reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder pages' })
  async reorderPages(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
    @Body('order') order: string[],
  ) {
    await this.builder.reorderPages(dashId, orgId, user, order);
    return { success: true };
  }

  // ── Widgets ───────────────────────────────────

  @Get(':dashId/pages/:pageId/widgets')
  @ApiOperation({ summary: 'List widgets for a page' })
  async listWidgets(
    @OrgId() orgId: string,
    @Param('pageId') pageId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const widgets = await this.builder.listWidgets(pageId, orgId, user.id);
    return { widgets };
  }

  @Post(':dashId/pages/:pageId/widgets')
  @ApiOperation({ summary: 'Add a widget' })
  async addWidget(
    @OrgId() orgId: string,
    @Param('pageId') pageId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: CreateWidgetDto,
  ) {
    const widget = await this.builder.addWidget(pageId, orgId, user, dto);
    return { widget };
  }

  @Put(':dashId/pages/:pageId/widgets/:widgetId')
  @ApiOperation({ summary: 'Update a widget' })
  async updateWidget(
    @OrgId() orgId: string,
    @Param('pageId') pageId: string,
    @Param('widgetId') widgetId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: Partial<CreateWidgetDto>,
  ) {
    const widget = await this.builder.updateWidget(widgetId, pageId, orgId, user, dto);
    return { widget };
  }

  @Delete(':dashId/pages/:pageId/widgets/:widgetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a widget' })
  async removeWidget(
    @OrgId() orgId: string,
    @Param('pageId') pageId: string,
    @Param('widgetId') widgetId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    await this.builder.removeWidget(widgetId, pageId, orgId, user);
  }

  @Post(':dashId/pages/:pageId/widgets/:widgetId/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute widget query synchronously' })
  async executeWidget(
    @OrgId() orgId: string,
    @Param('widgetId') widgetId: string,
    @CurrentUser() user: SafeAccount,
    @Body('forceRefresh') forceRefresh?: boolean,
  ) {
    return this.executionService.executeSync(widgetId, orgId, user, forceRefresh);
  }

  @Get(':dashId/pages/:pageId/widgets/:widgetId/inspect')
  @ApiOperation({ summary: 'Inspect widget execution details' })
  async inspectWidget(
    @OrgId() orgId: string,
    @Param('widgetId') widgetId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    return this.builder.inspectWidget(widgetId, orgId, user);
  }

  // ── Filters ───────────────────────────────────

  @Get(':dashId/filters')
  @ApiOperation({ summary: 'List dashboard filters' })
  async listFilters(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const filters = await this.builder.listFilters(dashId, orgId, user);
    return { filters };
  }

  @Post(':dashId/filters')
  @ApiOperation({ summary: 'Add dashboard filter' })
  async addFilter(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: any,
  ) {
    const filter = await this.builder.addFilter(dashId, orgId, user, dto);
    return { filter };
  }

  @Delete(':dashId/filters/:filterId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove dashboard filter' })
  async removeFilter(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @Param('filterId') filterId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    await this.builder.removeFilter(filterId, dashId, orgId, user);
  }

  // ── Versioning ───────────────────────────────────

  @Get(':dashId/versions')
  @ApiOperation({ summary: 'List dashboard versions' })
  async listVersions(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const versions = await this.builder.listVersions(dashId, orgId, user);
    return { versions };
  }

  @Post(':dashId/versions')
  @ApiOperation({ summary: 'Save new dashboard version' })
  async saveVersion(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
    @Body('message') message?: string,
  ) {
    const version = await this.builder.saveVersion(dashId, orgId, user, message);
    return { version };
  }

  @Post(':dashId/versions/:versionId/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore dashboard to a saved version' })
  async restoreVersion(
    @OrgId() orgId: string,
    @Param('dashId') dashId: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    return this.builder.restoreVersion(dashId, versionId, orgId, user);
  }
}
