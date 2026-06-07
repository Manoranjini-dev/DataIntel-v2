import { Client } from 'pg';
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

export class RedshiftConnector extends BaseMCPConnector {
  readonly connectorType = ConnectorType.REDSHIFT;

  constructor() {
    super('RedshiftConnector');
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
      const client = this.createClient(params);
      try {
        await client.connect();
        await client.query('SELECT 1');
        return true;
      } finally {
        await client.end();
      }
    });
  }

  async describeSchema(params: ConnectionParams): Promise<MCPToolResult<SchemaMetadata>> {
    return this.executeWithResult(async () => {
      const client = this.createClient(params);
      try {
        await client.connect();
        const tables = await this.getTables(client);
        const tableSchemas: TableSchema[] = [];

        for (const tableName of tables) {
          const columns = await this.getColumns(client, tableName);
          const foreignKeys = await this.getForeignKeys(client, tableName);
          const primaryKeys = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
          tableSchemas.push({ name: tableName, columns, primaryKeys, foreignKeys, indexes: [] });
        }

        return {
          database: params.database,
          connectorType: ConnectorType.REDSHIFT,
          tables: tableSchemas,
          extractedAt: new Date(),
        };
      } finally {
        await client.end();
      }
    });
  }

  async executeReadQuery(
    params: ConnectionParams,
    sql: string,
    timeoutMs: number,
  ): Promise<MCPToolResult<MCPQueryResult>> {
    return this.executeWithResult(async () => {
      const client = this.createClient(params);
      try {
        await client.connect();
        await client.query('BEGIN TRANSACTION READ ONLY');
        await client.query(`SET statement_timeout = ${timeoutMs}`);
        const result = await client.query(sql);
        await client.query('COMMIT');
        const columns = result.fields.map((f) => f.name);
        return {
          rows: result.rows as Record<string, unknown>[],
          columns,
          rowCount: result.rowCount ?? 0,
          executionTimeMs: 0,
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        await client.end();
      }
    });
  }

  async dispose(): Promise<void> {
    this.logger.log('Redshift connector disposed');
  }

  private createClient(params: ConnectionParams): Client {
    return new Client({
      host: params.host,
      port: params.port,
      user: params.username,
      password: params.password,
      database: params.database,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });
  }

  private async getTables(client: Client): Promise<string[]> {
    const result = await client.query(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename`,
    );
    return result.rows.map((r) => r.tablename as string);
  }

  private async getColumns(client: Client, table: string): Promise<TableColumn[]> {
    const result = await client.query(
      `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
         CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
       FROM information_schema.columns c
       LEFT JOIN (
         SELECT ku.column_name FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
         WHERE tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
       ) pk ON c.column_name = pk.column_name
       WHERE c.table_schema = 'public' AND c.table_name = $1
       ORDER BY c.ordinal_position`,
      [table],
    );
    return result.rows.map((r) => ({
      name: r.column_name as string,
      type: r.data_type as string,
      nullable: r.is_nullable === 'YES',
      isPrimaryKey: r.is_primary_key as boolean,
      defaultValue: r.column_default as string | null,
    }));
  }

  private async getForeignKeys(client: Client, table: string): Promise<ForeignKey[]> {
    const result = await client.query(
      `SELECT kcu.column_name, ccu.table_name AS referenced_table,
         ccu.column_name AS referenced_column, tc.constraint_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'`,
      [table],
    );
    return result.rows.map((r) => ({
      columnName: r.column_name as string,
      referencedTable: r.referenced_table as string,
      referencedColumn: r.referenced_column as string,
      constraintName: r.constraint_name as string,
    }));
  }
}
