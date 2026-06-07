// ──────────────────────────────────────────────
// Rate Limit Guard — Redis-backed sliding window
// Usage: @UseGuards(RateLimitGuard) @RateLimit(60, 10)
// 10 requests per 60 seconds per account
// ──────────────────────────────────────────────

import {
  Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';

export const RATE_LIMIT_META = 'rateLimit';
export const RateLimit = (windowSec: number, maxRequests: number) =>
  SetMetadata(RATE_LIMIT_META, { windowSec, maxRequests });

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<{ windowSec: number; maxRequests: number }>(
      RATE_LIMIT_META,
      [context.getHandler(), context.getClass()],
    );

    if (!meta) return true; // No rate limit configured

    const request = context.switchToHttp().getRequest();
    const accountId = request.user?.id;
    if (!accountId) return true; // Auth guard handles auth; rate limit only applies to authenticated users

    const handlerName = context.getHandler().name;
    const key = `ratelimit:${accountId}:${handlerName}`;

    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, meta.windowSec);
    }

    if (current > meta.maxRequests) {
      throw new HttpException(
        {
          type: 'RateLimitExceeded',
          message: `Too many requests. Max ${meta.maxRequests} per ${meta.windowSec}s.`,
          retryAfter: meta.windowSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
