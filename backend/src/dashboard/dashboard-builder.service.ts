// ──────────────────────────────────────────────
// DashboardBuilderService — Layout management, draft/publish lifecycle,
// widget CRUD, batch layout updates, cache invalidation
// ──────────────────────────────────────────────

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { DashboardPermissionsService } from './dashboard-permissions.service';
import { CacheService, CacheKeys, CacheTTL } from '../cache/cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SafeAccount } from '../auth/auth.service';

export interface CreateDashboardDto {
  name: string;
  description?: string;
  contextType: 'org_overview' | 'connection' | 'combo';
  contextId?: string | null;
  // Discriminates the two independent dashboard families. Manual dashboards
  // belong to the Dashboards module; datasource dashboards live only inside a
  // specific data source / combo workflow. Defaults to 'manual'.
  origin?: 'manual' | 'datasource';
}

export interface CreateWidgetDto {
  widgetType: string;
  title?: string;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  layoutDesktop?: Record<string, number>;
  layoutTablet?: Record<string, number>;
  layoutMobile?: Record<string, number>;
  cardId?: string;
  pinnedCardVersion?: number;
  datasourceContextType?: string;
  datasourceContextId?: string;
  queryDefinition?: Record<string, unknown>;
  queryLanguage?: string;
  visualizationConfig?: Record<string, unknown>;
  refreshIntervalSec?: number;
  cacheTtlSec?: number;
}

export interface LayoutItem {
  widgetId: string;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  layoutDesktop?: Record<string, number>;
  layoutTablet?: Record<string, number>;
  layoutMobile?: Record<string, number>;
}

