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
import { randomBytes } from 'crypto';
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
  // Discriminates the independent dashboard families. Manual dashboards
  // belong to the Dashboards module; datasource dashboards live only inside a
  // specific data source / combo workflow; cards-workspace dashboards belong
  // to the Cards module (no fixed data source, no seeding, never publishable).
  // Defaults to 'manual'.
  origin?: 'manual' | 'datasource' | 'cards';
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

/**
 * One dashboard-global filter condition. Mirrors the client FilterCondition
 * (frontend/src/lib/filters.ts): a target dimension + typed operator, with the
 * operator-specific payload (value/values/relativeN/from/to) carried in
 * `config` so new operators never require a schema change.
 */
export interface AddDashboardFilterDto {
  column: string;
  colType: 'numeric' | 'string' | 'date';
  operator: string;
  config?: Record<string, unknown>;
  /** DC-04 — when true, viewers cannot modify or remove this filter. */
  locked?: boolean;
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

  /**
   * List dashboards the user owns, that were shared with them directly, or
   * where at least one PAGE within the dashboard was shared with them.
   * Deliberately does NOT consider dashboard_widget_shares — a card-only
   * share must never surface a dashboard tile (it belongs only in
   * Cards → Shared with Me; see listSharedCards).
   */
  async listDashboards(
    requesterId: string,
    opts: { contextType?: string; contextId?: string; status?: string; origin?: string; requesterRole?: string; editableOnly?: boolean } = {},
  ) {
    // Visibility model:
    //   • everyone: dashboards they own, that are shared with them directly,
    //     or that have at least one page shared with them.
    //   • Admin (additional): every PUBLISHED dashboard across the project,
    //     regardless of owner or share — Admins oversee all published content.
    const pageShareExists = `EXISTS (
             SELECT 1 FROM dashboard_page_shares ps
             JOIN dashboard_pages pg ON pg.id = ps.page_id
             WHERE pg.dashboard_id = d.id AND ps.shared_with = $1 AND pg.deleted_at IS NULL
           )`;
    const isAdmin = opts.requesterRole === 'ADMIN';
    const visibility = isAdmin
      ? `( d.created_by = $1
           OR d.status = 'published'
           OR EXISTS (
             SELECT 1 FROM dashboard_shares ds
             WHERE ds.dashboard_id = d.id AND ds.shared_with = $1
           )
           OR ${pageShareExists} )`
      : `( d.created_by = $1
           OR EXISTS (
             SELECT 1 FROM dashboard_shares ds
             WHERE ds.dashboard_id = d.id AND ds.shared_with = $1
           )
           OR ${pageShareExists} )`;
    const conditions = ['d.deleted_at IS NULL', visibility];
    const params: unknown[] = [requesterId];
    let p = 2;

    if (opts.origin) { conditions.push(`d.origin = $${p++}::dashboard_origin`); params.push(opts.origin); }
    if (opts.contextType) { conditions.push(`d.context_type = $${p++}`); params.push(opts.contextType); }
    if (opts.contextId) { conditions.push(`d.context_id = $${p++}`); params.push(opts.contextId); }
    if (opts.status) { conditions.push(`d.status = $${p++}`); params.push(opts.status); }
    // Move/copy target picker: only dashboards the requester can actually edit into.
    if (opts.editableOnly) {
      conditions.push(
        `( d.created_by = $1
           OR EXISTS (
             SELECT 1 FROM dashboard_shares ds
             WHERE ds.dashboard_id = d.id AND ds.shared_with = $1 AND ds.can_edit = TRUE
           ) )`,
      );
    }

    // Cards module only: the distinct data sources used by cards inside each
    // workspace, for the "filter by data source" dropdown on the Cards page.
    // Skipped for regular dashboard listing — it's an extra correlated
    // subquery per row that nothing else needs.
    const dataSourcesCol = opts.origin === 'cards'
      ? `(SELECT COALESCE(json_agg(DISTINCT jsonb_build_object('id', dc.id, 'name', dc.name)) FILTER (WHERE dc.id IS NOT NULL), '[]'::json)
            FROM dashboard_widgets_v2 w
            JOIN dashboard_pages p ON p.id = w.page_id
            LEFT JOIN datasource_connections dc ON dc.id = w.datasource_context_id AND w.datasource_context_type = 'connection'
          WHERE p.dashboard_id = d.id AND w.deleted_at IS NULL AND p.deleted_at IS NULL) AS data_sources,`
      : '';

    const rows = await this.db.queryMany<any>(
      `SELECT d.*, a.display_name AS created_by_name,
              (SELECT COUNT(*) FROM dashboard_pages WHERE dashboard_id = d.id AND deleted_at IS NULL) AS page_count,
              ${dataSourcesCol}
              ds.shared_by AS dash_share_shared_by, ds.can_edit AS dash_share_can_edit,
              sharer.display_name AS dash_share_shared_by_name, sharer.email AS dash_share_shared_by_email,
              (SELECT ps.shared_by FROM dashboard_page_shares ps
                 JOIN dashboard_pages pg ON pg.id = ps.page_id
               WHERE pg.dashboard_id = d.id AND ps.shared_with = $1 AND pg.deleted_at IS NULL
               LIMIT 1) AS page_share_shared_by
       FROM dashboards d
       JOIN accounts a ON a.id = d.created_by
       LEFT JOIN dashboard_shares ds ON ds.dashboard_id = d.id AND ds.shared_with = $1
       LEFT JOIN accounts sharer ON sharer.id = ds.shared_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.updated_at DESC`,
      params,
    );

    const sharerCache = new Map<string, { display_name: string; email: string } | null>();
    const resolveSharer = async (accountId: string) => {
      if (!sharerCache.has(accountId)) {
        sharerCache.set(accountId, await this.db.queryOne(`SELECT display_name, email FROM accounts WHERE id = $1`, [accountId]));
      }
      return sharerCache.get(accountId) ?? null;
    };

    const annotated: any[] = [];
    for (const row of rows) {
      const {
        dash_share_shared_by, dash_share_can_edit, dash_share_shared_by_name, dash_share_shared_by_email,
        page_share_shared_by, ...rest
      } = row;
      const isOwner = rest.created_by === requesterId;
      if (isOwner) {
        annotated.push({ ...rest, access_source: 'owner', shared_by_name: null, shared_by_email: null });
      } else if (dash_share_shared_by) {
        annotated.push({ ...rest, access_source: 'dashboard_share', shared_by_name: dash_share_shared_by_name, shared_by_email: dash_share_shared_by_email });
      } else if (page_share_shared_by) {
        const sharer = await resolveSharer(page_share_shared_by);
        annotated.push({ ...rest, access_source: 'page_share', shared_by_name: sharer?.display_name ?? null, shared_by_email: sharer?.email ?? null });
      } else {
        // Admin viewing a published dashboard they neither own nor were shared on.
        annotated.push({ ...rest, access_source: 'admin_published', shared_by_name: null, shared_by_email: null });
      }
    }
    return annotated;
  }

