// ──────────────────────────────────────────────
// Dashboard Controller (v2) — /dashboards
// ──────────────────────────────────────────────

import {
  Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus, Query
} from '@nestjs/common';
import { DashboardBuilderService, CreateDashboardDto, CreateWidgetDto, LayoutItem } from './dashboard-builder.service';
import { DashboardPermissionsService } from './dashboard-permissions.service';
import { WidgetExecutionService } from './widget-execution.service';
import { DefaultCardsService } from './default-cards.service';
import { CurrentUser } from '../common/decorators';
import { SafeAccount } from '../auth/auth.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Dashboards')
@Controller('dashboards')
export class DashboardController {
  constructor(
    private readonly builder: DashboardBuilderService,
    private readonly executionService: WidgetExecutionService,
    private readonly defaultCards: DefaultCardsService,
    private readonly permissions: DashboardPermissionsService,
  ) {}

  // ── Dashboards ────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List dashboards' })
  async list(
    @CurrentUser() user: SafeAccount,
    @Query('contextType') contextType?: string,
    @Query('contextId') contextId?: string,
    @Query('status') status?: string,
    @Query('origin') origin?: string,
  ) {
    const dashboards = await this.builder.listDashboards(user.id, { contextType, contextId, status, origin });
    return { dashboards };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new dashboard' })
  async create(
    @CurrentUser() user: SafeAccount,
    @Body() dto: CreateDashboardDto,
  ) {
    const dashboard = await this.builder.createDashboard(user, dto);

    // Fully-automated dashboard scaffolding: seed Page 1 with 5 intelligent
    // default analytical cards (KPI, trend, comparison, distribution,
    // correlation) based on the connected datasource. Each widget is validated
    // with a live query before creation — no widget is created unless it returns
    // real data. Layout is saved automatically. Best-effort: failure here never
    // blocks dashboard creation.
    if (dto.origin === 'manual' && (dto.contextType === 'connection' || dto.contextType === 'combo') && dto.contextId) {
      const pages = await this.builder.listPages(dashboard.id, user.id);
      const pageId = pages[0]?.id;
      if (pageId) {
        const seeded = await this.defaultCards.seedDefaultCards(
          user, dashboard.id, pageId, dto.contextType, dto.contextId,
        );

        if (seeded.length > 0) {
          // Save the layout so positions are persisted
          const layoutItems = (seeded as any[]).map((w: any) => ({
            widgetId: w.id,
            gridX: w.grid_x ?? 0,
            gridY: w.grid_y ?? 0,
            gridW: w.grid_w ?? 6,
            gridH: w.grid_h ?? 4,
          }));
          await this.builder.updateLayout(dashboard.id, user, layoutItems).catch(() => undefined);

          // Save an initial version so the dashboard is ready without any user action
          await this.builder
            .saveVersion(dashboard.id, user, 'Initial auto-generated dashboard')
            .catch(() => undefined);

          // Fire async re-execution for any widget that may still have no pre-loaded data
          // (best-effort background refresh — does not block the API response)
          for (const w of seeded as any[]) {
            this.executionService
              .executeSync(w.id, user, false)
              .catch(() => undefined);
          }
        }
      }
    } else if (dto.origin === 'manual') {
      const pages = await this.builder.listPages(dashboard.id, user.id);
      const pageId = pages[0]?.id;
      if (pageId) {
        const seeded = await this.defaultCards.seedPlaceholderCards(
          user, dashboard.id, pageId
        );
        if (seeded && seeded.length > 0) {
          const layoutItems = (seeded as any[]).map((w: any) => ({
            widgetId: w.id,
            gridX: w.grid_x ?? 0,
            gridY: w.grid_y ?? 0,
            gridW: w.grid_w ?? 6,
            gridH: w.grid_h ?? 3,
          }));
          await this.builder.updateLayout(dashboard.id, user, layoutItems).catch(() => undefined);
          await this.builder
            .saveVersion(dashboard.id, user, 'Initial manual dashboard')
            .catch(() => undefined);
        }
      }
    }

    return { dashboard };
  }

  // ── Sharing (share-targets must be before :dashId to avoid param collision) ──

  @Get('share-targets')
  @ApiOperation({ summary: 'Search workspace users for sharing' })
  async searchShareTargets(
    @CurrentUser() user: SafeAccount,
    @Query('q') q: string = '',
  ) {
    const users = await this.permissions.searchShareTargets(q, user.id);
    return { users };
  }

  @Get(':dashId/shares')
  @ApiOperation({ summary: 'List users a dashboard is shared with' })
  async listShares(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const shares = await this.permissions.listShares(dashId, user.id);
    return { shares };
  }

  @Post(':dashId/shares')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Share a dashboard with a user by email' })
  async shareWithUser(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: { email: string; accessLevel: 'view' | 'edit' },
  ) {
    const canEdit = dto.accessLevel === 'edit';
    const share = await this.permissions.shareByEmail(dashId, dto.email, canEdit, user.id);
    return { share };
  }

  @Put(':dashId/shares/:accountId')
  @ApiOperation({ summary: 'Update access level for a shared user' })
  async updateShare(
    @Param('dashId') dashId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: { accessLevel: 'view' | 'edit' },
  ) {
    await this.permissions.updateShare(dashId, accountId, dto.accessLevel === 'edit', user.id);
    return { success: true };
  }

  @Delete(':dashId/shares/:accountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a user\'s access to a dashboard' })
  async revokeShare(
    @Param('dashId') dashId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    await this.permissions.revokeAccess(dashId, accountId, user.id);
  }

