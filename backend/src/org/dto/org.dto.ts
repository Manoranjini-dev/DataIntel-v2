// ──────────────────────────────────────────────
// Org DTOs
// ──────────────────────────────────────────────

import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength, IsEmail, IsEnum } from 'class-validator';

export class CreateOrgDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  slug!: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;
}

export class UpdateOrgDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;
}

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsEnum(['admin', 'editor', 'viewer'])
  role!: 'admin' | 'editor' | 'viewer';
}
