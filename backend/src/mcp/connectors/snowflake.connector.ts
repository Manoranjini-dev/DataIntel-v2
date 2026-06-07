import * as snowflake from 'snowflake-sdk';
import {
  ConnectionParams,
  ConnectorCapabilities,
  ConnectorType,
  ForeignKey,
  SchemaMetadata,
  TableColumn,
  TableIndex,
  TableSchema,
} from '../../common/types';
import { MCPQueryResult, MCPToolResult } from '../types';
import { BaseMCPConnector } from './base.connector';

export class SnowflakeConnector extends BaseMCPConnector {
  readonly connectorType = ConnectorType.SNOWFLAKE;

  constructor() {
    super('SnowflakeConnector');
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      readOnly: true,
      supportsTransactions: false,
      supportsSchemaIntrospection: true,
      maxResultRows: 500,
      supportedOperations: ['SELECT'],
    };
  }

  async testConnection(params: ConnectionParams): Promise<MCPToolResult<boolean>> {
    return this.executeWithResult(async () => {
      const conn = await this.connect(params);
      try {
        await this.executeQuery(conn, 'SELECT 1 AS ok');
        return true;
      } finally {
        conn.destroy(() => {});
      }
    });
  }

  async describeSchema(params: ConnectionParams): Promise<MCPToolResult<SchemaMetadata>> {
    return this.executeWithResult(async () => {
      const conn = await this.connect(params);
      try {
        const tablesResult = await this.executeQuery(conn,
          `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
           WHERE TABLE_SCHEMA = 'PUBLIC' AND TABLE_TYPE = 'BASE TABLE'
           ORDER BY TABLE_NAME`,
        );
        const tableSchemas: TableSchema[] = [];

        for (const row of tablesResult) {
          const tableName = row.TABLE_NAME as string;
          const columns = await this.getColumns(conn, tableName);
          const foreignKeys = await this.getForeignKeys(conn, tableName);
          const primaryKeys = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
          tableSchemas.push({ name: tableName, columns, primaryKeys, foreignKeys, indexes: [] });
        }

        return {
          database: params.database,
          connectorType: ConnectorType.SNOWFLAKE,
          tables: tableSchemas,
          extractedAt: new Date(),
        };
      } finally {
        conn.destroy(() => {});
      }
    });
  }

  async executeReadQuery(
    params: ConnectionParams,
    sql: string,
    timeoutMs: number,
  ): Promise<MCPToolResult<MCPQueryResult>> {
    return this.executeWithResult(async () => {
      const conn = await this.connect(params);
      try {
        const rows = await this.executeQuery(conn, sql, timeoutMs);
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return {
          rows: rows as Record<string, unknown>[],
          columns,
          rowCount: rows.length,
          executionTimeMs: 0,
        };
      } finally {
        conn.destroy(() => {});
      }
    });
  }

  async dispose(): Promise<void> {
    this.logger.log('Snowflake connector disposed');
  }

  private connect(params: ConnectionParams): Promise<snowflake.Connection> {
    return new Promise((resolve, reject) => {
      const conn = snowflake.createConnection({
        account: params.host,
        username: params.username,
        password: params.password,
        database: params.database,
      });
      conn.connect((err) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });
  }

  private executeQuery(
    conn: snowflake.Connection,
    sql: string,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      conn.execute({
        sqlText: sql,
        ...(timeoutMs ? { timeout: timeoutMs } : {}),
        complete: (err, _stmt, rows) => {
          if (err) reject(err);
          else resolve((rows || []) as Record<string, unknown>[]);
        },
      });
    });
  }

  private async getColumns(conn: snowflake.Connection, table: string): Promise<TableColumn[]> {
    const rows = await this.executeQuery(conn,
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = 'PUBLIC' AND TABLE_NAME = '${table.replace(/'/g, "''")}'
       ORDER BY ORDINAL_POSITION`,
    );
    const pkRows = await this.executeQuery(conn,
      `SHOW PRIMARY KEYS IN TABLE "PUBLIC"."${table.replace(/"/g, '""')}"`,
    ).catch(() => [] as Record<string, unknown>[]);
    const pkCols = new Set(pkRows.map((r) => r['column_name'] as string));

    return rows.map((r) => ({
      name: r.COLUMN_NAME as string,
      type: r.DATA_TYPE as string,
      nullable: r.IS_NULLABLE === 'YES',
      isPrimaryKey: pkCols.has(r.COLUMN_NAME as string),
      defaultValue: (r.COLUMN_DEFAULT as string) || null,
    }));
  }

  private async getForeignKeys(conn: snowflake.Connection, table: string): Promise<ForeignKey[]> {
    const rows = await this.executeQuery(conn,
      `SHOW IMPORTED KEYS IN TABLE "PUBLIC"."${table.replace(/"/g, '""')}"`,
    ).catch(() => [] as Record<string, unknown>[]);
    return rows.map((r) => ({
      columnName: r['fk_column_name'] as string,
      referencedTable: r['pk_table_name'] as string,
      referencedColumn: r['pk_column_name'] as string,
      constraintName: r['fk_name'] as string,
    }));
  }
}
