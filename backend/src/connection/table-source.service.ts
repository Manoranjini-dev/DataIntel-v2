// ──────────────────────────────────────────────
// Table Source Service (DS-02)
// Lets a user pick an entire table as a data-card source without writing SQL.
// Generates a connector-correct, read-only `SELECT *` query and previews the
// first rows through the existing MCP read-only boundary.
//
// SECURITY: table/schema identifiers are NEVER taken as free text into SQL.
// A candidate (schema, table) is first validated against the introspected
// metadata (connection_schemas / connection_tables); only the canonical,
// stored identifiers are quoted into the generated query. This makes SQL
// injection via the table name impossible, and read-only is still enforced at
// the connector level (identical to hand-written SQL cards).
// ──────────────────────────────────────────────

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { ConnectionPermissionsService } from './connection-permissions.service';
import { MCPService } from '../mcp/mcp.service';
import { ConnectorType } from '../common/types';
import { decrypt } from '../common/utils/encryption';
import { SafeAccount } from '../auth/auth.service';

/** Rows shown in the DS-02 "preview first 10 rows" step. */
const PREVIEW_ROW_LIMIT = 10;

export interface TablePreviewResult {
  schema: string | null;
  table: string;
  /** LIMIT-10 query used to fetch the preview rows (matches `rows`). */
  previewSql: string;
  /** Query persisted as the card source — the whole table, capped by the
   *  platform row limit (behaves identically to a hand-written SQL card). */
  sourceSql: string;
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  executionTimeMs: number;
}

@Injectable()
export class TableSourceService {
  private readonly logger = new Logger(TableSourceService.name);
  private readonly encKey: string;
  /** The whole-table source query is capped at the platform's max result rows. */
  private readonly sourceRowLimit: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly connectionPermissions: ConnectionPermissionsService,
    private readonly mcp: MCPService,
    private readonly config: ConfigService,
  ) {
    this.encKey = this.config.getOrThrow('CREDENTIAL_ENCRYPTION_KEY');
    this.sourceRowLimit = this.config.get<number>('MCP_MAX_RESULT_ROWS', 500);
  }

  /**
   * Quote a single identifier for the given connector, escaping the quote char
   * by doubling it. Identifiers here are always introspected (never raw user
   * input), but correct quoting still guards reserved words / special chars.
   */
  private quoteIdent(connectorType: ConnectorType, ident: string): string {
    switch (connectorType) {
      case ConnectorType.MYSQL:
      case ConnectorType.DATABRICKS:
      case ConnectorType.BIGQUERY:
        return '`' + ident.replace(/`/g, '``') + '`';
      case ConnectorType.MSSQL:
        return '[' + ident.replace(/]/g, ']]') + ']';
      // Postgres, Redshift, Snowflake, Oracle — ANSI double quotes.
      default:
        return '"' + ident.replace(/"/g, '""') + '"';
    }
  }

  /** Build the fully-qualified, quoted table reference. */
  private qualifiedName(connectorType: ConnectorType, schema: string | null, table: string): string {
    // BigQuery references a dataset.table inside a single backtick pair.
    if (connectorType === ConnectorType.BIGQUERY) {
      const parts = [schema, table].filter(Boolean).map((p) => (p as string).replace(/`/g, '``'));
      return '`' + parts.join('.') + '`';
    }
    const quotedTable = this.quoteIdent(connectorType, table);
    return schema ? `${this.quoteIdent(connectorType, schema)}.${quotedTable}` : quotedTable;
  }

  /**
   * Generate a connector-correct, read-only `SELECT *` query for a table.
   * Handles dialect row-limiting: MSSQL TOP, Oracle FETCH FIRST, LIMIT elsewhere.
   * Exposed (not private) so it can be unit-tested per connector directly.
   */
  buildSelectAllQuery(
    connectorType: ConnectorType,
    schema: string | null,
    table: string,
    limit: number,
  ): string {
    const ref = this.qualifiedName(connectorType, schema, table);
    const n = Math.max(1, Math.floor(limit));
    switch (connectorType) {
      case ConnectorType.MSSQL:
        return `SELECT TOP ${n} * FROM ${ref}`;
      case ConnectorType.ORACLE:
        return `SELECT * FROM ${ref} FETCH FIRST ${n} ROWS ONLY`;
      default:
        return `SELECT * FROM ${ref} LIMIT ${n}`;
    }
  }

  /**
   * Validate a table against introspected metadata and preview its first rows.
   * @param schemaName optional disambiguator when the same table name exists in
   *   multiple schemas; when omitted the sole matching table is used.
   */
  async previewTable(
    connId: string,
    user: SafeAccount,
    tableName: string,
    schemaName: string | null,
    previewLimit = PREVIEW_ROW_LIMIT,
  ): Promise<TablePreviewResult> {
    await this.connectionPermissions.requireAction(connId, user.id, 'view');

    // 1. Resolve + validate the table from introspected metadata (injection-safe).
    const params: any[] = [connId, tableName];
    let schemaFilter = '';
    if (schemaName) {
      params.push(schemaName);
      schemaFilter = ` AND cs.schema_name = $3`;
    }
    const matches = await this.db.queryMany<{ schema_name: string; table_name: string }>(
      `SELECT cs.schema_name, ct.table_name
         FROM connection_tables ct
         JOIN connection_schemas cs ON cs.id = ct.schema_id
        WHERE cs.connection_id = $1
          AND ct.table_name = $2
          AND cs.deleted_at IS NULL
          AND ct.deleted_at IS NULL${schemaFilter}
        ORDER BY cs.schema_name`,
      params,
    );
    if (matches.length === 0) {
      throw new NotFoundException(
        `Table "${tableName}" was not found in this connection's schema. Re-sync the schema if it was added recently.`,
      );
    }
    const chosen = matches[0];

    // 2. Load connection + credentials.
    const conn = await this.db.queryOne<any>(
      'SELECT * FROM datasource_connections WHERE id = $1 AND deleted_at IS NULL',
      [connId],
    );
    if (!conn) throw new NotFoundException('Connection not found');
    const connectorType = conn.connector_type as ConnectorType;

    // 3. Generate the read-only queries.
    const clampedPreview = Math.min(Math.max(1, previewLimit), PREVIEW_ROW_LIMIT);
    const previewSql = this.buildSelectAllQuery(connectorType, chosen.schema_name, chosen.table_name, clampedPreview);
    const sourceSql = this.buildSelectAllQuery(connectorType, chosen.schema_name, chosen.table_name, this.sourceRowLimit);

    // 4. Execute the preview through the read-only MCP boundary.
    const password = decrypt(conn.encrypted_password, this.encKey);
    const session = await this.mcp.createSession({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password,
      database: conn.database_name,
      connectorType,
    });

    const start = Date.now();
    try {
      const result = await this.mcp.executeReadQuery(session.sessionId, previewSql);
      if (!result.success) {
        throw new Error(result.error || 'Table preview query failed');
      }
      const rows = result.data?.rows || [];
      const columns = result.data?.columns || [];
      return {
        schema: chosen.schema_name,
        table: chosen.table_name,
        previewSql,
        sourceSql,
        rows,
        columns,
        rowCount: result.data?.rowCount ?? rows.length,
        executionTimeMs: Date.now() - start,
      };
    } finally {
      await this.mcp.destroySession(session.sessionId).catch(() => {});
    }
  }
}
