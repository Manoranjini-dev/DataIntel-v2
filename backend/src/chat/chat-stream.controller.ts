import {
  Controller, Post, Param, Body, Res, HttpCode, HttpStatus, Logger, BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { MCPService } from '../mcp/mcp.service';
import { LLMService } from '../llm/llm.service';
import { PromptBuilderService } from '../llm/prompt-builder.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';
import { decrypt } from '../common/utils/encryption';
import { ConnectorType } from '../common/types';

@Controller('orgs/:orgId/chats')
export class ChatStreamController {
  private readonly logger = new Logger(ChatStreamController.name);
  private readonly encKey: string;

  constructor(
    private readonly chatService: ChatService,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly mcpService: MCPService,
    private readonly llmService: LLMService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly config: ConfigService,
  ) {
    this.encKey = this.config.getOrThrow('CREDENTIAL_ENCRYPTION_KEY');
  }

  @Post(':chatId/stream')
  @HttpCode(HttpStatus.OK)
  async stream(
    @Param('orgId') orgId: string,
    @Param('chatId') chatId: string,
    @CurrentUser() user: SafeAccount,
    @Body() body: { prompt: string },
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (event: string, data?: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
    };

    try {
      const chat = await this.chatService.get(orgId, chatId, user.id) as any;
      if (!chat.connection_id) {
        throw new BadRequestException('Streaming is for connection-scoped chats only.');
      }

      const conn = await this.db.queryOne<any>(
        'SELECT * FROM datasource_connections WHERE id = $1',
        [chat.connection_id],
      );
      if (!conn) throw new BadRequestException('Connection not found');

      send('thinking');

      const userMsg = await this.chatService.addMessage(chatId, 'user', body.prompt);
      const start = Date.now();

      // Build schema context
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
        [conn.id],
      );
      const compressedSchema = tables.length
        ? tables.map((t: any) => `${t.table_name}(${t.columns})`).join('\n')
        : '-- No schema synced';

      // Load recent messages
      const msgs = await this.db.queryMany<any>(
        `SELECT role, content FROM chat_messages
         WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [chatId],
      );
      const recentMessages = msgs.reverse().map((m: any) => ({ role: m.role, content: m.content }));

      const connectorFamily = conn.connector_type === 'elasticsearch'
        ? 'elasticsearch' : conn.connector_type === 'mongodb' ? 'document' : 'sql';

      // Generate SQL
      const llmContext = this.promptBuilder.assembleContext({
        compressedSchema,
        conversationSummary: null,
        recentMessages,
        userPrompt: body.prompt,
        connectorFamily: connectorFamily as any,
      });

      const llmResponse = await this.llmService.generateSQL(llmContext);
      send('sql_generated', {
        sql: llmResponse.sql,
        explanation: llmResponse.explanation,
        tables_used: llmResponse.tables_used,
      });

      // Execute via MCP
      send('executing');
      const password = decrypt(conn.encrypted_password, this.encKey);
      const session = await this.mcpService.createSession({
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password,
        database: conn.database_name,
        connectorType: conn.connector_type as ConnectorType,
      });

      let rows: any[] = [];
      let columns: any[] = [];
      let rowCount = 0;
      let execStatus = 'success';
      let execError: string | null = null;

      try {
        const mcpResult = await this.mcpService.executeReadQuery(session.sessionId, llmResponse.sql);
        if (!mcpResult.success) {
          execStatus = 'failed';
          execError = mcpResult.error || 'Query execution failed';
        } else {
          rows = mcpResult.data?.rows || [];
          columns = mcpResult.data?.columns || [];
          rowCount = mcpResult.data?.rowCount || rows.length;
        }
      } finally {
        await this.mcpService.destroySession(session.sessionId).catch(() => {});
      }

      const execTimeMs = Date.now() - start;
      send('results', { rows, columns, rowCount, executionTimeMs: execTimeMs, status: execStatus, error: execError });

      // Interpret results
      let insight = '';
      if (execStatus === 'success' && rows.length > 0) {
        insight = await this.llmService.interpretResults(
          body.prompt, llmResponse.sql, columns, rows, rowCount, connectorFamily as any,
        ).catch(() => '');
      }
      send('insight', { insight, ui_hint: llmResponse.ui_hint });

      // Persist execution
      const execRecord = await this.db.queryOne(
        `INSERT INTO query_executions
           (org_id, chat_id, message_id, connection_id, executed_by, prompt,
            generated_query, query_explanation, tables_used, confidence,
            status, execution_time_ms, row_count, result_preview, result_columns,
            error_message, insight, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
         RETURNING *`,
        [
          orgId, chatId, userMsg!.id, conn.id, user.id, body.prompt,
          llmResponse.sql, llmResponse.explanation,
          llmResponse.tables_used, llmResponse.confidence,
          execStatus, execTimeMs, rowCount,
          JSON.stringify(rows.slice(0, 25)),
          columns, execError, insight,
        ],
      );

      await this.db.query(
        'UPDATE chat_messages SET execution_id = $2 WHERE id = $1',
        [userMsg!.id, execRecord!.id],
      );

      const assistantContent = execStatus === 'success' && insight
        ? insight
        : execStatus === 'failed' ? `Query failed: ${execError}` : 'Query executed successfully.';

      await this.chatService.addMessage(chatId, 'assistant', assistantContent, execRecord!.id, llmResponse.ui_hint);

      send('done', { executionId: execRecord!.id });
      res.end();

    } catch (err: any) {
      this.logger.error(`Chat stream failed: ${err.message}`, err.stack);
      send('error', { message: err.message });
      res.end();
    }
  }
}
