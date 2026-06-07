import { BigQuery } from '@google-cloud/bigquery';
import {
  ConnectionParams,
  ConnectorCapabilities,
  ConnectorType,
  ForeignKey,
  SchemaMetadata,
  TableColumn,
  TableSchema,
} from '../../common/types';
import { MCPQueryResult, MCPToolResult } from '../types';
import { BaseMCPConnector } from './base.connector';

export class BigQueryConnector extends BaseMCPConnector {
  readonly connectorType = ConnectorType.BIGQUERY;

  constructor() {
    super('BigQueryConnector');
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
      const [rows] = await client.query('SELECT 1 AS ok');
      return rows.length > 0;
    });
  }

  async describeSchema(params: ConnectionParams): Promise<MCPToolResult<SchemaMetadata>> {
    return this.executeWithResult(async () => {
      const client = this.createClient(params);
      const dataset = client.dataset(params.database);
      const [tables] = await dataset.getTables();
      const tableSchemas: TableSchema[] = [];

      for (const table of tables) {
        const [metadata] = await table.getMetadata();
        const fields = metadata.schema?.fields || [];
        const columns: TableColumn[] = fields.map((f: any) => ({
          name: f.name,
          type: f.type,
          nullable: f.mode !== 'REQUIRED',
          isPrimaryKey: false,
          defaultValue: null,
        }));
        tableSchemas.push({
          name: table.id!,
          columns,
          primaryKeys: [],
          foreignKeys: [],
          indexes: [],
        });
      }

      return {
        database: params.database,
        connectorType: ConnectorType.BIGQUERY,
        tables: tableSchemas,
        extractedAt: new Date(),
      };
    });
  }

  async executeReadQuery(
    params: ConnectionParams,
    sql: string,
    timeoutMs: number,
  ): Promise<MCPToolResult<MCPQueryResult>> {
    return this.executeWithResult(async () => {
      const client = this.createClient(params);
      const queryResponse = await client.query({
        query: sql,
        jobTimeoutMs: timeoutMs,
        maxResults: 500,
      });
      const rows = Array.isArray(queryResponse) ? queryResponse[0] : queryResponse;
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return {
        rows: rows as Record<string, unknown>[],
        columns,
        rowCount: rows.length,
        executionTimeMs: 0,
      };
    });
  }

  async dispose(): Promise<void> {
    this.logger.log('BigQuery connector disposed');
  }

  private createClient(params: ConnectionParams): BigQuery {
    return new BigQuery({
      projectId: params.host,
      credentials: params.password ? JSON.parse(params.password) : undefined,
    });
  }
}
