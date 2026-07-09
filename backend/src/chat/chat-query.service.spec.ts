// ──────────────────────────────────────────────
// ChatQueryService unit tests — SQL validation wiring
// ──────────────────────────────────────────────

import { BadRequestException } from '@nestjs/common';
import { ChatQueryService } from './chat-query.service';
import { encrypt } from '../common/utils/encryption';
import type { SafeAccount } from '../auth/auth.service';

const ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function makeUser(): SafeAccount {
  return {
    id: 'user-1', email: 'user@company.com', displayName: 'User', avatarUrl: null,
    role: 'ANALYST', status: 'ACTIVE', isActive: true, emailVerified: true,
    lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('ChatQueryService — SQL validation wiring', () => {
  let service: ChatQueryService;
  let db: { queryOne: jest.Mock; queryMany: jest.Mock; query: jest.Mock };
  let audit: { log: jest.Mock };
  let mcpService: { createSession: jest.Mock; executeReadQuery: jest.Mock; destroySession: jest.Mock };
  let llmService: { generateSQL: jest.Mock; interpretResults: jest.Mock; generateStarterQuestions: jest.Mock };
  let promptBuilder: { assembleContext: jest.Mock };
  let chatService: { get: jest.Mock; addMessage: jest.Mock };
  let config: { getOrThrow: jest.Mock };
  let validationService: { validate: jest.Mock; extractTablesFromSQL: jest.Mock };

  const chatId = 'chat-1';
  const connId = 'conn-1';

  const schemaTableRow = { table_name: 'orders', columns: 'id integer PK, total numeric' };
  const schemaGraphRow = {
    table_name: 'orders', column_name: 'id', data_type: 'integer',
    is_nullable: false, is_primary_key: true, is_foreign_key: false,
    fk_ref_table: null, fk_ref_column: null, default_value: null,
  };

  beforeEach(() => {
    db = {
      queryOne: jest.fn(),
      queryMany: jest.fn(),
      query: jest.fn().mockResolvedValue({ rowCount: 1 }),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    mcpService = {
      createSession: jest.fn().mockResolvedValue({ sessionId: 'sess-1' }),
      executeReadQuery: jest.fn().mockResolvedValue({
        success: true,
        data: { rows: [{ id: 1 }], columns: ['id'], rowCount: 1 },
      }),
      destroySession: jest.fn().mockResolvedValue(undefined),
    };
    llmService = {
      generateSQL: jest.fn(),
      interpretResults: jest.fn().mockResolvedValue('1 row found.'),
      generateStarterQuestions: jest.fn().mockResolvedValue([]),
    };
    promptBuilder = {
      assembleContext: jest.fn().mockImplementation((params) => ({ systemPrompt: 'sys', ...params })),
    };
    chatService = {
      get: jest.fn().mockResolvedValue({ id: chatId, connection_id: connId }),
      addMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    config = { getOrThrow: jest.fn().mockReturnValue(ENC_KEY) };
    validationService = {
      validate: jest.fn(),
      extractTablesFromSQL: jest.fn().mockReturnValue(['orders']),
    };

    service = new ChatQueryService(
      db as any, audit as any, mcpService as any, llmService as any,
      promptBuilder as any, chatService as any, config as any, validationService as any,
    );

    // Connection row lookup + schema queries (buildSchemaContext, buildSchemaGraph)
    db.queryOne.mockImplementation((sql: string) => {
      if (sql.includes('FROM datasource_connections')) {
        return Promise.resolve({
          id: connId, connector_type: 'postgres', host: 'h', port: 5432,
          username: 'u', encrypted_password: encrypt('pw', ENC_KEY), database_name: 'd',
        });
      }
      if (sql.includes('INSERT INTO query_executions')) {
        return Promise.resolve({ id: 'exec-1' });
      }
      return Promise.resolve(null);
    });
    db.queryMany.mockImplementation((sql: string) => {
      if (sql.includes('string_agg')) return Promise.resolve([schemaTableRow]); // buildSchemaContext
      if (sql.includes('cc.fk_ref_table')) return Promise.resolve([schemaGraphRow]); // buildSchemaGraph
      return Promise.resolve([]); // recentMessages
    });
  });

  it('rejects an empty prompt before calling the LLM', async () => {
    await expect(service.query(chatId, makeUser(), '   ')).rejects.toThrow(BadRequestException);
    expect(llmService.generateSQL).not.toHaveBeenCalled();
  });

  it('auto-retries with validation feedback and executes the corrected SQL on success', async () => {
    llmService.generateSQL
      .mockResolvedValueOnce({ sql: 'SELECT * FROM missing_table', explanation: 'e', tables_used: ['missing_table'], confidence: 0.9 })
      .mockResolvedValueOnce({ sql: 'SELECT id FROM orders LIMIT 500', explanation: 'fixed', tables_used: ['orders'], confidence: 0.95 });

    validationService.validate
      .mockReturnValueOnce({ verdict: 'REJECT', sql: 'SELECT * FROM missing_table', reasons: ['Tables not found in schema: missing_table'], rulesChecked: [] })
      .mockReturnValueOnce({ verdict: 'ACCEPT', sql: 'SELECT id FROM orders LIMIT 500', reasons: [], rulesChecked: [] });

    const result = await service.query(chatId, makeUser(), 'show orders');

    expect(llmService.generateSQL).toHaveBeenCalledTimes(2);
    const retryCallArg = llmService.generateSQL.mock.calls[1][0];
    expect(retryCallArg.validationFeedback).toContain('missing_table');
    expect(mcpService.executeReadQuery).toHaveBeenCalledWith('sess-1', 'SELECT id FROM orders LIMIT 500');
    expect(result.execution.status ?? 'success').not.toBe('failed');
  });

  it('never executes SQL and returns a clear error when validation rejects on both attempts', async () => {
    llmService.generateSQL.mockResolvedValue({
      sql: 'SELECT * FROM missing_table', explanation: 'e', tables_used: ['missing_table'], confidence: 0.9,
    });
    validationService.validate.mockReturnValue({
      verdict: 'REJECT', sql: 'SELECT * FROM missing_table',
      reasons: ['Tables not found in schema: missing_table'], rulesChecked: [],
    });

    const result = await service.query(chatId, makeUser(), 'show orders');

    expect(mcpService.executeReadQuery).not.toHaveBeenCalled();
    expect(result.execution.status).toBe('failed');
    expect(result.execution.error_message).toMatch(/didn't pass validation/i);
    expect(result.execution.error_message).not.toContain('validation_rejected:');
  });

  it('skips AST validation entirely for non-SQL connector families (Elasticsearch)', async () => {
    db.queryOne.mockImplementation((sql: string) => {
      if (sql.includes('FROM datasource_connections')) {
        return Promise.resolve({
          id: connId, connector_type: 'elasticsearch', host: 'h', port: 9200,
          username: 'u', encrypted_password: encrypt('pw', ENC_KEY), database_name: 'd',
        });
      }
      if (sql.includes('INSERT INTO query_executions')) {
        return Promise.resolve({ id: 'exec-1' });
      }
      return Promise.resolve(null);
    });
    llmService.generateSQL.mockResolvedValue({
      sql: '{"query":{"match_all":{}}}', explanation: 'e', tables_used: ['my-index'], confidence: 0.9,
    });

    await service.query(chatId, makeUser(), 'search everything');

    expect(validationService.validate).not.toHaveBeenCalled();
    expect(mcpService.executeReadQuery).toHaveBeenCalledWith('sess-1', '{"query":{"match_all":{}}}');
  });

  // ── Conversational suggestions (Parts 1-3) ───────────────────────
  describe('suggestions & row_counts', () => {
    beforeEach(() => { (ChatQueryService as any).starterCache.clear(); });

    it('buildFollowUps dedups the current + previously-asked questions and pads to 4 unique', () => {
      const out = (service as any).buildFollowUps(
        ['Show sales by month', 'How many orders?', 'Show sales by month'], // one dup
        'How many orders?',                                                  // current → excluded
        [{ role: 'user', content: 'Show sales by month' }],                  // already asked → excluded
        { columns: ['region', 'total'] },
        'postgres',
      );
      expect(out).toHaveLength(4);
      expect(new Set(out.map((q: string) => q.toLowerCase())).size).toBe(4); // unique
      expect(out).not.toContain('How many orders?');
      expect(out.some((q: string) => /sales by month/i.test(q))).toBe(false); // asked one dropped
      expect(out).toContain('Break this down by region'); // result-column-aware pad
    });

    it('quoteIdent quotes/escapes per SQL dialect', () => {
      expect((service as any).quoteIdent('mysql', 'we`ird')).toBe('`we``ird`');
      expect((service as any).quoteIdent('postgres', 'we"ird')).toBe('"we""ird"');
      expect((service as any).quoteIdent('mssql', 'we]ird')).toBe('[we]]ird]');
    });

    it('countRowsPerTable runs ONE UNION ALL and returns counts sorted desc', async () => {
      mcpService.executeReadQuery.mockResolvedValueOnce({
        success: true, data: { rows: [{ table_name: 'a', records: 5 }, { table_name: 'b', records: 20 }] },
      });
      const conn = { connector_type: 'mysql', host: 'h', port: 3306, username: 'u', encrypted_password: encrypt('pw', ENC_KEY), database_name: 'd' };
      const rows = await (service as any).countRowsPerTable(conn, ['a', 'b']);

      const sql = mcpService.executeReadQuery.mock.calls[0][1];
      expect(sql).toContain('UNION ALL');
      expect(sql).toContain('`a`');
      expect(sql).toContain('`b`');
      expect(rows).toEqual([{ table_name: 'b', records: 20 }, { table_name: 'a', records: 5 }]);
      expect(mcpService.destroySession).toHaveBeenCalledWith('sess-1');
    });

    it('generateStarterQuestions returns LLM questions and caches them', async () => {
      llmService.generateStarterQuestions = jest.fn().mockResolvedValue(['q1', 'q2', 'q3', 'q4']);
      const res = await service.generateStarterQuestions(connId, makeUser());
      expect(res).toEqual(['q1', 'q2', 'q3', 'q4']);
      // second call is served from cache — LLM not called again
      await service.generateStarterQuestions(connId, makeUser());
      expect(llmService.generateStarterQuestions).toHaveBeenCalledTimes(1);
    });

    it('generateStarterQuestions falls back WITHOUT caching when the LLM under-delivers', async () => {
      llmService.generateStarterQuestions = jest.fn().mockResolvedValue([]); // failure → empty
      const res = await service.generateStarterQuestions(connId, makeUser());
      expect(res.length).toBe(4); // generic fallback
      await service.generateStarterQuestions(connId, makeUser()); // retries the LLM (not cached)
      expect(llmService.generateStarterQuestions).toHaveBeenCalledTimes(2);
    });

    describe('Task 9: Failure and exception resilience (No HTTP 500s)', () => {
      it('handles unhandled LLM timeout/error during query generation without throwing (returns structured failure)', async () => {
        llmService.generateSQL = jest.fn().mockRejectedValue(new Error('LLM request timeout'));
        const res = await service.query(chatId, makeUser(), 'show top doctors');
        expect(res.success).toBe(false);
        expect(res.message).toBe('Unable to generate an answer for this query.');
        expect(res.reason).toBe('LLM request timeout');
        expect((res.suggestions || []).length).toBeGreaterThan(0);
        expect(res.execution.status).toBe('failed');
      });

      it('handles pre-flight database error cleanly and returns structured failure response', async () => {
        chatService.addMessage = jest.fn().mockRejectedValue(new Error('connection pool exhaustion'));
        const res = await service.query(chatId, makeUser(), 'show patients');
        expect(res.success).toBe(false);
        expect(res.message).toBe('Unable to generate an answer for this query.');
        expect(res.execution.status).toBe('failed');
        expect(res.execution.error_message).toContain('connection pool exhaustion');
      });

      it('executeDraft returns structured failure when MCP session creation throws instead of unhandled error', async () => {
        mcpService.createSession = jest.fn().mockRejectedValue(new Error('connect ETIMEDOUT'));
        const res = await service.executeDraft(chatId, makeUser(), 'exec-1', 'SELECT * FROM test');
        expect(res.success).toBe(false);
        expect(res.status).toBe('failed');
        expect(res.error_message).toBe('connect ETIMEDOUT');
      });
    });
  });
});