  /**
   * Cards (dashboard widgets) shared directly with the requester — the
   * counterpart to listDashboards' page/dashboard scope. These never imply
   * dashboard or page visibility (listDashboards intentionally ignores
   * dashboard_widget_shares), so this is the ONLY place a card-only share
   * surfaces: the Cards → Shared with Me page.
   */
  async listSharedCards(requesterId: string) {
    return this.db.queryMany<any>(
      `SELECT w.id, w.title, w.widget_type, w.query_definition, w.visualization_config,
              w.cached_result, w.cached_at, w.updated_at, w.created_at,
              ws.can_edit, ws.shared_by, ws.created_at AS shared_at,
              sharer.display_name AS shared_by_name, sharer.email AS shared_by_email,
              p.id AS page_id, p.name AS page_name,
              d.id AS dashboard_id, d.name AS dashboard_name, d.origin AS dashboard_origin
       FROM dashboard_widget_shares ws
       JOIN dashboard_widgets_v2 w ON w.id = ws.widget_id
       JOIN dashboard_pages p ON p.id = w.page_id
       JOIN dashboards d ON d.id = p.dashboard_id
       JOIN accounts sharer ON sharer.id = ws.shared_by
       WHERE ws.shared_with = $1 AND w.deleted_at IS NULL
         AND p.deleted_at IS NULL AND d.deleted_at IS NULL
       ORDER BY ws.created_at DESC`,
      [requesterId],
    );
  }

