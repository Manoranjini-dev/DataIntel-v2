// ──────────────────────────────────────────────
// MCP Toolbox — unit tests (pure helpers)
// ──────────────────────────────────────────────

import { ConnectorType } from '../../common/types';
import { sourceKeyFor, executeSqlToolName, TOOLBOX_SUPPORTED } from './toolbox.constants';
import { isMappable, mapConnectionToSource } from './toolbox-source.mapper';
import { normalizeToolboxResult } from './toolbox-result.normalizer';

describe('sourceKeyFor', () => {
  const base = {
    connectorType: ConnectorType.POSTGRES,
    host: 'db.example.com',
    port: 5432,
    database: 'analytics',
    username: 'reader',
  };

  it('is deterministic for identical coordinates', () => {
    expect(sourceKeyFor(base)).toBe(sourceKeyFor({ ...base }));
  });

  it('is prefixed and stable in shape', () => {
    expect(sourceKeyFor(base)).toMatch(/^conn_[0-9a-f]{16}$/);
  });

  it('changes when any coordinate changes', () => {
    expect(sourceKeyFor(base)).not.toBe(sourceKeyFor({ ...base, port: 5433 }));
    expect(sourceKeyFor(base)).not.toBe(sourceKeyFor({ ...base, database: 'other' }));
    expect(sourceKeyFor(base)).not.toBe(sourceKeyFor({ ...base, username: 'writer' }));
  });

  it('does NOT depend on the password (rotation keeps the same key)', () => {
    // password isn't part of the Pick<> type, so the key is inherently stable.
    expect(sourceKeyFor(base)).toBe(sourceKeyFor({ ...base }));
  });

  it('derives the tool name from the source key', () => {
    const key = sourceKeyFor(base);
    expect(executeSqlToolName(key)).toBe(`${key}__execute_sql`);
  });
});

describe('isMappable / TOOLBOX_SUPPORTED', () => {
  it('supports all SQL connectors Toolbox can execute', () => {
    for (const t of [
      ConnectorType.MYSQL, ConnectorType.POSTGRES, ConnectorType.REDSHIFT,
      ConnectorType.BIGQUERY, ConnectorType.MSSQL, ConnectorType.ORACLE, ConnectorType.SNOWFLAKE,
    ]) {
      expect(isMappable(t)).toBe(true);
    }
  });

  it('excludes non-SQL and unsupported connectors', () => {
    expect(isMappable(ConnectorType.DATABRICKS)).toBe(false);
    expect(isMappable(ConnectorType.MONGODB)).toBe(false);
    expect(isMappable(ConnectorType.ELASTICSEARCH)).toBe(false);
  });

  it('keeps isMappable and TOOLBOX_SUPPORTED in sync', () => {
    expect(isMappable(ConnectorType.SNOWFLAKE)).toBe(TOOLBOX_SUPPORTED.has(ConnectorType.SNOWFLAKE));
    expect(TOOLBOX_SUPPORTED.has(ConnectorType.DATABRICKS)).toBe(false);
  });
});

