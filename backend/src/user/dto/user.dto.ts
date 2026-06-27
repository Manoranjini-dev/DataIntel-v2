// ──────────────────────────────────────────────
// User Management DTOs — validation for /users routes
// ──────────────────────────────────────────────

import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum PlatformRoleEnum {
  ADMIN = 'ADMIN',
  ANALYST = 'ANALYST',
  VIEWER = 'VIEWER',
}

// Statuses an admin may set directly via update/status routes.
// (PENDING_INVITATION and DELETED are managed by the system, not set manually.)
export enum SettableUserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export class CreateUserDto {
  @IsString()
  @MinLength(2, { message: 'Full name must be at least 2 characters' })
  @MaxLength(255)
  name!: string;

  @IsEmail({}, { message: 'Invalid email address' })
  email!: string;

  @IsEnum(PlatformRoleEnum, { message: 'Role must be ADMIN, ANALYST, or VIEWER' })
  role!: PlatformRoleEnum;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Full name must be at least 2 characters' })
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Invalid email address' })
  email?: string;

  @IsOptional()
  @IsEnum(PlatformRoleEnum, { message: 'Role must be ADMIN, ANALYST, or VIEWER' })
  role?: PlatformRoleEnum;

  @IsOptional()
  @IsEnum(SettableUserStatus, { message: 'Status must be ACTIVE or INACTIVE' })
  status?: SettableUserStatus;
}

export class UpdateUserStatusDto {
  @IsEnum(SettableUserStatus, { message: 'Status must be ACTIVE or INACTIVE' })
  status!: SettableUserStatus;
}

export class ListUsersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @IsEnum(PlatformRoleEnum)
  role?: PlatformRoleEnum;

  @IsOptional()
  @IsIn(['PENDING_INVITATION', 'ACTIVE', 'INACTIVE'])
  status?: string;

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'name', 'email'])
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
