// ──────────────────────────────────────────────
// BaseMCPConnector.connectWithRetry — transient cold-connect recovery
// Reproduces the reported root cause: a cold connect to managed MySQL/Postgres
// intermittently times out (ETIMEDOUT) on the first attempt, then succeeds.
// The retry must recover instead of failing the whole request.
// ──────────────────────────────────────────────

import { BaseMCPConnector } from './base.connector';
import { ConnectorType, ConnectorCapabilities } from '../../common/types';

// Concrete subclass exposing the protected helpers for direct testing.
class TestConnector extends BaseMCPConnector {
  readonly connectorType = ConnectorType.MYSQL;
  constructor() { super('TestConnector'); }
  testConnection() { return Promise.resolve({ success: true, executionTimeMs: 0 }); }
  describeSchema() { return Promise.resolve({ success: true, executionTimeMs: 0 } as any); }
  executeReadQuery() { return Promise.resolve({ success: true, executionTimeMs: 0 } as any); }
  getCapabilities(): ConnectorCapabilities {
    return { readOnly: true, supportsTransactions: false, supportsSchemaIntrospection: true, maxResultRows: 500, supportedOperations: ['SELECT'] };
  }
  dispose() { return Promise.resolve(); }
  // Expose protected helpers.
  retry<T>(fn: () => Promise<T>) { return this.connectWithRetry(fn, 'test', 3, 1); }
}

const etimedout = () => Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });

describe('connectWithRetry', () => {
  it('recovers when the first (cold) connect times out and the retry succeeds', async () => {
    const c = new TestConnector();
    let attempts = 0;
    const factory = jest.fn(async () => {
      attempts++;
      if (attempts === 1) throw etimedout(); // cold connect times out
      return 'connected';                     // retry succeeds
    });
    await expect(c.retry(factory)).resolves.toBe('connected');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('gives up after all attempts on a persistent transient failure', async () => {
    const c = new TestConnector();
    const factory = jest.fn(async () => { throw etimedout(); });
    await expect(c.retry(factory)).rejects.toThrow(/ETIMEDOUT/);
    expect(factory).toHaveBeenCalledTimes(3); // attempts exhausted
  });

  it('does NOT retry a non-transient error (e.g. bad credentials)', async () => {
    const c = new TestConnector();
    const factory = jest.fn(async () => { throw Object.assign(new Error('Access denied for user'), { code: 'ER_ACCESS_DENIED_ERROR' }); });
    await expect(c.retry(factory)).rejects.toThrow(/Access denied/);
    expect(factory).toHaveBeenCalledTimes(1); // fail fast — no wasted retries
  });

  it('classifies transient vs permanent errors', () => {
    const c = new TestConnector();
    expect((c as any).isTransientConnectError({ code: 'ETIMEDOUT' })).toBe(true);
    expect((c as any).isTransientConnectError({ code: 'ECONNRESET' })).toBe(true);
    expect((c as any).isTransientConnectError({ message: 'connect ECONNREFUSED 1.2.3.4:3306' })).toBe(true);
    expect((c as any).isTransientConnectError({ code: 'ER_ACCESS_DENIED_ERROR' })).toBe(false);
    expect((c as any).isTransientConnectError({ code: 'ENOTFOUND' })).toBe(false);
  });
});
