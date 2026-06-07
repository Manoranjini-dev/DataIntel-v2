// ──────────────────────────────────────────────
// Combo Executor — Parallel sub-query execution
// Runs each step against its MCP session concurrently
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MCPService } from '../mcp/mcp.service';
import { DatabaseService } from '../database/database.service';
import { decrypt } from '../common/utils/encryption';
import { ComboQueryPlan, StepResult } from './combo.types';
import { ConnectorType } from '../common/types';

const MAX_ROWS_PER_STEP = 10_000;

@Injectable()
export class ComboExecutorService {
  private readonly logger = new Logger(ComboExecutorService.name);
  private readonly encKey: string;

  constructor(
    private readonly mcpService: MCPService,
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {
    this.encKey = this.config.getOrThrow('CREDENTIAL_ENCRYPTION_KEY');
  }

  /**
   * Execute all steps in the plan concurrently.
   * Uses Promise.allSettled — a failure in one step doesn't cancel the others.
   */
  async executeAll(plan: ComboQueryPlan): Promise<StepResult[]> {
    this.logger.log(`Executing ${plan.steps.length} sub-queries in parallel`);

    const promises = plan.steps.map(step => this.executeStep(step));
    const settled = await Promise.allSettled(promises);

    return settled.map((result, i) => {
      const step = plan.steps[i];
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        this.logger.error(`Step ${step.alias} failed: ${result.reason?.message}`);
        return {
          step,
          rows: [],
          columns: [],
          rowCount: 0,
          executionTimeMs: 0,
          status: 'failed' as const,
          error: result.reason?.message || 'Unknown error',
        };
      }
    });
  }

  private async executeStep(step: any): Promise<StepResult> {
    const start = Date.now();

    // Load connection credentials from DB
    const conn = await this.db.queryOne<any>(
      'SELECT * FROM datasource_connections WHERE id = $1',
      [step.connectionId],
    );

    if (!conn) {
      throw new Error(`Connection ${step.connectionId} not found`);
    }

    const password = decrypt(conn.encrypted_password, this.encKey);

    // Create a temporary MCP session for this step
    const session = await this.mcpService.createSession({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password,
      database: conn.database_name,
      connectorType: conn.connector_type as ConnectorType,
    });

    try {
      const result = await this.mcpService.executeReadQuery(session.sessionId, step.query);

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Query execution failed');
      }

      const rows = result.data.rows?.slice(0, MAX_ROWS_PER_STEP) || [];
      const columns = result.data.columns || [];

      return {
        step,
        rows,
        columns,
        rowCount: rows.length,
        executionTimeMs: Date.now() - start,
        status: 'success',
      };
    } finally {
      // Always clean up the session
      await this.mcpService.destroySession(session.sessionId).catch(() => {});
    }
  }
}
