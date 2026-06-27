// ──────────────────────────────────────────────
// Connection Refresh Scheduler
// Polls for connections due for auto-refresh and runs them.
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ConnectionRefreshService } from './connection-refresh.service';

@Injectable()
export class ConnectionRefreshScheduler {
  private readonly logger = new Logger(ConnectionRefreshScheduler.name);
  private running = false;

  constructor(private readonly refreshService: ConnectionRefreshService) {}

  @Interval(60_000)
  async handleTick() {
    if (this.running) return; // skip overlapping ticks if a previous batch is still running
    this.running = true;
    try {
      const due = await this.refreshService.getDueForRefresh(50);
      for (const conn of due) {
        try {
          await this.refreshService.runScheduledRefresh(conn.id, conn.refresh_interval_minutes);
        } catch (err: any) {
          this.logger.error(`Failed to process refresh for connection ${conn.id}: ${err?.message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
