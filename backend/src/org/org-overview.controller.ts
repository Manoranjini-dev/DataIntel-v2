// ──────────────────────────────────────────────
// Org Overview Controller — /orgs/:orgId/overview
// Aggregate health, connections, recent queries
// ──────────────────────────────────────────────

import { Controller, Get, Param, Query } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OrgService } from '../org/org.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';

@Controller('orgs/:orgId/overview')
export class OrgOverviewController {
  constructor(
    private readonly db: DatabaseService,
    private readonly orgService: OrgService,
  ) {}

  @Get()
  async getOverview(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
  ) {
    await this.orgService.requireMember(orgId, user.id);

    const [connections, members, recentQueries, stats, combos] = await Promise.all([
      // Connection health summary
      this.db.queryMany(
        `SELECT id, name, connector_type, status, last_health_check, last_health_ok
         FROM datasource_connections
         WHERE org_id = $1
         ORDER BY name ASC`,
        [orgId],
      ),

      // Member count
      this.db.queryOne<{ count: string }>(
        'SELECT COUNT(*) AS count FROM org_members WHERE org_id = $1',
        [orgId],
      ),

      // Recent query executions (last 10)
      this.db.queryMany(
        `SELECT qe.id, qe.prompt, qe.status, qe.execution_time_ms,
                qe.row_count, qe.created_at, qe.completed_at,
                a.display_name AS executor_name,
                dc.name AS connection_name
         FROM query_executions qe
         LEFT JOIN accounts a ON a.id = qe.executed_by
         LEFT JOIN datasource_connections dc ON dc.id = qe.connection_id
         WHERE qe.org_id = $1
         ORDER BY qe.created_at DESC
         LIMIT 10`,
        [orgId],
      ),

      // Query stats
      this.db.queryOne(
        `SELECT
           COUNT(*) AS total_queries,
           COUNT(*) FILTER (WHERE status = 'success') AS successful,
           COUNT(*) FILTER (WHERE status = 'failed') AS failed,
           ROUND(AVG(execution_time_ms) FILTER (WHERE status = 'success')) AS avg_time_ms,
           COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS queries_24h
         FROM query_executions
         WHERE org_id = $1`,
        [orgId],
      ),

      // Combo count
      this.db.queryOne<{ count: string }>(
        'SELECT COUNT(*) AS count FROM datasource_combos WHERE org_id = $1',
        [orgId],
      ),
    ]);

    const healthSummary = {
      total: connections.length,
      active: connections.filter((c: any) => c.status === 'active').length,
      error: connections.filter((c: any) => c.status === 'error').length,
      inactive: connections.filter((c: any) => c.status === 'inactive').length,
    };

    return {
      connections,
      healthSummary,
      memberCount: parseInt(members?.count || '0'),
      comboCount: parseInt(combos?.count || '0'),
      recentQueries,
      queryStats: stats,
    };
  }
}

@Controller('orgs/:orgId/audit')
export class OrgAuditController {
  constructor(
    private readonly db: DatabaseService,
    private readonly orgService: OrgService,
  ) {}

  @Get()
  async getAuditLogs(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Query('eventType') eventType?: string,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    await this.orgService.requireMember(orgId, user.id);

    const limitN = Math.min(parseInt(limit) || 50, 200);
    const offsetN = parseInt(offset) || 0;

    let sql = `SELECT al.*, a.display_name AS executor_name
               FROM audit_logs al
               LEFT JOIN accounts a ON a.id = al.account_id
               WHERE al.org_id = $1`;
    const params: any[] = [orgId];

    if (eventType) {
      params.push(eventType);
      sql += ` AND al.event_type = $${params.length}`;
    }

    sql += ` ORDER BY al.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limitN, offsetN);

    const logs = await this.db.queryMany(sql, params);
    return { logs };
  }
}
