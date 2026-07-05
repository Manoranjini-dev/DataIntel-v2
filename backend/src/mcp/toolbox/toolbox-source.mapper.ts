// ──────────────────────────────────────────────
// MCP Toolbox — Source Mapper
// Maps a DataIntel connection to a Toolbox `source` + execute-sql tool `kind`.
// ──────────────────────────────────────────────

import { ConnectorType } from '../../common/types';
import { sourceKeyFor, TOOLBOX_SUPPORTED } from './toolbox.constants';

/** A raw Toolbox source config object (goes under `sources.<key>`). */
export type ToolboxSourceConfig = Record<string, unknown>;

/** Decrypted connection material handed to the mapper. */
export interface MappableConnection {
  connectorType: ConnectorType;
  host: string;
  port: number;
  database: string;
  username: string;
  /** Decrypted password (or service-account JSON for BigQuery, if used). */
  password: string;
  ssl?: boolean;
  connectionOptions?: Record<string, any> | null;
}

/** Result of mapping one connection. */
export interface MappedSource {
  sourceKey: string;
  source: ToolboxSourceConfig;
  /** Toolbox tool kind, e.g. "postgres-execute-sql". */
  toolKind: string;
}

/** Whether the mapper knows how to represent this connector as a Toolbox source. */
export function isMappable(type: ConnectorType): boolean {
  return TOOLBOX_SUPPORTED.has(type);
}

/** Standard host/port/database/user/password source body shared by SQL sources. */
function basicSource(kind: string, conn: MappableConnection): ToolboxSourceConfig {
  return {
    kind,
    host: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.username,
    password: conn.password,
  };
}

/**
 * Map a connection to its Toolbox source config and tool kind.
 * Throws for unsupported connector types — callers should filter with
 * `isMappable` first.
 *
 * Note how the generic ConnectionParams fields are reused per dialect, matching
 * the native connectors: Snowflake stores its account in `host`, Oracle stores
 * its service name in `database`, MSSQL uses `host` as the server.
 */
export function mapConnectionToSource(conn: MappableConnection): MappedSource {
  const sourceKey = sourceKeyFor(conn);
  const opts = conn.connectionOptions ?? {};

  switch (conn.connectorType) {
    case ConnectorType.MYSQL:
      return { sourceKey, toolKind: 'mysql-execute-sql', source: basicSource('mysql', conn) };

    case ConnectorType.POSTGRES:
      return { sourceKey, toolKind: 'postgres-execute-sql', source: basicSource('postgres', conn) };

    case ConnectorType.REDSHIFT:
      // Redshift has no dedicated Toolbox source but is Postgres wire-compatible.
      // Route it through the `postgres` source + tool. Validate against real
      // Redshift before enabling in production (some SQL/catalog quirks differ).
      return { sourceKey, toolKind: 'postgres-execute-sql', source: basicSource('postgres', conn) };

    case ConnectorType.MSSQL: {
      // Also the path for Microsoft Fabric (PRD DS2-03) via the SQL-analytics
      // endpoint. `encrypt` is optional; only emit it when explicitly configured.
      const source: ToolboxSourceConfig = basicSource('mssql', conn);
      if (opts.encrypt) source.encrypt = opts.encrypt;
      return { sourceKey, toolKind: 'mssql-execute-sql', source };
    }

    case ConnectorType.ORACLE: {
      // Native connector builds `${host}:${port}/${database}` — i.e. the Oracle
      // service name lives in `database`.
      if (!conn.host || !conn.port || !conn.database) {
        throw new Error('Oracle source requires host, port, and service name (database)');
      }
      return {
        sourceKey,
        toolKind: 'oracle-execute-sql',
        source: {
          kind: 'oracle',
          host: conn.host,
          port: conn.port,
          serviceName: conn.database,
          user: conn.username,
          password: conn.password,
        },
      };
    }

    case ConnectorType.SNOWFLAKE: {
      // Native connector maps the Snowflake account identifier onto `host`.
      // Toolbox requires `account`, `database`, and `schema`.
      const account = conn.host;
      if (!account) throw new Error('Snowflake source requires an account identifier (host)');
      const source: ToolboxSourceConfig = {
        kind: 'snowflake',
        account,
        user: conn.username,
        password: conn.password,
        database: conn.database,
        schema: opts.schema || opts.snowflakeSchema || 'PUBLIC',
      };
      if (opts.warehouse || opts.snowflakeWarehouse) {
        source.warehouse = opts.warehouse || opts.snowflakeWarehouse;
      }
      if (opts.role || opts.snowflakeRole) source.role = opts.role || opts.snowflakeRole;
      return { sourceKey, toolKind: 'snowflake-execute-sql', source };
    }

    case ConnectorType.BIGQUERY: {
      // BigQuery sources authenticate via ADC / impersonation / the sidecar's
      // GOOGLE_APPLICATION_CREDENTIALS — the source config carries no inline
      // secret. Service-account JSON must be mounted to the sidecar and pointed
      // at by GOOGLE_APPLICATION_CREDENTIALS (see deployment notes). `blocked`
      // writeMode is a defense-in-depth read-only guard on top of our validator.
      const project = opts.bigqueryProjectId || conn.database || opts.project;
      if (!project) {
        throw new Error('BigQuery source requires a project id (bigqueryProjectId)');
      }
      return {
        sourceKey,
        toolKind: 'bigquery-execute-sql',
        source: {
          kind: 'bigquery',
          project,
          writeMode: 'blocked',
        },
      };
    }

    default:
      throw new Error(
        `Toolbox source mapper does not support connector type: ${conn.connectorType}`,
      );
  }
}
