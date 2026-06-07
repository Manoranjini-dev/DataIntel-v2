import { Module } from '@nestjs/common';
import { ComboService } from './combo.service';
import { ComboController } from './combo.controller';
import { SchemaMergerService } from './schema-merger.service';
import { ComboPlannerService } from './combo-planner.service';
import { ComboExecutorService } from './combo-executor.service';
import { ResultMergerService } from './result-merger.service';
import { OrgModule } from '../org/org.module';
import { LLMModule } from '../llm/llm.module';

@Module({
  imports: [OrgModule, LLMModule],
  controllers: [ComboController],
  providers: [
    ComboService,
    SchemaMergerService,
    ComboPlannerService,
    ComboExecutorService,
    ResultMergerService,
  ],
  exports: [ComboService, SchemaMergerService],
})
export class ComboModule {}