  @Get(':dashId')
  @ApiOperation({ summary: 'Get dashboard with draft state' })
  async get(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const dashboard = await this.builder.getDashboard(dashId, user.id);
    const pages = await this.builder.listPages(dashId, user.id);
    const pagesWithWidgets = await Promise.all(pages.map(async p => {
      const widgets = await this.builder.listWidgets(p.id, user.id);
      return { ...p, widgets };
    }));
    return { dashboard, pages: pagesWithWidgets };
  }

  @Put(':dashId')
  @ApiOperation({ summary: 'Update a dashboard' })
  async update(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: { name?: string; description?: string },
  ) {
    const dashboard = await this.builder.updateDashboard(dashId, user, dto);
    return { dashboard };
  }

  @Post(':dashId/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish draft layout' })
  async publish(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const dashboard = await this.builder.publishDashboard(dashId, user);
    return { dashboard };
  }

  @Delete(':dashId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a dashboard' })
  async delete(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    await this.builder.softDeleteDashboard(dashId, user);
  }

  @Post(':dashId/layout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update draft layout' })
  async updateLayout(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
    @Body('layout') layout: LayoutItem[],
  ) {
    await this.builder.updateLayout(dashId, user, layout);
    return { success: true };
  }

  // ── Pages ─────────────────────────────────────

  @Get(':dashId/pages')
  @ApiOperation({ summary: 'List pages' })
  async listPages(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const pages = await this.builder.listPages(dashId, user.id);
    return { pages };
  }

  @Post(':dashId/pages')
  @ApiOperation({ summary: 'Create page' })
  async createPage(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
    @Body('name') name: string,
  ) {
    const page = await this.builder.createPage(dashId, user, name);
    return { page };
  }

  @Put(':dashId/pages/reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder pages' })
  async reorderPages(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
    @Body('order') order: string[],
  ) {
    await this.builder.reorderPages(dashId, user, order);
    return { success: true };
  }

  @Put(':dashId/pages/:pageId')
  @ApiOperation({ summary: 'Update page details' })
  async updatePage(
    @Param('dashId') dashId: string,
    @Param('pageId') pageId: string,
    @CurrentUser() user: SafeAccount,
    @Body() data: { name?: string; isDefault?: boolean },
  ) {
    const page = await this.builder.updatePage(pageId, dashId, user, data);
    return { page };
  }

  @Delete(':dashId/pages/:pageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete page' })
  async deletePage(
    @Param('dashId') dashId: string,
    @Param('pageId') pageId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    await this.builder.deletePage(pageId, dashId, user);
  }

  @Post(':dashId/pages/:pageId/duplicate')
  @ApiOperation({ summary: 'Duplicate page' })
  async duplicatePage(
    @Param('dashId') dashId: string,
    @Param('pageId') pageId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const page = await this.builder.duplicatePage(pageId, dashId, user);
    return { page };
  }

  // ── Widgets ───────────────────────────────────

  @Get(':dashId/pages/:pageId/widgets')
  @ApiOperation({ summary: 'List widgets for a page' })
  async listWidgets(
    @Param('pageId') pageId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const widgets = await this.builder.listWidgets(pageId, user.id);
    return { widgets };
  }

  @Post(':dashId/pages/:pageId/widgets')
  @ApiOperation({ summary: 'Add a widget' })
  async addWidget(
    @Param('pageId') pageId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: CreateWidgetDto,
  ) {
    const widget = await this.builder.addWidget(pageId, user, dto);
    return { widget };
  }

  @Put(':dashId/pages/:pageId/widgets/:widgetId')
  @ApiOperation({ summary: 'Update a widget' })
  async updateWidget(
    @Param('pageId') pageId: string,
    @Param('widgetId') widgetId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: Partial<CreateWidgetDto>,
  ) {
    const widget = await this.builder.updateWidget(widgetId, pageId, user, dto);
    return { widget };
  }

  @Delete(':dashId/pages/:pageId/widgets/:widgetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a widget' })
  async removeWidget(
    @Param('pageId') pageId: string,
    @Param('widgetId') widgetId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    await this.builder.removeWidget(widgetId, pageId, user);
  }

  @Post(':dashId/pages/:pageId/widgets/:widgetId/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute widget query synchronously' })
  async executeWidget(
    @Param('widgetId') widgetId: string,
    @CurrentUser() user: SafeAccount,
    @Body('forceRefresh') forceRefresh?: boolean,
  ) {
    return this.executionService.executeSync(widgetId, user, forceRefresh);
  }

  @Get(':dashId/pages/:pageId/widgets/:widgetId/inspect')
  @ApiOperation({ summary: 'Inspect widget execution details' })
  async inspectWidget(
    @Param('widgetId') widgetId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    return this.builder.inspectWidget(widgetId, user);
  }

  @Post(':dashId/pages/:pageId/widgets/:widgetId/suggest-question')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AI-suggest an analytics question for an empty widget prompt' })
  async suggestWidgetQuestion(
    @Param('widgetId') widgetId: string,
    @CurrentUser() _user: SafeAccount,
  ) {
    const question = await this.executionService.suggestQuestion(widgetId);
    return { question };
  }

  @Post(':dashId/pages/:pageId/widgets/:widgetId/improve-prompt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AI-rephrase a user prompt into a clearer analytical request' })
  async improveWidgetPrompt(
    @Param('widgetId') widgetId: string,
    @CurrentUser() _user: SafeAccount,
    @Body('prompt') prompt: string,
  ) {
    const improved = await this.executionService.improvePrompt(prompt || '', widgetId);
    return { prompt: improved };
  }

  // ── Filters ───────────────────────────────────

  @Get(':dashId/filters')
  @ApiOperation({ summary: 'List dashboard filters' })
  async listFilters(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const filters = await this.builder.listFilters(dashId, user);
    return { filters };
  }

  @Post(':dashId/filters')
  @ApiOperation({ summary: 'Add dashboard filter' })
  async addFilter(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: any,
  ) {
    const filter = await this.builder.addFilter(dashId, user, dto);
    return { filter };
  }

  @Delete(':dashId/filters/:filterId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove dashboard filter' })
  async removeFilter(
    @Param('dashId') dashId: string,
    @Param('filterId') filterId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    await this.builder.removeFilter(filterId, dashId, user);
  }

  // ── Versioning ───────────────────────────────────

  @Get(':dashId/versions')
  @ApiOperation({ summary: 'List dashboard versions' })
  async listVersions(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const versions = await this.builder.listVersions(dashId, user);
    return { versions };
  }

  @Post(':dashId/versions')
  @ApiOperation({ summary: 'Save new dashboard version' })
  async saveVersion(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
    @Body('message') message?: string,
  ) {
    const version = await this.builder.saveVersion(dashId, user, message);
    return { version };
  }

  @Post(':dashId/versions/:versionId/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore dashboard to a saved version' })
  async restoreVersion(
    @Param('dashId') dashId: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    return this.builder.restoreVersion(dashId, versionId, user);
  }
}