@Injectable()
export class DashboardBuilderService {
  private readonly logger = new Logger(DashboardBuilderService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly dashboardPermissions: DashboardPermissionsService,
    private readonly cache: CacheService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Dashboard CRUD ────────────────────────────────────

  /** List dashboards the user owns or that were shared with them */
  async listDashboards(
    requesterId: string,
    opts: { contextType?: string; contextId?: string; status?: string; origin?: string; requesterRole?: string } = {},
  ) {
    // Visibility model:
    //   • everyone: dashboards they own or that are shared with them.
    //   • Admin (additional): every PUBLISHED dashboard across the project,
    //     regardless of owner or share — Admins oversee all published content.
    const isAdmin = opts.requesterRole === 'ADMIN';
    const visibility = isAdmin
      ? `( d.created_by = $1
           OR d.status = 'published'
           OR EXISTS (
             SELECT 1 FROM dashboard_shares ds
             WHERE ds.dashboard_id = d.id AND ds.shared_with = $1
           ) )`
      : `( d.created_by = $1
           OR EXISTS (
             SELECT 1 FROM dashboard_shares ds
             WHERE ds.dashboard_id = d.id AND ds.shared_with = $1
           ) )`;
    const conditions = ['d.deleted_at IS NULL', visibility];
    const params: unknown[] = [requesterId];
    let p = 2;

    if (opts.origin) { conditions.push(`d.origin = $${p++}::dashboard_origin`); params.push(opts.origin); }
    if (opts.contextType) { conditions.push(`d.context_type = $${p++}`); params.push(opts.contextType); }
    if (opts.contextId) { conditions.push(`d.context_id = $${p++}`); params.push(opts.contextId); }
    if (opts.status) { conditions.push(`d.status = $${p++}`); params.push(opts.status); }

    return this.db.queryMany(
      `SELECT d.*, a.display_name AS created_by_name,
              (SELECT COUNT(*) FROM dashboard_pages WHERE dashboard_id = d.id AND deleted_at IS NULL) AS page_count
       FROM dashboards d
       JOIN accounts a ON a.id = d.created_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.updated_at DESC`,
      params,
    );
  }

  async getDashboard(dashId: string, requesterId: string, requesterRole?: string) {
    await this.dashboardPermissions.requireAction(dashId, requesterId, 'can_view');
    const dash = await this.db.queryOne<any>(
      `SELECT d.*, a.display_name AS created_by_name
       FROM dashboards d
       JOIN accounts a ON a.id = d.created_by
       WHERE d.id = $1 AND d.deleted_at IS NULL`,
      [dashId],
    );
    if (!dash) throw new NotFoundException('Dashboard not found');

    // Annotate with the caller's access level so the UI can render read-only vs
    // editable and gate the Publish action — never trust the client to decide.
    const isOwner = dash.created_by === requesterId;
    let canEdit = isOwner;
    if (!canEdit) {
      const share = await this.db.queryOne<{ can_edit: boolean }>(
        `SELECT can_edit FROM dashboard_shares WHERE dashboard_id = $1 AND shared_with = $2`,
        [dashId, requesterId],
      );
      canEdit = !!share?.can_edit;
    }
    const canPublish = (requesterRole === 'ADMIN' || requesterRole === 'ANALYST') && canEdit;

    return {
      ...dash,
      access_level: isOwner ? 'owner' : canEdit ? 'edit' : 'view',
      is_owner: isOwner,
      can_edit: canEdit,
      can_publish: canPublish,
    };
  }

  async createDashboard(creator: SafeAccount, dto: CreateDashboardDto) {
    const dash = await this.db.transaction(async (query) => {
      const result = await query(
        `INSERT INTO dashboards
           (name, description, context_type, context_id, origin, redis_key, created_by, updated_by)
         VALUES ($1, $2, $3::dashboard_context_type, $4, $5::dashboard_origin, $6, $7, $7)
         RETURNING *`,
        [
          dto.name, dto.description || null,
          dto.contextType, dto.contextId,
          dto.origin || 'manual',
          `dash:${Date.now()}`,   // will be updated below
          creator.id,
        ],
      );
      const dash = result.rows[0];

      // Update redis_key with actual ID
      await query(
        `UPDATE dashboards SET redis_key = $2 WHERE id = $1`,
        [dash.id, `dash:${dash.id}`],
      );

      // Create default page
      await query(
        `INSERT INTO dashboard_pages (dashboard_id, name, is_default, order_index)
         VALUES ($1, 'Page 1', TRUE, 0)`,
        [dash.id],
      );

      return dash;
    });

    await this.audit.log({
      accountId: creator.id,
      eventType: 'dashboard_created', resourceType: 'dashboard', resourceId: dash.id,
      details: { name: dash.name, contextType: dto.contextType, origin: dto.origin || 'manual' },
    });

    return dash;
  }

  async updateDashboard(dashId: string, updater: SafeAccount, dto: { name?: string; description?: string }) {
    await this.dashboardPermissions.requireAction(dashId, updater.id, 'can_edit');

    const dash = await this.db.queryOne(
      `UPDATE dashboards
       SET name = COALESCE($3, name),
           description = COALESCE($4, description),
           updated_at = NOW(),
           updated_by = $2
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [dashId, updater.id, dto.name ?? null, dto.description ?? null],
    );

    if (!dash) throw new NotFoundException('Dashboard not found');

    await this.audit.log({
      accountId: updater.id,
      eventType: 'dashboard_updated', resourceType: 'dashboard', resourceId: dashId,
      details: { name: dash.name },
    });

    return dash;
  }

  async publishDashboard(dashId: string, publisher: SafeAccount) {
    // Only Admins and Analysts may publish — Viewers can never publish, even on
    // a dashboard they somehow own or have edit access to. Enforced here (not
    // just the UI) so the API itself rejects unauthorized publishes.
    if (publisher.role !== 'ADMIN' && publisher.role !== 'ANALYST') {
      throw new ForbiddenException('Only Admins and Analysts can publish dashboards.');
    }
    await this.dashboardPermissions.requireAction(dashId, publisher.id, 'can_publish');

    const dash = await this.db.queryOne<{ id: string; draft_layout: any }>(
      `SELECT id, draft_layout FROM dashboards WHERE id = $1 AND deleted_at IS NULL`,
      [dashId],
    );
    if (!dash) throw new NotFoundException('Dashboard not found');

    // Fix: actually promote the draft_layout positions to the live widget rows
    // inside a transaction before flipping the status flag. Previously draft_layout
    // was fetched but never applied — the publish only changed the status field,
    // leaving widget grid positions unchanged and the draft_layout silently discarded.
    await this.db.transaction(async (query) => {
      // If a draft layout snapshot exists, apply it to the widget rows so the
      // published state reflects exactly what the editor last arranged.
      const draftItems: Array<{ widgetId: string; gridX: number; gridY: number; gridW: number; gridH: number }> =
        Array.isArray(dash.draft_layout) ? dash.draft_layout : [];

      for (const item of draftItems) {
        await query(
          `UPDATE dashboard_widgets_v2
           SET grid_x = $2, grid_y = $3, grid_w = $4, grid_h = $5,
               updated_at = NOW(), updated_by = $6
           WHERE id = $1 AND deleted_at IS NULL`,
          [item.widgetId, item.gridX, item.gridY, item.gridW, item.gridH, publisher.id],
        );
      }

      // Promote to published: clear the draft snapshot and bump the version.
      await query(
        `UPDATE dashboards
         SET status = 'published', draft_layout = NULL, published_at = NOW(), published_by = $2,
             version = version + 1, updated_at = NOW(), updated_by = $2
         WHERE id = $1`,
        [dashId, publisher.id],
      );
    });

    // Invalidate all cached layouts for this dashboard
    await this.invalidateDashboardCache(dashId);

    // Emit event to trigger widget refresh
    this.events.emit('dashboard.published', { dashId });

    await this.audit.log({
      accountId: publisher.id,
      eventType: 'dashboard_published', resourceType: 'dashboard', resourceId: dashId,
    });

    return this.getDashboard(dashId, publisher.id, publisher.role);
  }

  async unpublishDashboard(dashId: string, requester: SafeAccount) {
    // Only Admins and Analysts may unpublish — same permission bar as publish.
    if (requester.role !== 'ADMIN' && requester.role !== 'ANALYST') {
      throw new ForbiddenException('Only Admins and Analysts can unpublish dashboards.');
    }
    await this.dashboardPermissions.requireAction(dashId, requester.id, 'can_publish');

    const dash = await this.db.queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM dashboards WHERE id = $1 AND deleted_at IS NULL`,
      [dashId],
    );
    if (!dash) throw new NotFoundException('Dashboard not found');

    await this.db.query(
      `UPDATE dashboards
       SET status = 'draft', updated_at = NOW(), updated_by = $2
       WHERE id = $1`,
      [dashId, requester.id],
    );

    await this.invalidateDashboardCache(dashId);

    await this.audit.log({
      accountId: requester.id,
      eventType: 'dashboard_unpublished', resourceType: 'dashboard', resourceId: dashId,
    });

    return this.getDashboard(dashId, requester.id, requester.role);
  }

  async softDeleteDashboard(dashId: string, deleter: SafeAccount) {
    await this.dashboardPermissions.requireAction(dashId, deleter.id, 'can_delete');
    await this.db.query(
      `UPDATE dashboards SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [dashId, deleter.id],
    );
    await this.invalidateDashboardCache(dashId);
    await this.audit.log({
      accountId: deleter.id,
      eventType: 'dashboard_deleted', resourceType: 'dashboard', resourceId: dashId,
    });
  }

  // ── Page Management ────────────────────────────────────

  async listPages(dashId: string, requesterId: string) {
    await this.dashboardPermissions.requireAction(dashId, requesterId, 'can_view');
    return this.db.queryMany(
      `SELECT p.*,
         (SELECT COUNT(*) FROM dashboard_widgets_v2 w WHERE w.page_id = p.id AND w.deleted_at IS NULL) AS widget_count
       FROM dashboard_pages p
       WHERE p.dashboard_id = $1 AND p.deleted_at IS NULL
       ORDER BY p.order_index ASC`,
      [dashId],
    );
  }

  async createPage(dashId: string, creator: SafeAccount, name: string) {
    await this.dashboardPermissions.requireAction(dashId, creator.id, 'can_edit');

    const maxOrder = await this.db.queryOne<{ max_order: number }>(
      `SELECT COALESCE(MAX(order_index), -1) AS max_order FROM dashboard_pages
       WHERE dashboard_id = $1 AND deleted_at IS NULL`,
      [dashId],
    );

    const page = await this.db.queryOne(
      `INSERT INTO dashboard_pages (dashboard_id, name, order_index, is_default)
       VALUES ($1, $2, $3, FALSE) RETURNING *`,
      [dashId, name, (maxOrder?.max_order ?? -1) + 1],
    );

    await this.audit.log({
      accountId: creator.id,
      eventType: 'dashboard_page_created', resourceType: 'dashboard_page', resourceId: page!.id,
    });

    return page;
  }

  async updatePage(
    pageId: string, dashId: string,
    updater: SafeAccount, data: { name?: string; isDefault?: boolean },
  ) {
    await this.dashboardPermissions.requireAction(dashId, updater.id, 'can_edit');

    // Validate the new name: non-empty and unique within the dashboard.
    if (data.name !== undefined) {
      const trimmed = data.name.trim();
      if (!trimmed) {
        throw new BadRequestException('Page name cannot be empty');
      }
      const dupe = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM dashboard_pages
         WHERE dashboard_id = $1 AND id <> $2 AND deleted_at IS NULL
           AND LOWER(name) = LOWER($3)
         LIMIT 1`,
        [dashId, pageId, trimmed],
      );
      if (dupe) {
        throw new BadRequestException(`A page named "${trimmed}" already exists in this dashboard`);
      }
      data = { ...data, name: trimmed };
    }

    if (data.isDefault) {
      // Unset any existing default page
      await this.db.query(
        `UPDATE dashboard_pages SET is_default = FALSE WHERE dashboard_id = $1`,
        [dashId],
      );
    }

    return this.db.queryOne(
      `UPDATE dashboard_pages
       SET name = COALESCE($3, name),
           is_default = COALESCE($4, is_default),
           updated_at = NOW()
       WHERE id = $1 AND dashboard_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [pageId, dashId, data.name || null, data.isDefault ?? null],
    );
  }

  async deletePage(pageId: string, dashId: string, deleter: SafeAccount) {
    await this.dashboardPermissions.requireAction(dashId, deleter.id, 'can_edit');

    // Cannot delete the last page
    const pageCount = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) FROM dashboard_pages WHERE dashboard_id = $1 AND deleted_at IS NULL`,
      [dashId],
    );
    if (parseInt(pageCount?.count || '0', 10) <= 1) {
      throw new ForbiddenException('Cannot delete the last page of a dashboard');
    }

    await this.db.query(
      `UPDATE dashboard_pages SET deleted_at = NOW()
       WHERE id = $1 AND dashboard_id = $2 AND deleted_at IS NULL`,
      [pageId, dashId],
    );

    await this.audit.log({
      accountId: deleter.id,
      eventType: 'dashboard_page_deleted', resourceType: 'dashboard_page', resourceId: pageId,
    });
  }

