// ──────────────────────────────────────────────
// Redis Service — Extended with pub/sub, key helpers, distributed locks
// ──────────────────────────────────────────────

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// ── Redis Key Factory ─────────────────────────────────────
// Centralized key construction to avoid typos and ensure consistency.
// Convention: dataintel:{env}:{context}:{id}:{subkey}
export const RedisKeys = {
  // Session
  session: (tokenHash: string) => `di:session:${tokenHash}`,

  // Org permissions (cached role resolution)
  orgPerm: (orgId: string, accountId: string) => `di:org-perm:${orgId}:${accountId}`,
  orgHierarchy: (orgId: string) => `di:org-perm:hierarchy:${orgId}`,

  // Connection runtime
  connSession: (connectionId: string) => `di:conn:session:${connectionId}`,
  connHealth: (connectionId: string) => `di:conn:health:${connectionId}`,
  connSchema: (connectionId: string) => `di:conn:schema:${connectionId}`,
  schemaSyncLock: (connectionId: string) => `di:schema-sync:lock:${connectionId}`,
  schemaSyncStatus: (connectionId: string) => `di:schema-sync:status:${connectionId}`,

  // Widget cache
  widgetResult: (widgetId: string) => `di:widget:result:${widgetId}`,
  widgetLock: (widgetId: string) => `di:widget:lock:${widgetId}`,

  // Dashboard
  dashLayout: (dashId: string, pageId: string) => `di:dashboard:layout:${dashId}:${pageId}`,
  dashDraft: (dashId: string, accountId: string) => `di:dashboard:draft:${dashId}:${accountId}`,

  // Chat memory
  chatMemory: (chatId: string) => `di:chat:memory:${chatId}`,

  // Query execution
  queryStatus: (executionId: string) => `di:query:status:${executionId}`,
  queryResult: (executionId: string) => `di:query:result:${executionId}`,

  // Generation job
  genJob: (jobId: string) => `di:gen-job:${jobId}`,

  // Rate limiting
  rateLimitAccount: (accountId: string, bucket: string) => `di:rate:${accountId}:${bucket}`,
  rateLimitOrg: (orgId: string, bucket: string) => `di:rate:${orgId}:${bucket}`,

  // AI cost tracking
  aiCost: (orgId: string, month: string) => `di:ai-cost:${orgId}:${month}`,

  // User settings cache
  userSettings: (accountId: string) => `di:user:settings:${accountId}`,

  // Pub/Sub channels
  orgEvents: (orgId: string) => `di:events:${orgId}`,
  widgetRefreshChannel: (dashId: string) => `di:events:widget-refresh:${dashId}`,
  chatStreamChannel: (chatId: string) => `di:events:chat-stream:${chatId}`,
};

