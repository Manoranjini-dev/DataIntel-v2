import * as sql from 'mssql';
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

export class MSSQLConnector extends BaseMCPConnector {
  readonly connectorType = ConnectorType.MSSQL;

  constructor() {
    super('MSSQLConnector');
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
      const pool = await this.createPool(params);
      try {
        await pool.request().query('SELECT 1 AS ok');
        return true;
      } finally {
        await pool.close();
      }
    });
  }

  async describeSchema(params: ConnectionParams): Promise<MCPToolResult<SchemaMetadata>> {
    return this.executeWithResult(async () => {
      const pool = await this.createPool(params);
      try {
        const tables = await this.getTables(pool);
        const tableSchemas: TableSchema[] = [];

        for (const tableName of tables) {
          const columns = await this.getColumns(pool, tableName);
          const foreignKeys = await this.getForeignKeys(pool, tableName);
          const indexes = await this.getIndexes(pool, tableName);
          const primaryKeys = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
          tableSchemas.push({ name: tableName, columns, primaryKeys, foreignKeys, indexes });
        }

        return {
          database: params.database,
          connectorType: ConnectorType.MSSQL,
          tables: tableSchemas,
          extractedAt: new Date(),
        };
      } finally {
        await pool.close();
      }
    });
  }

  async executeReadQuery(
    params: ConnectionParams,
    sqlQuery: string,
    timeoutMs: number,
  ): Promise<MCPToolResult<MCPQueryResult>> {
    return this.executeWithResult(async () => {
      const pool = await this.createPool(params);
      try {
        const request = pool.request();
        (request as any).timeout = Math.floor(timeoutMs / 1000); // mssql expects seconds
        const result = await request.query(sqlQuery);
        const recordset = result.recordset || [];
        const columns = recordset.columns
          ? Object.keys(recordset.columns)
          : recordset.length > 0
            ? Object.keys(recordset[0])
            : [];
        return {
          rows: recordset as Record<string, unknown>[],
          columns,
          rowCount: recordset.length,
          executionTimeMs: 0,
        };
      } finally {
        await pool.close();
      }
    });
  }

  async dispose(): Promise<void> {
    this.logger.log('MSSQL connector disposed');
  }

  private async createPool(params: ConnectionParams): Promise<sql.ConnectionPool> {
    const config: sql.config = {
      server: params.host,
      port: params.port,
      user: params.username,
      password: params.password,
      database: params.database,
      options: { encrypt: true, trustServerCertificate: true },
      connectionTimeout: 10000,
      requestTimeout: 30000,
    };
    return new sql.ConnectionPool(config).connect();
  }

  private async getTables(pool: sql.ConnectionPool): Promise<string[]> {
    const result = await pool.request().query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = 'dbo'
       ORDER BY TABLE_NAME`,
    );
    return result.recordset.map((r) => r.TABLE_NAME as string);
  }

  private async getColumns(pool: sql.ConnectionPool, table: string): Promise<TableColumn[]> {
    const result = await pool.request()
      .input('table', sql.NVarChar, table)
      .query(
        `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT,
           CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_pk
         FROM INFORMATION_SCHEMA.COLUMNS c
         LEFT JOIN (
           SELECT ku.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
           JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
           WHERE tc.TABLE_NAME = @table AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
         ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
         WHERE c.TABLE_NAME = @table AND c.TABLE_SCHEMA = 'dbo'
         ORDER BY c.ORDINAL_POSITION`,
      );
    return result.recordset.map((r) => ({
      name: r.COLUMN_NAME as string,
      type: r.DATA_TYPE as string,
      nullable: r.IS_NULLABLE === 'YES',
      isPrimaryKey: r.is_pk === 1,
      defaultValue: r.COLUMN_DEFAULT as string | null,
    }));
  }

  private async getForeignKeys(pool: sql.ConnectionPool, table: string): Promise<ForeignKey[]> {
    const result = await pool.request()
      .input('table', sql.NVarChar, table)
      .query(
        `SELECT fk.name AS constraint_name,
           COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS column_name,
           OBJECT_NAME(fkc.referenced_object_id) AS referenced_table,
           COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS referenced_column
         FROM sys.foreign_keys fk
         JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
         WHERE OBJECT_NAME(fk.parent_object_id) = @table`,
      );
    return result.recordset.map((r) => ({
      columnName: r.column_name as string,
      referencedTable: r.referenced_table as string,
      referencedColumn: r.referenced_column as string,
      constraintName: r.constraint_name as string,
    }));
  }

  private async getIndexes(pool: sql.ConnectionPool, table: string): Promise<TableIndex[]> {
    const result = await pool.request()
      .input('table', sql.NVarChar, table)
      .query(
        `SELECT i.name AS index_name, COL_NAME(ic.object_id, ic.column_id) AS column_name, i.is_unique
         FROM sys.indexes i
         JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
         WHERE OBJECT_NAME(i.object_id) = @table AND i.name IS NOT NULL
         ORDER BY i.name, ic.key_ordinal`,
      );
    const indexMap = new Map<string, { columns: string[]; unique: boolean }>();
    for (const row of result.recordset) {
      const name = row.index_name as string;
      if (!indexMap.has(name)) indexMap.set(name, { columns: [], unique: row.is_unique as boolean });
      indexMap.get(name)!.columns.push(row.column_name as string);
    }
    return Array.from(indexMap.entries()).map(([name, info]) => ({
      name, columns: info.columns, unique: info.unique,
    }));
  }
}
