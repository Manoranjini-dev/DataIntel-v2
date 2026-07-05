// ──────────────────────────────────────────────
// MCP Toolbox — Client Service
// Thin HTTP client over the Toolbox sidecar's REST API.
//   POST /api/tool/{name}/invoke   body: { sql }   -> { result: "<json>" }
// Uses the stable HTTP contract (global fetch) rather than the SDK.
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MCPQueryResult } from '../types';
import { executeSqlToolName } from './toolbox.constants';
import {
  ToolboxInvokeResponse,
  normalizeToolboxResult,
} from './toolbox-result.normalizer';

@Injectable()
export class ToolboxClientService {
  private readonly logger = new Logger(ToolboxClientService.name);

  private readonly baseUrl: string;
  private readonly statementTimeoutMs: number;
  private readonly maxRows: number;
  private readonly healthTtlMs: number;

  /** Cached health probe result to keep the routing guard cheap. */
  private healthCache: { healthy: boolean; checkedAt: number } | null = null;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (this.config.get<string>('TOOLBOX_URL') ?? 'http://toolbox:5000').replace(/\/+$/, '');
    this.statementTimeoutMs = this.config.get<number>('TOOLBOX_STATEMENT_TIMEOUT_MS') ?? 30000;
    this.maxRows = this.config.get<number>('TOOLBOX_MAX_ROWS') ?? 500;
    this.healthTtlMs = this.config.get<number>('TOOLBOX_HEALTH_TTL_MS') ?? 5000;
  }

  /** Invoke the execute-sql tool bound to a connection's source key. */
  async invokeExecuteSql(sourceKey: string, sql: string): Promise<MCPQueryResult> {
    const toolName = executeSqlToolName(sourceKey);
    const url = `${this.baseUrl}/api/tool/${encodeURIComponent(toolName)}/invoke`;
    const started = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.statementTimeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Toolbox invoke failed (${res.status}): ${text.slice(0, 300)}`);
      }

      const payload = (await res.json()) as ToolboxInvokeResponse;
      return normalizeToolboxResult(payload, Date.now() - started, this.maxRows);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(`Toolbox query timed out after ${this.statementTimeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Cheap, cached liveness probe used by the routing guard. Any HTTP response
   * from the sidecar counts as healthy; a network error / timeout does not.
   */
  async isHealthy(): Promise<boolean> {
    const now = Date.now();
    if (this.healthCache && now - this.healthCache.checkedAt < this.healthTtlMs) {
      return this.healthCache.healthy;
    }
    const healthy = await this.probe();
    this.healthCache = { healthy, checkedAt: now };
    return healthy;
  }

  /** Force a fresh probe (used at startup bootstrap). */
  async probe(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(this.baseUrl, { method: 'GET', signal: controller.signal });
      // Server reachable (even a 404 means the process is up and serving).
      return res.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Invalidate the cached health result (e.g. after a known outage). */
  resetHealthCache(): void {
    this.healthCache = null;
  }
}
