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
import { ConnectorType, ConnectorFamily, SchemaMetadata, TableSchema } from '../common/types';
import { ValidationService } from '../validation/validation.service';
import { SchemaGraph } from '../schema/schema-graph';

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
    private readonly validationService: ValidationService,
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
    chatId: string,
    user: SafeAccount,
    prompt: string,
  ): Promise<{
    userMessage: any;
    assistantMessage: any;
    execution: any;
  }> {
    if (!prompt?.trim()) {
      throw new BadRequestException('Please enter a question to generate a query.');
    }

    // Load chat
    const chat = await this.chatService.get(chatId, user.id) as any;

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
        llmResponse.type = 'conversational';
        if (!llmResponse.explanation) {
          llmResponse.explanation = 'I could not generate a data query for your prompt. Please ensure your question relates to the available data and try refining your request.';
        }
      }

      let execResult: any = null;
      let execStatus = 'success';
      let execError: string | null = null;
      let insight = '';

      if (llmResponse.type === 'schema_query') {
        llmResponse.sql = `-- System Schema Query\n-- This result was served from synced metadata, not a live SQL query.\n-- Prompt: ${prompt}`;
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
        llmResponse.sql = `-- Conversational Response\n-- No data query was executed.\n-- Prompt: ${prompt}`;
        // 5b. Conversational response — no query execution
        insight = llmResponse.explanation;
        execResult = { rows: [], columns: [], rowCount: 0 };
        
      } else {
        // 5c. Validate the generated SQL deterministically before it ever touches
        // the database — catches malformed/incomplete SQL and references to
        // tables/columns that don't exist in the synced schema. On rejection,
        // feed the rejection reason back to the LLM for one self-correction
        // pass (the same pattern already proven in QueryService/generatePlan).
        // Scoped to true SQL connectors — the AST parser can't validate
        // Elasticsearch DSL / Mongo aggregation pipelines, which also flow
        // through this `sql` field for their respective connector families.
        if (connectorFamily === 'sql') {
          const schemaGraph = await this.buildSchemaGraph(conn.id);
          let validation = this.validationService.validate(llmResponse.sql, schemaGraph);

          if (validation.verdict === 'REJECT') {
            this.logger.warn(
              `SQL validation rejected on first attempt (chat=${chatId}): ${validation.reasons.join('; ')}`,
            );
            try {
              const retryResponse = await this.llmService.generateSQL({
                ...llmContext,
                validationFeedback: validation.reasons.join('\n'),
              });
              if (retryResponse.sql?.trim()) {
                const retryValidation = this.validationService.validate(retryResponse.sql, schemaGraph);
                validation = retryValidation;
                if (retryValidation.verdict === 'ACCEPT') {
                  llmResponse.sql = retryValidation.sql;
                  llmResponse.explanation = retryResponse.explanation || llmResponse.explanation;
                  llmResponse.tables_used = retryResponse.tables_used;
                  llmResponse.confidence = retryResponse.confidence;
                  this.logger.log(`SQL validation auto-retry succeeded (chat=${chatId})`);
                }
              }
            } catch (retryErr: any) {
              this.logger.warn(`SQL validation auto-retry LLM call failed (chat=${chatId}): ${retryErr?.message}`);
              // Fall through with the original rejection below.
            }
          } else {
            // Use the validated (possibly auto-patched, e.g. LIMIT-injected) SQL.
            llmResponse.sql = validation.sql;
          }

          if (validation.verdict === 'REJECT') {
            throw new Error(
              `validation_rejected: The generated query didn't pass validation (${validation.reasons[0] || 'unknown reason'}). ` +
              `Try rephrasing your question or being more specific about the tables/columns involved.`,
            );
          }

          this.logger.log(
            `SQL validated (chat=${chatId}, tables=${this.validationService.extractTablesFromSQL(llmResponse.sql).join(',')})`,
          );
        }

        // Execute data query via MCP (create temporary session)
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
           (chat_id, message_id, connection_id, executed_by, prompt,
            generated_query, query_explanation, tables_used, confidence,
            status, execution_time_ms, row_count, result_preview, result_columns,
            error_message, insight, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
         RETURNING *`,
        [
          chatId, userMsg!.id, conn.id, user.id, prompt,
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
        accountId: user.id,
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
      this.logger.log(`Chat query completed (chat=${chatId}, status=${execStatus}, rows=${apiResponse.execution.rows.length}, ms=${execTimeMs})`);
      return apiResponse;

    } catch (err: any) {
      const friendlyMessage = this.formatGenerationError(err);
      this.logger.error(`Chat query failed (chat=${chatId}): ${err?.message}`);

      // Persist failure message
      const failMsg = await this.chatService.addMessage(
        chatId, 'assistant', friendlyMessage,
      );

      return {
        userMessage: userMsg,
        assistantMessage: failMsg,
        execution: { status: 'failed', error_message: friendlyMessage },
      };
    }
  }

  /**
   * Translate internal error categories (LLM timeouts, network failures,
   * validation rejections, etc.) into a single user-facing sentence. Raw
   * exception messages can contain provider-internal text, stack-ish
   * fragments, or repeated "attempt N" noise — never shown to the user.
   */
  private formatGenerationError(err: any): string {
    const message: string = err?.message || 'Unknown error';

    // Already-friendly, purpose-written messages — pass through as-is.
    if (
      message.startsWith('Could not generate a SQL query') ||
      message.startsWith('validation_rejected:')
    ) {
      return message.replace(/^validation_rejected:\s*/, '');
    }

    const lower = message.toLowerCase();

    // ── AI-service failures — identified by the explicit llm_* category
    // prefixes emitted by LLMService. These MUST be checked before the generic
    // connection-error patterns below, otherwise a database ETIMEDOUT gets
    // mislabeled as an AI timeout (which is exactly the misleading-error bug).
    if (lower.includes('llm_timeout')) {
      return 'The AI took too long to respond. Please try again.';
    }
    if (lower.includes('llm_network_error')) {
      return 'Could not reach the AI service. Please check your connection and try again.';
    }
    if (lower.includes('llm_rate_limited')) {
      return 'The AI service is busy right now. Please wait a moment and try again.';
    }
    if (lower.includes('llm_auth_error') || lower.includes('insufficient credits')) {
      return 'The AI service is temporarily unavailable. Please contact support if this persists.';
    }
    if (lower.includes('llm_format_violation') || lower.includes('not valid json')) {
      return 'The AI could not generate a valid query for that request. Please try rephrasing your question.';
    }

    // ── Database / query-execution failures — the SQL was generated fine but
    // the connection or the query itself failed. Reported distinctly so the
    // user isn't told "the AI" failed when the data source is the problem.
    if (lower.includes('etimedout') || lower.includes('econnrefused') ||
        lower.includes('enotfound') || lower.includes('econnreset') ||
        lower.includes('connection failed') || lower.includes('connect ')) {
      return 'Could not connect to the data source. Verify the connection is online and reachable, then try again.';
    }
    if (lower.includes('schema') && lower.includes('sync')) {
      return 'The schema for this connection is not synced. Run Schema Sync, then try again.';
    }
    if (lower.includes('access denied') || lower.includes('permission')) {
      return 'The database rejected the query due to insufficient permissions.';
    }

    return 'Something went wrong while generating your query. Please try again or rephrase your question.';
  }

  /**
   * Re-execute a (possibly user-edited) SQL query draft.
   * Updates the existing query_execution record and returns results.
   */
  async executeDraft(
    chatId: string,
    user: SafeAccount,
    executionId: string,
    sql: string,
  ): Promise<{ rows: any[]; columns: string[]; row_count: number; execution_time_ms: number; status: string }> {
    const chat = await this.chatService.get(chatId, user.id) as any;
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
    const chat = await this.chatService.get(chatId, user.id) as any;
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
    const chat = await this.chatService.get(chatId, user.id) as any;
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

    // Large schemas can blow the LLM's context budget and degrade SQL
    // quality. Cap the table list sent in the prompt (the validation
    // SchemaGraph built in buildSchemaGraph() still sees every table —
    // this only trims what's shown to the LLM, not what's enforced).
    const MAX_TABLES_IN_PROMPT = 200;
    const truncated = tables.length > MAX_TABLES_IN_PROMPT;
    const shown = truncated ? tables.slice(0, MAX_TABLES_IN_PROMPT) : tables;

    const lines = shown.map((t: any) => `${t.table_name}(${t.columns})`);
    if (truncated) {
      lines.push(`-- (+${tables.length - MAX_TABLES_IN_PROMPT} more tables not shown — ask about a specific table by name for full detail)`);
      this.logger.warn(
        `Schema for connection ${connectionId} has ${tables.length} tables — truncated to ${MAX_TABLES_IN_PROMPT} for the LLM prompt`,
      );
    }

    // Append foreign-key relationships so the LLM generates correct JOINs
    // instead of guessing join columns. Without this the model frequently
    // joins on the wrong column (or invents one), producing invalid SQL.
    const shownNames = new Set(shown.map((t: any) => String(t.table_name).toLowerCase()));
    const fks = await this.db.queryMany<any>(
      `SELECT ct.table_name, cc.column_name, cc.fk_ref_table, cc.fk_ref_column
       FROM connection_schemas cs
       JOIN connection_tables ct ON ct.schema_id = cs.id
       JOIN connection_columns cc ON cc.table_id = ct.id
       WHERE cs.connection_id = $1
         AND cs.deleted_at IS NULL AND ct.deleted_at IS NULL AND cc.deleted_at IS NULL
         AND cc.is_foreign_key = TRUE
         AND cc.fk_ref_table IS NOT NULL AND cc.fk_ref_column IS NOT NULL
       ORDER BY ct.table_name, cc.column_name`,
      [connectionId],
    );
    const relLines = fks
      .filter((r: any) => shownNames.has(String(r.table_name).toLowerCase()))
      .map((r: any) => `${r.table_name}.${r.column_name} -> ${r.fk_ref_table}.${r.fk_ref_column}`);
    if (relLines.length) {
      lines.push('', 'RELATIONSHIPS (use these for JOINs):', ...relLines);
    }

    return lines.join('\n');
  }

  /**
   * Build a SchemaGraph for SQL validation (table/column/join existence
   * checks) from the connection's normalized, synced schema. Returns
   * undefined when nothing is synced yet — validation rules degrade
   * gracefully (syntax-only checks) when no graph is available.
   */
  private async buildSchemaGraph(connectionId: string): Promise<SchemaGraph | undefined> {
    const rows = await this.db.queryMany<any>(
      `SELECT ct.table_name, cc.column_name, cc.data_type, cc.is_nullable, cc.is_primary_key,
              cc.is_foreign_key, cc.fk_ref_table, cc.fk_ref_column, cc.default_value
       FROM connection_schemas cs
       JOIN connection_tables ct ON ct.schema_id = cs.id
       JOIN connection_columns cc ON cc.table_id = ct.id
       WHERE cs.connection_id = $1
         AND cs.deleted_at IS NULL
         AND ct.deleted_at IS NULL
         AND cc.deleted_at IS NULL
       ORDER BY ct.table_name, cc.ordinal_position`,
      [connectionId],
    );

    if (!rows.length) return undefined;

    const tableMap = new Map<string, TableSchema>();
    for (const r of rows) {
      let table = tableMap.get(r.table_name);
      if (!table) {
        table = { name: r.table_name, columns: [], primaryKeys: [], foreignKeys: [], indexes: [] };
        tableMap.set(r.table_name, table);
      }
      table.columns.push({
        name: r.column_name,
        type: r.data_type,
        nullable: r.is_nullable,
        isPrimaryKey: r.is_primary_key,
        defaultValue: r.default_value ?? null,
      });
      if (r.is_primary_key) table.primaryKeys.push(r.column_name);
      if (r.is_foreign_key && r.fk_ref_table && r.fk_ref_column) {
        table.foreignKeys.push({
          columnName: r.column_name,
          referencedTable: r.fk_ref_table,
          referencedColumn: r.fk_ref_column,
          constraintName: `fk_${r.table_name}_${r.column_name}`,
        });
      }
    }

    const metadata: SchemaMetadata = {
      database: connectionId,
      connectorType: 'postgres' as ConnectorType, // not used by validation rules; placeholder
      tables: Array.from(tableMap.values()),
      extractedAt: new Date(),
    };

    return new SchemaGraph(metadata);
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
