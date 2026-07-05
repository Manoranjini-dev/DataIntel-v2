// ──────────────────────────────────────────────
// MCP Toolbox — Shared constants & source-key helper
// ──────────────────────────────────────────────

import { createHash } from 'crypto';
import { ConnectionParams, ConnectorType } from '../../common/types';

/**
 * Connector types Toolbox can execute SQL for via a prebuilt `*-execute-sql`
 * tool. Anything outside this set always uses the native connector path.
 *
 * Excluded on purpose:
 *   - DATABRICKS   — no Toolbox source exists.
 *   - MONGODB / ELASTICSEARCH — non-SQL; Toolbox exposes structured tools
 *     (mongodb-find, es-*) that don't fit the single-`sql`-param execute model.
 *
 * REDSHIFT has no dedicated Toolbox source but is PostgreSQL wire-compatible,
 * so it is mapped onto the `postgres` source + `postgres-execute-sql` tool.
 */
export const TOOLBOX_SUPPORTED: ReadonlySet<ConnectorType> = new Set([
  ConnectorType.MYSQL,
  ConnectorType.POSTGRES,
  ConnectorType.REDSHIFT,
  ConnectorType.BIGQUERY,
  ConnectorType.MSSQL,
  ConnectorType.ORACLE,
  ConnectorType.SNOWFLAKE,
]);

/** Suffix appended to a source key to name its execute-sql tool. */
export const EXECUTE_SQL_TOOL_SUFFIX = '__execute_sql';

/**
 * Deterministic, password-independent key identifying a connection's Toolbox
 * source + tool. Derived purely from the connection coordinates so that:
 *   - `ToolboxConfigService` (which reads from the DB) and
 *   - `MCPService` (which only has the in-memory session params)
 * independently arrive at the same name without threading a persisted id
 * through every call site. Password is deliberately excluded so credential
 * rotation keeps the same source name (only the file contents change).
 */
export function sourceKeyFor(
  params: Pick<
    ConnectionParams,
    'connectorType' | 'host' | 'port' | 'database' | 'username'
  >,
): string {
  const material = [
    params.connectorType,
    params.host ?? '',
    params.port ?? '',
    params.database ?? '',
    params.username ?? '',
  ].join('|');
  const digest = createHash('sha256').update(material).digest('hex').slice(0, 16);
  return `conn_${digest}`;
}

/** Tool name for a given source key. */
export function executeSqlToolName(sourceKey: string): string {
  return `${sourceKey}${EXECUTE_SQL_TOOL_SUFFIX}`;
}