  async reorderPages(dashId: string, updater: SafeAccount, order: string[]) {
    await this.dashboardPermissions.requireAction(dashId, updater.id, 'can_edit');

    await this.db.transaction(async (query) => {
      for (let i = 0; i < order.length; i++) {
        await query(
          `UPDATE dashboard_pages SET order_index = $1 WHERE id = $2 AND dashboard_id = $3`,
          [i, order[i], dashId],
        );
      }
    });
  }

  async duplicatePage(pageId: string, dashId: string, creator: SafeAccount) {
    await this.dashboardPermissions.requireAction(dashId, creator.id, 'can_edit');

    const sourcePage = await this.db.queryOne<{ name: string; order_index: number }>(
      `SELECT name, order_index FROM dashboard_pages WHERE id = $1 AND dashboard_id = $2 AND deleted_at IS NULL`,
      [pageId, dashId],
    );
    if (!sourcePage) throw new NotFoundException('Page not found');

    const newPage = await this.db.queryOne(
      `INSERT INTO dashboard_pages (dashboard_id, name, order_index, is_default)
       VALUES ($1, $2, $3, FALSE) RETURNING *`,
      [dashId, `${sourcePage.name} (Copy)`, sourcePage.order_index + 1],
    );

    // Copy all widgets from source page
    await this.db.query(
      `INSERT INTO dashboard_widgets_v2
         (page_id, card_id, widget_type, title, grid_x, grid_y, grid_w, grid_h,
          layout_desktop, layout_tablet, layout_mobile,
          datasource_context_type, datasource_context_id,
          query_definition, query_language, visualization_config,
          refresh_interval_sec, cache_ttl_sec, sort_order, created_by, updated_by)
       SELECT $2, card_id, widget_type, title, grid_x, grid_y, grid_w, grid_h,
              layout_desktop, layout_tablet, layout_mobile,
              datasource_context_type, datasource_context_id,
              query_definition, query_language, visualization_config,
              refresh_interval_sec, cache_ttl_sec, sort_order, $3, $3
       FROM dashboard_widgets_v2
       WHERE page_id = $1 AND deleted_at IS NULL`,
      [pageId, newPage!.id, creator.id],
    );

    return newPage;
  }

