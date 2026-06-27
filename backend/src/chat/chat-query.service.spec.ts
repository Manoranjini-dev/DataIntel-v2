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
  let llmService: { generateSQL: jest.Mock; interpretResults: jest.Mock };
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
});