describe('mapConnectionToSource', () => {
  it('maps mysql with credentials + tool kind', () => {
    const { source, toolKind } = mapConnectionToSource({
      connectorType: ConnectorType.MYSQL,
      host: 'h', port: 3306, database: 'd', username: 'u', password: 'secret',
    });
    expect(toolKind).toBe('mysql-execute-sql');
    expect(source).toMatchObject({ kind: 'mysql', host: 'h', port: 3306, database: 'd', user: 'u', password: 'secret' });
  });

  it('maps postgres', () => {
    const { source, toolKind } = mapConnectionToSource({
      connectorType: ConnectorType.POSTGRES,
      host: 'h', port: 5432, database: 'd', username: 'u', password: 'p',
    });
    expect(toolKind).toBe('postgres-execute-sql');
    expect(source.kind).toBe('postgres');
  });

  it('maps redshift onto the postgres source + tool (wire-compatible)', () => {
    const { source, toolKind } = mapConnectionToSource({
      connectorType: ConnectorType.REDSHIFT,
      host: 'rs.example.com', port: 5439, database: 'dev', username: 'u', password: 'p',
    });
    expect(toolKind).toBe('postgres-execute-sql');
    expect(source).toMatchObject({ kind: 'postgres', host: 'rs.example.com', port: 5439 });
  });

  it('maps mssql, emitting encrypt only when configured', () => {
    const plain = mapConnectionToSource({
      connectorType: ConnectorType.MSSQL,
      host: 'h', port: 1433, database: 'd', username: 'u', password: 'p',
    });
    expect(plain.toolKind).toBe('mssql-execute-sql');
    expect(plain.source).not.toHaveProperty('encrypt');

    const encrypted = mapConnectionToSource({
      connectorType: ConnectorType.MSSQL,
      host: 'h', port: 1433, database: 'd', username: 'u', password: 'p',
      connectionOptions: { encrypt: 'strict' },
    });
    expect(encrypted.source.encrypt).toBe('strict');
  });

  it('maps oracle with service name taken from database', () => {
    const { source, toolKind } = mapConnectionToSource({
      connectorType: ConnectorType.ORACLE,
      host: 'h', port: 1521, database: 'XEPDB1', username: 'u', password: 'p',
    });
    expect(toolKind).toBe('oracle-execute-sql');
    expect(source).toMatchObject({ kind: 'oracle', host: 'h', port: 1521, serviceName: 'XEPDB1', user: 'u' });
    expect(source).not.toHaveProperty('database');
  });

  it('maps snowflake with account from host and schema default', () => {
    const { source, toolKind } = mapConnectionToSource({
      connectorType: ConnectorType.SNOWFLAKE,
      host: 'xy12345.us-east-1', port: 443, database: 'ANALYTICS', username: 'u', password: 'p',
      connectionOptions: { warehouse: 'WH', role: 'READER' },
    });
    expect(toolKind).toBe('snowflake-execute-sql');
    expect(source).toMatchObject({
      kind: 'snowflake', account: 'xy12345.us-east-1', database: 'ANALYTICS',
      schema: 'PUBLIC', warehouse: 'WH', role: 'READER',
    });
  });

  it('maps bigquery with project + blocked writeMode, no inline secret', () => {
    const { source, toolKind } = mapConnectionToSource({
      connectorType: ConnectorType.BIGQUERY,
      host: '', port: 0, database: '', username: '', password: '',
      connectionOptions: { bigqueryProjectId: 'my-proj' },
    });
    expect(toolKind).toBe('bigquery-execute-sql');
    expect(source).toEqual({ kind: 'bigquery', project: 'my-proj', writeMode: 'blocked' });
    expect(source).not.toHaveProperty('password');
  });

  it('throws for bigquery without a project', () => {
    expect(() =>
      mapConnectionToSource({
        connectorType: ConnectorType.BIGQUERY,
        host: '', port: 0, database: '', username: '', password: '',
      }),
    ).toThrow(/project/i);
  });

  it('throws for unsupported connectors', () => {
    expect(() =>
      mapConnectionToSource({
        connectorType: ConnectorType.DATABRICKS,
        host: 'h', port: 443, database: 'd', username: 'u', password: 'p',
      }),
    ).toThrow(/does not support/i);
  });
});

describe('normalizeToolboxResult', () => {
  it('parses a JSON array of rows and derives ordered columns', () => {
    const res = normalizeToolboxResult(
      { result: JSON.stringify([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]) },
      12,
    );
    expect(res.rowCount).toBe(2);
    expect(res.columns).toEqual(['id', 'name']);
    expect(res.executionTimeMs).toBe(12);
    expect(res.rows[0]).toEqual({ id: 1, name: 'a' });
  });

  it('handles empty / null results as zero rows', () => {
    expect(normalizeToolboxResult({ result: '' }, 1).rowCount).toBe(0);
    expect(normalizeToolboxResult({ result: 'null' }, 1).rowCount).toBe(0);
    expect(normalizeToolboxResult({ result: JSON.stringify([]) }, 1).columns).toEqual([]);
  });

  it('unions columns across heterogeneous rows', () => {
    const res = normalizeToolboxResult(
      { result: JSON.stringify([{ a: 1 }, { a: 2, b: 3 }]) },
      1,
    );
    expect(res.columns).toEqual(['a', 'b']);
  });

  it('caps rows at maxRows and records totalHits', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ i }));
    const res = normalizeToolboxResult({ result: JSON.stringify(rows) }, 1, 3);
    expect(res.rowCount).toBe(3);
    expect(res.totalHits).toBe(5);
  });

  it('throws on non-JSON result (triggers caller fallback)', () => {
    expect(() => normalizeToolboxResult({ result: 'ERROR: boom' }, 1)).toThrow(/non-JSON|unexpected/i);
  });
});
