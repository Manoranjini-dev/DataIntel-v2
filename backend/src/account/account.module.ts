// ──────────────────────────────────────────────
// Account Module
// ──────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { UserSettingsService } from './user-settings.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [AccountController],
  providers: [UserSettingsService],
  exports: [UserSettingsService],
})
export class AccountModule {}
