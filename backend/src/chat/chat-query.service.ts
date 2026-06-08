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

    // 1. Persist user message
    const userMsg = await this.chatService.addMessage(chatId, 'user', prompt);

    const start = Date.now();

    try {
      // 2. Build schema context from normalized tables
      const compressedSchema = await this.buildSchemaContext(conn.id);

      // 3. Load recent messages for memory
      const recentMessages = await this.getRecentMessages(chatId, 10);

      // 4. Generate SQL via LLM using proper LLMContext
      const connectorFamily = this.getConnectorFamily(conn.connector_type);
      const llmContext = this.promptBuilder.assembleContext({
        compressedSchema,
        conversationSummary: null,
        recentMessages,
        userPrompt: prompt,
        connectorFamily,
      });

      const llmResponse = await this.llmService.generateSQL(llmContext);

      // Guard: empty SQL means the LLM couldn't find schema info (not synced, etc.)
      if (!llmResponse.sql?.trim()) {
        throw new Error(
          'Could not generate a SQL query — the schema for this connection may not be synced yet. ' +
          'Please navigate to Connection Settings → Schema Sync and run a sync, then retry your question.',
        );
      }

      // 5. Execute via MCP (create temporary session)
      const password = decrypt(conn.encrypted_password, this.encKey);
      const session = await this.mcpService.createSession({
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password,
        database: conn.database_name,
        connectorType: conn.connector_type as ConnectorType,
      });

      let execResult: any = null;
      let execStatus = 'success';
      let execError: string | null = null;

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

      const execTimeMs = Date.now() - start;

      // 6. Interpret results
      let insight = '';
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
          JSON.stringify(execResult?.rows?.slice(0, 25) || []),
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

      return {
        userMessage: userMsg,
        assistantMessage: assistantMsg,
        execution: {
          ...execRecord,
          rows: execResult?.rows || [],
          columns: execResult?.columns || [],
        },
      };

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
         JSON.stringify(rows.slice(0, 25)), columns, error],
      ).catch(() => {});
    }

    if (status === 'failed') throw new Error(error || 'Query execution failed');
    return { rows, columns, row_count: rowCount, execution_time_ms: execTimeMs, status };
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
