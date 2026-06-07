// ──────────────────────────────────────────────
// Query Orchestration Service
// ──────────────────────────────────────────────

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { LLMService } from '../llm/llm.service';
import { ComboService } from '../combo/combo.service';
import { QueryApprovalService } from './query-approval.service';
import { SafeAccount } from '../auth/auth.service';
import { MCPService } from '../mcp/mcp.service';
import { ConnectorType } from '../common/types';
import { decrypt } from '../common/utils/encryption';

@Injectable()
export class QueryOrchestrationService {
  private readonly logger = new Logger(QueryOrchestrationService.name);

  private readonly encKey: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly llm: LLMService,
    private readonly comboService: ComboService,
    private readonly approvalService: QueryApprovalService,
    private readonly mcp: MCPService,
    private readonly config: ConfigService,
  ) {
    this.encKey = this.config.getOrThrow('CREDENTIAL_ENCRYPTION_KEY');
  }

  /**
   * Orchestrates the full query execution pipeline for both Connections and Combos.
   * 
   * Flow:
   * 1. Validate permissions
   * 2. Gather schema context
   * 3. AI Generation (SQL/DSL)
   * 4. Check approval workflow
   * 5. If approved/auto-approve: Execute
   * 6. Log execution and return results
   */
  async orchestrateQuery(orgId: string, contextType: 'connection' | 'combo', contextId: string, requester: SafeAccount, prompt: string) {
    // 1. Save execution record (init)
    const execution = await this.db.queryOne(
      `INSERT INTO query_executions 
         (org_id, datasource_context_type, datasource_context_id, account_id, prompt, status)
       VALUES ($1, $2, $3, $4, $5, 'planning')
       RETURNING *`,
      [orgId, contextType, contextId, requester.id, prompt]
    );

    try {
      if (contextType === 'combo') {
        // Handle Federated Query
        return await this.handleComboQuery(orgId, contextId, execution!.id, requester, prompt);
      } else {
        // Handle Single Connection Query
        return await this.handleConnectionQuery(orgId, contextId, execution!.id, requester, prompt);
      }
    } catch (e: any) {
      this.logger.error(`Execution failed for ${execution!.id}`, e.stack);
      await this.db.query(`UPDATE query_executions SET status = 'failed', error = $2 WHERE id = $1`, [execution!.id, e.message]);
      throw e;
    }
  }

  private async handleComboQuery(orgId: string, comboId: string, execId: string, requester: SafeAccount, prompt: string) {
    // Check approval
    const requiresApproval = await this.approvalService.requiresApproval(orgId);
    
    if (requiresApproval) {
      // Actually, for combos, generating the federated query plan is done via ComboService
      // For now, we will generate the plan first, then ask for approval.
    }

    // Call ComboService (which handles Schema merging, LLM generation, execution, and result merging)
    await this.db.query(`UPDATE query_executions SET status = 'running' WHERE id = $1`, [execId]);
    
    const result = await this.comboService.executeQuery(orgId, comboId, requester as any, prompt);

    await this.db.query(
      `UPDATE query_executions 
       SET status = 'completed', 
           generated_query = $2,
           execution_time_ms = $3,
           completed_at = NOW()
       WHERE id = $1`,
      [execId, JSON.stringify(result.plan), result.totalExecutionTimeMs]
    );

    return result;
  }

  private async handleConnectionQuery(orgId: string, connectionId: string, execId: string, requester: SafeAccount, prompt: string) {
    // 1. Fetch schema
    const schema = await this.db.queryOne<{ schema_json: any }>(
      `SELECT schema_json FROM connection_schemas WHERE connection_id = $1`,
      [connectionId]
    );

    if (!schema) {
      throw new BadRequestException('Schema not synced yet');
    }

    // 2. Generate SQL via LLM
    const llmResponse = await this.llm.generateSQL({} as any);

    let parsed;
    try {
      parsed = JSON.parse(llmResponse.sql /* patched */);
    } catch {
      throw new Error('LLM failed to generate valid JSON format');
    }

    const sql = parsed.sql;
    const tablesUsed = parsed.tablesUsed || [];

    await this.db.query(
      `UPDATE query_executions 
       SET generated_query = $2, tables_used = $3
       WHERE id = $1`,
      [execId, sql, tablesUsed]
    );

    // 3. Check Approval
    const requiresApproval = await this.approvalService.requiresApproval(orgId);
    if (requiresApproval) {
      await this.approvalService.requestApproval(orgId, execId, requester);
      await this.db.query(`UPDATE query_executions SET status = 'pending_approval' WHERE id = $1`, [execId]);
      return { status: 'pending_approval', executionId: execId, message: 'Query requires approval before execution', sql };
    }

    // 4. Execute Query via MCP
    await this.db.query(`UPDATE query_executions SET status = 'running' WHERE id = $1`, [execId]);

    const conn = await this.db.queryOne<any>(
      'SELECT * FROM datasource_connections WHERE id = $1',
      [connectionId],
    );
    if (!conn) throw new BadRequestException('Connection not found');

    const password = decrypt(conn.encrypted_password, this.encKey);
    const session = await this.mcp.createSession({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password,
      database: conn.database_name,
      connectorType: conn.connector_type as ConnectorType,
    });

    const start = Date.now();
    let rows: any[] = [];
    let columns: any[] = [];

    try {
      const mcpResult = await this.mcp.executeReadQuery(session.sessionId, sql);
      if (!mcpResult.success) {
        throw new Error(mcpResult.error || 'Query execution failed');
      }
      rows = mcpResult.data?.rows || [];
      columns = mcpResult.data?.columns || [];
    } finally {
      await this.mcp.destroySession(session.sessionId).catch(() => {});
    }

    const execTime = Date.now() - start;

    await this.db.query(
      `UPDATE query_executions
       SET status = 'completed', execution_time_ms = $2, completed_at = NOW()
       WHERE id = $1`,
      [execId, execTime],
    );

    return {
      status: 'success',
      executionId: execId,
      sql,
      tablesUsed,
      rows,
      columns,
      executionTimeMs: execTime,
    };
  }
}
