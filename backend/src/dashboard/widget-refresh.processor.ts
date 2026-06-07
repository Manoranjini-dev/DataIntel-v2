import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WidgetExecutionService } from './widget-execution.service';
import { SafeAccount } from '../auth/auth.service';

@Processor('widget-refresh')
export class WidgetRefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(WidgetRefreshProcessor.name);

  constructor(private readonly widgetExecution: WidgetExecutionService) {
    super();
  }

  async process(job: Job<{ widgetId: string; orgId: string; accountId?: string; triggeredBy: string }>) {
    const { widgetId, orgId, accountId, triggeredBy } = job.data;
    this.logger.log(`Processing widget refresh: ${widgetId} (triggered by ${triggeredBy})`);

    const user = accountId ? { id: accountId } as SafeAccount : { id: 'system' } as SafeAccount;
    await this.widgetExecution.executeSync(widgetId, orgId, user, true);

    this.logger.log(`Widget refresh completed: ${widgetId}`);
  }
}
