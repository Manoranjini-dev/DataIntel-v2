// ──────────────────────────────────────────────
// Connection DTOs (org-scoped)
// ──────────────────────────────────────────────

import {
  IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean,
  IsEnum, Min, Max, IsObject,
} from 'class-validator';

export type ConnectorType = 'mysql' | 'postgres' | 'elasticsearch' | 'mongodb' | 'databricks';

export class CreateConnectionDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsOptional() description?: string;

  @IsEnum(['mysql', 'postgres', 'elasticsearch', 'mongodb', 'databricks'])
  connectorType!: ConnectorType;

  @IsString() @IsNotEmpty() host!: string;

  @IsNumber() @Min(1) @Max(65535) port!: number;

  @IsString() @IsNotEmpty() databaseName!: string;
  @IsString() @IsNotEmpty() username!: string;
  @IsString() @IsNotEmpty() password!: string;

  @IsBoolean() @IsOptional() sslEnabled?: boolean;
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
  @IsObject() @IsOptional() connectionOptions?: Record<string, any>;
}
