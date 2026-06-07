import { DBSQLClient } from '@databricks/sql';
import type IDBSQLSession from '@databricks/sql/dist/contracts/IDBSQLSession';
import {
  ConnectionParams,
  ConnectorCapabilities,
  ConnectorType,
  SchemaMetadata,
  TableColumn,
  TableSchema,
} from '../../common/types';
import { MCPQueryResult, MCPToolResult } from '../types';
import { BaseMCPConnector } from './base.connector';

export class DatabricksConnector extends BaseMCPConnector {
  readonly connectorType = ConnectorType.DATABRICKS;

  constructor() {
    super('DatabricksConnector');
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
      const { client, session } = await this.connect(params);
      try {
        const op = await session.executeStatement('SELECT 1 AS ok');
        await op.close();
        return true;
      } finally {
        await session.close();
        await client.close();
      }
    });
  }

  async describeSchema(params: ConnectionParams): Promise<MCPToolResult<SchemaMetadata>> {
    return this.executeWithResult(async () => {
      const { client, session } = await this.connect(params);
      try {
        const tablesOp = await session.executeStatement(
          `SHOW TABLES IN ${this.escapeIdentifier(params.database)}`,
        );
        const tablesResult = await tablesOp.fetchAll();
        await tablesOp.close();

        const tableSchemas: TableSchema[] = [];
        for (const row of tablesResult) {
          const tableName = (row as any).tableName || (row as any).TABLE_NAME;
          if (!tableName) continue;
          const columns = await this.getColumns(session, params.database, tableName);
          tableSchemas.push({
            name: tableName,
            columns,
            primaryKeys: [],
            foreignKeys: [],
            indexes: [],
          });
        }

        return {
          database: params.database,
          connectorType: ConnectorType.DATABRICKS,
          tables: tableSchemas,
          extractedAt: new Date(),
        };
      } finally {
        await session.close();
        await client.close();
      }
    });
  }

  async executeReadQuery(
    params: ConnectionParams,
    sql: string,
    _timeoutMs: number,
  ): Promise<MCPToolResult<MCPQueryResult>> {
    return this.executeWithResult(async () => {
      const { client, session } = await this.connect(params);
      try {
        const op = await session.executeStatement(sql, { maxRows: 500 });
        const rows = await op.fetchAll();
        await op.close();
        const columns = rows.length > 0 ? Object.keys(rows[0] as object) : [];
        return {
          rows: rows as Record<string, unknown>[],
          columns,
          rowCount: rows.length,
          executionTimeMs: 0,
        };
      } finally {
        await session.close();
        await client.close();
      }
    });
  }

  async dispose(): Promise<void> {
    this.logger.log('Databricks connector disposed');
  }

  private async connect(params: ConnectionParams): Promise<{
    client: DBSQLClient;
    session: IDBSQLSession;
  }> {
    const client = new DBSQLClient();
    await client.connect({
      host: params.host,
      path: `/sql/1.0/warehouses/${params.database}`,
      token: params.password,
    });
    const session = await client.openSession();
    return { client, session };
  }

  private async getColumns(
    session: IDBSQLSession,
    database: string,
    table: string,
  ): Promise<TableColumn[]> {
    const op = await session.executeStatement(
      `DESCRIBE TABLE ${this.escapeIdentifier(database)}.${this.escapeIdentifier(table)}`,
    );
    const rows = await op.fetchAll();
    await op.close();
    return (rows as any[])
      .filter((r) => r.col_name && !r.col_name.startsWith('#'))
      .map((r) => ({
        name: r.col_name as string,
        type: r.data_type as string,
        nullable: true,
        isPrimaryKey: false,
        defaultValue: null,
      }));
  }

  private escapeIdentifier(id: string): string {
    return `\`${id.replace(/`/g, '``')}\``;
  }
}
