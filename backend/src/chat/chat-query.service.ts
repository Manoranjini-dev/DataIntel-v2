import { Injectable, Logger, BadRequestException, HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
    success?: boolean;
    message?: string;
    reason?: string | null;
    suggestions?: string[];
    sql?: string | null;
    chart?: string | null;
    userMessage: any;
    assistantMessage: any;
    execution: any;
    followUpQuestions?: string[];
  }> {
    // Structured request tracing — every stage logs {reqId, chatId, connId,
    // userId, stage, ms}; on any failure we log the stage + full stack so the
    // real exception is never hidden behind the user-facing message.
    const reqId = randomUUID();
    const start = Date.now();
    let stage = 'incoming_request';
    let connIdForLog: string | null = null;
    const stageLog = (s: string, extra = '') => {
      stage = s;
      try {
        this.logger.log(`[chat ${reqId}] ${s} (chat=${chatId} conn=${connIdForLog ?? '—'} user=${user?.id ?? 'unknown'} ms=${Date.now() - start})${extra ? ' ' + extra : ''}`);
      } catch {}
    };

    stageLog('IncomingRequest', `prompt="${prompt?.slice(0, 80)}"`);

    if (!prompt?.trim()) {
      throw new BadRequestException('Please enter a question to generate a query.');
    }

    // Pre-flight loads (chat, connection, history, user message). A failure here
    // is logged with full context and re-thrown so its HTTP status is preserved
    // (400/403/404) instead of surfacing as an opaque 500.
    let chat: any;
    let conn: any;
    let recentMessages: { role: 'user' | 'assistant'; content: string }[];
    let userMsg: any;
    try {
      this.logger.log(`STEP 1 Loading chat`);
      chat = await this.chatService.get(chatId, user?.id) as any;
      if (!chat?.connection_id) {
        throw new BadRequestException('This endpoint is for connection-scoped chats only.');
      }
      connIdForLog = chat.connection_id;

      this.logger.log(`STEP 2 Loading datasource`);
      conn = await this.db.queryOne<any>(
        'SELECT * FROM datasource_connections WHERE id = $1',
        [chat.connection_id],
      );
      if (!conn) throw new BadRequestException('Connection not found');
      stageLog('DatasourceLoaded', `type=${conn.connector_type} host=${conn.host}`);

      // Load conversation history BEFORE persisting the new user message so it is not
      // included in recentMessages (which would cause it to appear twice in the LLM
      // context: once from history, once from userPrompt — confusing the model).
      recentMessages = await this.getRecentMessages(chatId, 10);

      // 1. Persist user message
      userMsg = await this.chatService.addMessage(chatId, 'user', prompt);
    } catch (preErr: any) {
      try {
        this.logger.error(
          `[chat ${reqId}] FAILED at stage=${stage} chat=${chatId} conn=${connIdForLog ?? '—'} user=${user?.id ?? 'unknown'} ms=${Date.now() - start}: ${preErr?.message}`,
          preErr?.stack,
        );
      } catch {}
      // Legitimate client errors (not found / forbidden / bad request) keep their
      // HTTP status so the frontend can map them precisely. Any OTHER pre-flight
      // failure (e.g. a transient app-DB hiccup) must NOT surface as an opaque
      // 500 — return a graceful, retryable envelope instead.
      if (preErr instanceof HttpException && preErr.getStatus() < 500) throw preErr;
      const friendly = 'Something interrupted that request before it could run. Please try again in a moment.';
      return {
        success: false,
        message: 'Unable to generate an answer for this query.',
        reason: preErr?.message || friendly,
        suggestions: [],
        sql: null,
        chart: null,
        userMessage: userMsg ?? { id: `u-${reqId}`, chat_id: chatId, role: 'user', content: prompt, created_at: new Date().toISOString() },
        assistantMessage: { id: `err-${reqId}`, chat_id: chatId, role: 'assistant', content: friendly, created_at: new Date().toISOString() },
        followUpQuestions: [],
        execution: { status: 'failed', error_message: preErr?.message || friendly, rows: [], columns: [] },
      } as any;
    }

    try {
      // 2. Build schema context from normalized tables
      this.logger.log(`STEP 3 Loading schema`);
      const compressedSchema = await this.buildSchemaContext(conn.id);

      // Early-exit when schema is absent: avoids burning LLM retries on a query
      // that will always produce empty SQL — surface a clear error instead.
      if (compressedSchema.startsWith('-- No schema')) {
        throw new Error(
          'Could not generate a SQL query — the schema for this connection may not be synced yet. ' +
          'Please navigate to Connection Settings → Schema Sync and run a sync, then retry your question.',
        );
      }
      stageLog('SchemaLoaded');

      // 3. Generate SQL via LLM using proper LLMContext
      this.logger.log(`STEP 4 Generating SQL`);
      const connectorFamily = this.getConnectorFamily(conn.connector_type);
      const llmContext = this.promptBuilder.assembleContext({
        compressedSchema,
        conversationSummary: null,
        recentMessages,
        userPrompt: prompt,
        connectorFamily,
      });
      stageLog('PromptGenerated');

      const llmResponse = await this.llmService.generateSQL(llmContext);
      stageLog('SQLGenerated', `type=${llmResponse.type} conf=${llmResponse.confidence ?? '—'}`);

      // Guard: empty SQL after successful LLM parse (safety net). Native-handled
      // types (schema_query / row_counts) legitimately carry no SQL.
      if (llmResponse.type !== 'schema_query' && llmResponse.type !== 'conversational' && llmResponse.type !== 'row_counts' && !llmResponse.sql?.trim()) {
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

      } else if (llmResponse.type === 'row_counts') {
        // 5a-bis. "How many records are in each table?" — counted natively so we
        // never ask the user to pick a table and never need a banned UNION in
        // LLM-generated SQL. One UNION ALL query (backend-built from validated
        // metadata identifiers), with a per-table fallback if the dialect balks.
        try {
          const tableRows = await this.db.queryMany<{ table_name: string }>(
            `SELECT ct.table_name
               FROM connection_schemas cs
               JOIN connection_tables ct ON ct.schema_id = cs.id
              WHERE cs.connection_id = $1 AND cs.deleted_at IS NULL AND ct.deleted_at IS NULL
              ORDER BY ct.table_name`,
            [conn.id],
          );
          const tables = tableRows.map((r) => r.table_name);
          if (!tables.length) throw new Error('No tables are synced for this connection yet. Run Schema Sync first.');

          const countRows = await this.countRowsPerTable(conn, tables);
          llmResponse.sql = `-- Row counts across all ${tables.length} tables (computed natively)\n-- Prompt: ${prompt}`;
          execResult = { rows: countRows, columns: ['table_name', 'records'], rowCount: countRows.length };
          stageLog('SQLExecuted', `RowsReturned=${countRows.length} (row_counts)`);
          insight = await this.llmService
            .interpretResults(prompt, 'row counts per table', ['table_name', 'records'], countRows, countRows.length, connectorFamily as any)
            .catch(() => `Counted records across ${countRows.length} tables.`);
          llmResponse.explanation = insight;
          if (!llmResponse.ui_hint) llmResponse.ui_hint = 'bar_chart';
        } catch (err: any) {
          execStatus = 'failed';
          execError = err.message || 'Failed to count rows per table';
          this.logger.warn(`[chat ${reqId}] row_counts failed (chat=${chatId}): ${execError}`);
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
        this.logger.log(`STEP 5 Executing SQL`);
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
            this.logger.warn(`[chat ${reqId}] SQLExecuted FAILED (chat=${chatId}): ${execError}`);
          } else {
            execResult = mcpResult.data;
            stageLog('SQLExecuted', `RowsReturned=${execResult?.rowCount ?? execResult?.rows?.length ?? 0}`);
          }
        } finally {
          await this.mcpService.destroySession(session.sessionId).catch(() => {});
        }

        // 6. Interpret results if it was a real query
        this.logger.log(`STEP 6 Formatting response`);
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

      // Part 2 — follow-up questions. On success: context-aware drill-downs from
      // the LLM (deduped + padded). On a handled failure: schema-grounded, always
      // executable ALTERNATIVES so the conversation can continue seamlessly.
      const followUpQuestions = execStatus === 'success'
        ? this.buildFollowUps(llmResponse.follow_up_questions, prompt, recentMessages, execResult, conn.connector_type)
        : await this.getFailureAlternatives(conn);

      // 8. Persist assistant message
      this.logger.log(`STEP 7 Saving assistant message`);
      const assistantContent = execStatus === 'success' && insight
        ? insight
        : execStatus === 'failed'
          ? `Query failed: ${execError}`
          : 'Query executed successfully.';

      const assistantMsg = await this.chatService.addMessage(
        chatId, 'assistant', assistantContent, execRecord!.id, llmResponse.ui_hint, followUpQuestions,
      );

      try {
        await this.audit.log({
          accountId: user.id,
          eventType: execStatus === 'success' ? 'query_executed' : 'query_failed',
          resourceType: 'connection', resourceId: conn.id,
          details: { chatId, execTimeMs, rowCount: execResult?.rowCount },
        });
      } catch (auditErr: any) {
        this.logger.warn(`Audit log failed: ${auditErr?.message}`);
      }

      this.logger.log(`STEP 8 Returning response`);
      const apiResponse = {
        success: execStatus === 'success',
        message: assistantContent,
        reason: execStatus === 'failed' ? (execError || 'Execution failed') : null,
        suggestions: followUpQuestions || [],
        sql: llmResponse.sql || null,
        chart: llmResponse.ui_hint || null,
        userMessage: userMsg,
        assistantMessage: {
          ...assistantMsg,
          followUpQuestions,
        },
        followUpQuestions,
        execution: {
          ...execRecord,
          rows: execResult?.rows || [],
          columns: execResult?.columns || [],
        },
      };
      stageLog('ResponseSent', `status=${execStatus} rows=${apiResponse.execution.rows.length} followUps=${followUpQuestions.length}`);
      return apiResponse;

    } catch (err: any) {
      let friendlyMessage = 'Something went wrong while generating your query. Please try again or rephrase your question.';
      try {
        friendlyMessage = this.formatGenerationError(err);
      } catch (fmtErr: any) {
        this.logger.warn(`formatGenerationError threw an error: ${fmtErr?.message}`);
      }

      // Task 8: Detailed structured logging
      try {
        this.logger.error(
          `\n[ChatQueryService]\n\nStage:\n${stage}\n\nChat:\n${chatId}\n\nDatasource:\n${conn?.connector_type || 'unknown'} (${connIdForLog || 'none'})\n\nPrompt:\n${prompt}\n\nError:\n${err?.message || err}\n\nStack:\n${err?.stack || 'no stack'}\n`,
        );
      } catch {}

      // Offer schema-grounded, always-executable alternatives so the user can
      // continue the conversation instead of hitting a dead end.
      let followUpQuestions: string[] = [
        'Show me all tables',
        'How many records are in each table?',
        'Show the 10 most recent records',
        'Which table has the most records?',
      ];
      try {
        followUpQuestions = await this.getFailureAlternatives(conn);
      } catch {}

      // Persist a failure message. Guarded so a secondary DB hiccup here can't
      // turn a handled data-path failure into an opaque 500.
      let failMsg: any = null;
      try {
        failMsg = await this.chatService.addMessage(chatId, 'assistant', friendlyMessage, undefined, undefined, followUpQuestions);
      } catch (persistErr: any) {
        try {
          this.logger.error(
            `[chat ${reqId}] Could not persist failure message (chat=${chatId}): ${persistErr?.message}`,
            persistErr?.stack,
          );
        } catch {}
      }

      return {
        success: false,
        message: 'Unable to generate an answer for this query.',
        reason: err?.message || friendlyMessage,
        suggestions: followUpQuestions,
        sql: null,
        chart: null,
        userMessage: userMsg || { id: `u-${reqId}`, chat_id: chatId, role: 'user', content: prompt, created_at: new Date().toISOString() },
        assistantMessage: failMsg ? { ...failMsg, followUpQuestions } : {
          id: `err-${reqId}`, chat_id: chatId, role: 'assistant',
          content: friendlyMessage, created_at: new Date().toISOString(),
          followUpQuestions,
        },
        followUpQuestions,
        execution: { status: 'failed', error_message: friendlyMessage, rows: [], columns: [] },
      } as any;
    }
  }

  /**
   * Schema-grounded, guaranteed-executable ALTERNATIVE questions offered when a
   * turn fails (connection/validation/execution). No LLM, no per-column SQL —
   * these route through the native schema_query / row_counts / simple-select
   * paths, so they can never themselves reference a non-existent column. Never
   * throws (a failure here must not compound the original failure).
   */
  private async getFailureAlternatives(conn: any): Promise<string[]> {
    const generic = [
      'Show me all tables',
      'How many records are in each table?',
      'Show the 10 most recent records',
      'Which table has the most records?',
    ];
    try {
      if (!conn?.id) return generic;
      const rows = await this.db.queryMany<{ table_name: string; n: number }>(
        `SELECT ct.table_name, COUNT(cc.id)::int AS n
           FROM connection_schemas cs
           JOIN connection_tables ct ON ct.schema_id = cs.id
           LEFT JOIN connection_columns cc ON cc.table_id = ct.id AND cc.deleted_at IS NULL
          WHERE cs.connection_id = $1 AND cs.deleted_at IS NULL AND ct.deleted_at IS NULL
          GROUP BY ct.table_name ORDER BY n DESC LIMIT 1`,
        [conn.id],
      );
      const top = rows[0]?.table_name;
      if (!top) return generic;
      // Reference a REAL table by name but only via safe, generic shapes.
      return [
        'How many records are in each table?',
        `Show the 10 most recent ${top} records`,
        `How many ${top} records are there?`,
        'Which table has the most records?',
      ];
    } catch {
      return generic;
    }
  }

  /**
   * Translate internal error categories (LLM timeouts, network failures,
   * validation rejections, etc.) into a single user-facing sentence. Raw
   * exception messages can contain provider-internal text, stack-ish
   * fragments, or repeated "attempt N" noise — never shown to the user.
   */
  private formatGenerationError(err: any): string {
    let message: string = 'Unknown error';
    if (typeof err === 'string') {
      message = err;
    } else if (typeof err?.message === 'string') {
      message = err.message;
    } else if (err?.message && typeof err.message === 'object') {
      message = JSON.stringify(err.message);
    }

    // Already-friendly, purpose-written messages — pass through as-is.
    if (
      typeof message === 'string' &&
      (message.startsWith('Could not generate a SQL query') ||
       message.startsWith('validation_rejected:'))
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
  ): Promise<any> {
    const start = Date.now();
    try {
      const chat = await this.chatService.get(chatId, user?.id) as any;
      if (!chat?.connection_id) throw new BadRequestException('Chat has no connection.');

      const conn = await this.db.queryOne<any>('SELECT * FROM datasource_connections WHERE id = $1', [chat.connection_id]);
      if (!conn) throw new BadRequestException('Connection not found');

      const password = decrypt(conn.encrypted_password, this.encKey);
      const session = await this.mcpService.createSession({
        host: conn.host, port: conn.port, username: conn.username, password,
        database: conn.database_name, connectorType: conn.connector_type as ConnectorType,
      });

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

      return {
        success: status === 'success',
        status,
        rows,
        columns,
        row_count: rowCount,
        execution_time_ms: execTimeMs,
        error_message: error,
        message: status === 'success' ? 'Draft executed successfully' : (error || 'Execution failed'),
        reason: error,
        suggestions: [],
        sql,
        chart: null,
      };
    } catch (err: any) {
      if (err instanceof HttpException && err.getStatus() < 500) throw err;
      const errorMsg = err?.message || 'Execution failed';
      return {
        success: false,
        status: 'failed',
        rows: [],
        columns: [],
        row_count: 0,
        execution_time_ms: Date.now() - start,
        error_message: errorMsg,
        message: 'Unable to execute query draft.',
        reason: errorMsg,
        suggestions: [],
        sql,
        chart: null,
      };
    }
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
    try {
      const chat = await this.chatService.get(chatId, user?.id) as any;
      if (!chat?.connection_id) return [];

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
        if (!sql?.trim() || sql.trim().startsWith('--')) {
          return {
            executionId: rec.id,
            rows: [],
            columns: [],
            row_count: 0,
            execution_time_ms: 0,
            status: 'success' as const,
            error: undefined,
            skipped: true,
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
    } catch (err: any) {
      if (err instanceof HttpException && err.getStatus() < 500) throw err;
      this.logger.warn(`refreshMessages failed outside loop: ${err?.message}`);
      return [];
    }
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
    try {
      const chat = await this.chatService.get(chatId, user?.id) as any;
      if (!chat?.combo_id) return [];

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
    } catch (err: any) {
      if (err instanceof HttpException && err.getStatus() < 500) throw err;
      this.logger.warn(`refreshComboMessages failed outside loop: ${err?.message}`);
      return [];
    }
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
      `SELECT m.role, m.content, qe.generated_query, qe.result_columns, qe.result_preview
       FROM chat_messages m
       LEFT JOIN query_executions qe ON qe.id = m.execution_id
       WHERE m.chat_id = $1 ORDER BY m.created_at DESC LIMIT $2`,
      [chatId, limit],
    );
    return msgs.reverse().map((m: any) => {
      if (m.role === 'assistant' && m.generated_query && !m.generated_query.trim().startsWith('--')) {
        let cols = '';
        try {
          const cArray = typeof m.result_columns === 'string' ? JSON.parse(m.result_columns) : m.result_columns;
          if (Array.isArray(cArray) && cArray.length) cols = `\nColumns: ${cArray.join(', ')}`;
        } catch {}
        let prev = '';
        try {
          const pArray = typeof m.result_preview === 'string' ? JSON.parse(m.result_preview) : m.result_preview;
          if (Array.isArray(pArray) && pArray.length) prev = `\nRESULT PREVIEW:\n${JSON.stringify(pArray.slice(0, 5))}`;
        } catch {}
        return {
          role: m.role,
          content: `${m.content}\n[Executed SQL: ${m.generated_query}]${cols}${prev}`,
        };
      }
      return { role: m.role, content: m.content };
    });
  }

  /** Regenerate follow-up questions for a specific message (used when loading un-persisted history after refresh) */
  async regenerateFollowUpsForMessage(chatId: string, message: any, history: any[], connectionId: string): Promise<string[]> {
    try {
      const conn = await this.db.queryOne<any>('SELECT * FROM datasource_connections WHERE id = $1', [connectionId]);
      if (!conn) return [];
      if (message.exec_status === 'failed') {
        return await this.getFailureAlternatives(conn);
      }
      return this.buildFollowUps(
        [],
        history.find((m) => m.id === message.id)?.prompt || message.content || '',
        history,
        { columns: message.result_columns || [] },
        conn.connector_type,
      );
    } catch {
      return [];
    }
  }

  private getConnectorFamily(connectorType: string): 'sql' | 'elasticsearch' | 'document' {
    if (connectorType === 'elasticsearch') return 'elasticsearch';
    if (connectorType === 'mongodb') return 'document';
    return 'sql';
  }

  /**
   * Part 2 — assemble up to 4 follow-up questions: LLM suggestions first,
   * de-duplicated and stripped of anything already asked in this chat, then
   * padded (if the model returned too few) with safe, immediately-executable
   * prompts. Guarantees uniqueness and relevance to the current turn.
   */
  private buildFollowUps(
    llmFollowUps: string[] | undefined,
    currentPrompt: string,
    recentMessages: Array<{ role: string; content: string }>,
    execResult: any,
    connectorType: string,
  ): string[] {
    const norm = (s: string) => s.trim().toLowerCase().replace(/[?.!\s]+$/g, '').replace(/\s+/g, ' ');
    const asked = new Set<string>([
      norm(currentPrompt),
      ...recentMessages.filter((m) => m.role === 'user').map((m) => norm(m.content)),
    ]);
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (q?: string) => {
      if (out.length >= 4 || typeof q !== 'string') return;
      const t = q.trim();
      const n = norm(t);
      if (!n || n.length < 4 || asked.has(n) || seen.has(n)) return;
      seen.add(n);
      out.push(t);
    };

    (llmFollowUps || []).forEach(add);

    // Pad only if the model under-delivered — result-column-aware where possible.
    if (out.length < 4) {
      const cols: string[] = Array.isArray(execResult?.columns) ? execResult.columns : [];
      const pads = [
        'Show the 10 most recent records',
        'Which records were added most recently?',
        cols[0] ? `Break this down by ${cols[0]}` : 'Break this down by category',
        'Show this as a trend over time',
      ];
      pads.forEach(add);
    }
    return out.slice(0, 4);
  }

  /** Quote an introspected identifier per SQL dialect (metadata → safe input). */
  private quoteIdent(connectorType: string, ident: string): string {
    switch (connectorType) {
      case 'mysql':
      case 'databricks':
        return '`' + ident.replace(/`/g, '``') + '`';
      case 'mssql':
      case 'fabric':
        return '[' + ident.replace(/]/g, ']]') + ']';
      default: // postgres, redshift, snowflake, oracle, bigquery
        return '"' + ident.replace(/"/g, '""') + '"';
    }
  }

  /**
   * Count rows for EVERY table in one read-only pass. Primary path: a single
   * UNION ALL (backend-built — the UNION ban only applies to LLM-generated SQL).
   * Fallback: per-table COUNT(*) merged here (for a dialect that rejects the
   * combined query). Returns [{table_name, records}] sorted by records desc.
   */
  private async countRowsPerTable(
    conn: any,
    tables: string[],
  ): Promise<Array<{ table_name: string; records: number }>> {
    const connectorType = conn.connector_type as string;
    const password = decrypt(conn.encrypted_password, this.encKey);
    const session = await this.mcpService.createSession({
      host: conn.host, port: conn.port, username: conn.username, password,
      database: conn.database_name, connectorType: connectorType as ConnectorType,
    });
    try {
      // Cap the fan-out so a pathological schema can't build a giant query.
      const targets = tables.slice(0, 200);
      const lit = (t: string) => `'${t.replace(/'/g, "''")}'`;
      const unionSql = targets
        .map((t) => `SELECT ${lit(t)} AS table_name, COUNT(*) AS records FROM ${this.quoteIdent(connectorType, t)}`)
        .join(' UNION ALL ');

      const res = await this.mcpService.executeReadQuery(session.sessionId, unionSql);
      if (res.success) {
        return (res.data?.rows || [])
          .map((r: any) => ({ table_name: String(r.table_name), records: Number(r.records) || 0 }))
          .sort((a, b) => b.records - a.records);
      }

      // Fallback — count each table independently and merge.
      this.logger.warn(`row_counts UNION failed (${res.error}); falling back to per-table counts`);
      const out: Array<{ table_name: string; records: number }> = [];
      for (const t of targets) {
        const one = await this.mcpService.executeReadQuery(
          session.sessionId, `SELECT COUNT(*) AS records FROM ${this.quoteIdent(connectorType, t)}`,
        );
        out.push({ table_name: t, records: one.success ? Number(one.data?.rows?.[0]?.records) || 0 : 0 });
      }
      return out.sort((a, b) => b.records - a.records);
    } finally {
      await this.mcpService.destroySession(session.sessionId).catch(() => {});
    }
  }

  /**
   * Part 1 — generate datasource-aware starter questions for the landing page.
   * Pure schema → LLM. Cached briefly per (connection, schema-sync time) so the
   * landing page doesn't re-call the LLM on every mount, and auto-invalidated on
   * schema re-sync. Falls back to safe generic prompts if the LLM is unavailable.
   */
  async generateStarterQuestions(chatConnectionId: string, user: SafeAccount): Promise<string[]> {
    const fallback = [
      'Show me all tables',
      'How many records are in each table?',
      'Show the 10 most recent records',
      'Which table has the most records?',
    ];
    try {
      const conn = await this.db.queryOne<any>(
        'SELECT * FROM datasource_connections WHERE id = $1 AND deleted_at IS NULL',
        [chatConnectionId],
      );
      if (!conn) throw new BadRequestException('Connection not found');

      const cacheKey = `${conn.id}:${conn.schema_synced_at ?? 'none'}`;
      const cached = ChatQueryService.starterCache.get(cacheKey);
      if (cached && cached.expires > Date.now()) return cached.questions;

      const compressedSchema = await this.buildSchemaContext(conn.id);
      if (compressedSchema.startsWith('-- No schema')) return fallback;

      const family = this.getConnectorFamily(conn.connector_type);
      const questions = await this.llmService.generateStarterQuestions(compressedSchema, family, 4);

      if (questions.length >= 3) {
        const result = questions.slice(0, 4);
        ChatQueryService.starterCache.set(cacheKey, { questions: result, expires: Date.now() + 30 * 60 * 1000 });
        return result;
      }
      return fallback;
    } catch (err: any) {
      if (err instanceof HttpException && err.getStatus() < 500) throw err;
      this.logger.warn(`generateStarterQuestions failed: ${err?.message}`);
      return fallback;
    }
  }

  /** Per-(connection, schema-sync) starter-question cache (30 min TTL). */
  private static readonly starterCache = new Map<string, { questions: string[]; expires: number }>();
}
