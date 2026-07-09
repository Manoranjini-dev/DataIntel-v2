// ──────────────────────────────────────────────
// Dashboard Controller (v2) — /dashboards
// ──────────────────────────────────────────────

import {
  Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus, Query
} from '@nestjs/common';
import { DashboardBuilderService, CreateDashboardDto, CreateWidgetDto, LayoutItem, AddDashboardFilterDto } from './dashboard-builder.service';
import { DashboardPermissionsService } from './dashboard-permissions.service';
import { WidgetExecutionService } from './widget-execution.service';
import { DefaultCardsService } from './default-cards.service';
import { CurrentUser } from '../common/decorators';
import { SafeAccount } from '../auth/auth.service';
import { Public } from '../auth/auth.guard';
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
    @Query('editableOnly') editableOnly?: string,
  ) {
    const dashboards = await this.builder.listDashboards(user.id, {
      contextType, contextId, status, origin, requesterRole: user.role,
      editableOnly: editableOnly === 'true',
    });
    return { dashboards };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new dashboard' })
  async create(
    @CurrentUser() user: SafeAccount,
    @Body() dto: CreateDashboardDto,
  ) {
    const dashboard = await this.builder.createDashboard(user, dto);

    if (dto.origin === 'manual' && (dto.contextType === 'connection' || dto.contextType === 'combo') && dto.contextId) {
      // Datasource dashboard: seed placeholder cards synchronously so the user
      // immediately sees a populated dashboard, then fire AI card generation in
      // the background. Previously this awaited seedDefaultCards which blocked
      // for 30-60s (LLM + live queries), causing the create request to time out
      // and the user to see an empty dashboard.
      const pages = await this.builder.listPages(dashboard.id, user.id);
      const pageId = pages[0]?.id;
      if (pageId) {
        // Step 1 — synchronous: create 4 placeholder cards so the UI is not empty.
        const placeholders = await this.defaultCards.seedPlaceholderCards(user, dashboard.id, pageId);
        if (placeholders && placeholders.length > 0) {
          const layoutItems = (placeholders as any[]).map((w: any) => ({
            widgetId: w.id,
            gridX: w.grid_x ?? 0,
            gridY: w.grid_y ?? 0,
            gridW: w.grid_w ?? 6,
            gridH: w.grid_h ?? 4,
          }));
          await this.builder.updateLayout(dashboard.id, user, layoutItems).catch(() => undefined);
        }

        // Step 2 — background: replace placeholders with AI-generated insight cards.
        // We capture the placeholder IDs so the AI seeding can clean them up first.
        const placeholderIds = (placeholders as any[]).map((w: any) => w.id);

        setImmediate(async () => {
          try {
            // Remove the placeholder widgets before seeding AI cards so we don't
            // end up with 8 widgets (4 placeholders + 4 AI cards).
            for (const widgetId of placeholderIds) {
              await this.builder
                .removeWidget(widgetId, pageId, user)
                .catch(() => undefined);
            }

            const seeded = await this.defaultCards.seedDefaultCards(
              user, dashboard.id, pageId, dto.contextType as 'connection' | 'combo', dto.contextId!,
            );

            if (seeded.length > 0) {
              const layoutItems = (seeded as any[]).map((w: any) => ({
                widgetId: w.id,
                gridX: w.grid_x ?? 0,
                gridY: w.grid_y ?? 0,
                gridW: w.grid_w ?? 6,
                gridH: w.grid_h ?? 4,
              }));
              await this.builder.updateLayout(dashboard.id, user, layoutItems).catch(() => undefined);
              await this.builder
                .saveVersion(dashboard.id, user, 'Initial auto-generated dashboard')
                .catch(() => undefined);

              // Background widget refresh to pre-populate results
              for (const w of seeded as any[]) {
                this.executionService.executeSync(w.id, user, false).catch(() => undefined);
              }
            }
          } catch (e: any) {
            // Log but never crash — dashboard was already created and user is on the page
            const { Logger } = await import('@nestjs/common');
            new Logger('DashboardController').error(
              `Background AI card seeding failed for dashboard ${dashboard.id}: ${e?.message}`,
              e?.stack,
            );
          }
        });
      }
    } else if (dto.origin === 'manual') {
      // No data source — seed static placeholders synchronously (fast, no LLM).
      const pages = await this.builder.listPages(dashboard.id, user.id);
      const pageId = pages[0]?.id;
      if (pageId) {
        const seeded = await this.defaultCards.seedPlaceholderCards(user, dashboard.id, pageId);
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


  // ── Sharing (share-targets/shared-cards must be before :dashId to avoid param collision) ──

  @Get('share-targets')
  @ApiOperation({ summary: 'Search workspace users for sharing' })
  async searchShareTargets(
    @CurrentUser() user: SafeAccount,
    @Query('q') q: string = '',
  ) {
    const users = await this.permissions.searchShareTargets(q, user.id);
    return { users };
  }

  @Get('shared-cards')
  @ApiOperation({ summary: 'List dashboard cards shared directly with the current user (card-only shares — never implies dashboard/page visibility)' })
  async listSharedCards(
    @CurrentUser() user: SafeAccount,
  ) {
    const cards = await this.builder.listSharedCards(user.id);
    return { cards };
  }

  @Get(':dashId/shares')
  @ApiOperation({ summary: 'List users a dashboard is shared with (includes owner)' })
  async listShares(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const { shares, owner } = await this.permissions.listShares(dashId, user.id);
    return { shares, owner };
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
    const dashboard = await this.builder.getDashboard(dashId, user.id, user.role);
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

  @Post(':dashId/unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revert published dashboard back to draft status' })
  async unpublish(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const dashboard = await this.builder.unpublishDashboard(dashId, user);
    return { dashboard };
  }

  // ── Embedding (DB2-03) ────────────────────────
  @Post(':dashId/embed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable/disable embedding and get the embed token' })
  async setEmbed(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: { enabled: boolean; regenerate?: boolean },
  ) {
    return this.builder.setEmbed(dashId, user, !!dto.enabled, !!dto.regenerate);
  }

  // Public: serves a published, embed-enabled dashboard by opaque token.
  // Two path segments so it never collides with GET :dashId (one segment).
  @Public()
  @Get('embed/:token')
  @ApiOperation({ summary: 'Public read of an embedded dashboard by token' })
  async getEmbedded(@Param('token') token: string) {
    return this.builder.getEmbeddedDashboard(token);
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

  @Post(':dashId/pages/:pageId/copy-to')
  @ApiOperation({ summary: 'Copy a page into a different dashboard' })
  async copyPageTo(
    @Param('dashId') dashId: string,
    @Param('pageId') pageId: string,
    @CurrentUser() user: SafeAccount,
    @Body('targetDashboardId') targetDashboardId: string,
  ) {
    const page = await this.builder.copyPage(pageId, dashId, targetDashboardId, user);
    return { page };
  }

  @Post(':dashId/pages/:pageId/move')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move a page into a different dashboard' })
  async movePage(
    @Param('dashId') dashId: string,
    @Param('pageId') pageId: string,
    @CurrentUser() user: SafeAccount,
    @Body('targetDashboardId') targetDashboardId: string,
  ) {
    const page = await this.builder.movePage(pageId, dashId, targetDashboardId, user);
    return { page };
  }

  // ── Page-level sharing ────────────────────────

  @Get(':dashId/pages/:pageId/shares')
  @ApiOperation({ summary: 'List users a page is shared with (includes dashboard owner)' })
  async listPageShares(
    @Param('pageId') pageId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const { shares, owner } = await this.permissions.listPageShares(pageId, user.id);
    return { shares, owner };
  }

  @Post(':dashId/pages/:pageId/shares')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Share a single page with a user by email' })
  async sharePage(
    @Param('pageId') pageId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: { email: string; accessLevel: 'view' | 'edit' },
  ) {
    const share = await this.permissions.sharePageByEmail(pageId, dto.email, dto.accessLevel === 'edit', user.id);
    return { share };
  }

  @Put(':dashId/pages/:pageId/shares/:accountId')
  @ApiOperation({ summary: 'Update a page share access level' })
  async updatePageShare(
    @Param('pageId') pageId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: { accessLevel: 'view' | 'edit' },
  ) {
    await this.permissions.updatePageShare(pageId, accountId, dto.accessLevel === 'edit', user.id);
    return { success: true };
  }

  @Delete(':dashId/pages/:pageId/shares/:accountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a user\'s access to a page' })
  async revokePageShare(
    @Param('pageId') pageId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    await this.permissions.revokePageAccess(pageId, accountId, user.id);
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

  @Post(':dashId/pages/:pageId/widgets/:widgetId/copy')
  @ApiOperation({ summary: 'Copy a card into a different page/dashboard' })
  async copyWidget(
    @Param('widgetId') widgetId: string,
    @CurrentUser() user: SafeAccount,
    @Body('targetPageId') targetPageId: string,
  ) {
    const widget = await this.builder.copyWidget(widgetId, targetPageId, user);
    return { widget };
  }

  @Post(':dashId/pages/:pageId/widgets/:widgetId/move')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move a card to a different page/dashboard' })
  async moveWidget(
    @Param('widgetId') widgetId: string,
    @CurrentUser() user: SafeAccount,
    @Body('targetPageId') targetPageId: string,
  ) {
    const widget = await this.builder.moveWidget(widgetId, targetPageId, user);
    return { widget };
  }

  // ── Card (widget)-level sharing ───────────────

  @Get(':dashId/pages/:pageId/widgets/:widgetId/shares')
  @ApiOperation({ summary: 'List users a card is shared with (includes dashboard owner)' })
  async listWidgetShares(
    @Param('widgetId') widgetId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    const { shares, owner } = await this.permissions.listWidgetShares(widgetId, user.id);
    return { shares, owner };
  }

  @Post(':dashId/pages/:pageId/widgets/:widgetId/shares')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Share a single card with a user by email' })
  async shareWidget(
    @Param('widgetId') widgetId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: { email: string; accessLevel: 'view' | 'edit' },
  ) {
    const share = await this.permissions.shareWidgetByEmail(widgetId, dto.email, dto.accessLevel === 'edit', user.id);
    return { share };
  }

  @Put(':dashId/pages/:pageId/widgets/:widgetId/shares/:accountId')
  @ApiOperation({ summary: 'Update a card share access level' })
  async updateWidgetShare(
    @Param('widgetId') widgetId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: { accessLevel: 'view' | 'edit' },
  ) {
    await this.permissions.updateWidgetShare(widgetId, accountId, dto.accessLevel === 'edit', user.id);
    return { success: true };
  }

  @Delete(':dashId/pages/:pageId/widgets/:widgetId/shares/:accountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a user\'s access to a card' })
  async revokeWidgetShare(
    @Param('widgetId') widgetId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: SafeAccount,
  ) {
    await this.permissions.revokeWidgetAccess(widgetId, accountId, user.id);
  }

  @Post(':dashId/pages/:pageId/widgets/:widgetId/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute widget query synchronously' })
  async executeWidget(
    @Param('widgetId') widgetId: string,
    @CurrentUser() user: SafeAccount,
    @Body('forceRefresh') forceRefresh?: boolean,
  ) {
    await this.permissions.requireWidgetAction(widgetId, user.id, 'can_view');
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
    @CurrentUser() user: SafeAccount,
    @Body('connectionId') connectionId?: string,
    @Body('vizType') vizType?: string,
  ) {
    await this.permissions.requireWidgetAction(widgetId, user.id, 'can_view');
    const question = await this.executionService.suggestQuestion(widgetId, connectionId, vizType);
    return { question };
  }

  @Post(':dashId/pages/:pageId/widgets/:widgetId/improve-prompt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AI-rephrase a user prompt into a clearer analytical request' })
  async improveWidgetPrompt(
    @Param('widgetId') widgetId: string,
    @CurrentUser() user: SafeAccount,
    @Body('prompt') prompt: string,
  ) {
    await this.permissions.requireWidgetAction(widgetId, user.id, 'can_view');
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
    @Body() dto: AddDashboardFilterDto,
  ) {
    const filter = await this.builder.addFilter(dashId, user, dto);
    return { filter };
  }

  @Put(':dashId/filters')
  @ApiOperation({ summary: 'Replace the entire dashboard filter set (DC-04: preserves locks transactionally)' })
  async replaceFilters(
    @Param('dashId') dashId: string,
    @CurrentUser() user: SafeAccount,
    @Body() body: { filters: AddDashboardFilterDto[] },
  ) {
    const filters = await this.builder.replaceFilters(dashId, user, body?.filters || []);
    return { filters };
  }

  @Put(':dashId/filters/:filterId')
  @ApiOperation({ summary: 'Update dashboard filter' })
  async updateFilter(
    @Param('dashId') dashId: string,
    @Param('filterId') filterId: string,
    @CurrentUser() user: SafeAccount,
    @Body() dto: AddDashboardFilterDto,
  ) {
    const filter = await this.builder.updateFilter(filterId, dashId, user, dto);
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
