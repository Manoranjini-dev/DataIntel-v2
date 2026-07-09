// ──────────────────────────────────────────────
// WidgetExecutionService — DS-02 direct-SQL (table source) execution
// Verifies the discriminator logic and that a table/SQL-sourced widget runs its
// stored SQL directly, bypassing the LLM.
// ──────────────────────────────────────────────

// Stub credential decryption (covered by its own tests) so mock connection
// rows don't need real ciphertext.
jest.mock('../common/utils/encryption', () => ({
  decrypt: () => 'secret-pw',
  encrypt: (x: string) => x,
}));

import { WidgetExecutionService } from './widget-execution.service';

function makeService(mcpExec?: jest.Mock, llmGen?: jest.Mock) {
  const cache = {
    getCachedWidgetResult: jest.fn().mockResolvedValue(null),
    setCachedWidgetResult: jest.fn().mockResolvedValue(undefined),
    acquireWidgetExecutionLock: jest.fn().mockResolvedValue(true),
    releaseWidgetExecutionLock: jest.fn().mockResolvedValue(undefined),
  };
  const mcp = {
    createSession: jest.fn().mockResolvedValue({ sessionId: 'sess-1' }),
    executeReadQuery: mcpExec ?? jest.fn().mockResolvedValue({ success: true, data: { rows: [{ id: 1 }], columns: ['id'] } }),
    destroySession: jest.fn().mockResolvedValue(undefined),
  };
  const llm = { generateSQL: llmGen ?? jest.fn() };
  const db = { queryOne: jest.fn(), queryMany: jest.fn(), query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
  const audit = { log: jest.fn() };
  const config = { getOrThrow: () => 'key', get: (_k: string, d?: any) => d };
  const svc = new WidgetExecutionService(
    db as any, audit as any, cache as any, mcp as any, llm as any,
    {} as any, config as any, {} as any,
  );
  return { svc, db, mcp, llm, cache };
}

describe('WidgetExecutionService.resolveWidgetSql (DS-02 discriminator)', () => {
  const { svc } = makeService();
  const call = (qd: any) => (svc as any).resolveWidgetSql({ query_definition: qd });

  it('returns SQL for a table source', () => {
    expect(call({ sourceType: 'table', sql: 'SELECT * FROM t LIMIT 500', prompt: '' })).toBe('SELECT * FROM t LIMIT 500');
  });
  it('returns SQL for an explicit sql mode', () => {
    expect(call({ mode: 'sql', sql: 'SELECT 1' })).toBe('SELECT 1');
  });
  it('returns SQL for a legacy SQL-only widget (sql but no prompt)', () => {
    expect(call({ sql: 'SELECT 1' })).toBe('SELECT 1');
  });
  it('yields to the prompt path when a real prompt exists (no regression)', () => {
    expect(call({ sql: 'SELECT 1', prompt: 'top customers' })).toBe('');
  });
  it('parses a stringified query_definition', () => {
    expect(call(JSON.stringify({ sourceType: 'table', sql: 'SELECT 2' }))).toBe('SELECT 2');
  });
  it('returns empty when there is no SQL', () => {
    expect(call({ prompt: 'hello' })).toBe('');
  });
});

describe('WidgetExecutionService.executeSync — table-source direct execution', () => {
  const widgetRow = {
    id: 'w1', page_id: 'p1', dash_id: 'd1',
    dash_context_type: 'connection', dash_context_id: 'c1',
    datasource_context_type: 'connection', datasource_context_id: 'c1',
    card_id: null, cache_ttl_sec: 300,
    query_definition: { sourceType: 'table', sql: 'SELECT * FROM `shop`.`orders` LIMIT 500' },
  };

  it('runs the stored SQL directly and never calls the LLM', async () => {
    const mcpExec = jest.fn().mockResolvedValue({ success: true, data: { rows: [{ id: 1 }, { id: 2 }], columns: ['id'] } });
    const llmGen = jest.fn();
    const { svc, db, mcp } = makeService(mcpExec, llmGen);

    db.queryOne
      .mockResolvedValueOnce(widgetRow)                              // widget fetch
      .mockResolvedValueOnce({ id: 'exec-1' })                       // exec record insert
      .mockResolvedValueOnce({ id: 'c1', host: 'h', port: 3306, username: 'u', encrypted_password: 'enc', database_name: 'db', connector_type: 'mysql' }); // connection

    const res = await svc.executeSync('w1', { id: 'user-1' } as any, true);

    expect(mcp.executeReadQuery).toHaveBeenCalledWith('sess-1', 'SELECT * FROM `shop`.`orders` LIMIT 500');
    expect(llmGen).not.toHaveBeenCalled();                          // LLM bypassed
    expect(res.rows).toHaveLength(2);
    expect(mcp.destroySession).toHaveBeenCalledWith('sess-1');
  });
});
