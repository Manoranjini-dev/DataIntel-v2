// ──────────────────────────────────────────────
// Connection DTOs (org-scoped)
// ──────────────────────────────────────────────

import {
  IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean,
  IsEnum, Min, Max, IsObject,
} from 'class-validator';

export type ConnectorType = 'mysql' | 'postgres' | 'elasticsearch' | 'mongodb' | 'databricks' | 'mssql' | 'snowflake' | 'bigquery' | 'redshift';

export class CreateConnectionDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsOptional() description?: string;

  @IsEnum(['mysql', 'postgres', 'elasticsearch', 'mongodb', 'databricks', 'mssql', 'snowflake', 'bigquery', 'redshift'])
  connectorType!: ConnectorType;

  @IsString() @IsOptional() host?: string;
  @IsNumber() @IsOptional() @Min(1) @Max(65535) port?: number;

  @IsString() @IsOptional() databaseName?: string;
  @IsString() @IsOptional() username?: string;
  @IsString() @IsOptional() password?: string;

  @IsBoolean() @IsOptional() sslEnabled?: boolean;
  @IsBoolean() @IsOptional() ssl?: boolean;
  
  @IsString() @IsOptional() databricksHttpPath?: string;
  @IsString() @IsOptional() bigqueryProjectId?: string;
  @IsString() @IsOptional() bigqueryDatasetId?: string;
  @IsString() @IsOptional() bigqueryKeyJson?: string;

  @IsObject() @IsOptional() connectionOptions?: Record<string, any>;
}

export class UpdateConnectionDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() host?: string;
  @IsNumber() @IsOptional() @Min(1) @Max(65535) port?: number;
  @IsString() @IsOptional() username?: string;
  @IsString() @IsOptional() password?: string;
  @IsBoolean() @IsOptional() sslEnabled?: boolean;
  @IsBoolean() @IsOptional() ssl?: boolean;

  @IsString() @IsOptional() databricksHttpPath?: string;
  @IsString() @IsOptional() bigqueryProjectId?: string;
  @IsString() @IsOptional() bigqueryDatasetId?: string;
  @IsString() @IsOptional() bigqueryKeyJson?: string;

  @IsObject() @IsOptional() connectionOptions?: Record<string, any>;
}
