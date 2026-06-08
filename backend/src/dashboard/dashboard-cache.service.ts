import { Injectable, Inject, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class DashboardCacheService {
  private readonly logger = new Logger(DashboardCacheService.name);

  constructor(private readonly cache: CacheService) {}

  async getCachedWidgetResult(widgetId: string): Promise<any | null> {
    const raw = await this.cache.get(`widget:result:${widgetId}`);
    return raw ? JSON.parse(raw) : null;
  }

  async setCachedWidgetResult(widgetId: string, result: any, ttlSeconds = 300): Promise<void> {
    await this.cache.set(`widget:result:${widgetId}`, JSON.stringify(result), ttlSeconds);
  }

  async acquireWidgetExecutionLock(widgetId: string, ttlMs: number): Promise<boolean> {
    const key = `widget:lock:${widgetId}`;
    return await this.cache.acquireLock(key, Math.ceil(ttlMs / 1000), '1');
  }

  async releaseWidgetExecutionLock(widgetId: string): Promise<void> {
    await this.cache.del(`widget:lock:${widgetId}`);
  }

  async getDashboardState(dashboardId: string): Promise<any | null> {
    const raw = await this.cache.get(`dashboard:${dashboardId}:state`);
    return raw ? JSON.parse(raw) : null;
  }

  async setDashboardState(dashboardId: string, state: any, ttlSeconds = 86400): Promise<void> {
    await this.cache.set(`dashboard:${dashboardId}:state`, JSON.stringify(state), ttlSeconds);
  }

  async setDirtyFlag(dashboardId: string): Promise<void> {
    await this.cache.set(`dashboard:${dashboardId}:dirty`, '1', 300);
  }

  async clearDirtyFlag(dashboardId: string): Promise<void> {
    await this.cache.del(`dashboard:${dashboardId}:dirty`);
  }
}
