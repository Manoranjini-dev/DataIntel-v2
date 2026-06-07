// ──────────────────────────────────────────────
// Environment Validation — Bootstrap Guard
// ──────────────────────────────────────────────

import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min, validateSync } from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsNumber() @Min(1)
  PORT: number = 3001;

  @IsString() @IsNotEmpty({ message: 'OPEN_ROUTER_KEY must not be empty' })
  OPEN_ROUTER_KEY!: string;

  @IsString() @IsOptional()
  OPEN_ROUTER_API_URL: string = 'https://openrouter.ai/api/v1';

  @IsString() @IsOptional()
  OPEN_ROUTER_MODEL: string = 'openai/gpt-oss-120b';

  @IsNumber() @IsOptional()
  MCP_EXECUTION_TIMEOUT_MS: number = 30000;

  @IsNumber() @IsOptional()
  MCP_MAX_RESULT_ROWS: number = 500;

  @IsNumber() @IsOptional()
  MEMORY_SLIDING_WINDOW_SIZE: number = 20;

  @IsNumber() @IsOptional()
  MEMORY_SUMMARY_TOKEN_THRESHOLD: number = 4000;

  @IsNumber() @IsOptional()
  SCHEMA_CACHE_TTL_SECONDS: number = 300;

  @IsString() @IsOptional()
  LOG_LEVEL: string = 'debug';

  // ── Database (Neon Postgres) ──────────────────

  @IsString() @IsNotEmpty({ message: 'DATABASE_URL must not be empty' })
  DATABASE_URL!: string;

  // ── Redis (optional) ──────────────────────────

  @IsString() @IsOptional()
  REDIS_URL?: string;

  // ── Auth & Sessions ───────────────────────────

  @IsString() @IsNotEmpty({ message: 'SESSION_SECRET must not be empty' })
  SESSION_SECRET!: string;

  @IsString() @IsOptional()
  COOKIE_DOMAIN: string = 'localhost';

  @IsString() @IsOptional()
  COOKIE_SECURE: string = 'false';

  @IsNumber() @IsOptional()
  SESSION_TTL_HOURS: number = 168;

  // ── Encryption ────────────────────────────────

  @IsString() @IsNotEmpty({ message: 'CREDENTIAL_ENCRYPTION_KEY must not be empty' })
  CREDENTIAL_ENCRYPTION_KEY!: string;
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const messages = errors
      .map((err) => Object.values(err.constraints || {}).join(', '))
      .join('; ');
    throw new Error(`Environment validation failed: ${messages}`);
  }

  return validatedConfig;
}