// TTL constants (seconds)
export const RedisTTL = {
  SESSION: 7 * 24 * 3600,        // 7 days
  ORG_PERM: 5 * 60,               // 5 minutes
  ORG_HIERARCHY: 10 * 60,         // 10 minutes
  CONN_SCHEMA: 3600,              // 1 hour
  CONN_HEALTH: 5 * 60,           // 5 minutes
  CONN_SESSION: 30 * 60,         // 30 minutes (sliding)
  SCHEMA_SYNC_LOCK: 15 * 60,    // 15 minutes
  WIDGET_RESULT: 300,            // 5 minutes (default, overridden per widget)
  WIDGET_LOCK: 30,               // 30 seconds (stampede prevention)
  DASH_LAYOUT: 10 * 60,         // 10 minutes
  DASH_DRAFT: 24 * 3600,        // 24 hours
  CHAT_MEMORY: 24 * 3600,       // 24 hours
  QUERY_STATUS: 10 * 60,        // 10 minutes
  QUERY_RESULT: 5 * 60,         // 5 minutes
  GEN_JOB: 3600,                // 1 hour
  USER_SETTINGS: 15 * 60,       // 15 minutes
};

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private subscriber!: Redis;   // dedicated pub/sub subscriber connection
  private publisher!: Redis;    // dedicated pub/sub publisher connection

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const url = this.config.get<string>('REDIS_URL');

    if (!url) {
      this.logger.warn('REDIS_URL not set — Redis features will be disabled');
      return;
    }

    const opts = {
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    };

    this.client = new Redis(url, opts);
    this.subscriber = new Redis(url, { ...opts, lazyConnect: false });
    this.publisher = new Redis(url, opts);

    this.client.on('error', (e) => this.logger.error(`Redis client error: ${e.message}`));
    this.subscriber.on('error', (e) => this.logger.error(`Redis subscriber error: ${e.message}`));

    this.logger.log('Redis connected');
  }

  async onModuleDestroy() {
    await Promise.all([
      this.client?.quit(),
      this.subscriber?.quit(),
      this.publisher?.quit(),
    ]);
  }

  get isAvailable(): boolean {
    return !!this.client && this.client.status === 'ready';
  }

  // ── Basic Operations ──────────────────────────────────

  async get(key: string): Promise<string | null> {
    if (!this.isAvailable) return null;
    return this.client.get(key);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (!this.isAvailable) return;
    if (ttlSec) {
      await this.client.setex(key, ttlSec, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async setJson(key: string, value: unknown, ttlSec?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSec);
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.isAvailable || !keys.length) return;
    await this.client.del(...keys);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isAvailable) return false;
    return (await this.client.exists(key)) === 1;
  }

  async expire(key: string, ttlSec: number): Promise<void> {
    if (!this.isAvailable) return;
    await this.client.expire(key, ttlSec);
  }

  async ttl(key: string): Promise<number> {
    if (!this.isAvailable) return -2;
    return this.client.ttl(key);
  }

  // ── Hash Operations ───────────────────────────────────

  async hset(key: string, field: string, value: string, ttlSec?: number): Promise<void> {
    if (!this.isAvailable) return;
    await this.client.hset(key, field, value);
    if (ttlSec) await this.client.expire(key, ttlSec);
  }

  async hget(key: string, field: string): Promise<string | null> {
    if (!this.isAvailable) return null;
    return this.client.hget(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    if (!this.isAvailable) return {};
    return this.client.hgetall(key);
  }

  async hdel(key: string, ...fields: string[]): Promise<void> {
    if (!this.isAvailable) return;
    await this.client.hdel(key, ...fields);
  }

  // ── Increment / Counters ──────────────────────────────

  async incr(key: string): Promise<number> {
    if (!this.isAvailable) return 0;
    return this.client.incr(key);
  }

  async incrby(key: string, delta: number): Promise<number> {
    if (!this.isAvailable) return 0;
    return this.client.incrby(key, delta);
  }

  async incrbyfloat(key: string, delta: number): Promise<number> {
    if (!this.isAvailable) return 0;
    return parseFloat(await this.client.incrbyfloat(key, delta));
  }

  // ── Distributed Lock ──────────────────────────────────
  // SET NX EX pattern (single-instance; use Redlock for multi-node)

  async acquireLock(key: string, ttlSec: number, owner: string): Promise<boolean> {
    if (!this.isAvailable) return true; // fail open if Redis unavailable
    const result = await this.client.set(key, owner, 'EX', ttlSec, 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string, owner: string): Promise<void> {
    if (!this.isAvailable) return;
    // Atomic: only delete if we own the lock
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await this.client.eval(script, 1, key, owner);
  }

  // ── Pub/Sub ───────────────────────────────────────────

  async publish(channel: string, message: unknown): Promise<void> {
    if (!this.isAvailable) return;
    await this.publisher.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel: string, handler: (message: unknown) => void): Promise<void> {
    if (!this.isAvailable) return;
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch: string, raw: string) => {
      if (ch === channel) {
        try {
          handler(JSON.parse(raw));
        } catch {
          handler(raw);
        }
      }
    });
  }

  async unsubscribe(channel: string): Promise<void> {
    if (!this.isAvailable) return;
    await this.subscriber.unsubscribe(channel);
  }

  // ── Pattern Delete (for cache invalidation) ───────────

  async delPattern(pattern: string): Promise<number> {
    if (!this.isAvailable) return 0;
    const keys = await this.client.keys(pattern);
    if (!keys.length) return 0;
    await this.client.del(...keys);
    return keys.length;
  }

  // ── Sliding window rate limit ─────────────────────────

  async checkRateLimit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    if (!this.isAvailable) return { allowed: true, remaining: limit, resetAt: 0 };

    const script = `
      local key = KEYS[1]
      local limit = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      
      local count = redis.call('incr', key)
      if count == 1 then
        redis.call('expire', key, window)
      end
      
      local ttl = redis.call('ttl', key)
      return {count, ttl}
    `;

    const now = Math.floor(Date.now() / 1000);
    const [count, ttl] = (await this.client.eval(script, 1, key, limit, windowSec, now)) as [number, number];

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt: now + ttl,
    };
  }

  // ── Direct client access (for advanced use) ───────────
  getClient(): Redis {
    return this.client;
  }
}
