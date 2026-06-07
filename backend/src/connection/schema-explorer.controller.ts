// ──────────────────────────────────────────────
// Schema Explorer Controller
// GET /orgs/:orgId/connections/:connId/schema/tables
// GET /orgs/:orgId/connections/:connId/schema/tables/:tableName
// GET /orgs/:orgId/connections/:connId/schema/search?q=term
// ──────────────────────────────────────────────

import {
  Controller, Get, Param, Query,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OrgService } from '../org/org.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';

@Controller('orgs/:orgId/connections/:connId/schema')
export class SchemaExplorerController {
  constructor(
    private readonly db: DatabaseService,
    private readonly orgService: OrgService,
  ) {}

  /** List all schemas/tables for a connection */
  @Get('tables')
  async listTables(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('connId') connId: string,
    @Query('q') search?: string,
  ) {
    await this.orgService.requireMember(orgId, user.id);

    let sql: string;
    let params: any[];

    if (search?.trim()) {
      sql = `SELECT cs.schema_name, ct.table_name, ct.row_count_estimate,
                    COUNT(cc.id) AS column_count,
                    SUM(CASE WHEN cc.is_foreign_key = true THEN 1 ELSE 0 END) AS fk_count
             FROM connection_schemas cs
             JOIN connection_tables ct ON ct.schema_id = cs.id
             LEFT JOIN connection_columns cc ON cc.table_id = ct.id
             WHERE cs.connection_id = $1
               AND (ct.table_name ILIKE $2 OR cs.schema_name ILIKE $2)
             GROUP BY cs.schema_name, ct.table_name, ct.row_count_estimate
             ORDER BY ct.table_name
             LIMIT 100`;
      params = [connId, `%${search.trim()}%`];
    } else {
      sql = `SELECT cs.schema_name, ct.table_name, ct.row_count_estimate,
                    COUNT(cc.id) AS column_count,
                    SUM(CASE WHEN cc.is_foreign_key = true THEN 1 ELSE 0 END) AS fk_count
             FROM connection_schemas cs
             JOIN connection_tables ct ON ct.schema_id = cs.id
             LEFT JOIN connection_columns cc ON cc.table_id = ct.id
             WHERE cs.connection_id = $1
             GROUP BY cs.schema_name, ct.table_name, ct.row_count_estimate
             ORDER BY cs.schema_name, ct.table_name`;
      params = [connId];
    }

    const tables = await this.db.queryMany(sql, params);
    return { tables };
  }

  /** Get columns for a specific table */
  @Get('tables/:tableName/columns')
  async getTableColumns(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('connId') connId: string,
    @Param('tableName') tableName: string,
  ) {
    await this.orgService.requireMember(orgId, user.id);

    const columns = await this.db.queryMany(
      `SELECT cc.column_name, cc.data_type, cc.is_nullable,
              cc.is_primary_key, cc.is_foreign_key, cc.fk_ref_table,
              cc.fk_ref_column, cc.default_value, cc.ordinal_position
       FROM connection_columns cc
       JOIN connection_tables ct ON ct.id = cc.table_id
       JOIN connection_schemas cs ON cs.id = ct.schema_id
       WHERE cs.connection_id = $1 AND ct.table_name = $2
       ORDER BY cc.ordinal_position`,
      [connId, tableName],
    );

    const incoming_references = await this.db.queryMany(
      `SELECT ct.table_name as source_table, cc.column_name as source_column, cc.fk_ref_column as target_column
       FROM connection_columns cc
       JOIN connection_tables ct ON ct.id = cc.table_id
       JOIN connection_schemas cs ON cs.id = ct.schema_id
       WHERE cs.connection_id = $1 AND cc.fk_ref_table = $2`,
      [connId, tableName]
    );

    return { tableName, columns, incoming_references };
  }

  /** Full-text search across column names */
  @Get('search')
  async searchColumns(
    @CurrentUser() user: SafeAccount,
    @Param('orgId') orgId: string,
    @Param('connId') connId: string,
    @Query('q') q: string,
  ) {
    await this.orgService.requireMember(orgId, user.id);
    if (!q?.trim()) return { results: [] };

    const results = await this.db.queryMany(
      `SELECT ct.table_name, cc.column_name, cc.data_type, cc.is_primary_key
       FROM connection_columns cc
       JOIN connection_tables ct ON ct.id = cc.table_id
       JOIN connection_schemas cs ON cs.id = ct.schema_id
       WHERE cs.connection_id = $1
         AND (cc.column_name ILIKE $2 OR ct.table_name ILIKE $2)
       ORDER BY ct.table_name, cc.ordinal_position
       LIMIT 50`,
      [connId, `%${q.trim()}%`],
    );

    return { results };
  }
}
