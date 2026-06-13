// ──────────────────────────────────────────────
// MySQL MCP Connector — Read-Only MySQL Access
// ──────────────────────────────────────────────

import * as mysql from 'mysql2/promise';
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

export class MySQLConnector extends BaseMCPConnector {
  readonly connectorType = ConnectorType.MYSQL;

  constructor() {
    super('MySQLConnector');
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
      const connection = await this.createConnection(params);
      try {
        await connection.execute('SELECT 1');
        return true;
      } finally {
        await connection.end();
      }
    });
  }

  async describeSchema(params: ConnectionParams): Promise<MCPToolResult<SchemaMetadata>> {
    return this.executeWithResult(async () => {
      const connection = await this.createConnection(params);
      try {
        const tables = await this.getTables(connection, params.database);
        
        const [allColumnsRows] = await connection.execute<mysql.RowDataPacket[]>(
          `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLUMN_COMMENT
           FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = ?
           ORDER BY TABLE_NAME, ORDINAL_POSITION`,
          [params.database]
        );

        const [allFkRows] = await connection.execute<mysql.RowDataPacket[]>(
          `SELECT 
            TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME
           FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
           WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
          [params.database]
        );

        const [allIdxRows] = await connection.execute<mysql.RowDataPacket[]>(
          `SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE
           FROM INFORMATION_SCHEMA.STATISTICS
           WHERE TABLE_SCHEMA = ?
           ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
          [params.database]
        );

        const colsByTable = new Map<string, TableColumn[]>();
        for (const r of allColumnsRows) {
          const t = r.TABLE_NAME as string;
          if (!colsByTable.has(t)) colsByTable.set(t, []);
          colsByTable.get(t)!.push({
            name: r.COLUMN_NAME as string,
            type: r.DATA_TYPE as string,
            nullable: r.IS_NULLABLE === 'YES',
            isPrimaryKey: r.COLUMN_KEY === 'PRI',
            defaultValue: r.COLUMN_DEFAULT as string | null,
            comment: r.COLUMN_COMMENT as string | undefined,
          });
        }

        const fksByTable = new Map<string, ForeignKey[]>();
        for (const r of allFkRows) {
          const t = r.TABLE_NAME as string;
          if (!fksByTable.has(t)) fksByTable.set(t, []);
          fksByTable.get(t)!.push({
            columnName: r.COLUMN_NAME as string,
            referencedTable: r.REFERENCED_TABLE_NAME as string,
            referencedColumn: r.REFERENCED_COLUMN_NAME as string,
            constraintName: r.CONSTRAINT_NAME as string,
          });
        }

        const idxByTable = new Map<string, TableIndex[]>();
        const indexGroups = new Map<string, Map<string, { columns: string[]; unique: boolean }>>();
        for (const r of allIdxRows) {
          const t = r.TABLE_NAME as string;
          const idxName = r.INDEX_NAME as string;
          if (!indexGroups.has(t)) indexGroups.set(t, new Map());
          
          const tGroups = indexGroups.get(t)!;
          if (!tGroups.has(idxName)) {
            tGroups.set(idxName, { columns: [], unique: r.NON_UNIQUE === 0 });
          }
          tGroups.get(idxName)!.columns.push(r.COLUMN_NAME as string);
        }
        
        for (const [t, groups] of indexGroups.entries()) {
          idxByTable.set(t, Array.from(groups.entries()).map(([name, info]) => ({
            name,
            columns: info.columns,
            unique: info.unique,
          })));
        }

        const tableSchemas: TableSchema[] = [];
        for (const tableName of tables) {
          const columns = colsByTable.get(tableName) || [];
          const foreignKeys = fksByTable.get(tableName) || [];
          const indexes = idxByTable.get(tableName) || [];
          const primaryKeys = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

          tableSchemas.push({
            name: tableName,
            columns,
            primaryKeys,
            foreignKeys,
            indexes,
          });
        }

        return {
          database: params.database,
          connectorType: ConnectorType.MYSQL,
          tables: tableSchemas,
          extractedAt: new Date(),
        };
      } finally {
        await connection.end();
      }
    });
  }

  async executeReadQuery(
    params: ConnectionParams,
    sql: string,
    timeoutMs: number,
  ): Promise<MCPToolResult<MCPQueryResult>> {
    return this.executeWithResult(async () => {
      const connection = await this.createConnection(params);
      try {
        // Enforce read-only at the session level
        await connection.query('SET SESSION TRANSACTION READ ONLY');
        // Disable ONLY_FULL_GROUP_BY to accommodate imperfect LLM-generated SQL
        await connection.query("SET SESSION sql_mode=(SELECT REPLACE(@@sql_mode,'ONLY_FULL_GROUP_BY',''))");

        const [rows, fields] = await Promise.race([
          connection.query(sql) as Promise<[mysql.RowDataPacket[], mysql.FieldPacket[]]>,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Query execution timeout')), timeoutMs),
          ),
        ]);

        const columns = fields.map((f) => f.name);
        const resultRows = (rows as Record<string, unknown>[]).map((row) => {
          const clean: Record<string, unknown> = {};
          for (const col of columns) {
            const val = row[col];
            // Ensure BigInt values are converted to safe JS numbers/strings
            clean[col] = typeof val === 'bigint'
              ? (val <= Number.MAX_SAFE_INTEGER && val >= Number.MIN_SAFE_INTEGER
                  ? Number(val)
                  : val.toString())
              : val;
          }
          return clean;
        });

        return {
          rows: resultRows,
          columns,
          rowCount: resultRows.length,
          executionTimeMs: 0, // Outer wrapper handles timing
        };
      } finally {
        await connection.end();
      }
    });
  }

  async dispose(): Promise<void> {
    this.logger.log('MySQL connector disposed');
  }

  // ── Private Helpers ──────────────────────────

  private async createConnection(params: ConnectionParams): Promise<mysql.Connection> {
    return mysql.createConnection({
      host: params.host,
      port: params.port,
      user: params.username,
      password: params.password,
      database: params.database,
      connectTimeout: 10000,
      multipleStatements: false, // Critical: prevent multi-statement injection
      supportBigNumbers: true,   // Handle BIGINT/DECIMAL without precision loss
      bigNumberStrings: false,   // Return as JS numbers when safe
      decimalNumbers: true,      // Return DECIMAL as numbers
    });
  }

  private async getTables(connection: mysql.Connection, database: string): Promise<string[]> {
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [database],
    );
    return rows.map((r) => r.TABLE_NAME as string);
  }

  private async getColumns(
    connection: mysql.Connection,
    database: string,
    table: string,
  ): Promise<TableColumn[]> {
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLUMN_COMMENT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [database, table],
    );

    return rows.map((r) => ({
      name: r.COLUMN_NAME as string,
      type: r.DATA_TYPE as string,
      nullable: r.IS_NULLABLE === 'YES',
      isPrimaryKey: r.COLUMN_KEY === 'PRI',
      defaultValue: r.COLUMN_DEFAULT as string | null,
      comment: r.COLUMN_COMMENT as string | undefined,
    }));
  }

  private async getForeignKeys(
    connection: mysql.Connection,
    database: string,
    table: string,
  ): Promise<ForeignKey[]> {
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT 
        COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [database, table],
    );

    return rows.map((r) => ({
      columnName: r.COLUMN_NAME as string,
      referencedTable: r.REFERENCED_TABLE_NAME as string,
      referencedColumn: r.REFERENCED_COLUMN_NAME as string,
      constraintName: r.CONSTRAINT_NAME as string,
    }));
  }

  private async getIndexes(
    connection: mysql.Connection,
    database: string,
    table: string,
  ): Promise<TableIndex[]> {
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [database, table],
    );

    const indexMap = new Map<string, { columns: string[]; unique: boolean }>();
    for (const row of rows) {
      const name = row.INDEX_NAME as string;
      if (!indexMap.has(name)) {
        indexMap.set(name, { columns: [], unique: row.NON_UNIQUE === 0 });
      }
      indexMap.get(name)!.columns.push(row.COLUMN_NAME as string);
    }

    return Array.from(indexMap.entries()).map(([name, info]) => ({
      name,
      columns: info.columns,
      unique: info.unique,
    }));
  }
}
