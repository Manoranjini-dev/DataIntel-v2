import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { ConnectionHealthService } from './connection-health.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeAccount } from '../auth/auth.service';

@Controller('connections')
export class ConnectionHealthController {
  constructor(private readonly healthService: ConnectionHealthService) {}

  @Get('health/summary')
  async getHealthSummary(@CurrentUser() user: SafeAccount) {
    const summary = await this.healthService.getHealthSummary(user.id);
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
    @Param('connId') connId: string,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    const history = await this.healthService.getHealthHistory(
      connId, parseInt(limit) || 50, parseInt(offset) || 0,
    );
    return { history };
  }
}
