// ──────────────────────────────────────────────
// ConnectionModule — Datasource connection domain
// ──────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConnectionController } from './connection.controller';
import { ConnectionService } from './connection.service';
import { PersistentConnectionController } from './persistent-connection.controller';
import { PersistentConnectionService } from './persistent-connection.service';
import { SchemaExplorerController } from './schema-explorer.controller';

import { ConnectionHealthService } from './connection-health.service';
import { ConnectionHealthController } from './connection-health.controller';
import { ConnectionPermissionsService } from './connection-permissions.service';
import { ConnectionRefreshService } from './connection-refresh.service';
import { ConnectionRefreshScheduler } from './connection-refresh.scheduler';
import { SchemaModule } from '../schema/schema.module';
import { AuditModule } from '../audit/audit.module';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [SchemaModule, AuditModule, CacheModule, ScheduleModule.forRoot()],
  controllers: [
    ConnectionController,
    PersistentConnectionController,
    SchemaExplorerController,
    ConnectionHealthController,
  ],
  providers: [
    ConnectionService,
    PersistentConnectionService,
    ConnectionHealthService,
    ConnectionPermissionsService,
    ConnectionRefreshService,
    ConnectionRefreshScheduler,
  ],
  exports: [
    ConnectionService,
    PersistentConnectionService,
    ConnectionHealthService,
    ConnectionPermissionsService,
    ConnectionRefreshService,
  ],
})
export class ConnectionModule {}
