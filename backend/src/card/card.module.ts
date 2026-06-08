// ──────────────────────────────────────────────
// CardModule
// ──────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { CardController } from './card.controller';
import { CardFolderController } from './card-folder.controller';
import { CardService } from './card.service';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { CacheModule } from '../cache/cache.module';
import { OrgModule } from '../org/org.module';

@Module({
  imports: [DatabaseModule, AuditModule, CacheModule, OrgModule],
  controllers: [CardController, CardFolderController],
  providers: [CardService],
  exports: [CardService],
})
export class CardModule {}
