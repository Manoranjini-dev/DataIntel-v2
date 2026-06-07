import { Module } from '@nestjs/common';
import { ConnectionController } from './connection.controller';
import { ConnectionService } from './connection.service';
import { PersistentConnectionController } from './persistent-connection.controller';
import { PersistentConnectionService } from './persistent-connection.service';
import { SchemaExplorerController } from './schema-explorer.controller';
import { SchemaModule } from '../schema/schema.module';
import { OrgModule } from '../org/org.module';

@Module({
  imports: [SchemaModule, OrgModule],
  controllers: [ConnectionController, PersistentConnectionController, SchemaExplorerController],
  providers: [ConnectionService, PersistentConnectionService],
  exports: [ConnectionService, PersistentConnectionService],
})
export class ConnectionModule {}
