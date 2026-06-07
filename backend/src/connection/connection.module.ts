// ──────────────────────────────────────────────
// ConnectionModule — Datasource connection domain
// ──────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { ConnectionController } from './connection.controller';
import { ConnectionService } from './connection.service';
import { PersistentConnectionController } from './persistent-connection.controller';
import { PersistentConnectionService } from './persistent-connection.service';
import { SchemaExplorerController } from './schema-explorer.controller';

import { CredentialVaultService } from './credential-vault.service';
import { ConnectionHealthService } from './connection-health.service';
import { ConnectionHealthController } from './connection-health.controller';
import { SchemaModule } from '../schema/schema.module';
import { OrgModule } from '../org/org.module';
import { AuditModule } from '../audit/audit.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [SchemaModule, OrgModule, AuditModule, RedisModule],
  controllers: [
    ConnectionController,
    PersistentConnectionController,
    SchemaExplorerController,
    ConnectionHealthController,
  ],
  providers: [
    ConnectionService,
    PersistentConnectionService,
    CredentialVaultService,
    ConnectionHealthService,
  ],
  exports: [
    ConnectionService,
    PersistentConnectionService,
    CredentialVaultService,
    ConnectionHealthService,
  ],
})
export class ConnectionModule {}
