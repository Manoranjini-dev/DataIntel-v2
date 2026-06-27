// ──────────────────────────────────────────────
// Connection Refresh Service
// Configurable auto-refresh schedules (custom interval, in minutes)
// for datasource connections — e.g. every 10 minutes, hourly, etc.
// ──────────────────────────────────────────────

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { SafeAccount } from '../auth/auth.service';
import { ConnectionPermissionsService } from './connection-permissions.service';
import { PersistentConnectionService } from './persistent-connection.service';
import { RefreshScheduleDto } from './dto/persistent-connection.dto';

@Injectable()
export class ConnectionRefreshService {
  private readonly logger = new Logger(ConnectionRefreshService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly connectionPermissions: ConnectionPermissionsService,
    private readonly persistentConn: PersistentConnectionService,
  ) {}

  /**
   * Configure (or disable) the auto-refresh schedule for a connection.
   * Owner/Admin only — shared users (even with Edit access) may trigger a
   * manual refresh but cannot change the schedule itself.
   */
  async configureSchedule(connId: string, user: SafeAccount, dto: RefreshScheduleDto) {
    await this.connectionPermissions.requireAction(connId, user.id, 'manage');

    if (dto.enabled && !dto.intervalMinutes) {
      throw new NotFoundException('intervalMinutes is required when enabling auto-refresh');
    }

    const nextRefreshAt = dto.enabled
      ? new Date(Date.now() + (dto.intervalMinutes as number) * 60_000)
      : null;

    const conn = await this.db.queryOne(
      `UPDATE datasource_connections
       SET refresh_enabled = $2,
           refresh_interval_minutes = $3,
           next_refresh_at = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, refresh_enabled, refresh_interval_minutes, next_refresh_at,
                 last_refresh_at, last_refresh_status, last_refresh_error`,
      [connId, dto.enabled, dto.enabled ? dto.intervalMinutes : null, nextRefreshAt],
    );
    if (!conn) throw new NotFoundException('Connection not found');

    await this.audit.log({
      accountId: user.id,
      eventType: 'connection_refresh_scheduled',
      resourceType: 'connection', resourceId: connId,
      details: { enabled: dto.enabled, intervalMinutes: dto.intervalMinutes },
    });

    return conn;
  }

  /** Get the current refresh schedule/status for a connection */
  async getSchedule(connId: string, accountId: string) {
    await this.connectionPermissions.requireAction(connId, accountId, 'view');

    const conn = await this.db.queryOne(
      `SELECT id, refresh_enabled, refresh_interval_minutes, next_refresh_at,
              last_refresh_at, last_refresh_status, last_refresh_error
       FROM datasource_connections
       WHERE id = $1`,
      [connId],
    );
    if (!conn) throw new NotFoundException('Connection not found');
    return conn;
  }

  /** Connections whose next_refresh_at has elapsed and are due for a run */
  async getDueForRefresh(limit = 50): Promise<Array<{ id: string; refresh_interval_minutes: number }>> {
    return this.db.queryMany(
      `SELECT id, refresh_interval_minutes
       FROM datasource_connections
       WHERE deleted_at IS NULL
         AND refresh_enabled = TRUE
         AND next_refresh_at <= NOW()
       ORDER BY next_refresh_at ASC
       LIMIT $1`,
      [limit],
    );
  }

  /**
   * Manually trigger an immediate refresh. Available to the owner/Admin and
   * to any user with Edit access on the connection. Updates the same
   * last_refresh_at/status bookkeeping as the scheduled job, and only
   * pushes next_refresh_at forward if auto-refresh is enabled.
   */
  async triggerManualRefresh(connId: string, user: SafeAccount): Promise<{ success: boolean; error?: string }> {
    await this.connectionPermissions.requireAction(connId, user.id, 'edit');

    const { success, error } = await this.persistentConn.refreshNow(connId);

    const conn = await this.db.queryOne<{ refresh_enabled: boolean; refresh_interval_minutes: number | null }>(
      'SELECT refresh_enabled, refresh_interval_minutes FROM datasource_connections WHERE id = $1',
      [connId],
    );
    const nextRefreshAt = conn?.refresh_enabled && conn.refresh_interval_minutes
      ? new Date(Date.now() + conn.refresh_interval_minutes * 60_000)
      : null;

    await this.db.query(
      `UPDATE datasource_connections
       SET last_refresh_at = NOW(),
           last_refresh_status = $2,
           last_refresh_error = $3,
           next_refresh_at = COALESCE($4, next_refresh_at)
       WHERE id = $1`,
      [connId, success ? 'success' : 'error', error || null, nextRefreshAt],
    );

    await this.audit.log({
      accountId: user.id,
      eventType: success ? 'connection_refresh_completed' : 'connection_refresh_failed',
      resourceType: 'connection', resourceId: connId,
      details: success ? { trigger: 'manual' } : { trigger: 'manual', error },
    });

    return { success, error };
  }

  /** Run a refresh for a single connection and reschedule the next run */
  async runScheduledRefresh(connectionId: string, intervalMinutes: number): Promise<void> {
    const { success, error } = await this.persistentConn.refreshNow(connectionId);
    const nextRefreshAt = new Date(Date.now() + intervalMinutes * 60_000);

    await this.db.query(
      `UPDATE datasource_connections
       SET last_refresh_at = NOW(),
           last_refresh_status = $2,
           last_refresh_error = $3,
           next_refresh_at = $4
       WHERE id = $1`,
      [connectionId, success ? 'success' : 'error', error || null, nextRefreshAt],
    );

    await this.audit.log({
      eventType: success ? 'connection_refresh_completed' : 'connection_refresh_failed',
      resourceType: 'connection', resourceId: connectionId,
      details: success ? {} : { error },
    });
  }
}
