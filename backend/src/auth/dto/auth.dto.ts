// ──────────────────────────────────────────────
// Auth DTOs — Request/Response validation
// ──────────────────────────────────────────────

import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Invalid email address' })
  email!: string;

  @IsString()
  @MinLength(2, { message: 'Display name must be at least 2 characters' })
  @MaxLength(255)
  displayName!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128)
  password!: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Invalid email address' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password!: string;
}
