// ──────────────────────────────────────────────
// SSO DTOs
// ──────────────────────────────────────────────

import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class LdapLoginDto {
  @IsString() @MaxLength(256)
  username!: string;

  @IsString() @MaxLength(512)
  password!: string;
}

export class UpsertSsoProviderDto {
  @IsBoolean() @IsOptional()
  enabled?: boolean;

  @IsString() @IsOptional() @MaxLength(128)
  displayName?: string;

  /** Non-secret provider config (clientId, tenantId, LDAP url/baseDN/filter…). */
  @IsObject() @IsOptional()
  config?: Record<string, any>;

  /** OAuth client secret / LDAP bind password. Omit to keep, empty to clear. */
  @IsString() @IsOptional()
  secret?: string;

  @IsBoolean() @IsOptional()
  autoProvision?: boolean;

  @IsArray() @IsOptional() @IsString({ each: true })
  allowedDomains?: string[];

  @IsIn(['ADMIN', 'ANALYST', 'VIEWER']) @IsOptional()
  defaultRole?: 'ADMIN' | 'ANALYST' | 'VIEWER';
}
