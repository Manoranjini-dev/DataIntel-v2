// ──────────────────────────────────────────────
// App Module — Root Module Assembly (v2 Extended) - reloading
// ──────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { validateEnvironment } from './common/config/env.validation';

// ── Infrastructure ─────────────────────────────
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './cache/cache.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AccountModule } from './account/account.module';

// ── Core Infrastructure (Global) ───────────────
import { MCPModule } from './mcp/mcp.module';
import { SchemaModule } from './schema/schema.module';
import { ValidationModule } from './validation/validation.module';
import { MemoryModule } from './memory/memory.module';

// ── Organization Domain ─────────────────────────
import { OrgModule } from './org/org.module';

// ── Datasource Domain ───────────────────────────
import { ConnectionModule } from './connection/connection.module';
import { ComboModule } from './combo/combo.module';
import { QueryModule } from './query/query.module';

// ── Analytics Domain ────────────────────────────
import { CardModule } from './card/card.module';
import { DashboardModule } from './dashboard/dashboard.module';

// ── Chat Domain ─────────────────────────────────
import { ChatModule } from './chat/chat.module';

// ── Background Workers ──────────────────────────

import { DashboardGenerationModule } from './dashboard-generation/dashboard-generation.module';

@Module({
  imports: [
    // ── Configuration ─────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
      envFilePath: '.env',
    }),

    // ── Event Bus (internal domain events) ────
    EventEmitterModule.forRoot({
      wildcard: true,      // enables 'connection.*' style subscriptions
      delimiter: '.',
      maxListeners: 50,
    }),



    // ── Rate Limiting ─────────────────────────
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60_000,   // 1 minute
        limit: 300,    // 300 req/min general API limit
      },
      {
        name: 'medium',
        ttl: 15 * 60_000,  // 15 minutes
        limit: 1000,
      },
    ]),

    // ── Infrastructure (Global — available everywhere) ──
    DatabaseModule,
    CacheModule,
    AuditModule,
    AuthModule,
    AccountModule,

    // ── Core Infrastructure Modules (Global) ──────────
    MCPModule,
    SchemaModule,
    ValidationModule,
    MemoryModule,

    // ── Organization Domain ──────────────────────────
    OrgModule,          // Global (exports OrgPermissionsService for guards)

    // ── Datasource Domain ────────────────────────────
    ConnectionModule,
    ComboModule,
    QueryModule,

    // ── Analytics Domain ─────────────────────────────
    CardModule,
    DashboardModule,
    DashboardGenerationModule,

    // ── Chat Domain ──────────────────────────────────
    ChatModule,

    // ── Background Workers ───────────────────────────
    
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
