import { Injectable, Inject, Logger } from '@nestjs/common';
import { REDIS_CLIENT } from '../redis/redis.constants';
import Redis from 'ioredis';

@Injectable()
export class DashboardCacheService {
  private readonly logger = new Logger(DashboardCacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async getCachedWidgetResult(widgetId: string): Promise<any | null> {
    const raw = await this.redis.get(`widget:result:${widgetId}`);
    return raw ? JSON.parse(raw) : null;
  }

  async setCachedWidgetResult(widgetId: string, result: any, ttlSeconds = 300): Promise<void> {
    await this.redis.set(`widget:result:${widgetId}`, JSON.stringify(result), 'EX', ttlSeconds);
  }

  async acquireWidgetExecutionLock(widgetId: string, ttlMs: number): Promise<boolean> {
    const key = `widget:lock:${widgetId}`;
    const result = await this.redis.set(key, '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  async releaseWidgetExecutionLock(widgetId: string): Promise<void> {
    await this.redis.del(`widget:lock:${widgetId}`);
  }

  async getDashboardState(dashboardId: string): Promise<any | null> {
    const raw = await this.redis.get(`dashboard:${dashboardId}:state`);
    return raw ? JSON.parse(raw) : null;
  }

  async setDashboardState(dashboardId: string, state: any, ttlSeconds = 86400): Promise<void> {
    await this.redis.set(`dashboard:${dashboardId}:state`, JSON.stringify(state), 'EX', ttlSeconds);
  }

  async setDirtyFlag(dashboardId: string): Promise<void> {
    await this.redis.set(`dashboard:${dashboardId}:dirty`, '1', 'EX', 300);
  }

  async clearDirtyFlag(dashboardId: string): Promise<void> {
    await this.redis.del(`dashboard:${dashboardId}:dirty`);
  }
}
