import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { MCPService } from '../mcp/mcp.service';
import { LLMService } from '../llm/llm.service';
import { PromptBuilderService } from '../llm/prompt-builder.service';
import { ChatService } from './chat.service';
import { SafeAccount } from '../auth/auth.service';
import { decrypt } from '../common/utils/encryption';
import { ConnectorType, ConnectorFamily } from '../common/types';

@Injectable()
export class ChatQueryService {
  private readonly logger = new Logger(ChatQueryService.name);
  private readonly encKey: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly mcpService: MCPService,
    private readonly llmService: LLMService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly chatService: ChatService,
    private readonly config: ConfigService,
  ) {
    this.encKey = this.config.getOrThrow('CREDENTIAL_ENCRYPTION_KEY');
  }

  /**
   * Execute an AI query in a chat:
   * 1. Load connection credentials
   * 2. Load schema context from normalized tables
   * 3. Build LLM context with chat history
   * 4. Generate SQL via LLM
   * 5. Execute via MCP
   * 6. Interpret results
   * 7. Persist to query_executions + chat_messages
   */
  async query(
    orgId: string,
    chatId: string,
    user: SafeAccount,
    prompt: string,
  ): Promise<{
    userMessage: any;
    assistantMessage: any;
    execution: any;
  }> {
    // Load chat
    const chat = await this.chatService.get(orgId, chatId, user.id) as any;

    if (!chat.connection_id) {
      throw new BadRequestException('This endpoint is for connection-scoped chats only.');
    }

    // Load connection
    const conn = await this.db.queryOne<any>(
      'SELECT * FROM datasource_connections WHERE id = $1',
      [chat.connection_id],
    );
    if (!conn) throw new BadRequestException('Connection not found');

    // Load conversation history BEFORE persisting the new user message so it is not
    // included in recentMessages (which would cause it to appear twice in the LLM
    // context: once from history, once from userPrompt — confusing the model).
    const recentMessages = await this.getRecentMessages(chatId, 10);

    // 1. Persist user message
    const userMsg = await this.chatService.addMessage(chatId, 'user', prompt);

    const start = Date.now();

    try {
      // 2. Build schema context from normalized tables
      const compressedSchema = await this.buildSchemaContext(conn.id);

      // Early-exit when schema is absent: avoids burning LLM retries on a query
      // that will always produce empty SQL — surface a clear error instead.
      if (compressedSchema.startsWith('-- No schema')) {
        throw new Error(
          'Could not generate a SQL query — the schema for this connection may not be synced yet. ' +
          'Please navigate to Connection Settings → Schema Sync and run a sync, then retry your question.',
        );
      }

      // 3. Generate SQL via LLM using proper LLMContext
      const connectorFamily = this.getConnectorFamily(conn.connector_type);
      const llmContext = this.promptBuilder.assembleContext({
        compressedSchema,
        conversationSummary: null,
        recentMessages,
        userPrompt: prompt,
        connectorFamily,
      });

      const llmResponse = await this.llmService.generateSQL(llmContext);

      // Guard: empty SQL after successful LLM parse (safety net)
      if (llmResponse.type !== 'schema_query' && llmResponse.type !== 'conversational' && !llmResponse.sql?.trim()) {
        throw new Error(
          'Could not generate a SQL query for your prompt. ' +
          'Please ensure your question relates to the available data and try refining your request.',
        );
      }

      let execResult: any = null;
      let execStatus = 'success';
      let execError: string | null = null;
      let insight = '';

      if (llmResponse.type === 'schema_query') {
        // 5a. Handle schema queries natively via our synced schema database
        // We fetch ALL tables to avoid truncating schema discovery.
        try {
          const tablesResult = await this.db.queryMany<any>(
            `SELECT ct.table_name, COUNT(cc.id)::int as column_count
             FROM connection_schemas cs
             JOIN connection_tables ct ON ct.schema_id = cs.id
             LEFT JOIN connection_columns cc ON cc.table_id = ct.id AND cc.deleted_at IS NULL
             WHERE cs.connection_id = $1 AND cs.deleted_at IS NULL AND ct.deleted_at IS NULL
             GROUP BY ct.table_name
             ORDER BY ct.table_name`,
            [conn.id],
          );

          const totalTables = tablesResult.length;
          console.log(`[DEBUG TRACE] Database Count: ${totalTables}`);
          execResult = {
            rows: tablesResult,
            columns: ['table_name', 'column_count'],
            rowCount: totalTables,
          };

          insight = `Showing all ${totalTables} tables available in the schema.`;
            
          llmResponse.explanation = insight;
          if (!llmResponse.ui_hint) llmResponse.ui_hint = 'data_table';

        } catch (err: any) {
          execStatus = 'failed';
          execError = err.message || 'Failed to fetch schema metadata';
        }

      } else if (llmResponse.type === 'conversational') {
        // 5b. Conversational response — no query execution
        insight = llmResponse.explanation;
        execResult = { rows: [], columns: [], rowCount: 0 };
        
      } else {
        // 5c. Execute data query via MCP (create temporary session)
        const password = decrypt(conn.encrypted_password, this.encKey);
        const session = await this.mcpService.createSession({
          host: conn.host,
          port: conn.port,
          username: conn.username,
          password,
          database: conn.database_name,
          connectorType: conn.connector_type as ConnectorType,
        });

        try {
          const mcpResult = await this.mcpService.executeReadQuery(session.sessionId, llmResponse.sql);
          if (!mcpResult.success) {
            execStatus = 'failed';
            execError = mcpResult.error || 'Query execution failed';
          } else {
            execResult = mcpResult.data;
          }
        } finally {
          await this.mcpService.destroySession(session.sessionId).catch(() => {});
        }

        // 6. Interpret results if it was a real query
        if (execStatus === 'success' && execResult) {
          insight = await this.llmService.interpretResults(
            prompt,
            llmResponse.sql,
            execResult.columns || [],
            execResult.rows || [],
            execResult.rowCount || 0,
            connectorFamily as any,
          ).catch(() => '');
        }
      }

      const execTimeMs = Date.now() - start;

      // 7. Persist query_executions
      const execRecord = await this.db.queryOne(
        `INSERT INTO query_executions
           (org_id, chat_id, message_id, connection_id, executed_by, prompt,
            generated_query, query_explanation, tables_used, confidence,
            status, execution_time_ms, row_count, result_preview, result_columns,
            error_message, insight, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
         RETURNING *`,
        [
          orgId, chatId, userMsg!.id, conn.id, user.id, prompt,
          llmResponse.sql, llmResponse.explanation,
          llmResponse.tables_used, llmResponse.confidence,
          execStatus, execTimeMs,
          execResult?.rowCount || 0,
          JSON.stringify(execResult?.rows?.slice(0, 5000) || []),
          execResult?.columns || [],
          execError,
          insight,
        ],
      );

      // Update user message with execution link
      await this.db.query(
        'UPDATE chat_messages SET execution_id = $2 WHERE id = $1',
        [userMsg!.id, execRecord!.id],
      );

      // 8. Persist assistant message
      const assistantContent = execStatus === 'success' && insight
        ? insight
        : execStatus === 'failed'
          ? `Query failed: ${execError}`
          : 'Query executed successfully.';

      const assistantMsg = await this.chatService.addMessage(
        chatId, 'assistant', assistantContent, execRecord!.id, llmResponse.ui_hint,
      );

      await this.audit.log({
        orgId, accountId: user.id,
        eventType: execStatus === 'success' ? 'query_executed' : 'query_failed',
        resourceType: 'connection', resourceId: conn.id,
        details: { chatId, execTimeMs, rowCount: execResult?.rowCount },
      });

      const apiResponse = {
        userMessage: userMsg,
        assistantMessage: assistantMsg,
        execution: {
          ...execRecord,
          rows: execResult?.rows || [],
          columns: execResult?.columns || [],
        },
      };
      console.log(`[DEBUG TRACE] API Count: ${apiResponse.execution.rows.length}`);
      return apiResponse;

    } catch (err: any) {
      this.logger.error(`Chat query failed: ${err.message}`);

      // Persist failure message
      const failMsg = await this.chatService.addMessage(
        chatId, 'assistant',
        `I encountered an error: ${err.message}`,
      );

      return {
        userMessage: userMsg,
        assistantMessage: failMsg,
        execution: { status: 'failed', error_message: err.message },
      };
    }
  }

  /**
   * Re-execute a (possibly user-edited) SQL query draft.
   * Updates the existing query_execution record and returns results.
   */
  async executeDraft(
    orgId: string,
    chatId: string,
    user: SafeAccount,
    executionId: string,
    sql: string,
  ): Promise<{ rows: any[]; columns: string[]; row_count: number; execution_time_ms: number; status: string }> {
    const chat = await this.chatService.get(orgId, chatId, user.id) as any;
    if (!chat.connection_id) throw new BadRequestException('Chat has no connection.');

    const conn = await this.db.queryOne<any>('SELECT * FROM datasource_connections WHERE id = $1', [chat.connection_id]);
    if (!conn) throw new BadRequestException('Connection not found');

    const password = decrypt(conn.encrypted_password, this.encKey);
    const session = await this.mcpService.createSession({
      host: conn.host, port: conn.port, username: conn.username, password,
      database: conn.database_name, connectorType: conn.connector_type as ConnectorType,
    });

    const start = Date.now();
    let rows: any[] = [], columns: string[] = [], rowCount = 0, status = 'success', error: string | null = null;
    try {
      const result = await this.mcpService.executeReadQuery(session.sessionId, sql);
      if (!result.success) { status = 'failed'; error = result.error || 'Query failed'; }
      else { rows = result.data?.rows || []; columns = result.data?.columns || []; rowCount = result.data?.rowCount || rows.length; }
    } finally {
      await this.mcpService.destroySession(session.sessionId).catch(() => {});
    }

    const execTimeMs = Date.now() - start;

    // Update execution record if it exists
    if (executionId) {
      await this.db.query(
        `UPDATE query_executions SET generated_query=$2, status=$3, execution_time_ms=$4,
         row_count=$5, result_preview=$6, result_columns=$7, error_message=$8, completed_at=NOW()
         WHERE id=$1`,
        [executionId, sql, status, execTimeMs, rowCount,
         JSON.stringify(rows.slice(0, 5000)), columns, error],
      ).catch(() => {});
    }

    if (status === 'failed') throw new Error(error || 'Query execution failed');
    return { rows, columns, row_count: rowCount, execution_time_ms: execTimeMs, status };
  }

  /**
   * Re-execute the stored SQL for a list of execution IDs against the live database.
   * Returns fresh rows for each execution WITHOUT persisting back to query_executions.
   * This powers "view always shows current data" without altering chat history.
   */
  async refreshMessages(
    orgId: string,
    chatId: string,
    user: SafeAccount,
    executionIds: string[],
  ): Promise<Array<{
    executionId: string;
    rows: any[];
    columns: string[];
    row_count: number;
    execution_time_ms: number;
    status: 'success' | 'failed';
    error?: string;
  }>> {
    const chat = await this.chatService.get(orgId, chatId, user.id) as any;
    if (!chat.connection_id) {
      // Combo or connectionless chats cannot be refreshed this way
      return [];
    }

    const conn = await this.db.queryOne<any>(
      'SELECT * FROM datasource_connections WHERE id = $1',
      [chat.connection_id],
    );
    if (!conn) return [];

    // Batch-fetch all execution records at once
    const execRecords = await this.db.queryMany<any>(
      `SELECT id, generated_query FROM query_executions
       WHERE id = ANY($1::uuid[]) AND connection_id = $2`,
      [executionIds, conn.id],
    );

    if (!execRecords.length) return [];

    const password = decrypt(conn.encrypted_password, this.encKey);

    const results = await Promise.all(
      execRecords.map(async (rec) => {
        const sql = rec.generated_query;
        if (!sql?.trim()) {
          return {
            executionId: rec.id,
            rows: [],
            columns: [],
            row_count: 0,
            execution_time_ms: 0,
            status: 'failed' as const,
            error: 'No SQL stored for this execution',
          };
        }

        let session: any;
        try {
          session = await this.mcpService.createSession({
            host: conn.host,
            port: conn.port,
            username: conn.username,
            password,
            database: conn.database_name,
            connectorType: conn.connector_type as ConnectorType,
          });

          const start = Date.now();
          const mcpResult = await this.mcpService.executeReadQuery(session.sessionId, sql);
          const execTimeMs = Date.now() - start;

          if (!mcpResult.success) {
            return {
              executionId: rec.id,
              rows: [],
              columns: [],
              row_count: 0,
              execution_time_ms: execTimeMs,
              status: 'failed' as const,
              error: mcpResult.error || 'Query failed',
            };
          }

          const rows = mcpResult.data?.rows || [];
          const columns = mcpResult.data?.columns || [];
          return {
            executionId: rec.id,
            rows,
            columns,
            row_count: rows.length,
            execution_time_ms: execTimeMs,
            status: 'success' as const,
          };
        } catch (err: any) {
          return {
            executionId: rec.id,
            rows: [],
            columns: [],
            row_count: 0,
            execution_time_ms: 0,
            status: 'failed' as const,
            error: err.message,
          };
        } finally {
          if (session) {
            await this.mcpService.destroySession(session.sessionId).catch(() => {});
          }
        }
      }),
    );

    return results;
  }

  /**
   * Re-execute stored sub-queries for a list of execution IDs for a COMBO chat.
   * Reads the sub_queries JSON from query_executions, re-runs each per-connection SQL,
   * then re-merges using the merge strategy from the stored plan (generated_query JSON).
   * Returns fresh merged rows WITHOUT persisting back.
   */
  async refreshComboMessages(
    orgId: string,
    chatId: string,
    user: SafeAccount,
    executionIds: string[],
  ): Promise<Array<{
    executionId: string;
    rows: any[];
    columns: string[];
    row_count: number;
    execution_time_ms: number;
    status: 'success' | 'failed';
    error?: string;
  }>> {
    const chat = await this.chatService.get(orgId, chatId, user.id) as any;
    if (!chat.combo_id) return [];

    const execRecords = await this.db.queryMany<any>(
      `SELECT id, generated_query, sub_queries FROM query_executions
       WHERE id = ANY($1::uuid[]) AND combo_id = $2`,
      [executionIds, chat.combo_id],
    );
    if (!execRecords.length) return [];

    // Load all connection credentials for this combo upfront
    const connRows = await this.db.queryMany<any>(
      `SELECT dc.*, dcm.alias
       FROM datasource_connections dc
       JOIN datasource_combo_members dcm ON dcm.connection_id = dc.id
       WHERE dcm.combo_id = $1`,
      [chat.combo_id],
    );
    const connMap = new Map<string, any>(connRows.map((c: any) => [c.id, c]));

    const results = await Promise.all(
      execRecords.map(async (rec) => {
        const start = Date.now();
        try {
          let subQueries: any[] = [];
          try {
            subQueries = typeof rec.sub_queries === 'string'
              ? JSON.parse(rec.sub_queries)
              : (rec.sub_queries || []);
          } catch { subQueries = []; }

          let plan: any = { merge: { strategy: 'union' } };
          try {
            plan = typeof rec.generated_query === 'string'
              ? JSON.parse(rec.generated_query)
              : (rec.generated_query || plan);
          } catch { /* keep default */ }

          const mergeStrategy: string = plan?.merge?.strategy || 'union';
          const joinKey: string | undefined = plan?.merge?.joinKey;
          const outputColumns: string[] | undefined = plan?.merge?.outputColumns;

          const stepResults: Array<{
            alias: string; rows: any[]; columns: string[]; status: 'success' | 'failed';
          }> = await Promise.all(
            subQueries.map(async (sq: any) => {
              const conn = connMap.get(sq.connectionId);
              if (!conn || !sq.query?.trim()) {
                return { alias: sq.alias || '', rows: [], columns: [], status: 'failed' as const };
              }
              const password = decrypt(conn.encrypted_password, this.encKey);
              let session: any;
              try {
                session = await this.mcpService.createSession({
                  host: conn.host, port: conn.port, username: conn.username, password,
                  database: conn.database_name, connectorType: conn.connector_type as ConnectorType,
                });
                const mcpResult = await this.mcpService.executeReadQuery(session.sessionId, sq.query);
                if (!mcpResult.success) {
                  return { alias: sq.alias || '', rows: [], columns: [], status: 'failed' as const };
                }
                return {
                  alias: sq.alias || (conn as any).alias || conn.name || '',
                  rows: mcpResult.data?.rows || [],
                  columns: mcpResult.data?.columns || [],
                  status: 'success' as const,
                };
              } catch {
                return { alias: sq.alias || '', rows: [], columns: [], status: 'failed' as const };
              } finally {
                if (session) await this.mcpService.destroySession(session.sessionId).catch(() => {});
              }
            }),
          );

          const { rows, columns } = this.mergeStepResults(stepResults, mergeStrategy, joinKey, outputColumns);
          const execTimeMs = Date.now() - start;

          return {
            executionId: rec.id,
            rows,
            columns,
            row_count: rows.length,
            execution_time_ms: execTimeMs,
            status: (rows.length > 0 ? 'success' : 'failed') as 'success' | 'failed',
          };
        } catch (err: any) {
          return {
            executionId: rec.id, rows: [], columns: [], row_count: 0,
            execution_time_ms: Date.now() - start,
            status: 'failed' as const, error: err.message,
          };
        }
      }),
    );

    return results;
  }

  /**
   * Inline re-implementation of the four merge strategies (avoids circular ChatModule ↔ ComboModule dep).
   */
  private mergeStepResults(
    stepResults: Array<{ alias: string; rows: any[]; columns: string[]; status: string }>,
    strategy: string,
    joinKey?: string,
    outputColumns?: string[],
  ): { rows: any[]; columns: string[] } {
    const successes = stepResults.filter(r => r.status === 'success');
    if (!successes.length) return { rows: [], columns: [] };

    if (strategy === 'join' && joinKey) {
      const [base, ...rest] = successes;
      let merged = base.rows.map((r: any) => ({ ...r }));
      for (const step of rest) {
        const hashMap = new Map<string, any>();
        for (const row of step.rows) hashMap.set(String(row[joinKey] ?? ''), row);
        merged = merged.map((baseRow: any) => {
          const match = hashMap.get(String(baseRow[joinKey] ?? '')) || {};
          const prefixed: any = {};
          for (const [col, val] of Object.entries(match)) {
            if (col === joinKey) continue;
            const colName = baseRow[col] !== undefined ? `${step.alias}_${col}` : col;
            prefixed[colName] = val;
          }
          return { ...baseRow, ...prefixed };
        });
      }
      const allCols = merged.length > 0 ? Object.keys(merged[0]) : [];
      const finalCols = outputColumns?.length ? outputColumns.filter(c => allCols.includes(c)) : allCols;
      return { rows: merged, columns: finalCols };
    }

    if (strategy === 'append') {
      const columns: string[] = [];
      for (const step of successes) for (const col of step.columns) columns.push(`${step.alias}__${col}`);
      const maxRows = Math.max(...successes.map(s => s.rows.length));
      const rows: any[] = [];
      for (let i = 0; i < maxRows; i++) {
        const row: any = {};
        for (const step of successes) {
          const src = step.rows[i] || {};
          for (const col of step.columns) row[`${step.alias}__${col}`] = src[col] ?? null;
        }
        rows.push(row);
      }
      return { rows, columns };
    }

    if (strategy === 'independent') {
      const colSet = new Set<string>(['_result_set']);
      const rows: any[] = [];
      for (const step of successes) {
        for (const row of step.rows) {
          rows.push({ _result_set: step.alias, ...row });
          Object.keys(row).forEach(c => colSet.add(c));
        }
      }
      return { rows, columns: Array.from(colSet) };
    }

    // Default: union
    const rows: any[] = [];
    for (const step of successes) {
      for (const row of step.rows) rows.push({ ...row, _source: step.alias });
    }
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { rows, columns };
  }

  private async buildSchemaContext(connectionId: string): Promise<string> {
    const tables = await this.db.queryMany<any>(
      `SELECT ct.table_name, string_agg(
         cc.column_name || ' ' || cc.data_type ||
         CASE WHEN cc.is_primary_key THEN ' PK' ELSE '' END ||
         CASE WHEN NOT cc.is_nullable THEN ' NOT NULL' ELSE '' END,
         ', ' ORDER BY cc.ordinal_position
       ) AS columns
       FROM connection_schemas cs
       JOIN connection_tables ct ON ct.schema_id = cs.id
       JOIN connection_columns cc ON cc.table_id = ct.id
       WHERE cs.connection_id = $1
         AND cs.deleted_at IS NULL
         AND ct.deleted_at IS NULL
         AND cc.deleted_at IS NULL
       GROUP BY ct.table_name
       ORDER BY ct.table_name`,
      [connectionId],
    );

    if (!tables.length) {
      return '-- No schema synced yet. Run Schema Sync for this connection first.';
    }

    return tables.map((t: any) => `${t.table_name}(${t.columns})`).join('\n');
  }

  private async getRecentMessages(chatId: string, limit: number) {
    const msgs = await this.db.queryMany<any>(
      `SELECT role, content FROM chat_messages
       WHERE chat_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [chatId, limit],
    );
    return msgs.reverse().map((m: any) => ({ role: m.role, content: m.content }));
  }

  private getConnectorFamily(connectorType: string): 'sql' | 'elasticsearch' | 'document' {
    if (connectorType === 'elasticsearch') return 'elasticsearch';
    if (connectorType === 'mongodb') return 'document';
    return 'sql';
  }
}
