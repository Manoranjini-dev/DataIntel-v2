import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export const CacheKeys = {
  session: (tokenHash: string) => `di:session:${tokenHash}`,
  orgPerm: (orgId: string, accountId: string) => `di:org-perm:${orgId}:${accountId}`,
  orgHierarchy: (orgId: string) => `di:org-perm:hierarchy:${orgId}`,
  connSession: (connectionId: string) => `di:conn:session:${connectionId}`,
  connHealth: (connectionId: string) => `di:conn:health:${connectionId}`,
  connSchema: (connectionId: string) => `di:conn:schema:${connectionId}`,
  schemaSyncLock: (connectionId: string) => `di:schema-sync:lock:${connectionId}`,
  schemaSyncStatus: (connectionId: string) => `di:schema-sync:status:${connectionId}`,
  widgetResult: (widgetId: string) => `di:widget:result:${widgetId}`,
  widgetLock: (widgetId: string) => `di:widget:lock:${widgetId}`,
  dashLayout: (dashId: string, pageId: string) => `di:dashboard:layout:${dashId}:${pageId}`,
  dashDraft: (dashId: string, accountId: string) => `di:dashboard:draft:${dashId}:${accountId}`,
  chatMemory: (chatId: string) => `di:chat:memory:${chatId}`,
  queryStatus: (executionId: string) => `di:query:status:${executionId}`,
  queryResult: (executionId: string) => `di:query:result:${executionId}`,
  genJob: (jobId: string) => `di:gen-job:${jobId}`,
  rateLimitAccount: (accountId: string, bucket: string) => `di:rate:${accountId}:${bucket}`,
  rateLimitOrg: (orgId: string, bucket: string) => `di:rate:${orgId}:${bucket}`,
  aiCost: (orgId: string, month: string) => `di:ai-cost:${orgId}:${month}`,
  userSettings: (accountId: string) => `di:user:settings:${accountId}`,
  orgEvents: (orgId: string) => `di:events:${orgId}`,
  widgetRefreshChannel: (dashId: string) => `di:events:widget-refresh:${dashId}`,
  chatStreamChannel: (chatId: string) => `di:events:chat-stream:${chatId}`,
};