  // ── Widget Management ──────────────────────────────────

  /** Resolve the dashboard_id that owns a page (for permission checks) */
  private async resolveDashboardIdForPage(pageId: string): Promise<string> {
    const page = await this.db.queryOne<{ dashboard_id: string }>(
      `SELECT dashboard_id FROM dashboard_pages WHERE id = $1`, [pageId]
    );
    if (!page) throw new NotFoundException('Page not found');
    return page.dashboard_id;
  }

  async listWidgets(pageId: string, requesterId: string) {
    const dashId = await this.resolveDashboardIdForPage(pageId);
    await this.dashboardPermissions.requireAction(dashId, requesterId, 'can_view');
    return this.db.queryMany(
      `SELECT w.*,
              c.name AS card_name, c.status AS card_status,
              c.raw_query AS card_raw_query,
              c.chart_type AS card_chart_type,
              c.datasource_context_id AS card_context_id,
              c.datasource_context_type AS card_context_type,
              qe.result_preview AS card_result_preview,
              qe.result_columns AS card_result_columns
       FROM dashboard_widgets_v2 w
       LEFT JOIN analytics_cards c ON c.id = w.card_id
       LEFT JOIN query_executions qe ON qe.id = c.last_execution_id
       WHERE w.page_id = $1 AND w.deleted_at IS NULL
       ORDER BY w.grid_y ASC, w.grid_x ASC`,
      [pageId],
    );
  }

