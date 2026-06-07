// ──────────────────────────────────────────────
// App Module — Root Module Assembly
// ──────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './common/config/env.validation';

// Infrastructure modules
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';

// Core modules (existing)
import { MCPModule } from './mcp/mcp.module';
import { SchemaModule } from './schema/schema.module';
import { ValidationModule } from './validation/validation.module';
import { MemoryModule } from './memory/memory.module';

// Feature modules (existing)
import { ConnectionModule } from './connection/connection.module';
import { QueryModule } from './query/query.module';

// New feature modules
import { OrgModule } from './org/org.module';
import { ChatModule } from './chat/chat.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ComboModule } from './combo/combo.module';

@Module({
  imports: [
    // Environment configuration with validation
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
      envFilePath: '.env',
    }),

    // Infrastructure (Global — available everywhere)
    DatabaseModule,
    RedisModule,
    AuditModule,
    AuthModule,

    // Core infrastructure modules (Global)
    MCPModule,
    SchemaModule,
    ValidationModule,
    MemoryModule,

    // Feature modules (existing — @Public() via decorators)
    ConnectionModule,
    QueryModule,

    // New org-scoped feature modules
    OrgModule,
    ChatModule,
    DashboardModule,
    ComboModule,
  ],
})
export class AppModule {}
