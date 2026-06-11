// ──────────────────────────────────────────────
// PostgreSQL MCP Connector — Read-Only PG Access
// ──────────────────────────────────────────────

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

export class PostgresConnector extends BaseMCPConnector {
  readonly connectorType = ConnectorType.POSTGRES;

  constructor() {
    super('PostgresConnector');
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
        
        const allColumnsResult = await client.query(
          `SELECT 
            c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default,
            CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
           FROM information_schema.columns c
           LEFT JOIN (
             SELECT tc.table_name, ku.column_name 
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
             WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
           ) pk ON c.column_name = pk.column_name AND c.table_name = pk.table_name
           WHERE c.table_schema = 'public'
           ORDER BY c.table_name, c.ordinal_position`
        );

        const allFkResult = await client.query(
          `SELECT 
            tc.table_name,
            kcu.column_name,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column,
            tc.constraint_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu 
             ON tc.constraint_name = kcu.constraint_name
           JOIN information_schema.constraint_column_usage ccu 
             ON ccu.constraint_name = tc.constraint_name
           WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
        );

        const allIdxResult = await client.query(
          `SELECT 
            t.relname as table_name,
            i.relname as index_name,
            a.attname as column_name,
            ix.indisunique as is_unique
           FROM pg_class t
           JOIN pg_index ix ON t.oid = ix.indrelid
           JOIN pg_class i ON i.oid = ix.indexrelid
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
           JOIN pg_namespace n ON n.oid = t.relnamespace
           WHERE t.relkind = 'r' AND n.nspname = 'public'
           ORDER BY t.relname, i.relname, a.attnum`
        );

        const colsByTable = new Map<string, TableColumn[]>();
        for (const r of allColumnsResult.rows) {
          const t = r.table_name as string;
          if (!colsByTable.has(t)) colsByTable.set(t, []);
          colsByTable.get(t)!.push({
            name: r.column_name as string,
            type: r.data_type as string,
            nullable: r.is_nullable === 'YES',
            isPrimaryKey: r.is_primary_key as boolean,
            defaultValue: r.column_default as string | null,
          });
        }

        const fksByTable = new Map<string, ForeignKey[]>();
        for (const r of allFkResult.rows) {
          const t = r.table_name as string;
          if (!fksByTable.has(t)) fksByTable.set(t, []);
          fksByTable.get(t)!.push({
            columnName: r.column_name as string,
            referencedTable: r.referenced_table as string,
            referencedColumn: r.referenced_column as string,
            constraintName: r.constraint_name as string,
          });
        }

        const idxByTable = new Map<string, TableIndex[]>();
        const indexGroups = new Map<string, Map<string, { columns: string[]; unique: boolean }>>();
        for (const r of allIdxResult.rows) {
          const t = r.table_name as string;
          const idxName = r.index_name as string;
          if (!indexGroups.has(t)) indexGroups.set(t, new Map());
          
          const tGroups = indexGroups.get(t)!;
          if (!tGroups.has(idxName)) {
            tGroups.set(idxName, { columns: [], unique: r.is_unique as boolean });
          }
          tGroups.get(idxName)!.columns.push(r.column_name as string);
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
          connectorType: ConnectorType.POSTGRES,
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

        // Enforce read-only transaction
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
    this.logger.log('PostgreSQL connector disposed');
  }

  // ── Private Helpers ──────────────────────────

  private createClient(params: ConnectionParams): Client {
    return new Client({
      host: params.host,
      port: params.port,
      user: params.username,
      password: params.password,
      database: params.database,
      connectionTimeoutMillis: 10000,
    });
  }

  private async getTables(client: Client): Promise<string[]> {
    const result = await client.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    return result.rows.map((r) => r.table_name as string);
  }

  private async getColumns(client: Client, table: string): Promise<TableColumn[]> {
    const result = await client.query(
      `SELECT 
        c.column_name, c.data_type, c.is_nullable, c.column_default,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
       FROM information_schema.columns c
       LEFT JOIN (
         SELECT ku.column_name 
         FROM information_schema.table_constraints tc
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
      `SELECT 
        kcu.column_name,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column,
        tc.constraint_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu 
         ON tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage ccu 
         ON ccu.constraint_name = tc.constraint_name
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

  private async getIndexes(client: Client, table: string): Promise<TableIndex[]> {
    const result = await client.query(
      `SELECT 
        i.relname as index_name,
        a.attname as column_name,
        ix.indisunique as is_unique
       FROM pg_class t
       JOIN pg_index ix ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
       WHERE t.relkind = 'r' AND t.relname = $1
       ORDER BY i.relname, a.attnum`,
      [table],
    );

    const indexMap = new Map<string, { columns: string[]; unique: boolean }>();
    for (const row of result.rows) {
      const name = row.index_name as string;
      if (!indexMap.has(name)) {
        indexMap.set(name, { columns: [], unique: row.is_unique as boolean });
      }
      indexMap.get(name)!.columns.push(row.column_name as string);
    }

    return Array.from(indexMap.entries()).map(([name, info]) => ({
      name,
      columns: info.columns,
      unique: info.unique,
    }));
  }
}
