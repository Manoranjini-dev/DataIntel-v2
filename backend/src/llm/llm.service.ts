// ──────────────────────────────────────────────
// LLM Service — OpenRouter Inference Orchestration
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PromptBuilderService } from './prompt-builder.service';
import { LLMContext, LLMResponse, LLMStreamChunk, UIHint } from './types';

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxRetries = 2;

  constructor(
    private readonly configService: ConfigService,
    private readonly promptBuilder: PromptBuilderService,
  ) {
    const apiKey = this.configService.get<string>('OPEN_ROUTER_KEY');
    const baseURL = this.configService.get<string>('OPEN_ROUTER_API_URL') || 'https://openrouter.ai/api/v1';

    if (!apiKey) {
      throw new Error('OPEN_ROUTER_KEY is required');
    }

    this.client = new OpenAI({
      apiKey,
      baseURL,
    });

    this.model =
      this.configService.get<string>('OPEN_ROUTER_MODEL') ?? 'openai/gpt-oss-120b';
    this.logger.log(`LLM Service initialized — model: ${this.model}`);
  }

  /**
   * Generate a query from natural language.
   * Routes to SQL or ES DSL parsing based on context.connectorFamily.
   * Retries once on JSON parse failure. Never repairs output.
   */
  async generateSQL(context: LLMContext): Promise<LLMResponse> {
    const messages = this.promptBuilder.contextToMessages(context);
    let lastError: string | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        // On retries, strongly reinforce the JSON-only requirement with an example
        // structure so the model cannot mistake the response format.
        const retryHint =
          context.connectorFamily === 'elasticsearch'
            ? '{"query_dsl":{"_index":"...","size":0,"query":{"match_all":{}}},"explanation":"...","target_indices":["..."],"confidence":0.9,"intent":"search","ui_hint":"table","follow_up_questions":["...","...","..."]}'
            : '{"sql":"SELECT ...","explanation":"...","tables_used":["..."],"confidence":0.9,"ui_hint":"table","follow_up_questions":["...","...","..."]}';

        const messagesForApi = attempt === 0
          ? messages
          : [
              ...messages,
              {
                role: 'system' as const,
                content:
                  `CRITICAL FORMAT ERROR: Your previous output was not valid JSON. ` +
                  `You MUST respond with ONLY a valid JSON object — no markdown, no code fences, no surrounding text. ` +
                  `Required structure (fill in real values):\n${retryHint}`,
              },
            ];

        const completion = await this.client.chat.completions.create({
          model: this.model,
          messages: messagesForApi,
          temperature: 0.1,
          max_tokens: 2048,
          top_p: 0.95,
        });

        const content = completion.choices[0]?.message?.content;
        if (!content) {
          throw new Error('Empty response from LLM');
        }

        // Parse based on connector family
        const parsed =
          context.connectorFamily === 'elasticsearch'
            ? this.parseESResponse(content)
            : this.parseResponse(content);

        this.logger.log(
          `Query generated (attempt ${attempt + 1}, family=${context.connectorFamily}): confidence=${parsed.confidence}, targets=${parsed.tables_used.join(',')}`,
        );
        return parsed;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        
        if (lastError.includes('402') || lastError.includes('401') || lastError.includes('Insufficient credits')) {
          this.logger.error(`LLM API Error (Fast Fail): ${lastError}`);
          throw new Error(`LLM format violation after ${attempt + 1} attempts: ${lastError}`);
        }

        this.logger.warn(`LLM generation attempt ${attempt + 1} failed: ${lastError}`);

        if (attempt === this.maxRetries) {
          break;
        }
      }
    }

    // All retries exhausted — reject, never repair
    throw new Error(`LLM format violation after ${this.maxRetries + 1} attempts: ${lastError}`);
  }

  /**
   * Stream explanation narrative.
   * Streams the explanation character by character for progressive rendering.
   */
  async *streamExplanation(context: LLMContext): AsyncGenerator<LLMStreamChunk> {
    // First, get the full structured response
    const response = await this.generateSQL(context);

    // Stream the explanation word by word for progressive rendering
    const words = response.explanation.split(' ');
    let accumulated = '';

    for (let i = 0; i < words.length; i++) {
      accumulated += (i > 0 ? ' ' : '') + words[i];
      yield { type: 'explanation', content: accumulated };
    }

    // Final chunk with complete data
    yield { type: 'complete', content: response.explanation, data: response };
  }

  /**
   * Interpret query results in natural language.
   * Called post-execution to produce a conversational AI response about the data.
   * Works for both SQL results and ES search results.
   */
  async interpretResults(
    originalPrompt: string,
    sql: string,
    columns: string[],
    rows: Record<string, unknown>[],
    rowCount: number,
    connectorFamily: 'sql' | 'elasticsearch' | 'document' | 'databricks' = 'sql',
  ): Promise<string> {
    const isES = connectorFamily === 'elasticsearch';
    const queryLabel = isES ? 'Elasticsearch DSL' : 'SQL';

    const systemPrompt = `You are a senior data analyst embedded in a business intelligence platform. Your sole job is to translate query results into a sharp, human-readable insight.

Rules — follow every one without exception:
- Lead immediately with the most important number, name, or trend that directly answers the question
- Cite at least one specific value from the results (exact figure, name, date, percentage)
- If the data reveals a notable pattern, outlier, or comparison, mention it in a second sentence
- Maximum 3 sentences — no padding, no filler, no throat-clearing phrases
- Never describe the ${queryLabel} query or mention technical terms like "query", "rows", "columns", "SELECT", "aggregate"
- Never open with "The data shows", "The results indicate", "Based on the query" — state findings as facts, like a human analyst would
- Write for a non-technical business audience — plain English only
- For zero results: say what wasn't found and suggest the most likely reason in one sentence
- For single-value results: state the number with full context (what it measures, over what scope if known)
- For ranked/grouped results: name the top performer and the gap to second if notable
- For time-series: identify the direction (rising/falling/flat) and the magnitude of change`;

    const sampleRows = rows.slice(0, 25);
    const userContent = [
      `User question: "${originalPrompt}"`,
      ``,
      `${queryLabel} executed:`,
      sql,
      ``,
      `Column names: ${columns.join(', ')}`,
      `Total rows returned: ${rowCount}`,
      ``,
      `Data (first ${sampleRows.length} rows):`,
      JSON.stringify(sampleRows, null, 2),
    ].join('\n');

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.35,
        max_tokens: 320,
      });

      const text = completion.choices[0]?.message?.content?.trim();
      if (!text) throw new Error('Empty insight response');
      this.logger.log(`Result interpretation generated (${text.length} chars)`);
      return text;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`interpretResults failed: ${msg}`);
      return rowCount === 0
        ? 'No results were found matching your criteria.'
        : `Found ${rowCount} result${rowCount !== 1 ? 's' : ''}.`;
    }
  }

  /**
   * Generate plain free-text response — no SQL, no JSON parsing.
   * Used for schema explanation, contextual summaries, etc.
   */
  async generateFreeText(
    systemPrompt: string,
    userContent: string,
    maxTokens = 512,
    options: { reasoningEffort?: 'low' | 'medium' | 'high' } = {},
  ): Promise<string> {
    let lastError = 'Unknown error';

    // Reasoning models (e.g. openai/gpt-oss-*) spend part of the token budget on
    // hidden reasoning before emitting any visible content. A tight cap (e.g. 50
    // tokens for a title) gets fully consumed by reasoning, so `content` comes
    // back EMPTY. Enforce a floor so the model always has room to emit the answer.
    const effectiveMaxTokens = Math.max(maxTokens, 256);

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        this.logger.debug(
          `generateFreeText attempt ${attempt + 1}: maxTokens=${effectiveMaxTokens} ` +
          `reasoningEffort=${options.reasoningEffort ?? 'default'} ` +
          `system="${systemPrompt.slice(0, 100).replace(/\s+/g, ' ')}" ` +
          `user="${userContent.slice(0, 200).replace(/\s+/g, ' ')}"`,
        );

        // Build the request explicitly so we can attach OpenRouter's unified
        // `reasoning` control. Reasoning models (e.g. openai/gpt-oss-*) otherwise
        // spend the whole token budget on hidden reasoning and return EMPTY
        // visible content. Constraining the reasoning effort leaves room for the
        // model to emit the actual answer on the FIRST attempt. Models that don't
        // support the field simply ignore it.
        const request = {
          model: this.model,
          messages: [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userContent },
          ],
          temperature: 0.5,
          max_tokens: effectiveMaxTokens,
          ...(options.reasoningEffort
            ? { reasoning: { effort: options.reasoningEffort } }
            : {}),
        } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;

        const completion = await this.client.chat.completions.create(request);

        const choice = completion.choices?.[0];
        const message = choice?.message as
          | { content?: string | null; reasoning?: string | null }
          | undefined;

        // Primary source is `content`. Some OpenRouter reasoning models return an
        // empty `content` and place text in a separate `reasoning` field — use it
        // as a last-resort fallback so we still surface a usable answer.
        let text = (message?.content ?? '').trim();
        if (!text && typeof message?.reasoning === 'string') {
          text = message.reasoning.trim();
        }

        this.logger.debug(
          `generateFreeText raw response: finish_reason=${choice?.finish_reason ?? 'n/a'} ` +
          `contentLen=${(message?.content ?? '').length} ` +
          `reasoningLen=${(message?.reasoning ?? '').length} ` +
          `usage=${JSON.stringify(completion.usage ?? {})}`,
        );

        if (!text) {
          // Empty response — record why before retrying.
          this.logger.warn(
            `generateFreeText empty response on attempt ${attempt + 1} ` +
            `(finish_reason=${choice?.finish_reason ?? 'unknown'}). ` +
            `The model returned no content — likely the token budget was exhausted by reasoning.`,
          );
          throw new Error(`Empty response (finish_reason=${choice?.finish_reason ?? 'unknown'})`);
        }

        this.logger.debug(`generateFreeText parsed (${text.length} chars): "${text.slice(0, 120)}"`);
        return text;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(`generateFreeText attempt ${attempt + 1} failed: ${lastError}`);
      }
    }

    // All attempts failed — return an EMPTY string sentinel. Callers are
    // responsible for substituting a deterministic fallback. We deliberately do
    // NOT return a human-readable error string here, because callers used to
    // mistake it for a valid result.
    this.logger.error(`generateFreeText failed after ${this.maxRetries + 1} attempts: ${lastError}`);
    return '';
  }

  /** Parse LLM response — strict JSON only */
  private parseResponse(content: string): LLMResponse {
    // Strip markdown code fences if present
    let cleaned = content.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`LLM output is not valid JSON: ${cleaned.substring(0, 200)}`);
    }

    // Conversational or schema_query response — no data query needed
    if (parsed.type === 'conversational' || parsed.type === 'schema_query') {
      return {
        type: parsed.type,
        sql: '',
        explanation: (parsed.explanation as string) || '',
        tables_used: [],
        confidence: (parsed.confidence as number) ?? 1.0,
        ui_hint: (parsed.ui_hint as UIHint) || undefined,
        schema_query_params: parsed.schema_query_params as any,
        follow_up_questions: Array.isArray(parsed.follow_up_questions)
          ? (parsed.follow_up_questions as string[]).slice(0, 3)
          : undefined,
      };
    }

    // Validate required fields
    if (typeof parsed.sql !== 'string') {
      throw new Error('LLM response missing "sql" field');
    }
    if (typeof parsed.explanation !== 'string') {
      throw new Error('LLM response missing "explanation" field');
    }
    if (!Array.isArray(parsed.tables_used)) {
      throw new Error('LLM response missing "tables_used" array');
    }
    if (typeof parsed.confidence !== 'number') {
      throw new Error('LLM response missing "confidence" number');
    }

    return {
      sql: parsed.sql as string,
      explanation: parsed.explanation as string,
      tables_used: parsed.tables_used as string[],
      confidence: parsed.confidence as number,
      ui_hint: (parsed.ui_hint as UIHint) || undefined,
      follow_up_questions: Array.isArray(parsed.follow_up_questions)
        ? (parsed.follow_up_questions as string[]).slice(0, 3)
        : undefined,
    };
  }

  /**
   * Parse Elasticsearch DSL response from LLM.
   * Expected format:
   * {
   *   "query_dsl": { ... ES search body ... },
   *   "explanation": "...",
   *   "target_indices": ["index1"],
   *   "confidence": 0.95,
   *   "intent": "search"
   * }
   *
   * Normalizes to LLMResponse format where:
   * - sql = stringified query_dsl JSON
   * - tables_used = target_indices
   */
  private parseESResponse(content: string): LLMResponse {
    // Strip markdown code fences if present
    let cleaned = content.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`LLM output is not valid JSON: ${cleaned.substring(0, 200)}`);
    }

    // Conversational or schema_query response — no data query needed
    if (parsed.type === 'conversational' || parsed.type === 'schema_query') {
      return {
        type: parsed.type,
        sql: '',
        explanation: (parsed.explanation as string) || '',
        tables_used: [],
        confidence: (parsed.confidence as number) ?? 1.0,
        ui_hint: (parsed.ui_hint as UIHint) || undefined,
        schema_query_params: parsed.schema_query_params as any,
        follow_up_questions: Array.isArray(parsed.follow_up_questions)
          ? (parsed.follow_up_questions as string[]).slice(0, 3)
          : undefined,
      };
    }

    // Validate required ES-specific fields
    if (parsed.query_dsl === undefined && parsed.sql === undefined) {
      throw new Error('LLM response missing "query_dsl" field');
    }
    if (typeof parsed.explanation !== 'string') {
      throw new Error('LLM response missing "explanation" field');
    }
    if (typeof parsed.confidence !== 'number') {
      throw new Error('LLM response missing "confidence" number');
    }

    // Extract the query DSL — could be in query_dsl or sql field
    let queryDsl: unknown;
    if (parsed.query_dsl !== undefined) {
      queryDsl = parsed.query_dsl;
    } else {
      // Fallback: LLM used SQL format — try to parse sql field as JSON
      try {
        queryDsl = typeof parsed.sql === 'string' ? JSON.parse(parsed.sql) : parsed.sql;
      } catch {
        queryDsl = parsed.sql;
      }
    }

    // Extract target indices — normalize to string array
    let targetIndices: string[];
    const rawIndices = parsed.target_indices ?? parsed.tables_used;
    if (Array.isArray(rawIndices)) {
      targetIndices = rawIndices.map(String);
    } else if (typeof rawIndices === 'string') {
      targetIndices = rawIndices.split(',').map((s: string) => s.trim()).filter(Boolean);
    } else {
      targetIndices = [];
    }

    // Stringify the DSL for the pipeline (will be parsed again by validator/executor)
    const dslString =
      typeof queryDsl === 'object' && queryDsl !== null
        ? JSON.stringify(queryDsl, null, 2)
        : '';

    return {
      sql: dslString,
      explanation: parsed.explanation as string,
      tables_used: targetIndices,
      confidence: parsed.confidence as number,
      intent: (parsed.intent as string) || 'search',
      ui_hint: (parsed.ui_hint as UIHint) || undefined,
      follow_up_questions: Array.isArray(parsed.follow_up_questions)
        ? (parsed.follow_up_questions as string[]).slice(0, 3)
        : undefined,
    };
  }
}
