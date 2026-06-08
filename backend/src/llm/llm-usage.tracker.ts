// ──────────────────────────────────────────────
// LLM Usage Tracker — Track per-org token usage and cost in Redis
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class LLMUsageTracker {
  private readonly logger = new Logger(LLMUsageTracker.name);

  constructor(
    private readonly cache: CacheService,
    private readonly db: DatabaseService,
  ) {}

  /**
   * Track token usage for a specific organization.
   * Increments the Redis counter for fast tracking.
   * Optionally writes back to postgres in batches via a worker in a real scenario.
   */
  async trackUsage(
    orgId: string, 
    model: string, 
    promptTokens: number, 
    completionTokens: number,
    costUsd: number
  ) {
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    const redisKey = `di:llm_usage:${orgId}:${monthKey}`;

    try {
      if (this.cache.isAvailable) {
        // We can use a Redis hash to store stats for the month
        await this.cache.getClient().hincrbyfloat(redisKey, 'costUsd', costUsd);
        await this.cache.getClient().hincrby(redisKey, 'promptTokens', promptTokens);
        await this.cache.getClient().hincrby(redisKey, 'completionTokens', completionTokens);
        await this.cache.getClient().hincrby(redisKey, 'requestCount', 1);
      }

      // Async write to db for permanent record
      await this.db.query(
        `INSERT INTO org_llm_usage_logs
           (org_id, model, prompt_tokens, completion_tokens, cost_usd, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [orgId, model, promptTokens, completionTokens, costUsd]
      ).catch(e => {
        // We only warn here so failure to write log doesn't crash the query execution
        this.logger.warn(`Failed to write usage log to DB for org ${orgId}: ${e.message}`);
      });
      
    } catch (e) {
      this.logger.error(`Failed to track LLM usage in Redis for org ${orgId}`, e);
    }
  }

  /**
   * Retrieve usage stats for an org for a given month
   */
  async getUsageStats(orgId: string, monthKey: string) {
    const redisKey = `di:llm_usage:${orgId}:${monthKey}`;
    const stats = this.cache.isAvailable ? await this.cache.getClient().hgetall(redisKey) : {};
    
    return {
      costUsd: parseFloat(stats.costUsd || '0'),
      promptTokens: parseInt(stats.promptTokens || '0', 10),
      completionTokens: parseInt(stats.completionTokens || '0', 10),
      requestCount: parseInt(stats.requestCount || '0', 10),
    };
  }
}
