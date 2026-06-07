// ──────────────────────────────────────────────
// DashboardBuilderService — Layout management, draft/publish lifecycle,
// widget CRUD, batch layout updates, cache invalidation
// ──────────────────────────────────────────────

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OrgPermissionsService } from '../org/org-permissions.service';
import { RedisService, RedisKeys, RedisTTL } from '../redis/redis.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SafeAccount } from '../auth/auth.service';

export interface CreateDashboardDto {
  name: string;
  description?: string;
  contextType: 'org_overview' | 'connection' | 'combo';
  contextId: string;
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
    private readonly orgPermissions: OrgPermissionsService,
    private readonly redis: RedisService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Dashboard CRUD ────────────────────────────────────

  async listDashboards(orgId: string, requesterId: string, opts: { contextType?: string; contextId?: string; status?: string } = {}) {
    await this.orgPermissions.requireMember(orgId, requesterId);

    const conditions = ['d.org_id = $1', 'd.deleted_at IS NULL'];
    const params: unknown[] = [orgId];
    let p = 2;

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

  async getDashboard(dashId: string, orgId: string, requesterId: string) {
    await this.orgPermissions.requireMember(orgId, requesterId);
    const dash = await this.db.queryOne(
      `SELECT d.*, a.display_name AS created_by_name
       FROM dashboards d
       JOIN accounts a ON a.id = d.created_by
       WHERE d.id = $1 AND d.org_id = $2 AND d.deleted_at IS NULL`,
      [dashId, orgId],
    );
    if (!dash) throw new NotFoundException('Dashboard not found');
    return dash;
  }

  async createDashboard(orgId: string, creator: SafeAccount, dto: CreateDashboardDto) {
    await this.orgPermissions.requireRole(orgId, creator.id, 'editor');

    const dash = await this.db.transaction(async (query) => {
      const result = await query(
        `INSERT INTO dashboards
           (org_id, name, description, context_type, context_id, redis_key, created_by, updated_by)
         VALUES ($1, $2, $3, $4::dashboard_context_type, $5, $6, $7, $7)
         RETURNING *`,
        [
          orgId, dto.name, dto.description || null,
          dto.contextType, dto.contextId,
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
         VALUES ($1, 'Overview', TRUE, 0)`,
        [dash.id],
      );

      return dash;
    });

    await this.audit.log({
      orgId, accountId: creator.id,
      eventType: 'dashboard_created', resourceType: 'dashboard', resourceId: dash.id,
      details: { name: dash.name, contextType: dto.contextType },
    });

    return dash;
  }

  async publishDashboard(dashId: string, orgId: string, publisher: SafeAccount) {
    await this.orgPermissions.requireRole(orgId, publisher.id, 'editor');

    const dash = await this.db.queryOne<{ id: string; draft_layout: unknown }>(
      `SELECT id, draft_layout FROM dashboards WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [dashId, orgId],
    );
    if (!dash) throw new NotFoundException('Dashboard not found');

    await this.db.query(
      `UPDATE dashboards
       SET status = 'published', draft_layout = NULL, published_at = NOW(), published_by = $2,
           version = version + 1, updated_at = NOW(), updated_by = $2
       WHERE id = $1`,
      [dashId, publisher.id],
    );

    // Invalidate all cached layouts for this dashboard
    await this.invalidateDashboardCache(dashId);

    // Emit event to trigger widget refresh
    this.events.emit('dashboard.published', { dashId, orgId });

    await this.audit.log({
      orgId, accountId: publisher.id,
      eventType: 'dashboard_published', resourceType: 'dashboard', resourceId: dashId,
    });

    return this.getDashboard(dashId, orgId, publisher.id);
  }

  async softDeleteDashboard(dashId: string, orgId: string, deleter: SafeAccount) {
    await this.orgPermissions.requireRole(orgId, deleter.id, 'admin');
    await this.db.query(
      `UPDATE dashboards SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [dashId, deleter.id],
    );
    await this.invalidateDashboardCache(dashId);
    await this.audit.log({
      orgId, accountId: deleter.id,
      eventType: 'dashboard_deleted', resourceType: 'dashboard', resourceId: dashId,
    });
  }

  // ── Page Management ────────────────────────────────────

  async listPages(dashId: string, orgId: string, requesterId: string) {
    await this.orgPermissions.requireMember(orgId, requesterId);
    return this.db.queryMany(
      `SELECT p.*,
         (SELECT COUNT(*) FROM dashboard_widgets_v2 w WHERE w.page_id = p.id AND w.deleted_at IS NULL) AS widget_count
       FROM dashboard_pages p
       WHERE p.dashboard_id = $1 AND p.deleted_at IS NULL
       ORDER BY p.order_index ASC`,
      [dashId],
    );
  }

  async createPage(dashId: string, orgId: string, creator: SafeAccount, name: string) {
    await this.orgPermissions.requireRole(orgId, creator.id, 'editor');
    await this.verifyDashboardOwnership(dashId, orgId);

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
      orgId, accountId: creator.id,
      eventType: 'dashboard_page_created', resourceType: 'dashboard_page', resourceId: page!.id,
    });

    return page;
  }

  async updatePage(
    pageId: string, dashId: string, orgId: string,
    updater: SafeAccount, data: { name?: string; isDefault?: boolean },
  ) {
    await this.orgPermissions.requireRole(orgId, updater.id, 'editor');

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

  async deletePage(pageId: string, dashId: string, orgId: string, deleter: SafeAccount) {
    await this.orgPermissions.requireRole(orgId, deleter.id, 'editor');

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
      orgId, accountId: deleter.id,
      eventType: 'dashboard_page_deleted', resourceType: 'dashboard_page', resourceId: pageId,
    });
  }

  async reorderPages(dashId: string, orgId: string, updater: SafeAccount, order: string[]) {
    await this.orgPermissions.requireRole(orgId, updater.id, 'editor');

    await this.db.transaction(async (query) => {
      for (let i = 0; i < order.length; i++) {
        await query(
          `UPDATE dashboard_pages SET order_index = $1 WHERE id = $2 AND dashboard_id = $3`,
          [i, order[i], dashId],
        );
      }
    });
  }

  async duplicatePage(pageId: string, dashId: string, orgId: string, creator: SafeAccount) {
    await this.orgPermissions.requireRole(orgId, creator.id, 'editor');

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

  async listWidgets(pageId: string, orgId: string, requesterId: string) {
    await this.orgPermissions.requireMember(orgId, requesterId);
    return this.db.queryMany(
      `SELECT w.*, c.name AS card_name, c.status AS card_status
       FROM dashboard_widgets_v2 w
       LEFT JOIN analytics_cards c ON c.id = w.card_id
       WHERE w.page_id = $1 AND w.deleted_at IS NULL
       ORDER BY w.grid_y ASC, w.grid_x ASC`,
      [pageId],
    );
  }

  async addWidget(pageId: string, orgId: string, creator: SafeAccount, dto: CreateWidgetDto) {
    await this.orgPermissions.requireRole(orgId, creator.id, 'editor');

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
      orgId, accountId: creator.id,
      eventType: 'widget_added', resourceType: 'widget', resourceId: widget!.id,
    });

    return widget;
  }

  async updateWidget(
    widgetId: string, pageId: string, orgId: string,
    updater: SafeAccount, dto: Partial<CreateWidgetDto>,
  ) {
    await this.orgPermissions.requireRole(orgId, updater.id, 'editor');

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
    await this.redis.del(RedisKeys.widgetResult(widgetId));

    return widget;
  }

  async removeWidget(widgetId: string, pageId: string, orgId: string, remover: SafeAccount) {
    await this.orgPermissions.requireRole(orgId, remover.id, 'editor');
    await this.db.query(
      `UPDATE dashboard_widgets_v2
       SET deleted_at = NOW(), updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND page_id = $2 AND deleted_at IS NULL`,
      [widgetId, pageId, remover.id],
    );
    await this.redis.del(RedisKeys.widgetResult(widgetId));
    await this.audit.log({
      orgId, accountId: remover.id,
      eventType: 'widget_removed', resourceType: 'widget', resourceId: widgetId,
    });
  }

  /**
   * Batch layout update — called by the dashboard builder on drag/resize.
   * Saves the new layout as a draft (not yet published).
   * Also updates individual widget grid positions.
   */
  async updateLayout(dashId: string, orgId: string, updater: SafeAccount, layout: LayoutItem[]) {
    await this.orgPermissions.requireRole(orgId, updater.id, 'editor');

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
    await this.redis.setJson(
      RedisKeys.dashDraft(dashId, updater.id),
      layout,
      RedisTTL.DASH_DRAFT,
    );
  }

  async inspectWidget(widgetId: string, orgId: string, requester: SafeAccount) {
    await this.orgPermissions.requireMember(orgId, requester.id);
    
    const execution = await this.db.queryOne(
      `SELECT w.id, w.status, w.error, w.duration_ms, w.started_at, w.cached,
              q.raw_query, q.rows_returned 
       FROM widget_executions w
       LEFT JOIN query_executions q ON w.execution_id = q.id
       WHERE w.widget_id = $1 AND w.org_id = $2
       ORDER BY w.started_at DESC LIMIT 1`,
      [widgetId, orgId]
    );

    return { execution: execution || null };
  }

  // ── Filters ──────────────────────────────────────────────

  async listFilters(dashId: string, orgId: string, requester: SafeAccount) {
    await this.verifyDashboardOwnership(dashId, orgId);
    await this.orgPermissions.requireMember(orgId, requester.id);
    return this.db.queryMany(`SELECT * FROM dashboard_filters WHERE dashboard_id = $1 ORDER BY created_at ASC`, [dashId]);
  }

  async addFilter(dashId: string, orgId: string, requester: SafeAccount, dto: any) {
    await this.verifyDashboardOwnership(dashId, orgId);
    await this.orgPermissions.requireMember(orgId, requester.id);
    const filter = await this.db.queryOne(
      `INSERT INTO dashboard_filters (dashboard_id, name, filter_type, operator, default_value, config)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [dashId, dto.name, dto.filterType, dto.operator, dto.defaultValue, dto.config || {}]
    );
    return filter;
  }

  async removeFilter(filterId: string, dashId: string, orgId: string, requester: SafeAccount) {
    await this.verifyDashboardOwnership(dashId, orgId);
    await this.orgPermissions.requireMember(orgId, requester.id);
    await this.db.query(`DELETE FROM dashboard_filters WHERE id = $1 AND dashboard_id = $2`, [filterId, dashId]);
  }

  // ── Versioning ───────────────────────────────────────────

  async saveVersion(dashId: string, orgId: string, requester: SafeAccount, message?: string) {
    await this.verifyDashboardOwnership(dashId, orgId);
    await this.orgPermissions.requireMember(orgId, requester.id);

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
        WHERE p.dashboard_id = $1
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

  async listVersions(dashId: string, orgId: string, requester: SafeAccount) {
    await this.verifyDashboardOwnership(dashId, orgId);
    await this.orgPermissions.requireMember(orgId, requester.id);
    return this.db.queryMany(
      `SELECT v.id, v.version as version_number, v.change_summary as commit_message, v.published_at as created_at, a.email as created_by_email 
       FROM dashboard_versions v
       LEFT JOIN accounts a ON v.published_by = a.id
       WHERE v.dashboard_id = $1 ORDER BY v.version DESC`,
      [dashId]
    );
  }

  // ── Cache Helpers ──────────────────────────────────────

  async invalidateDashboardCache(dashId: string) {
    await this.redis.delPattern(`di:dashboard:layout:${dashId}:*`);
    await this.redis.delPattern(`di:dashboard:draft:${dashId}:*`);
    await this.redis.del(RedisKeys.dashLayout(dashId, '*'));
  }

  // ── Private Helpers ────────────────────────────────────

  private async verifyDashboardOwnership(dashId: string, orgId: string) {
    const dash = await this.db.queryOne(
      `SELECT id FROM dashboards WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [dashId, orgId],
    );
    if (!dash) throw new NotFoundException('Dashboard not found in this organization');
  }
}