  async addWidget(pageId: string, creator: SafeAccount, dto: CreateWidgetDto) {
    const dashId = await this.resolveDashboardIdForPage(pageId);
    await this.dashboardPermissions.requireAction(dashId, creator.id, 'can_edit');

    const widget = await this.db.queryOne(
      `INSERT INTO dashboard_widgets_v2
         (page_id, card_id, pinned_card_version, widget_type, title,
          grid_x, grid_y, grid_w, grid_h,
          layout_desktop, layout_tablet, layout_mobile,
          datasource_context_type, datasource_context_id,
          query_definition, query_language, visualization_config,
          refresh_interval_sec, cache_ttl_sec, created_by, updated_by)
       VALUES ($1, $2, $3, $4::widget_type, $5, $6, $7, $8, $9,
               $10, $11, $12, $13::datasource_context_type, $14,
               $15, $16, $17, $18, $19, $20, $20)
       RETURNING *`,
      [
        pageId,
        dto.cardId || null, dto.pinnedCardVersion || null,
        dto.widgetType, dto.title || null,
        dto.gridX, dto.gridY, dto.gridW, dto.gridH,
        JSON.stringify(dto.layoutDesktop || {}),
        JSON.stringify(dto.layoutTablet || {}),
        JSON.stringify(dto.layoutMobile || {}),
        dto.datasourceContextType || null, dto.datasourceContextId || null,
        JSON.stringify(dto.queryDefinition || {}),
        dto.queryLanguage || 'sql',
        JSON.stringify(dto.visualizationConfig || {}),
        dto.refreshIntervalSec || null, dto.cacheTtlSec || 300,
        creator.id,
      ],
    );

    await this.audit.log({
      accountId: creator.id,
      eventType: 'widget_added', resourceType: 'widget', resourceId: widget!.id,
    });

    await this.invalidateDashboardCache(dashId);

    return widget;
  }

