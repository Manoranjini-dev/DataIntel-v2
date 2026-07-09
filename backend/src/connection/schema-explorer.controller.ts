// ──────────────────────────────────────────────
// Schema Explorer Controller
// GET /connections/:connId/schema/tables
// GET /connections/:connId/schema/tables/:tableName
// GET /connections/:connId/schema/search?q=term
// ──────────────────────────────────────────────

import {
  Controller, Get, Param, Query,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ConnectionPermissionsService } from './connection-permissions.service';
import { TableSourceService } from './table-source.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';

@Controller('connections/:connId/schema')
export class SchemaExplorerController {
  constructor(
    private readonly db: DatabaseService,
    private readonly connectionPermissions: ConnectionPermissionsService,
    private readonly tableSource: TableSourceService,
  ) {}

  /** List all schemas/tables for a connection */
  @Get('tables')
  async listTables(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
    @Query('q') search?: string,
  ) {
    await this.connectionPermissions.requireAction(connId, user.id, 'view');

    let sql: string;
    let params: any[];

    if (search?.trim()) {
      sql = `SELECT cs.schema_name, ct.table_name, ct.row_count_estimate,
                    COUNT(cc.id) AS column_count,
                    SUM(CASE WHEN cc.is_foreign_key = true THEN 1 ELSE 0 END) AS fk_count
             FROM connection_schemas cs
             JOIN connection_tables ct ON ct.schema_id = cs.id
             LEFT JOIN connection_columns cc ON cc.table_id = ct.id AND cc.deleted_at IS NULL
             WHERE cs.connection_id = $1
               AND cs.deleted_at IS NULL
               AND ct.deleted_at IS NULL
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
             LEFT JOIN connection_columns cc ON cc.table_id = ct.id AND cc.deleted_at IS NULL
             WHERE cs.connection_id = $1
               AND cs.deleted_at IS NULL
               AND ct.deleted_at IS NULL
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
    @Param('connId') connId: string,
    @Param('tableName') tableName: string,
  ) {
    await this.connectionPermissions.requireAction(connId, user.id, 'view');

    const columns = await this.db.queryMany(
      `SELECT cc.column_name, cc.data_type, cc.is_nullable,
              cc.is_primary_key, cc.is_foreign_key, cc.fk_ref_table,
              cc.fk_ref_column, cc.default_value, cc.ordinal_position
       FROM connection_columns cc
       JOIN connection_tables ct ON ct.id = cc.table_id
       JOIN connection_schemas cs ON cs.id = ct.schema_id
       WHERE cs.connection_id = $1 AND ct.table_name = $2
         AND cs.deleted_at IS NULL
         AND ct.deleted_at IS NULL
         AND cc.deleted_at IS NULL
       ORDER BY cc.ordinal_position`,
      [connId, tableName],
    );

    const incoming_references = await this.db.queryMany(
      `SELECT ct.table_name as source_table, cc.column_name as source_column, cc.fk_ref_column as target_column
       FROM connection_columns cc
       JOIN connection_tables ct ON ct.id = cc.table_id
       JOIN connection_schemas cs ON cs.id = ct.schema_id
       WHERE cs.connection_id = $1 AND cc.fk_ref_table = $2
         AND cs.deleted_at IS NULL
         AND ct.deleted_at IS NULL
         AND cc.deleted_at IS NULL`,
      [connId, tableName]
    );

    return { tableName, columns, incoming_references };
  }

  /**
   * DS-02 — Preview an entire table as a data-card source. Validates the table
   * against introspected metadata, generates a connector-correct read-only
   * `SELECT *`, and returns the first 10 rows plus the query to persist on the
   * card. `?schema=` disambiguates when the same table name exists in multiple
   * schemas.
   */
  @Get('tables/:tableName/preview')
  async previewTable(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema?: string,
  ) {
    return this.tableSource.previewTable(connId, user, tableName, schema?.trim() || null);
  }

  /** Full-text search across column names */
  @Get('search')
  async searchColumns(
    @CurrentUser() user: SafeAccount,
    @Param('connId') connId: string,
    @Query('q') q: string,
  ) {
    await this.connectionPermissions.requireAction(connId, user.id, 'view');
    if (!q?.trim()) return { results: [] };

    const results = await this.db.queryMany(
      `SELECT ct.table_name, cc.column_name, cc.data_type, cc.is_primary_key
       FROM connection_columns cc
       JOIN connection_tables ct ON ct.id = cc.table_id
       JOIN connection_schemas cs ON cs.id = ct.schema_id
       WHERE cs.connection_id = $1
         AND cs.deleted_at IS NULL
         AND ct.deleted_at IS NULL
         AND cc.deleted_at IS NULL
         AND (cc.column_name ILIKE $2 OR ct.table_name ILIKE $2)
       ORDER BY ct.table_name, cc.ordinal_position
       LIMIT 50`,
      [connId, `%${q.trim()}%`],
    );

    return { results };
  }
}
