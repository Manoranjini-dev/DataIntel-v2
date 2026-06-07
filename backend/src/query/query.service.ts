// ──────────────────────────────────────────────
// Query Service — Full Orchestration Pipeline
// ──────────────────────────────────────────────
//
// Pipeline: NL → LLM → Validate → [Approve] → Execute via MCP → Respond
//
// Supports both SQL (MySQL/Postgres) and ES DSL (Elasticsearch) paths.
// The connector family is resolved from the session and routes through
// the appropriate validation engine and LLM prompt set.
//

import { Injectable, Logger, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { LLMService } from '../llm/llm.service';
import { PromptBuilderService } from '../llm/prompt-builder.service';
import { MCPService } from '../mcp/mcp.service';
import { MemoryService } from '../memory/memory.service';
import { SchemaService } from '../schema/schema.service';
import { ValidationService } from '../validation/validation.service';
import { ESValidationService } from '../validation/es/es-validation.service';
import { AuditLogEntry, ConnectorFamily, ErrorType, ValidationVerdict, getConnectorFamily } from '../common/types';
import { QueryPlanResult, QueryExecutionResponse, QueryStreamEvent, DashboardWidget } from './types';
import type { UIHint } from '../llm/types';

@Injectable()
export class QueryService {
  private readonly logger = new Logger(QueryService.name);

  /** Audit log — append-only in memory for MVP */
  private readonly auditLog: AuditLogEntry[] = [];

  constructor(
    private readonly llmService: LLMService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly validationService: ValidationService,
    private readonly esValidationService: ESValidationService,
    private readonly mcpService: MCPService,
    private readonly schemaService: SchemaService,
    private readonly memoryService: MemoryService,
  ) {}

  /**
   * STEP 1: Generate query plan from natural language.
   * Routes through SQL or ES DSL pipeline based on connector family.
   * Returns validated plan — awaits frontend approval before execution.
   */
  async generatePlan(sessionId: string, prompt: string): Promise<QueryPlanResult> {
    this.logger.log(`Generating plan for session ${sessionId}: "${prompt.substring(0, 80)}"`);

    // Validate prerequisites
    this.validateSession(sessionId);

    // Resolve connector family from session
    const session = this.mcpService.getSession(sessionId);
    const connectorFamily = session
      ? getConnectorFamily(session.connectorType)
      : 'sql';

    // Get schema context
    const compressedSchema = this.schemaService.getCompressedSchema(sessionId);
    if (!compressedSchema) {
      throw new BadRequestException('No schema available for this session');
    }

    // Get memory context
    const contextWindow = this.memoryService.getContextWindow(sessionId);

    // Add user message to memory
    this.memoryService.addUserMessage(sessionId, prompt);

    // Assemble LLM context with connector-aware prompts
    const context = this.promptBuilder.assembleContext({
      compressedSchema,
      conversationSummary: contextWindow.summary,
      recentMessages: contextWindow.recentMessages,
      userPrompt: prompt,
      connectorFamily: connectorFamily as any, // patched
    });

    // Generate query via LLM
    let llmResponse;
    try {
      llmResponse = await this.llmService.generateSQL(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LLM generation failed';
      throw new HttpException(
        { type: ErrorType.LLM_FORMAT_VIOLATION, message },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // If LLM returned no query (conversational answer or low-confidence fallback), return immediately
    if (!llmResponse.sql) {
      this.memoryService.addAssistantMessage(sessionId, llmResponse.explanation, {
        confidence: llmResponse.confidence,
      });

      const isConversational = llmResponse.type === 'conversational';
      return {
        sql: '',
        explanation: llmResponse.explanation,
        tables_used: [],
        confidence: llmResponse.confidence,
        validationVerdict: isConversational ? 'CONVERSATIONAL' : 'REJECT',
        validationReasons: isConversational ? [] : ['LLM could not generate a valid query'],
        requiresApproval: false,
        follow_up_questions: llmResponse.follow_up_questions,
      };
    }

    // Validate through the appropriate engine
    let validationVerdict: 'ACCEPT' | 'REJECT';
    let validationReasons: string[];
    let validatedQuery: string;

    if (connectorFamily === 'elasticsearch') {
      // ES DSL validation path — with one auto-retry on failure
      const graph = this.schemaService.getGraph(sessionId);
      let esResult = this.esValidationService.validate(llmResponse.sql, graph);

      // Auto-retry: feed validation error back to LLM for one correction attempt
      if (esResult.verdict === 'REJECT' && llmResponse.sql) {
        this.logger.warn(
          `ES validation rejected, attempting auto-retry with feedback: ${esResult.reasons.join('; ')}`,
        );
        try {
          const retryContext: typeof context & { validationFeedback: string } = {
            ...context,
            validationFeedback: esResult.reasons.join('\n'),
          };
          const retryResponse = await this.llmService.generateSQL(retryContext);
          if (retryResponse.sql) {
            const retryResult = this.esValidationService.validate(retryResponse.sql, graph);
            if (retryResult.verdict === 'ACCEPT') {
              this.logger.log('ES auto-retry succeeded — using corrected query');
              llmResponse = retryResponse;
              esResult = retryResult;
            } else {
              this.logger.warn(`ES auto-retry still rejected: ${retryResult.reasons.join('; ')}`);
              // Use the retry's rejection (may be more specific)
              esResult = retryResult;
            }
          }
        } catch (retryError) {
          this.logger.warn(
            `ES auto-retry LLM call failed: ${retryError instanceof Error ? retryError.message : 'unknown'}`,
          );
          // Fall through with original rejection
        }
      }

      validationVerdict = esResult.verdict;
      validationReasons = esResult.reasons;
      validatedQuery = esResult.queryDsl;
    } else {
      // SQL validation path
      const graph = this.schemaService.getGraph(sessionId);
      const sqlResult = this.validationService.validate(llmResponse.sql, graph);
      validationVerdict = sqlResult.verdict;
      validationReasons = sqlResult.reasons;
      validatedQuery = sqlResult.sql;
    }

    // Record in audit log
    this.recordAudit(sessionId, prompt, llmResponse.sql, validationVerdict, validationReasons);

    // Store in memory
    this.memoryService.addAssistantMessage(sessionId, llmResponse.explanation, {
      sql: llmResponse.sql,
      tables_used: llmResponse.tables_used,
      confidence: llmResponse.confidence,
    });

    return {
      sql: validationVerdict === 'ACCEPT' ? validatedQuery : '',
      explanation: llmResponse.explanation,
      tables_used: llmResponse.tables_used,
      confidence: llmResponse.confidence,
      validationVerdict,
      validationReasons,
      requiresApproval: validationVerdict === 'ACCEPT',
      ui_hint: llmResponse.ui_hint,
      follow_up_questions: llmResponse.follow_up_questions,
    };
  }

  /**
   * STEP 2: Execute approved, validated query through MCP.
   * Requires explicit frontend approval.
   * Routes SQL or ES DSL through the appropriate validation and execution path.
   */
  async executeApproved(
    sessionId: string,
    sql: string,
    prompt?: string,
  ): Promise<QueryExecutionResponse> {
    this.logger.log(`Executing approved query for session ${sessionId}`);

    this.validateSession(sessionId);

    // Resolve connector family
    const session = this.mcpService.getSession(sessionId);
    const connectorFamily = session
      ? getConnectorFamily(session.connectorType)
      : 'sql';

    // Re-validate before execution (defense in depth)
    if (connectorFamily === 'elasticsearch') {
      const graph = this.schemaService.getGraph(sessionId);
      const esReValidation = this.esValidationService.validate(sql, graph);
      if (esReValidation.verdict !== 'ACCEPT') {
        throw new HttpException(
          {
            type: ErrorType.VALIDATION_REJECTION,
            message: 'ES DSL re-validation failed before execution',
            details: { reasons: esReValidation.reasons },
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      // Use possibly-patched DSL
      sql = esReValidation.queryDsl;
    } else {
      const graph = this.schemaService.getGraph(sessionId);
      const reValidation = this.validationService.validate(sql, graph);
      if (reValidation.verdict !== 'ACCEPT') {
        throw new HttpException(
          {
            type: ErrorType.VALIDATION_REJECTION,
            message: 'SQL re-validation failed before execution',
            details: { reasons: reValidation.reasons },
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Execute through MCP tool boundary
    const result = await this.mcpService.executeReadQuery(sessionId, sql);

    if (!result.success || !result.data) {
      const errorMessage = result.error || 'Query execution failed';

      if (errorMessage.includes('timeout')) {
        throw new HttpException(
          { type: ErrorType.EXECUTION_TIMEOUT, message: errorMessage },
          HttpStatus.REQUEST_TIMEOUT,
        );
      }

      throw new HttpException(
        { type: ErrorType.INTERNAL_ERROR, message: errorMessage },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Extract target tables/indices
    let tables: string[];
    if (connectorFamily === 'elasticsearch') {
      tables = this.esValidationService.extractIndicesFromDSL(sql);
    } else {
      tables = this.validationService.extractTablesFromSQL(sql);
    }

    // Store result values in memory so follow-up queries can reference actual
    // emails, IDs, names etc. instead of generating placeholder values.
    this.memoryService.appendResultSummary(sessionId, result.data.rows, result.data.columns);

    // Generate AI insight — interpret the results in natural language
    let insight: string | undefined;
    if (prompt) {
      insight = await this.llmService.interpretResults(
        prompt,
        sql,
        result.data.columns,
        result.data.rows,
        result.data.rowCount,
        connectorFamily,
      );
    }

    return {
      sql,
      explanation: '',
      tables_used: tables,
      confidence: 0,
      executionTime: result.executionTimeMs,
      rowCount: result.data.rowCount,
      rows: result.data.rows,
      columns: result.data.columns,
      insight,
      totalHits: result.data.totalHits,
    };
  }

  /**
   * Combined pipeline: Generate → Validate → Return plan for approval.
   * NEVER auto-executes. Frontend must call /execute with explicit approval.
   */
  async ask(
    sessionId: string,
    prompt: string,
  ): Promise<{
    plan: QueryPlanResult;
  }> {
    const plan = await this.generatePlan(sessionId, prompt);
    return { plan };
  }

  /**
   * Stream query events for progressive UI rendering.
   */
  async *streamQuery(
    sessionId: string,
    prompt: string,
  ): AsyncGenerator<QueryStreamEvent> {
    this.validateSession(sessionId);

    // Resolve connector family from session
    const session = this.mcpService.getSession(sessionId);
    const connectorFamily = session
      ? getConnectorFamily(session.connectorType)
      : 'sql';

    const compressedSchema = this.schemaService.getCompressedSchema(sessionId);
    if (!compressedSchema) {
      yield { type: 'error', data: { message: 'No schema available' } };
      return;
    }

    const contextWindow = this.memoryService.getContextWindow(sessionId);
    this.memoryService.addUserMessage(sessionId, prompt);

    const context = this.promptBuilder.assembleContext({
      compressedSchema,
      conversationSummary: contextWindow.summary,
      recentMessages: contextWindow.recentMessages,
      userPrompt: prompt,
      connectorFamily: connectorFamily as any,
    });

    // Stream explanation
    let finalResponse;
    try {
      for await (const chunk of this.llmService.streamExplanation(context)) {
        if (chunk.type === 'explanation') {
          yield { type: 'explanation', data: { text: chunk.content } };
        }
        if (chunk.type === 'complete' && chunk.data) {
          finalResponse = chunk.data;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stream failed';
      yield { type: 'error', data: { message } };
      return;
    }

    if (!finalResponse || !finalResponse.sql) {
      yield {
        type: 'plan',
        data: {
          sql: '',
          explanation: finalResponse?.explanation || 'Could not generate query',
          validationVerdict: 'REJECT',
        },
      };
      return;
    }

    // Validate — route through correct engine based on connector family
    const graph = this.schemaService.getGraph(sessionId);

    let validationVerdict: 'ACCEPT' | 'REJECT';
    let validationReasons: string[];
    let validatedQuery: string;

    if (connectorFamily === 'elasticsearch') {
      let esResult = this.esValidationService.validate(finalResponse.sql, graph);

      // Auto-retry: feed validation error back to LLM for one correction attempt
      if (esResult.verdict === 'REJECT' && finalResponse.sql) {
        this.logger.warn(
          `ES stream validation rejected, auto-retrying: ${esResult.reasons.join('; ')}`,
        );
        try {
          const retryContext = { ...context, validationFeedback: esResult.reasons.join('\n') };
          const retryResponse = await this.llmService.generateSQL(retryContext);
          if (retryResponse.sql) {
            const retryResult = this.esValidationService.validate(retryResponse.sql, graph);
            if (retryResult.verdict === 'ACCEPT') {
              finalResponse = retryResponse;
              esResult = retryResult;
            } else {
              esResult = retryResult;
            }
          }
        } catch {
          // Fall through with original rejection
        }
      }

      validationVerdict = esResult.verdict;
      validationReasons = esResult.reasons;
      validatedQuery = esResult.queryDsl;
    } else {
      const sqlResult = this.validationService.validate(finalResponse.sql, graph);
      validationVerdict = sqlResult.verdict;
      validationReasons = sqlResult.reasons;
      validatedQuery = sqlResult.sql;
    }

    yield {
      type: 'validation',
      data: {
        verdict: validationVerdict,
        reasons: validationReasons,
      },
    };

    yield {
      type: 'plan',
      data: {
        sql: validationVerdict === 'ACCEPT' ? validatedQuery : '',
        explanation: finalResponse.explanation,
        tables_used: finalResponse.tables_used,
        confidence: finalResponse.confidence,
        validationVerdict: validationVerdict,
        validationReasons: validationReasons,
        requiresApproval: validationVerdict === 'ACCEPT',
      },
    };

    this.memoryService.addAssistantMessage(sessionId, finalResponse.explanation, {
      sql: finalResponse.sql,
      tables_used: finalResponse.tables_used,
      confidence: finalResponse.confidence,
    });

    this.recordAudit(
      sessionId,
      prompt,
      finalResponse.sql,
      validationVerdict,
      validationReasons,
    );
  }

  /**
   * Explain schema — generates a plain-text AI summary of the database
   * from schema topology passed by the frontend. No SQL, no validation.
   */
  async explainSchema(
    schemaSummary: string,
    databaseName: string,
    connectorFamily?: ConnectorFamily,
  ): Promise<{ explanation: string }> {
    const isES = connectorFamily === 'elasticsearch';

    const system = isES
      ? `You are an expert Elasticsearch architect and data analyst.
Given an Elasticsearch cluster's index mappings summary, explain:
1. What kind of application or system these indices support
2. The purpose of each major index
3. How the indices relate to each other (shared fields, naming conventions, data flow)
4. Field mapping patterns and any interesting observations about the data model (nested objects, keyword vs text, date fields)

Format your response with clear sections using **bold headers**.
Be insightful, specific, and concise. Use bullet points where helpful.`
      : `You are an expert database architect and data analyst.
Given a database schema summary, explain:
1. What kind of application or business this database supports
2. The purpose of each major table
3. The most important relationships between tables
4. Any interesting observations about the data model

Format your response with clear sections using **bold headers**.
Be insightful, specific, and concise. Use bullet points where helpful.`;

    const entityLabel = isES ? 'Cluster' : 'Database';
    const schemaLabel = isES ? 'Index mappings summary' : 'Schema summary';
    const actionLabel = isES ? 'Explain these indices.' : 'Explain this database.';

    const user = `${entityLabel}: ${databaseName}

${schemaLabel}:
${schemaSummary}

${actionLabel}`;

    const explanation = await this.llmService.generateFreeText(system, user, 600);
    return { explanation };
  }

  /** Get query history for a session */
  getQueryHistory(sessionId: string): string[] {
    return this.memoryService.getPreviousQueries(sessionId);
  }

  /**
   * Generate dashboard widget queries for a connected datasource.
   * Uses schema metadata to create contextual queries that provide
   * an overview dashboard with various chart types.
   */
  async generateDashboardQueries(
    sessionId: string,
  ): Promise<{ widgets: DashboardWidget[] }> {
    this.logger.log(`Generating dashboard queries for session ${sessionId}`);
    this.validateSession(sessionId);

    const session = this.mcpService.getSession(sessionId);
    const connectorFamily = session
      ? getConnectorFamily(session.connectorType)
      : 'sql';

    const compressedSchema = this.schemaService.getCompressedSchema(sessionId);
    if (!compressedSchema) {
      throw new BadRequestException('No schema available for this session');
    }

    // Ask LLM to generate dashboard widget definitions
    const systemPrompt = this.buildDashboardPrompt(connectorFamily);
    const userContent = `SCHEMA:\n${compressedSchema}\n\nGenerate 6 dashboard widgets for this ${connectorFamily === 'elasticsearch' ? 'cluster' : 'database'}.`;

    try {
      const response = await this.llmService.generateFreeText(systemPrompt, userContent, 2048);

      // Parse the response as JSON
      let cleaned = response.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      cleaned = cleaned.trim();

      const parsed = JSON.parse(cleaned);
      const widgets: DashboardWidget[] = (parsed.widgets || parsed || []).map(
        (w: any, i: number) => ({
          id: `widget-${i}`,
          title: w.title || `Widget ${i + 1}`,
          prompt: w.prompt || w.question || '',
          ui_hint: w.ui_hint || 'data_table',
          size: w.size || (w.ui_hint === 'metric_card' ? 'sm' : 'md'),
        }),
      );

      return { widgets: widgets.slice(0, 8) };
    } catch (error) {
      // Fallback: generate sensible defaults from schema
      this.logger.warn(`Dashboard LLM generation failed, using fallback: ${error}`);
      return { widgets: this.generateFallbackWidgets(compressedSchema, connectorFamily) };
    }
  }

  /**
   * Execute a single dashboard widget query and return results.
   */
  async executeDashboardWidget(
    sessionId: string,
    prompt: string,
  ): Promise<QueryExecutionResponse & { ui_hint?: UIHint }> {
    try {
      const plan = await this.generatePlan(sessionId, prompt);
      if (plan.validationVerdict !== 'ACCEPT' || !plan.sql) {
        return {
          sql: '',
          explanation: plan.explanation || 'Could not generate a valid query for this widget.',
          tables_used: [],
          confidence: 0,
          executionTime: 0,
          rowCount: 0,
          rows: [],
          columns: [],
          ui_hint: plan.ui_hint,
        };
      }
      const result = await this.executeApproved(sessionId, plan.sql, prompt);
      return {
        ...result,
        ui_hint: plan.ui_hint || result.ui_hint,
      };
    } catch (error) {
      this.logger.warn(`Dashboard widget failed for prompt "${prompt}": ${error instanceof Error ? error.message : error}`);
      return {
        sql: '',
        explanation: 'This widget could not be loaded. Try a different question.',
        tables_used: [],
        confidence: 0,
        executionTime: 0,
        rowCount: 0,
        rows: [],
        columns: [],
      };
    }
  }

  private buildDashboardPrompt(connectorFamily: ConnectorFamily): string {
    const dataLabel = connectorFamily === 'elasticsearch' ? 'indices' : 'tables';
    return `You are a dashboard analytics expert. Given a database/cluster schema, generate exactly 6 dashboard widget definitions that provide a comprehensive overview.

Each widget should be a natural language question that can be converted to a query.

RESPOND WITH ONLY A VALID JSON ARRAY. No markdown, no code fences.

{"widgets": [
  {"title": "Widget Title", "prompt": "natural language question about the data", "ui_hint": "bar_chart", "size": "md"},
  ...
]}

UI_HINT options: "metric_card", "bar_chart", "line_chart", "pie_chart", "area_chart", "stat_grid", "data_table", "list"
SIZE options: "sm" (1/4 width, for metric_card), "md" (1/2 width), "lg" (full width)

RULES:
- Generate EXACTLY 6 widgets
- Start with 2 metric_card (size "sm") for key KPIs like total count, recent activity
- Include 1 bar_chart for categorical breakdown
- Include 1 line_chart for time trends (if date fields exist) or bar_chart
- Include 1 pie_chart for proportional data
- Include 1 data_table or list for recent records
- Keep prompts short and specific to the ${dataLabel}
- Use actual ${dataLabel} and field names from the schema
- Make each widget tell a different story about the data`;
  }

  private generateFallbackWidgets(schema: string, family: ConnectorFamily): DashboardWidget[] {
    // Extract table/index names from schema
    const namePattern = family === 'elasticsearch' ? /Index:\s*(\w+)/gi : /Table:\s*(\w+)/gi;
    const names: string[] = [];
    let match;
    while ((match = namePattern.exec(schema)) !== null) {
      names.push(match[1]);
    }
    if (names.length === 0) names.push('data');

    const entity = family === 'elasticsearch' ? 'documents' : 'records';

    return [
      { id: 'widget-0', title: `Total ${names[0]}`, prompt: `How many ${entity} are in ${names[0]}?`, ui_hint: 'metric_card', size: 'sm' },
      { id: 'widget-1', title: `${names[1] || names[0]} Count`, prompt: `How many ${entity} are in ${names[1] || names[0]}?`, ui_hint: 'metric_card', size: 'sm' },
      { id: 'widget-2', title: `${names[0]} Overview`, prompt: `Show the top 10 records from ${names[0]}`, ui_hint: 'data_table', size: 'lg' },
      { id: 'widget-3', title: `${names[0]} Distribution`, prompt: `Show distribution of ${entity} in ${names[0]}`, ui_hint: 'bar_chart', size: 'md' },
      { id: 'widget-4', title: `Recent ${names[0]}`, prompt: `Show the 5 most recent ${entity} from ${names[0]}`, ui_hint: 'list', size: 'md' },
      { id: 'widget-5', title: `${names[names.length - 1]} Summary`, prompt: `Summarize ${names[names.length - 1]}`, ui_hint: 'pie_chart', size: 'md' },
    ];
  }


  // ── Private Methods ──────────────────────────

  private validateSession(sessionId: string): void {
    if (!this.mcpService.isSessionActive(sessionId)) {
      throw new BadRequestException('No active database session. Connect first.');
    }
  }

  private recordAudit(
    sessionId: string,
    prompt: string,
    sql: string,
    verdict: 'ACCEPT' | 'REJECT',
    reasons: string[],
  ): void {
    const schemaHash = this.schemaService.getSchemaHash(sessionId) ?? 'unknown';
    const session = this.mcpService.getSession(sessionId);

    this.auditLog.push({
      timestamp: new Date(),
      sessionId,
      prompt,
      generatedSql: sql,
      validationResult: verdict === 'ACCEPT' ? ValidationVerdict.ACCEPT : ValidationVerdict.REJECT,
      validationReasons: reasons,
      schemaHash,
      connectorId: session?.connectorId ?? 'unknown',
    });

    // Keep audit log bounded
    if (this.auditLog.length > 10000) {
      this.auditLog.splice(0, this.auditLog.length - 10000);
    }
  }
}