  async getDashboard(dashId: string, requesterId: string, requesterRole?: string) {
    // Loosened from a hard dashboard-level gate to "any access at all" so a
    // user who was only granted a page-level or card-level share can open
    // the dashboard shell — listPages/listWidgets below then filter the
    // content down to exactly what they were granted, nothing more.
    const hasAnyAccess = await this.dashboardPermissions.canViewDashboardAtAll(dashId, requesterId);
    if (!hasAnyAccess) throw new ForbiddenException('You do not have access to this dashboard');
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
    // Cards-workspace dashboards are never publishable — never trust the
    // client to hide the button, decide it here.
    const canPublish = dash.origin !== 'cards' && (requesterRole === 'ADMIN' || requesterRole === 'ANALYST') && canEdit;

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

    const dash = await this.db.queryOne<{ id: string; draft_layout: any; origin: string }>(
      `SELECT id, draft_layout, origin FROM dashboards WHERE id = $1 AND deleted_at IS NULL`,
      [dashId],
    );
    if (!dash) throw new NotFoundException('Dashboard not found');
    if (dash.origin === 'cards') {
      throw new ForbiddenException('Card workspaces cannot be published.');
    }

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

  // ── Embedding (DB2-03) ─────────────────────────────────

  /**
   * Enable/disable embedding for a dashboard. Generates a fresh opaque token
   * the first time embedding is turned on. Same permission bar as publishing.
   * Returns the current embed state.
   */
  async setEmbed(
    dashId: string,
    requester: SafeAccount,
    enabled: boolean,
    regenerate = false,
  ): Promise<{ embed_enabled: boolean; embed_token: string | null }> {
    if (requester.role !== 'ADMIN' && requester.role !== 'ANALYST') {
      throw new ForbiddenException('Only Admins and Analysts can manage embedding.');
    }
    await this.dashboardPermissions.requireAction(dashId, requester.id, 'can_publish');

    const dash = await this.db.queryOne<{ id: string; embed_token: string | null; origin: string }>(
      `SELECT id, embed_token, origin FROM dashboards WHERE id = $1 AND deleted_at IS NULL`,
      [dashId],
    );
    if (!dash) throw new NotFoundException('Dashboard not found');
    if (dash.origin === 'cards') {
      throw new ForbiddenException('Card workspaces cannot be embedded.');
    }

    // Mint a token on first enable (or when explicitly rotating).
    const token = enabled && (!dash.embed_token || regenerate)
      ? randomBytes(24).toString('base64url')
      : dash.embed_token;

    const updated = await this.db.queryOne<{ embed_enabled: boolean; embed_token: string | null }>(
      `UPDATE dashboards
          SET embed_enabled = $2, embed_token = $3, updated_at = NOW(), updated_by = $4
        WHERE id = $1
      RETURNING embed_enabled, embed_token`,
      [dashId, enabled, token, requester.id],
    );

    await this.audit.log({
      accountId: requester.id,
      eventType: enabled ? 'dashboard_embed_enabled' : 'dashboard_embed_disabled',
      resourceType: 'dashboard', resourceId: dashId,
    });

    return updated!;
  }

  /**
   * Public read path for an embedded dashboard. The token is the capability —
   * the dashboard is only served when embedding is enabled AND it is currently
   * published, so unpublishing or disabling embedding revokes access instantly.
   * Content is read using the owner's identity so the full published dashboard
   * is returned (no per-viewer share filtering).
   */
  async getEmbeddedDashboard(token: string) {
    if (!token) throw new NotFoundException('Dashboard not found');
    const dash = await this.db.queryOne<any>(
      `SELECT d.*, a.display_name AS created_by_name
         FROM dashboards d
         JOIN accounts a ON a.id = d.created_by
        WHERE d.embed_token = $1
          AND d.embed_enabled = true
          AND d.status = 'published'
          AND d.deleted_at IS NULL`,
      [token],
    );
    if (!dash) throw new NotFoundException('This dashboard is not available for embedding.');

    const ownerId = dash.created_by;
    const pages = await this.listPages(dash.id, ownerId);
    const pagesWithWidgets = await Promise.all(
      pages.map(async (p: any) => ({
        ...p,
        widgets: await this.listWidgets(p.id, ownerId),
      })),
    );

    // Dashboard-global filters cascade to widgets client-side; ship them so the
    // embedded viewer can render (and interact with) the filter bar.
    const filters = await this.db.queryMany(
      `SELECT * FROM dashboard_filters WHERE dashboard_id = $1 ORDER BY created_at ASC`,
      [dash.id],
    );

    return { dashboard: dash, pages: pagesWithWidgets, filters };
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
    // Filter-not-throw: a user with full dashboard access (owner / dashboard
    // share / admin-on-published) sees every page, unchanged from before. A
    // user who was only granted a share on ONE page sees only that page —
    // the hard dashboard-level gate this used to call would have rejected
    // them outright. Reject only if nothing in the dashboard is visible.
    const dash = await this.db.queryOne<{ created_by: string }>(
      `SELECT created_by FROM dashboards WHERE id = $1 AND deleted_at IS NULL`,
      [dashId],
    );
    if (!dash) throw new NotFoundException('Dashboard not found');
    const isOwner = dash.created_by === requesterId;

    let hasFullAccess = isOwner;
    let dashboardShareSharedBy: string | null = null;
    if (!hasFullAccess) {
      const share = await this.db.queryOne<{ shared_by: string }>(
        `SELECT shared_by FROM dashboard_shares WHERE dashboard_id = $1 AND shared_with = $2`,
        [dashId, requesterId],
      );
      if (share) { hasFullAccess = true; dashboardShareSharedBy = share.shared_by; }
    }
    if (!hasFullAccess) {
      // A published dashboard is fully viewable by any authenticated user
      // (mirrors listDashboards + DashboardPermissionsService.canView). This
      // ensures every page of a published dashboard renders for authorized
      // viewers instead of being filtered down to an empty set.
      const published = await this.db.queryOne(
        `SELECT 1 FROM dashboards WHERE id = $1 AND status = 'published' AND deleted_at IS NULL`,
        [dashId],
      );
      if (published) hasFullAccess = true;
    }

    const pages = await this.db.queryMany<any>(
      `SELECT p.*,
         (SELECT COUNT(*) FROM dashboard_widgets_v2 w WHERE w.page_id = p.id AND w.deleted_at IS NULL) AS widget_count,
         ps.can_edit AS page_share_can_edit, ps.shared_by AS page_share_shared_by,
         sharer.display_name AS page_share_shared_by_name, sharer.email AS page_share_shared_by_email,
         (SELECT ws.shared_by FROM dashboard_widget_shares ws
            JOIN dashboard_widgets_v2 w ON w.id = ws.widget_id
          WHERE w.page_id = p.id AND ws.shared_with = $2 AND w.deleted_at IS NULL
          LIMIT 1) AS widget_share_shared_by
       FROM dashboard_pages p
       LEFT JOIN dashboard_page_shares ps ON ps.page_id = p.id AND ps.shared_with = $2
       LEFT JOIN accounts sharer ON sharer.id = ps.shared_by
       WHERE p.dashboard_id = $1 AND p.deleted_at IS NULL
       ORDER BY p.order_index ASC`,
      [dashId, requesterId],
    );

    const sharerCache = new Map<string, { display_name: string; email: string } | null>();
    const resolveSharer = async (accountId: string) => {
      if (!sharerCache.has(accountId)) {
        sharerCache.set(accountId, await this.db.queryOne(`SELECT display_name, email FROM accounts WHERE id = $1`, [accountId]));
      }
      return sharerCache.get(accountId) ?? null;
    };

    const visible: any[] = [];
    for (const page of pages) {
      const { page_share_can_edit, page_share_shared_by, page_share_shared_by_name, page_share_shared_by_email, widget_share_shared_by, ...rest } = page;
      if (hasFullAccess) {
        let accessSource: string = isOwner ? 'owner' : 'dashboard_share';
        let sharedByName: string | null = null;
        let sharedByEmail: string | null = null;
        if (accessSource === 'dashboard_share' && dashboardShareSharedBy) {
          const sharer = await resolveSharer(dashboardShareSharedBy);
          sharedByName = sharer?.display_name ?? null;
          sharedByEmail = sharer?.email ?? null;
        }
        visible.push({ ...rest, access_source: accessSource, shared_by_name: sharedByName, shared_by_email: sharedByEmail });
      } else if (page_share_shared_by) {
        visible.push({
          ...rest,
          access_source: 'page_share',
          shared_by_name: page_share_shared_by_name,
          shared_by_email: page_share_shared_by_email,
        });
      } else if (widget_share_shared_by) {
        // No page-level share, but at least one card on this page IS shared
        // with them — the page must still appear so that card has a
        // route/tab to be opened from. listWidgets independently filters
        // this page down to just the card(s) actually shared.
        const sharer = await resolveSharer(widget_share_shared_by);
        visible.push({
          ...rest,
          access_source: 'widget_share',
          shared_by_name: sharer?.display_name ?? null,
          shared_by_email: sharer?.email ?? null,
        });
      }
      // else: not visible to this requester — omitted entirely
    }

    if (visible.length === 0) {
      throw new ForbiddenException('You do not have access to this dashboard');
    }
    return visible;
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
    // Page-level edit share is enough to rename/retitle a SPECIFIC page —
    // falls back through dashboard-level edit for owners/dashboard-shares.
    await this.dashboardPermissions.requirePageAction(pageId, updater.id, 'can_edit');

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
    await this.dashboardPermissions.requirePageAction(pageId, creator.id, 'can_edit');

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

  /**
   * Copy a page (and all its widgets) into a DIFFERENT dashboard, leaving the
   * source page and dashboard untouched. Requires view access to the source
   * page and edit access to the destination dashboard.
   */
  async copyPage(pageId: string, sourceDashId: string, targetDashId: string, copier: SafeAccount) {
    await this.dashboardPermissions.requirePageAction(pageId, copier.id, 'can_view');
    await this.dashboardPermissions.requireAction(targetDashId, copier.id, 'can_edit');

    const sourcePage = await this.db.queryOne<{ name: string }>(
      `SELECT name FROM dashboard_pages WHERE id = $1 AND dashboard_id = $2 AND deleted_at IS NULL`,
      [pageId, sourceDashId],
    );
    if (!sourcePage) throw new NotFoundException('Page not found');

    const maxOrder = await this.db.queryOne<{ max_order: number }>(
      `SELECT COALESCE(MAX(order_index), -1) AS max_order FROM dashboard_pages WHERE dashboard_id = $1 AND deleted_at IS NULL`,
      [targetDashId],
    );

    const newPage = await this.db.queryOne(
      `INSERT INTO dashboard_pages (dashboard_id, name, order_index, is_default)
       VALUES ($1, $2, $3, FALSE) RETURNING *`,
      [targetDashId, sourcePage.name, (maxOrder?.max_order ?? -1) + 1],
    );

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
      [pageId, newPage!.id, copier.id],
    );

    await this.audit.log({
      accountId: copier.id,
      eventType: 'dashboard_page_copied', resourceType: 'dashboard_page', resourceId: newPage!.id,
      details: { sourcePageId: pageId, sourceDashId, targetDashId },
    });
    await this.invalidateDashboardCache(targetDashId);

    return newPage;
  }

  /**
   * Move a page (and all its widgets) to a DIFFERENT dashboard. Requires
   * edit access to the source page and edit access to the destination
   * dashboard. The last page of a dashboard cannot be moved away.
   */
  async movePage(pageId: string, sourceDashId: string, targetDashId: string, mover: SafeAccount) {
    await this.dashboardPermissions.requirePageAction(pageId, mover.id, 'can_edit');
    await this.dashboardPermissions.requireAction(targetDashId, mover.id, 'can_edit');

    const sourcePage = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM dashboard_pages WHERE id = $1 AND dashboard_id = $2 AND deleted_at IS NULL`,
      [pageId, sourceDashId],
    );
    if (!sourcePage) throw new NotFoundException('Page not found');

    const pageCount = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(*) FROM dashboard_pages WHERE dashboard_id = $1 AND deleted_at IS NULL`,
      [sourceDashId],
    );
    if (parseInt(pageCount?.count || '0', 10) <= 1) {
      throw new ForbiddenException('Cannot move the last page out of a dashboard');
    }

    const maxOrder = await this.db.queryOne<{ max_order: number }>(
      `SELECT COALESCE(MAX(order_index), -1) AS max_order FROM dashboard_pages WHERE dashboard_id = $1 AND deleted_at IS NULL`,
      [targetDashId],
    );

    const movedPage = await this.db.queryOne(
      `UPDATE dashboard_pages
       SET dashboard_id = $2, order_index = $3, is_default = FALSE, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [pageId, targetDashId, (maxOrder?.max_order ?? -1) + 1],
    );

    // Page-level shares are scoped to the page row itself, so they travel
    // with it automatically (no cleanup needed). Widget-level shares are
    // likewise scoped to widget rows, which are untouched by this move.

    await this.audit.log({
      accountId: mover.id,
      eventType: 'dashboard_page_moved', resourceType: 'dashboard_page', resourceId: pageId,
      details: { sourceDashId, targetDashId },
    });
    await this.invalidateDashboardCache(sourceDashId);
    await this.invalidateDashboardCache(targetDashId);

    return movedPage;
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
    // Filter-not-throw, same approach as listPages: full dashboard or
    // page-level access shows every card on the page (unchanged for
    // existing owners/dashboard-shares/page-shares); a user with ONLY a
    // share on a specific card sees just that card.
    const hasPageAccess = await this.dashboardPermissions.canViewPage(pageId, requesterId);

    const widgets = await this.db.queryMany<any>(
      `SELECT w.*,
              c.name AS card_name, c.status AS card_status,
              c.raw_query AS card_raw_query,
              c.chart_type AS card_chart_type,
              c.datasource_context_id AS card_context_id,
              c.datasource_context_type AS card_context_type,
              qe.result_preview AS card_result_preview,
              qe.result_columns AS card_result_columns,
              ws.can_edit AS widget_share_can_edit, ws.shared_by AS widget_share_shared_by,
              sharer.display_name AS widget_share_shared_by_name, sharer.email AS widget_share_shared_by_email
       FROM dashboard_widgets_v2 w
       LEFT JOIN analytics_cards c ON c.id = w.card_id
       LEFT JOIN query_executions qe ON qe.id = c.last_execution_id
       LEFT JOIN dashboard_widget_shares ws ON ws.widget_id = w.id AND ws.shared_with = $2
       LEFT JOIN accounts sharer ON sharer.id = ws.shared_by
       WHERE w.page_id = $1 AND w.deleted_at IS NULL
       ORDER BY w.grid_y ASC, w.grid_x ASC`,
      [pageId, requesterId],
    );

    if (hasPageAccess) {
      return widgets.map(({ widget_share_can_edit, widget_share_shared_by, widget_share_shared_by_name, widget_share_shared_by_email, ...rest }) => rest);
    }

    const visible = widgets
      .filter((w) => w.widget_share_shared_by)
      .map(({ widget_share_can_edit, widget_share_shared_by, widget_share_shared_by_name, widget_share_shared_by_email, ...rest }) => ({
        ...rest,
        access_source: 'widget_share',
        shared_by_name: widget_share_shared_by_name,
        shared_by_email: widget_share_shared_by_email,
      }));

    if (visible.length === 0) {
      throw new ForbiddenException('You do not have access to this page');
    }
    return visible;
  }

  async addWidget(pageId: string, creator: SafeAccount, dto: CreateWidgetDto) {
    const dashId = await this.resolveDashboardIdForPage(pageId);
    // Page-level edit share lets a recipient add cards to THEIR shared page.
    await this.dashboardPermissions.requirePageAction(pageId, creator.id, 'can_edit');

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
    // Widget-level edit share lets a recipient edit just the card shared with them.
    await this.dashboardPermissions.requireWidgetAction(widgetId, updater.id, 'can_edit');

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
    await this.dashboardPermissions.requireWidgetAction(widgetId, remover.id, 'can_edit');

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
   * Copy a single card into a DIFFERENT page (same or different dashboard),
   * leaving the source card untouched. Requires view access to the source
   * card and edit access to the destination page.
   */
  async copyWidget(widgetId: string, targetPageId: string, copier: SafeAccount) {
    await this.dashboardPermissions.requireWidgetAction(widgetId, copier.id, 'can_view');
    await this.dashboardPermissions.requirePageAction(targetPageId, copier.id, 'can_edit');

    const source = await this.db.queryOne<any>(
      `SELECT * FROM dashboard_widgets_v2 WHERE id = $1 AND deleted_at IS NULL`,
      [widgetId],
    );
    if (!source) throw new NotFoundException('Card not found');

    const maxY = await this.db.queryOne<{ max_y: number }>(
      `SELECT COALESCE(MAX(grid_y + grid_h), 0) AS max_y FROM dashboard_widgets_v2 WHERE page_id = $1 AND deleted_at IS NULL`,
      [targetPageId],
    );

    const copy = await this.db.queryOne(
      `INSERT INTO dashboard_widgets_v2
         (page_id, card_id, pinned_card_version, widget_type, title,
          grid_x, grid_y, grid_w, grid_h,
          layout_desktop, layout_tablet, layout_mobile,
          datasource_context_type, datasource_context_id,
          query_definition, query_language, visualization_config,
          refresh_interval_sec, cache_ttl_sec, sort_order, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $20)
       RETURNING *`,
      [
        targetPageId, source.card_id, source.pinned_card_version, source.widget_type, source.title,
        maxY?.max_y ?? 0, source.grid_w, source.grid_h,
        JSON.stringify(source.layout_desktop || {}), JSON.stringify(source.layout_tablet || {}), JSON.stringify(source.layout_mobile || {}),
        source.datasource_context_type, source.datasource_context_id,
        JSON.stringify(source.query_definition || {}), source.query_language, JSON.stringify(source.visualization_config || {}),
        source.refresh_interval_sec, source.cache_ttl_sec, source.sort_order, copier.id,
      ],
    );

    const targetDashId = await this.resolveDashboardIdForPage(targetPageId);
    await this.audit.log({
      accountId: copier.id,
      eventType: 'widget_copied', resourceType: 'widget', resourceId: copy!.id,
      details: { sourceWidgetId: widgetId, targetPageId },
    });
    await this.invalidateDashboardCache(targetDashId);

    return copy;
  }

  /**
   * Move a single card to a DIFFERENT page (same or different dashboard).
   * Requires edit access to the source card and edit access to the
   * destination page.
   */
  async moveWidget(widgetId: string, targetPageId: string, mover: SafeAccount) {
    await this.dashboardPermissions.requireWidgetAction(widgetId, mover.id, 'can_edit');
    await this.dashboardPermissions.requirePageAction(targetPageId, mover.id, 'can_edit');

    const source = await this.db.queryOne<{ page_id: string }>(
      `SELECT page_id FROM dashboard_widgets_v2 WHERE id = $1 AND deleted_at IS NULL`,
      [widgetId],
    );
    if (!source) throw new NotFoundException('Card not found');
    const sourceDashId = await this.resolveDashboardIdForPage(source.page_id);
    const targetDashId = await this.resolveDashboardIdForPage(targetPageId);

    const maxY = await this.db.queryOne<{ max_y: number }>(
      `SELECT COALESCE(MAX(grid_y + grid_h), 0) AS max_y FROM dashboard_widgets_v2 WHERE page_id = $1 AND deleted_at IS NULL`,
      [targetPageId],
    );

    const moved = await this.db.queryOne(
      `UPDATE dashboard_widgets_v2
       SET page_id = $2, grid_x = 0, grid_y = $3, updated_at = NOW(), updated_by = $4
       WHERE id = $1
       RETURNING *`,
      [widgetId, targetPageId, maxY?.max_y ?? 0, mover.id],
    );

    // Widget-level shares stay attached to the widget row and travel with it.

    await this.audit.log({
      accountId: mover.id,
      eventType: 'widget_moved', resourceType: 'widget', resourceId: widgetId,
      details: { sourcePageId: source.page_id, targetPageId },
    });
    await this.cache.del(CacheKeys.widgetResult(widgetId));
    await this.invalidateDashboardCache(sourceDashId);
    await this.invalidateDashboardCache(targetDashId);

    return moved;
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
    await this.dashboardPermissions.requireWidgetAction(widgetId, requester.id, 'can_view');

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

  async addFilter(dashId: string, requester: SafeAccount, dto: AddDashboardFilterDto) {
    await this.dashboardPermissions.requireAction(dashId, requester.id, 'can_edit');
    if (!dto?.column || !dto?.operator) {
      throw new BadRequestException('A filter requires a column and an operator.');
    }
    const filter = await this.db.queryOne(
      `INSERT INTO dashboard_filters (dashboard_id, column_name, col_type, operator, config, locked)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [dashId, dto.column, dto.colType || 'string', dto.operator, dto.config || {}, dto.locked === true]
    );
    return filter;
  }

