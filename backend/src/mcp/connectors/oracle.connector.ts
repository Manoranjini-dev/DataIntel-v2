import * as oracledb from 'oracledb';
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

export class OracleConnector extends BaseMCPConnector {
  readonly connectorType = ConnectorType.ORACLE;

  constructor() {
    super('OracleConnector');
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
        await conn.execute('SELECT 1 FROM DUAL');
        return true;
      } finally {
        await conn.close();
      }
    });
  }

  async describeSchema(params: ConnectionParams): Promise<MCPToolResult<SchemaMetadata>> {
    return this.executeWithResult(async () => {
      const conn = await this.connect(params);
      try {
        const tables = await this.getTables(conn);
        const tableSchemas: TableSchema[] = [];

        for (const tableName of tables) {
          const columns = await this.getColumns(conn, tableName);
          const foreignKeys = await this.getForeignKeys(conn, tableName);
          const indexes = await this.getIndexes(conn, tableName);
          const primaryKeys = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
          tableSchemas.push({ name: tableName, columns, primaryKeys, foreignKeys, indexes });
        }

        return {
          database: params.database,
          connectorType: ConnectorType.ORACLE,
          tables: tableSchemas,
          extractedAt: new Date(),
        };
      } finally {
        await conn.close();
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
        conn.callTimeout = timeoutMs;
        const result = await conn.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = (result.rows || []) as Record<string, unknown>[];
        const columns = result.metaData?.map((m) => m.name) || [];
        return {
          rows,
          columns,
          rowCount: rows.length,
          executionTimeMs: 0,
        };
      } finally {
        await conn.close();
      }
    });
  }

  async dispose(): Promise<void> {
    this.logger.log('Oracle connector disposed');
  }

  private async connect(params: ConnectionParams): Promise<oracledb.Connection> {
    return oracledb.getConnection({
      user: params.username,
      password: params.password,
      connectString: `${params.host}:${params.port}/${params.database}`,
    });
  }

  private async getTables(conn: oracledb.Connection): Promise<string[]> {
    const result = await conn.execute(
      `SELECT TABLE_NAME FROM USER_TABLES ORDER BY TABLE_NAME`,
      [], { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (result.rows as any[]).map((r) => r.TABLE_NAME as string);
  }

  private async getColumns(conn: oracledb.Connection, table: string): Promise<TableColumn[]> {
    const result = await conn.execute(
      `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.NULLABLE, c.DATA_DEFAULT,
         CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PK
       FROM USER_TAB_COLUMNS c
       LEFT JOIN (
         SELECT cols.COLUMN_NAME FROM USER_CONSTRAINTS cons
         JOIN USER_CONS_COLUMNS cols ON cons.CONSTRAINT_NAME = cols.CONSTRAINT_NAME
         WHERE cons.TABLE_NAME = :table AND cons.CONSTRAINT_TYPE = 'P'
       ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
       WHERE c.TABLE_NAME = :table
       ORDER BY c.COLUMN_ID`,
      { table },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (result.rows as any[]).map((r) => ({
      name: r.COLUMN_NAME as string,
      type: r.DATA_TYPE as string,
      nullable: r.NULLABLE === 'Y',
      isPrimaryKey: r.IS_PK === 1,
      defaultValue: (r.DATA_DEFAULT as string) || null,
    }));
  }

  private async getForeignKeys(conn: oracledb.Connection, table: string): Promise<ForeignKey[]> {
    const result = await conn.execute(
      `SELECT a.COLUMN_NAME, c_pk.TABLE_NAME AS REF_TABLE,
         b.COLUMN_NAME AS REF_COLUMN, c.CONSTRAINT_NAME
       FROM USER_CONS_COLUMNS a
       JOIN USER_CONSTRAINTS c ON a.CONSTRAINT_NAME = c.CONSTRAINT_NAME
       JOIN USER_CONSTRAINTS c_pk ON c.R_CONSTRAINT_NAME = c_pk.CONSTRAINT_NAME
       JOIN USER_CONS_COLUMNS b ON c_pk.CONSTRAINT_NAME = b.CONSTRAINT_NAME AND a.POSITION = b.POSITION
       WHERE c.TABLE_NAME = :table AND c.CONSTRAINT_TYPE = 'R'`,
      { table },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (result.rows as any[]).map((r) => ({
      columnName: r.COLUMN_NAME as string,
      referencedTable: r.REF_TABLE as string,
      referencedColumn: r.REF_COLUMN as string,
      constraintName: r.CONSTRAINT_NAME as string,
    }));
  }

  private async getIndexes(conn: oracledb.Connection, table: string): Promise<TableIndex[]> {
    const result = await conn.execute(
      `SELECT i.INDEX_NAME, ic.COLUMN_NAME, i.UNIQUENESS
       FROM USER_INDEXES i
       JOIN USER_IND_COLUMNS ic ON i.INDEX_NAME = ic.INDEX_NAME
       WHERE i.TABLE_NAME = :table
       ORDER BY i.INDEX_NAME, ic.COLUMN_POSITION`,
      { table },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const indexMap = new Map<string, { columns: string[]; unique: boolean }>();
    for (const row of result.rows as any[]) {
      const name = row.INDEX_NAME as string;
      if (!indexMap.has(name)) indexMap.set(name, { columns: [], unique: row.UNIQUENESS === 'UNIQUE' });
      indexMap.get(name)!.columns.push(row.COLUMN_NAME as string);
    }
    return Array.from(indexMap.entries()).map(([name, info]) => ({
      name, columns: info.columns, unique: info.unique,
    }));
  }
}
