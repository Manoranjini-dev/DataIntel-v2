// ──────────────────────────────────────────────
// Dashboard Service — Multi-page dashboards
// State: Redis (live) → Postgres (saved)
// ──────────────────────────────────────────────

import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OrgService } from '../org/org.service';
import { SafeAccount } from '../auth/auth.service';
import { REDIS_CLIENT } from '../redis/redis.constants';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orgService: OrgService,
    @Inject(REDIS_CLIENT) private readonly redis: any,
  ) {}

  // ── Dashboards ────────────────────────────────

  async list(orgId: string, accountId: string) {
    await this.orgService.requireMember(orgId, accountId);
    return this.db.queryMany(
      `SELECT d.*, COUNT(dp.id) AS page_count
       FROM dashboards d
       LEFT JOIN dashboard_pages dp ON dp.dashboard_id = d.id
       WHERE d.org_id = $1
       GROUP BY d.id
       ORDER BY d.created_at DESC`,
      [orgId],
    );
  }

  async create(orgId: string, user: SafeAccount, data: {
    name: string;
    description?: string;
    connectionId?: string;
    comboId?: string;
    isOrgOverview?: boolean;
  }) {
    await this.orgService.requireRole(orgId, user.id, 'editor');

    const dashboard = await this.db.transaction(async (query) => {
      const dash = await query(
        `INSERT INTO dashboards
           (org_id, connection_id, combo_id, name, description, is_org_overview, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [orgId, data.connectionId || null, data.comboId || null,
         data.name, data.description || null, data.isOrgOverview || false, user.id],
      );

      // Auto-create first page
      await query(
        `INSERT INTO dashboard_pages (dashboard_id, name, sort_order)
         VALUES ($1, 'Page 1', 0)`,
        [dash.rows[0].id],
      );

      return dash.rows[0];
    });

    await this.audit.log({
      orgId, accountId: user.id,
      eventType: 'dashboard_created',
      resourceType: 'dashboard', resourceId: dashboard.id,
      details: { name: data.name },
    });

    return dashboard;
  }

  async get(orgId: string, dashId: string, accountId: string) {
    await this.orgService.requireMember(orgId, accountId);

    const dashboard = await this.db.queryOne(
      'SELECT * FROM dashboards WHERE id = $1 AND org_id = $2',
      [dashId, orgId],
    );
    if (!dashboard) throw new NotFoundException('Dashboard not found');

    // Check Redis for live state
    const redisKey = `dashboard:state:${dashId}`;
    const liveState = await this.redis?.get(redisKey).catch(() => null);

    // Get pages from DB
    const pages = await this.db.queryMany(
      'SELECT * FROM dashboard_pages WHERE dashboard_id = $1 ORDER BY sort_order ASC',
      [dashId],
    );

    // Get widgets per page
    const pagesWithWidgets = await Promise.all(
      pages.map(async (page: any) => {
        const widgets = await this.db.queryMany(
          'SELECT * FROM dashboard_widgets WHERE page_id = $1 ORDER BY sort_order ASC',
          [page.id],
        );
        // Parse JSONB fields that come back as strings in some PG drivers
        const parsed = widgets.map((w: any) => ({
          ...w,
          result_rows: typeof w.result_rows === 'string' ? JSON.parse(w.result_rows) : (w.result_rows || []),
          result_columns: typeof w.result_columns === 'string' ? JSON.parse(w.result_columns) : (w.result_columns || []),
        }));
        return { ...page, widgets: parsed };
      }),
    );

    return {
      dashboard,
      pages: pagesWithWidgets,
      hasUnsavedChanges: !!liveState,
    };
  }

  /** Save Redis state → Postgres */
  async save(orgId: string, dashId: string, user: SafeAccount) {
    await this.orgService.requireRole(orgId, user.id, 'editor');

    const redisKey = `dashboard:state:${dashId}`;
    const liveStateJson = await this.redis?.get(redisKey).catch(() => null);

    if (liveStateJson) {
      const liveState = JSON.parse(liveStateJson);

      await this.db.transaction(async (query) => {
        for (const page of liveState.pages || []) {
          // Update page layout
          await query(
            `UPDATE dashboard_pages SET layout = $2, updated_at = NOW() WHERE id = $1`,
            [page.id, JSON.stringify(page.layout)],
          );

          // Upsert widgets
          for (const widget of page.widgets || []) {
            await query(
              `INSERT INTO dashboard_widgets
                 (id, page_id, datasource_scope_type, datasource_scope_id,
                  title, prompt, generated_query, ui_hint, layout_x, layout_y,
                  layout_w, layout_h, settings, sort_order)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
               ON CONFLICT (id) DO UPDATE SET
                 title = EXCLUDED.title,
                 layout_x = EXCLUDED.layout_x, layout_y = EXCLUDED.layout_y,
                 layout_w = EXCLUDED.layout_w, layout_h = EXCLUDED.layout_h,
                 settings = EXCLUDED.settings,
                 updated_at = NOW()`,
              [widget.id, page.id, widget.datasourceScopeType, widget.datasourceScopeId,
               widget.title, widget.prompt, widget.generatedQuery, widget.uiHint,
               widget.layoutX, widget.layoutY, widget.layoutW, widget.layoutH,
               JSON.stringify(widget.settings), widget.sortOrder],
            );
          }
        }

        await query(
          'UPDATE dashboards SET updated_at = NOW() WHERE id = $1',
          [dashId],
        );
      });

      // Clear Redis state
      await this.redis?.del(redisKey).catch(() => null);
    }

    await this.audit.log({
      orgId, accountId: user.id,
      eventType: 'dashboard_updated',
      resourceType: 'dashboard', resourceId: dashId,
    });

    return { success: true };
  }

  /** Update live state in Redis (no DB write) */
  async updateLiveState(dashId: string, state: any) {
    const redisKey = `dashboard:state:${dashId}`;
    const TTL = 3600; // 1 hour
    if (this.redis) {
      await this.redis.set(redisKey, JSON.stringify(state), 'EX', TTL);
    }
    return { success: true };
  }

  // ── Pages ─────────────────────────────────────

  async addPage(orgId: string, dashId: string, user: SafeAccount, name: string) {
    await this.orgService.requireRole(orgId, user.id, 'editor');
    await this.get(orgId, dashId, user.id);

    const maxOrder = await this.db.queryOne<{ max: number }>(
      'SELECT MAX(sort_order) as max FROM dashboard_pages WHERE dashboard_id = $1',
      [dashId],
    );

    return this.db.queryOne(
      `INSERT INTO dashboard_pages (dashboard_id, name, sort_order)
       VALUES ($1, $2, $3) RETURNING *`,
      [dashId, name, (maxOrder?.max || 0) + 1],
    );
  }

  // ── Widgets ───────────────────────────────────

  async addWidget(orgId: string, dashId: string, pageId: string, user: SafeAccount, data: any) {
    await this.orgService.requireRole(orgId, user.id, 'editor');

    // Normalize camelCase from frontend to snake_case
    const prompt = data.prompt || data.queryPrompt;
    const uiHint = data.uiHint || data.ui_hint || 'data_table';
    const scopeType = data.datasourceScopeType || data.datasource_scope_type || 'connection';
    const scopeId = data.datasourceScopeId || data.datasource_scope_id;
    const resultRows = data.resultRows || data.result_rows;
    const resultColumns = data.resultColumns || data.result_columns;

    const widget = await this.db.queryOne(
      `INSERT INTO dashboard_widgets
         (page_id, datasource_scope_type, datasource_scope_id, title, prompt,
          ui_hint, layout_x, layout_y, layout_w, layout_h,
          result_rows, result_columns, settings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [pageId, scopeType, scopeId,
       data.title, prompt, uiHint,
       data.layoutX || 0, data.layoutY || 0, data.layoutW || 6, data.layoutH || 4,
       resultRows ? JSON.stringify(resultRows) : null,
       resultColumns ? JSON.stringify(resultColumns) : null,
       JSON.stringify(data.settings || {})],
    );

    await this.audit.log({
      orgId, accountId: user.id,
      eventType: 'widget_added',
      resourceType: 'widget', resourceId: widget!.id,
    });

    return widget;
  }

  async deleteWidget(orgId: string, dashId: string, widgetId: string, user: SafeAccount) {
    await this.orgService.requireRole(orgId, user.id, 'editor');
    await this.db.query('DELETE FROM dashboard_widgets WHERE id = $1', [widgetId]);
    await this.audit.log({
      orgId, accountId: user.id,
      eventType: 'widget_removed',
      resourceType: 'widget', resourceId: widgetId,
    });
    return { success: true };
  }

  /** Publish a dashboard */
  async publish(orgId: string, dashId: string, user: SafeAccount) {
    await this.orgService.requireRole(orgId, user.id, 'admin');
    await this.db.query(
      'UPDATE dashboards SET is_published = true, updated_at = NOW() WHERE id = $1',
      [dashId],
    );
    await this.audit.log({
      orgId, accountId: user.id,
      eventType: 'dashboard_published',
      resourceType: 'dashboard', resourceId: dashId,
    });
    return { success: true };
  }
}
