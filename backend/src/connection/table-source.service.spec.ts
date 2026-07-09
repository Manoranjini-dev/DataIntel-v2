// ──────────────────────────────────────────────
// TableSourceService — DS-02 table-as-source generation & preview
// ──────────────────────────────────────────────

// The service imports `decrypt` directly; stub it so no real key/ciphertext is
// needed. (Credential decryption itself is covered by encryption util tests.)
jest.mock('../common/utils/encryption', () => ({
  decrypt: () => 'secret-pw',
  encrypt: (x: string) => x,
}));

import { NotFoundException } from '@nestjs/common';
import { TableSourceService } from './table-source.service';
import { ConnectorType } from '../common/types';

const USER = { id: 'user-1' } as any;

function makeService(overrides: {
  requireAction?: jest.Mock;
  queryMany?: jest.Mock;
  queryOne?: jest.Mock;
  mcp?: any;
} = {}) {
  const db = {
    queryMany: overrides.queryMany ?? jest.fn(),
    queryOne: overrides.queryOne ?? jest.fn(),
    query: jest.fn(),
  };
  const perms = { requireAction: overrides.requireAction ?? jest.fn().mockResolvedValue(undefined) };
  const mcp = overrides.mcp ?? {
    createSession: jest.fn().mockResolvedValue({ sessionId: 'sess-1' }),
    executeReadQuery: jest.fn().mockResolvedValue({ success: true, data: { rows: [{ a: 1 }], columns: ['a'], rowCount: 1 } }),
    destroySession: jest.fn().mockResolvedValue(undefined),
  };
  const config = { getOrThrow: () => 'key', get: (_k: string, def?: any) => def };
  const svc = new TableSourceService(db as any, perms as any, mcp as any, config as any);
  return { svc, db, perms, mcp };
}

describe('TableSourceService.buildSelectAllQuery — per-connector dialects', () => {
  const { svc } = makeService();

  it('MySQL / Databricks use backticks + LIMIT', () => {
    expect(svc.buildSelectAllQuery(ConnectorType.MYSQL, 'shop', 'orders', 10)).toBe('SELECT * FROM `shop`.`orders` LIMIT 10');
    expect(svc.buildSelectAllQuery(ConnectorType.DATABRICKS, null, 'events', 5)).toBe('SELECT * FROM `events` LIMIT 5');
  });

  it('Postgres / Redshift / Snowflake / Oracle use double quotes', () => {
    expect(svc.buildSelectAllQuery(ConnectorType.POSTGRES, 'public', 'users', 10)).toBe('SELECT * FROM "public"."users" LIMIT 10');
    expect(svc.buildSelectAllQuery(ConnectorType.REDSHIFT, 'public', 'sales', 10)).toBe('SELECT * FROM "public"."sales" LIMIT 10');
    expect(svc.buildSelectAllQuery(ConnectorType.SNOWFLAKE, 'ANALYTICS', 'FACT', 10)).toBe('SELECT * FROM "ANALYTICS"."FACT" LIMIT 10');
  });

  it('Oracle limits with FETCH FIRST … ROWS ONLY', () => {
    expect(svc.buildSelectAllQuery(ConnectorType.ORACLE, 'HR', 'EMP', 10)).toBe('SELECT * FROM "HR"."EMP" FETCH FIRST 10 ROWS ONLY');
  });

  it('MSSQL uses TOP + bracket quoting', () => {
    expect(svc.buildSelectAllQuery(ConnectorType.MSSQL, 'dbo', 'Orders', 10)).toBe('SELECT TOP 10 * FROM [dbo].[Orders]');
  });

  it('BigQuery wraps dataset.table in a single backtick pair', () => {
    expect(svc.buildSelectAllQuery(ConnectorType.BIGQUERY, 'analytics', 'events', 10)).toBe('SELECT * FROM `analytics.events` LIMIT 10');
  });

  it('escapes the quote character to prevent identifier breakout', () => {
    expect(svc.buildSelectAllQuery(ConnectorType.MYSQL, null, 'we`ird', 10)).toBe('SELECT * FROM `we``ird` LIMIT 10');
    expect(svc.buildSelectAllQuery(ConnectorType.POSTGRES, null, 'we"ird', 10)).toBe('SELECT * FROM "we""ird" LIMIT 10');
    expect(svc.buildSelectAllQuery(ConnectorType.MSSQL, null, 'we]ird', 10)).toBe('SELECT TOP 10 * FROM [we]]ird]');
  });
});

describe('TableSourceService.previewTable', () => {
  it('validates the table, checks view permission, and previews 10 rows', async () => {
    const queryMany = jest.fn().mockResolvedValue([{ schema_name: 'public', table_name: 'orders' }]);
    const queryOne = jest.fn().mockResolvedValue({
      id: 'c1', connector_type: 'postgres', host: 'h', port: 5432,
      username: 'u', encrypted_password: 'enc', database_name: 'db',
    });
    const mcp = {
      createSession: jest.fn().mockResolvedValue({ sessionId: 'sess-1' }),
      executeReadQuery: jest.fn().mockResolvedValue({ success: true, data: { rows: [{ id: 1 }], columns: ['id'], rowCount: 1 } }),
      destroySession: jest.fn().mockResolvedValue(undefined),
    };
    const { svc, perms } = makeService({ queryMany, queryOne, mcp });

    const res = await svc.previewTable('c1', USER, 'orders', null);

    expect(perms.requireAction).toHaveBeenCalledWith('c1', 'user-1', 'view');
    // preview runs the LIMIT-10 query; source query is capped at the row limit (default 500)
    expect(res.previewSql).toBe('SELECT * FROM "public"."orders" LIMIT 10');
    expect(res.sourceSql).toBe('SELECT * FROM "public"."orders" LIMIT 500');
    expect(mcp.executeReadQuery).toHaveBeenCalledWith('sess-1', 'SELECT * FROM "public"."orders" LIMIT 10');
    expect(res.rows).toEqual([{ id: 1 }]);
    expect(mcp.destroySession).toHaveBeenCalledWith('sess-1'); // session always torn down
  });

  it('rejects a table that is not in the introspected metadata (injection-safe)', async () => {
    const queryMany = jest.fn().mockResolvedValue([]); // no metadata match
    const { svc, mcp } = makeService({ queryMany });

    await expect(svc.previewTable('c1', USER, 'orders; DROP TABLE users', null))
      .rejects.toBeInstanceOf(NotFoundException);
    // never opened a datasource session for an unknown/foreign identifier
    expect(mcp.createSession).not.toHaveBeenCalled();
  });

  it('tears the session down even when the preview query fails', async () => {
    const queryMany = jest.fn().mockResolvedValue([{ schema_name: 'public', table_name: 'orders' }]);
    const queryOne = jest.fn().mockResolvedValue({ id: 'c1', connector_type: 'postgres', encrypted_password: 'enc' });
    const mcp = {
      createSession: jest.fn().mockResolvedValue({ sessionId: 'sess-1' }),
      executeReadQuery: jest.fn().mockResolvedValue({ success: false, error: 'boom' }),
      destroySession: jest.fn().mockResolvedValue(undefined),
    };
    const { svc } = makeService({ queryMany, queryOne, mcp });

    await expect(svc.previewTable('c1', USER, 'orders', null)).rejects.toThrow(/boom/);
    expect(mcp.destroySession).toHaveBeenCalledWith('sess-1');
  });
});
