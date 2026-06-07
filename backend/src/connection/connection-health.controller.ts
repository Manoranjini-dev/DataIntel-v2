import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ConnectionHealthService } from './connection-health.service';

@Controller('orgs/:orgId/connections')
export class ConnectionHealthController {
  constructor(private readonly healthService: ConnectionHealthService) {}

  @Get('health/summary')
  async getOrgHealthSummary(
    @Param('orgId') orgId: string,
  ) {
    const summary = await this.healthService.getOrgHealthSummary(orgId);
    return { summary };
  }

  @Post(':connId/health/check')
  async checkConnection(
    @Param('connId') connId: string,
  ) {
    const health = await this.healthService.checkConnection(connId, 'api');
    return { health };
  }

  @Get(':connId/health')
  async getHealth(
    @Param('connId') connId: string,
  ) {
    const health = await this.healthService.getCachedHealth(connId);
    return { health };
  }

  @Get(':connId/health/history')
  async getHealthHistory(
    @Param('orgId') orgId: string,
    @Param('connId') connId: string,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    const history = await this.healthService.getHealthHistory(
      connId, orgId, parseInt(limit) || 50, parseInt(offset) || 0,
    );
    return { history };
  }
}
