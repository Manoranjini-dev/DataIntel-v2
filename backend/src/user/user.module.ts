// ──────────────────────────────────────────────
// User Module — Phase 1 User Management
// ──────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { PlatformRoleGuard } from '../common/guards/platform-role.guard';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule],
  controllers: [UserController],
  providers: [UserService, PlatformRoleGuard],
})
export class UserModule {}
