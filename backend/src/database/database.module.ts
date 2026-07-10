// ──────────────────────────────────────────────
// Database Module — Neon Postgres via pg Pool
// ──────────────────────────────────────────────

import { Module, Global, OnModuleDestroy, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DatabaseService } from './database.service';
import { DATABASE_POOL } from './database.constants';

export { DATABASE_POOL } from './database.constants';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: async (configService: ConfigService): Promise<Pool> => {
        const logger = new Logger('DatabaseModule');
        const databaseUrl = configService.get<string>('DATABASE_URL');

        if (!databaseUrl) {
          throw new Error('DATABASE_URL environment variable is not set');
        }

        const pool = new Pool({
          connectionString: databaseUrl,
          ssl: { rejectUnauthorized: false },
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 60000,
        });

        // Add error handler to prevent idle client errors from crashing Node.js
        pool.on('error', (err) => {
          logger.error(`Unexpected error on idle client: ${err.message}`, err.stack);
        });

        // Test connection with retries for serverless cold-start
        let lastError: any;
        for (let attempt = 1; attempt <= 5; attempt++) {
          try {
            const client = await pool.connect();
            const result = await client.query('SELECT NOW()');
            logger.log(`Database connected successfully at ${result.rows[0].now} (attempt ${attempt})`);
            client.release();
            lastError = null;
            break;
          } catch (error: any) {
            lastError = error;
            logger.warn(`Database connection attempt ${attempt}/5 failed: ${error.message || error}. Retrying in 4s...`);
            if (attempt < 5) {
              await new Promise(resolve => setTimeout(resolve, 4000));
            }
          }
        }

        if (lastError) {
          logger.error(`Database connection failed after 5 attempts: ${lastError}`);
          throw lastError;
        }

        return pool;
      },
      inject: [ConfigService],
    },
    DatabaseService,
  ],
  exports: [DATABASE_POOL, DatabaseService],
})
export class DatabaseModule implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
    this.logger.log('Database pool closed');
  }
}