  async updateFilter(filterId: string, dashId: string, requester: SafeAccount, dto: AddDashboardFilterDto) {
    await this.dashboardPermissions.requireAction(dashId, requester.id, 'can_edit');
    if (!dto?.column || !dto?.operator) {
      throw new BadRequestException('A filter requires a column and an operator.');
    }
    // DC-04 — a locked filter cannot be modified until it is explicitly unlocked
    // (the same request may unlock it by setting locked=false). This rejects
    // silent overrides even from an editor client that ignored the lock.
    const existing = await this.db.queryOne<{ locked: boolean }>(
      `SELECT locked FROM dashboard_filters WHERE id = $1 AND dashboard_id = $2`,
      [filterId, dashId],
    );
    if (!existing) throw new NotFoundException('Filter not found');
    if (existing.locked && dto.locked !== false) {
      throw new ForbiddenException('This filter is locked. Unlock it before editing.');
    }
    const filter = await this.db.queryOne(
      `UPDATE dashboard_filters
          SET column_name = $1, col_type = $2, operator = $3, config = $4, locked = $5, updated_at = NOW()
        WHERE id = $6 AND dashboard_id = $7
        RETURNING *`,
      [dto.column, dto.colType || 'string', dto.operator, dto.config || {}, dto.locked === true, filterId, dashId]
    );
    if (!filter) throw new NotFoundException('Filter not found');
    return filter;
  }

