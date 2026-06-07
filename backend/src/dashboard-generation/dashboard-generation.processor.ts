import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DashboardGenerationService } from './dashboard-generation.service';

@Processor('dashboard-generation')
export class DashboardGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(DashboardGenerationProcessor.name);

  constructor(private readonly generationService: DashboardGenerationService) {
    super();
  }

  async process(job: Job<{
    jobId: string; orgId: string; userId: string;
    intent: string; contextType: string; contextId: string;
  }>) {
    const { jobId, orgId, userId, intent, contextType, contextId } = job.data;
    this.logger.log(`Processing dashboard generation: ${jobId}`);

    await this.generationService.processGenerationJob(
      jobId, orgId, userId, intent, contextType, contextId,
    );

    this.logger.log(`Dashboard generation completed: ${jobId}`);
  }
}