export const CacheTTL = {
  SESSION: 7 * 24 * 3600,
  ORG_PERM: 5 * 60,
  ORG_HIERARCHY: 10 * 60,
  CONN_SCHEMA: 3600,
  CONN_HEALTH: 5 * 60,
  CONN_SESSION: 30 * 60,
  SCHEMA_SYNC_LOCK: 15 * 60,
  WIDGET_RESULT: 300,
  WIDGET_LOCK: 30,
  DASH_LAYOUT: 10 * 60,
  DASH_DRAFT: 24 * 3600,
  CHAT_MEMORY: 24 * 3600,
  QUERY_STATUS: 10 * 60,
  QUERY_RESULT: 5 * 60,
  GEN_JOB: 3600,
  USER_SETTINGS: 15 * 60,
};

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private store = new Map<string, { value: string; expiry: number | null }>();
  private hashStore = new Map<string, Map<string, string>>();
  
  constructor(private eventEmitter: EventEmitter2) {}

  async onModuleInit() {
    this.logger.log('In-Memory Cache (Redis Replacement) initialized.');
  }

  async onModuleDestroy() {
    this.store.clear();
    this.hashStore.clear();
  }

  get isAvailable(): boolean {
    return true; // Always available in memory
  }

  private cleanExpired(key: string) {
    const item = this.store.get(key);
    if (item && item.expiry && Date.now() > item.expiry) {
      this.store.delete(key);
      return true;
    }
    return false;
  }

  async get(key: string): Promise<string | null> {
    if (this.cleanExpired(key)) return null;
    return this.store.get(key)?.value || null;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    const expiry = ttlSec ? Date.now() + ttlSec * 1000 : null;
    this.store.set(key, { value, expiry });
  }

  async setJson(key: string, value: unknown, ttlSec?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSec);
  }

  async del(...keys: string[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(key);
      this.hashStore.delete(key);
    }
  }

  async exists(key: string): Promise<boolean> {
    this.cleanExpired(key);
    return this.store.has(key);
  }

  async expire(key: string, ttlSec: number): Promise<void> {
    const item = this.store.get(key);
    if (item) {
      item.expiry = Date.now() + ttlSec * 1000;
    }
  }

  async ttl(key: string): Promise<number> {
    const item = this.store.get(key);
    if (!item) return -2;
    if (!item.expiry) return -1;
    return Math.max(0, Math.floor((item.expiry - Date.now()) / 1000));
  }

  async hset(key: string, field: string, value: string, ttlSec?: number): Promise<void> {
    let hash = this.hashStore.get(key);
    if (!hash) {
      hash = new Map<string, string>();
      this.hashStore.set(key, hash);
    }
    hash.set(field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashStore.get(key)?.get(field) || null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.hashStore.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash.entries());
  }

  async hdel(key: string, ...fields: string[]): Promise<void> {
    const hash = this.hashStore.get(key);
    if (hash) {
      for (const f of fields) hash.delete(f);
    }
  }

  async incr(key: string): Promise<number> {
    const val = parseInt(await this.get(key) || '0', 10);
    const newVal = val + 1;
    await this.set(key, newVal.toString());
    return newVal;
  }

  async incrby(key: string, delta: number): Promise<number> {
    const val = parseInt(await this.get(key) || '0', 10);
    const newVal = val + delta;
    await this.set(key, newVal.toString());
    return newVal;
  }

  async incrbyfloat(key: string, delta: number): Promise<number> {
    const val = parseFloat(await this.get(key) || '0');
    const newVal = val + delta;
    await this.set(key, newVal.toString());
    return newVal;
  }

  async acquireLock(key: string, ttlSec: number, owner: string): Promise<boolean> {
    if (await this.get(key)) return false;
    await this.set(key, owner, ttlSec);
    return true;
  }

  async releaseLock(key: string, owner: string): Promise<void> {
    const current = await this.get(key);
    if (current === owner) await this.del(key);
  }

  async publish(channel: string, message: unknown): Promise<void> {
    this.eventEmitter.emit(`pubsub.${channel}`, JSON.stringify(message));
  }

  async subscribe(channel: string, handler: (message: unknown) => void): Promise<void> {
    this.eventEmitter.on(`pubsub.${channel}`, (raw: string) => {
      try { handler(JSON.parse(raw)); } catch { handler(raw); }
    });
  }

  async unsubscribe(channel: string): Promise<void> {
    this.eventEmitter.removeAllListeners(`pubsub.${channel}`);
  }

  async delPattern(pattern: string): Promise<number> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    let count = 0;
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  async checkRateLimit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const now = Math.floor(Date.now() / 1000);
    const val = parseInt(await this.get(key) || '0', 10);
    if (val === 0) {
      await this.set(key, '1', windowSec);
      return { allowed: 1 <= limit, remaining: Math.max(0, limit - 1), resetAt: now + windowSec };
    }
    const count = val + 1;
    this.store.get(key)!.value = count.toString();
    const ttl = await this.ttl(key);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt: now + ttl };
  }

  getClient(): any {
    return {
      hincrbyfloat: async (key: string, field: string, amt: number) => {
        let hash = this.hashStore.get(key);
        if(!hash) { hash = new Map(); this.hashStore.set(key, hash); }
        const current = parseFloat(hash.get(field) || '0');
        hash.set(field, (current + amt).toString());
      },
      hincrby: async (key: string, field: string, amt: number) => {
        let hash = this.hashStore.get(key);
        if(!hash) { hash = new Map(); this.hashStore.set(key, hash); }
        const current = parseInt(hash.get(field) || '0', 10);
        hash.set(field, (current + amt).toString());
      },
      hgetall: async (key: string) => this.hgetall(key)
    };
  }
}
