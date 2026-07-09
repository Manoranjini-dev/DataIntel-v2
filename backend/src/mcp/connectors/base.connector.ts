// ──────────────────────────────────────────────
// Base Connector — Abstract MCP Connector
// ──────────────────────────────────────────────

import { Logger } from '@nestjs/common';
import {
  ConnectionParams,
  ConnectorCapabilities,
  ConnectorType,
  SchemaMetadata,
} from '../../common/types';
import { IMCPConnector, MCPQueryResult, MCPToolResult } from '../types';

export abstract class BaseMCPConnector implements IMCPConnector {
  protected readonly logger: Logger;
  abstract readonly connectorType: ConnectorType;

  constructor(loggerContext: string) {
    this.logger = new Logger(loggerContext);
  }

  abstract testConnection(params: ConnectionParams): Promise<MCPToolResult<boolean>>;
  abstract describeSchema(params: ConnectionParams): Promise<MCPToolResult<SchemaMetadata>>;
  abstract executeReadQuery(
    params: ConnectionParams,
    sql: string,
    timeoutMs: number,
  ): Promise<MCPToolResult<MCPQueryResult>>;
  abstract getCapabilities(): ConnectorCapabilities;
  abstract dispose(): Promise<void>;

  /**
   * Establish a connection with bounded retries for TRANSIENT failures. Cloud
   * databases (Cloud SQL, RDS, …) frequently have a slow *first* connect
   * (TLS/proxy cold start) that trips the driver's connectTimeout — the next
   * attempt then succeeds in ~1s. Without this, a single cold-connect timeout
   * fails the whole request (observed: chat "Could not connect to the data
   * source" while the DB was healthy). Non-transient errors (bad password,
   * unknown host) are re-thrown immediately — retrying them is pointless.
   */
  protected async connectWithRetry<T>(
    factory: () => Promise<T>,
    label = 'connect',
    attempts = 4,
    backoffMs = 500,
  ): Promise<T> {
    let lastErr: any;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await factory();
      } catch (err: any) {
        lastErr = err;
        if (!this.isTransientConnectError(err) || attempt === attempts) break;
        this.logger.warn(
          `${label} attempt ${attempt}/${attempts} failed (${err?.code || err?.message}); retrying in ${backoffMs}ms`,
        );
        await new Promise((r) => setTimeout(r, backoffMs * attempt));
      }
    }
    throw lastErr;
  }

  /** Whether a connection error is worth retrying (timeouts / resets / refusals). */
  protected isTransientConnectError(err: any): boolean {
    const code = String(err?.code || '').toUpperCase();
    const msg = String(err?.message || '').toUpperCase();
    const TRANSIENT = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'PROTOCOL_CONNECTION_LOST', 'EHOSTUNREACH', 'ENETUNREACH'];
    return TRANSIENT.some((t) => code.includes(t) || msg.includes(t));
  }

  /** Measure execution time of an async operation */
  protected async withTiming<T>(
    operation: () => Promise<T>,
  ): Promise<{ result: T; executionTimeMs: number }> {
    const start = performance.now();
    const result = await operation();
    const executionTimeMs = Math.round(performance.now() - start);
    return { result, executionTimeMs };
  }

  /** Wrap operation in MCPToolResult */
  protected async executeWithResult<T>(
    operation: () => Promise<T>,
  ): Promise<MCPToolResult<T>> {
    try {
      const { result, executionTimeMs } = await this.withTiming(operation);
      return { success: true, data: result, executionTimeMs };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown connector error';
      this.logger.error(`Connector operation failed: ${message}`);
      return { success: false, error: message, executionTimeMs: 0 };
    }
  }
}