  async removeFilter(filterId: string, dashId: string, requester: SafeAccount) {
    await this.dashboardPermissions.requireAction(dashId, requester.id, 'can_edit');
    // DC-04 — a locked filter is protected: unlock it before removing.
    const existing = await this.db.queryOne<{ locked: boolean }>(
      `SELECT locked FROM dashboard_filters WHERE id = $1 AND dashboard_id = $2`,
      [filterId, dashId],
    );
    if (!existing) return; // already gone — idempotent delete
    if (existing.locked) {
      throw new ForbiddenException('This filter is locked. Unlock it before removing.');
    }
    await this.db.query(`DELETE FROM dashboard_filters WHERE id = $1 AND dashboard_id = $2`, [filterId, dashId]);
  }

  /**
   * DC-04 — replace the entire dashboard-global filter set in one transaction.
   * Editor-authoritative: the caller supplies the complete desired set (each
   * with its own `locked` flag), so this is the safe way to persist edits
   * without tripping the per-filter lock guards used for granular API calls.
   * Requires can_edit, so viewers can never override locked (or any) filters.
   */
  async replaceFilters(dashId: string, requester: SafeAccount, filters: AddDashboardFilterDto[]) {
    await this.dashboardPermissions.requireAction(dashId, requester.id, 'can_edit');
    const list = Array.isArray(filters) ? filters : [];
    for (const f of list) {
      if (!f?.column || !f?.operator) {
        throw new BadRequestException('Each filter requires a column and an operator.');
      }
    }
    return this.db.transaction(async (query) => {
      await query(`DELETE FROM dashboard_filters WHERE dashboard_id = $1`, [dashId]);
      const saved: any[] = [];
      for (const f of list) {
        const res = await query(
          `INSERT INTO dashboard_filters (dashboard_id, column_name, col_type, operator, config, locked)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [dashId, f.column, f.colType || 'string', f.operator, f.config || {}, f.locked === true],
        );
        saved.push(res.rows[0]);
      }
      return saved;
    });
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
