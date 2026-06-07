// ──────────────────────────────────────────────
// Redis Module — ioredis client
// ──────────────────────────────────────────────

import { Module, Global, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

export { REDIS_CLIENT } from './redis.constants';

import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('RedisModule');
        const redisUrl = configService.get<string>('REDIS_URL');

        if (!redisUrl) {
          logger.warn('REDIS_URL not set — Redis features will be disabled');
          return null;
        }

        const client = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          lazyConnect: true,
          reconnectOnError: (err) => {
            logger.warn(`Redis reconnect on error: ${err.message}`);
            return true;
          },
        });

        client.on('connect', () => logger.log('Redis connected'));
        client.on('error', (err) => logger.error(`Redis error: ${err.message}`));

        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