  async updateWidget(
    widgetId: string, pageId: string,
    updater: SafeAccount, dto: Partial<CreateWidgetDto>,
  ) {
    const dashId = await this.resolveDashboardIdForPage(pageId);
    await this.dashboardPermissions.requireAction(dashId, updater.id, 'can_edit');

    const widget = await this.db.queryOne(
      `UPDATE dashboard_widgets_v2
       SET title                   = COALESCE($3, title),
           grid_x                  = COALESCE($4, grid_x),
           grid_y                  = COALESCE($5, grid_y),
           grid_w                  = COALESCE($6, grid_w),
           grid_h                  = COALESCE($7, grid_h),
           layout_desktop          = CASE WHEN $8::jsonb IS NULL THEN layout_desktop ELSE $8::jsonb END,
           layout_tablet           = CASE WHEN $9::jsonb IS NULL THEN layout_tablet ELSE $9::jsonb END,
           layout_mobile           = CASE WHEN $10::jsonb IS NULL THEN layout_mobile ELSE $10::jsonb END,
           query_definition        = CASE WHEN $11::jsonb IS NULL THEN query_definition ELSE $11::jsonb END,
           visualization_config    = CASE WHEN $12::jsonb IS NULL THEN visualization_config ELSE $12::jsonb END,
           refresh_interval_sec    = COALESCE($13, refresh_interval_sec),
           cache_ttl_sec           = COALESCE($14, cache_ttl_sec),
           updated_by              = $15,
           updated_at              = NOW()
       WHERE id = $1 AND page_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [
        widgetId, pageId,
        dto.title !== undefined ? dto.title : null,
        dto.gridX ?? null, dto.gridY ?? null, dto.gridW ?? null, dto.gridH ?? null,
        dto.layoutDesktop ? JSON.stringify(dto.layoutDesktop) : null,
        dto.layoutTablet ? JSON.stringify(dto.layoutTablet) : null,
        dto.layoutMobile ? JSON.stringify(dto.layoutMobile) : null,
        dto.queryDefinition ? JSON.stringify(dto.queryDefinition) : null,
        dto.visualizationConfig ? JSON.stringify(dto.visualizationConfig) : null,
        dto.refreshIntervalSec !== undefined ? dto.refreshIntervalSec : null,
        dto.cacheTtlSec || null,
        updater.id,
      ],
    );

    // Invalidate widget cache
    await this.cache.del(CacheKeys.widgetResult(widgetId));
    await this.invalidateDashboardCache(dashId);

    return widget;
  }

  async removeWidget(widgetId: string, pageId: string, remover: SafeAccount) {
    const dashId = await this.resolveDashboardIdForPage(pageId);
    await this.dashboardPermissions.requireAction(dashId, remover.id, 'can_edit');

    await this.db.query(
      `UPDATE dashboard_widgets_v2
       SET deleted_at = NOW(), updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND page_id = $2 AND deleted_at IS NULL`,
      [widgetId, pageId, remover.id],
    );
    await this.cache.del(CacheKeys.widgetResult(widgetId));
    await this.audit.log({
      accountId: remover.id,
      eventType: 'widget_removed', resourceType: 'widget', resourceId: widgetId,
    });

    await this.invalidateDashboardCache(dashId);
  }

  /**
   * Batch layout update — called by the dashboard builder on drag/resize.
   * Saves the new layout as a draft (not yet published).
   * Also updates individual widget grid positions.
   */
  async updateLayout(dashId: string, updater: SafeAccount, layout: LayoutItem[]) {
    await this.dashboardPermissions.requireAction(dashId, updater.id, 'can_edit');

    await this.db.transaction(async (query) => {
      for (const item of layout) {
        await query(
          `UPDATE dashboard_widgets_v2
           SET grid_x = $2, grid_y = $3, grid_w = $4, grid_h = $5,
               layout_desktop = $6, layout_tablet = $7, layout_mobile = $8,
               updated_at = NOW(), updated_by = $9
           WHERE id = $1 AND deleted_at IS NULL`,
          [
            item.widgetId, item.gridX, item.gridY, item.gridW, item.gridH,
            JSON.stringify(item.layoutDesktop || {}),
            JSON.stringify(item.layoutTablet || {}),
            JSON.stringify(item.layoutMobile || {}),
            updater.id,
          ],
        );
      }

      // Persist draft layout on the dashboard
      await query(
        `UPDATE dashboards SET draft_layout = $2, updated_at = NOW(), updated_by = $3 WHERE id = $1`,
        [dashId, JSON.stringify(layout), updater.id],
      );
    });

    // Cache draft layout in Redis for fast retrieval
    await this.cache.setJson(
      CacheKeys.dashDraft(dashId, updater.id),
      layout,
      CacheTTL.DASH_DRAFT,
    );
  }

  async inspectWidget(widgetId: string, requester: SafeAccount) {
    const widgetRow = await this.db.queryOne<{ page_id: string }>(
      `SELECT page_id FROM dashboard_widgets_v2 WHERE id = $1`,
      [widgetId],
    );
    if (!widgetRow) throw new NotFoundException('Widget not found');
    const dashId = await this.resolveDashboardIdForPage(widgetRow.page_id);
    await this.dashboardPermissions.requireAction(dashId, requester.id, 'can_view');

    // Try the most-recent widget_execution → query_execution for the generated SQL
    const execution = await this.db.queryOne(
      `SELECT w.id, w.status, w.error, w.duration_ms, w.started_at, w.cached,
              q.generated_query, q.row_count AS rows_returned
       FROM widget_executions w
       LEFT JOIN query_executions q ON w.execution_id = q.id
       WHERE w.widget_id = $1
       ORDER BY w.started_at DESC LIMIT 1`,
      [widgetId],
    );

    // Fallback: read generated_query from the widget's own query_definition JSONB
    // (stored there by addWidget / updateWidget when the user adds or edits the widget)
    if (!execution?.generated_query) {
      const widget = await this.db.queryOne<{ query_definition: any }>(
        `SELECT query_definition FROM dashboard_widgets_v2 WHERE id = $1`,
        [widgetId],
      );
      const qd = typeof widget?.query_definition === 'string'
        ? JSON.parse(widget.query_definition)
        : (widget?.query_definition || {});
      const fallbackSql = (qd.sql as string | undefined) || null;
      if (fallbackSql) {
        return {
          execution: execution
            ? { ...execution, generated_query: fallbackSql }
            : { generated_query: fallbackSql },
        };
      }
    }

    return { execution: execution || null };
  }

  // ── Filters ──────────────────────────────────────────────

  async listFilters(dashId: string, requester: SafeAccount) {
    await this.dashboardPermissions.requireAction(dashId, requester.id, 'can_view');
    return this.db.queryMany(`SELECT * FROM dashboard_filters WHERE dashboard_id = $1 ORDER BY created_at ASC`, [dashId]);
  }

  async addFilter(dashId: string, requester: SafeAccount, dto: any) {
    await this.dashboardPermissions.requireAction(dashId, requester.id, 'can_edit');
    const filter = await this.db.queryOne(
      `INSERT INTO dashboard_filters (dashboard_id, name, filter_type, operator, default_value, config)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [dashId, dto.name, dto.filterType, dto.operator, dto.defaultValue, dto.config || {}]
    );
    return filter;
  }

