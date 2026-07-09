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

  // ── MCP Toolbox (external sidecar) ────────────
  // Master kill-switch. When false, all queries use the native connector path.
  @IsString() @IsOptional()
  TOOLBOX_ENABLED: string = 'false';

  @IsString() @IsOptional()
  TOOLBOX_URL: string = 'http://toolbox:5000';

  @IsString() @IsOptional()
  TOOLBOX_CONFIG_PATH: string = '/config/tools.yaml';

  /**
   * Comma-separated ConnectorType values routed through Toolbox. Mappable set:
   * mysql, postgres, redshift, bigquery, mssql, oracle, snowflake.
   * (Databricks / mongodb / elasticsearch always use the native path.)
   * Defaults to the best-tested pair; widen after per-connector shadow-diff.
   */
  @IsString() @IsOptional()
  TOOLBOX_ROUTED_CONNECTORS: string = 'mysql,postgres';

  @IsNumber() @IsOptional()
  TOOLBOX_STATEMENT_TIMEOUT_MS: number = 30000;

  @IsNumber() @IsOptional()
  TOOLBOX_MAX_ROWS: number = 500;

  /** TTL for the cached Toolbox health probe used by the routing guard. */
  @IsNumber() @IsOptional()
  TOOLBOX_HEALTH_TTL_MS: number = 5000;

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

  // Absolute maximum session lifetime (hard cap from creation). A session can
  // never live past created_at + this, even under continuous activity. Also
  // drives the session cookie maxAge. (Historically this was the sole TTL.)
  @IsNumber() @IsOptional()
  SESSION_TTL_HOURS: number = 168;

  // AUTH-03 — sliding inactivity window. A session expires this many minutes
  // after the LAST authenticated request; each request slides the deadline
  // forward (capped by SESSION_TTL_HOURS). Default 7 days preserves prior
  // behavior; shorten it to enforce stricter inactivity timeouts.
  @IsNumber() @IsOptional()
  SESSION_INACTIVITY_MINUTES: number = 10080;

  // AUTH-03 — minimum gap between sliding-expiry writes. Prevents a DB write on
  // every request; the deadline is only pushed forward once per this interval.
  @IsNumber() @IsOptional()
  SESSION_SLIDE_THROTTLE_SECONDS: number = 60;

  // ── Encryption ────────────────────────────────

  @IsString() @IsNotEmpty({ message: 'CREDENTIAL_ENCRYPTION_KEY must not be empty' })
  CREDENTIAL_ENCRYPTION_KEY!: string;

  // ── Frontend / links ──────────────────────────

  @IsString() @IsOptional()
  FRONTEND_URL: string = 'http://localhost:3000';

  // Public base URL of THIS backend — used to build OIDC redirect URIs
  // (${BACKEND_PUBLIC_URL}/api/auth/sso/:provider/callback). Must match the
  // redirect URI registered with Google / Entra.
  @IsString() @IsOptional()
  BACKEND_PUBLIC_URL: string = 'http://localhost:3001';

  @IsNumber() @IsOptional()
  RESET_TOKEN_TTL_MINUTES: number = 60;

  // ── SMTP (email delivery) ─────────────────────

  @IsString() @IsOptional()
  SMTP_HOST?: string;

  @IsNumber() @IsOptional()
  SMTP_PORT: number = 587;

  @IsString() @IsOptional()
  SMTP_USERNAME?: string;

  @IsString() @IsOptional()
  SMTP_PASSWORD?: string;

  @IsString() @IsOptional()
  SMTP_FROM_EMAIL?: string;

  @IsString() @IsOptional()
  SMTP_FROM_NAME: string = 'DataIntel';
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