  async removeFilter(filterId: string, dashId: string, requester: SafeAccount) {
    await this.dashboardPermissions.requireAction(dashId, requester.id, 'can_edit');
    await this.db.query(`DELETE FROM dashboard_filters WHERE id = $1 AND dashboard_id = $2`, [filterId, dashId]);
  }

  // ── Versioning ───────────────────────────────────────────

  async saveVersion(dashId: string, requester: SafeAccount, message?: string) {
    // Require can_edit — read-only (view-only) users must not be able to create
    // version snapshots. Previously this was can_view which was too permissive.
    await this.dashboardPermissions.requireAction(dashId, requester.id, 'can_edit');

      return this.db.transaction(async (query) => {
      // Get current max version
      const maxVerRow = await query(`SELECT COALESCE(MAX(version), 0) as v FROM dashboard_versions WHERE dashboard_id = $1`, [dashId]);
      const nextVer = Number(maxVerRow.rows[0].v) + 1;

      // Fetch full state for snapshot
      const dashInfo = await query(`SELECT * FROM dashboards WHERE id = $1`, [dashId]);
      const pages = await query(`SELECT * FROM dashboard_pages WHERE dashboard_id = $1 ORDER BY order_index ASC`, [dashId]);
      const widgets = await query(`
        SELECT w.* FROM dashboard_widgets_v2 w
        JOIN dashboard_pages p ON w.page_id = p.id
        WHERE p.dashboard_id = $1 AND w.deleted_at IS NULL
      `, [dashId]);
      const filters = await query(`SELECT * FROM dashboard_filters WHERE dashboard_id = $1`, [dashId]);

      const snapshotData = {
        dashboard: dashInfo.rows[0],
        pages: pages.rows,
        widgets: widgets.rows,
        filters: filters.rows,
      };

      const result = await query(
        `INSERT INTO dashboard_versions (dashboard_id, version, published_by, snapshot_data, change_summary)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [dashId, nextVer, requester.id, JSON.stringify(snapshotData), message || `Version ${nextVer}`]
      );

      // Update dash version
      await query(`UPDATE dashboards SET version = $1 WHERE id = $2`, [nextVer, dashId]);

      // Remap properties for the frontend expectation
      const row = result.rows[0];
      return {
        id: row.id,
        version_number: row.version,
        commit_message: row.change_summary,
        created_at: row.published_at,
        created_by: row.published_by,
        snapshot_data: row.snapshot_data
      };
    });
  }

  async listVersions(dashId: string, requester: SafeAccount) {
    await this.dashboardPermissions.requireAction(dashId, requester.id, 'can_view');
    return this.db.queryMany(
      `SELECT v.id, v.version as version_number, v.change_summary as commit_message, v.published_at as created_at, a.email as created_by_email
       FROM dashboard_versions v
       LEFT JOIN accounts a ON v.published_by = a.id
       WHERE v.dashboard_id = $1 ORDER BY v.version DESC`,
      [dashId]
    );
  }

  async restoreVersion(dashId: string, versionId: string, requester: SafeAccount) {
    await this.dashboardPermissions.requireAction(dashId, requester.id, 'can_view');

    const vrow = await this.db.queryOne(
      `SELECT snapshot_data FROM dashboard_versions WHERE id = $1 AND dashboard_id = $2`,
      [versionId, dashId]
    );
    if (!vrow) throw new Error('Version not found');

    const snap = vrow.snapshot_data as any;
    const pages: any[] = snap.pages || [];
    const widgets: any[] = snap.widgets || [];

    await this.db.transaction(async (query) => {
      // Delete existing pages (cascades to widgets via FK)
      await query(`DELETE FROM dashboard_pages WHERE dashboard_id = $1`, [dashId]);

      // Recreate pages in order
      for (const p of pages) {
        await query(
          `INSERT INTO dashboard_pages (id, dashboard_id, name, order_index, settings)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, order_index = EXCLUDED.order_index`,
          [p.id, dashId, p.name, p.order_index, JSON.stringify(p.settings || {})]
        );
      }

      // Recreate widgets
      for (const w of widgets) {
        await query(
          `INSERT INTO dashboard_widgets_v2
             (id, page_id, card_id, title, widget_type, grid_x, grid_y, grid_w, grid_h,
              datasource_context_type, datasource_context_id, query_definition,
              layout_desktop, layout_tablet, layout_mobile,
              created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title, widget_type = EXCLUDED.widget_type,
             grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y,
             grid_w = EXCLUDED.grid_w, grid_h = EXCLUDED.grid_h,
             card_id = EXCLUDED.card_id,
             datasource_context_type = EXCLUDED.datasource_context_type,
             datasource_context_id = EXCLUDED.datasource_context_id,
             query_definition = EXCLUDED.query_definition,
             deleted_at = NULL`,
          [
            w.id, w.page_id, w.card_id || null, w.title, w.widget_type,
            w.grid_x, w.grid_y, w.grid_w, w.grid_h,
            w.datasource_context_type || null, w.datasource_context_id || null,
            JSON.stringify(w.query_definition || {}),
            JSON.stringify(w.layout_desktop || {}),
            JSON.stringify(w.layout_tablet || {}),
            JSON.stringify(w.layout_mobile || {}),
            requester.id
          ]
        );
      }
    });

    await this.invalidateDashboardCache(dashId);
    return { success: true };
  }

  // ── Cache Helpers ──────────────────────────────────────

  async invalidateDashboardCache(dashId: string) {
    try {
      await this.cache.delPattern(`di:dashboard:layout:${dashId}:*`);
      await this.cache.delPattern(`di:dashboard:draft:${dashId}:*`);
      await this.cache.del(CacheKeys.dashLayout(dashId, '*'));
    } catch (e: any) {
      this.logger.warn(`Failed to invalidate cache for dashboard ${dashId}: ${e.message}`);
    }
  }
}
