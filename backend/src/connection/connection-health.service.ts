// ──────────────────────────────────────────────
// ConnectionHealthService — Health checks + monitoring
// ──────────────────────────────────────────────

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { RedisService, RedisKeys, RedisTTL } from '../redis/redis.service';
import { PersistentConnectionService } from './persistent-connection.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface HealthStatus {
  connectionId: string;
  isHealthy: boolean;
  latencyMs: number | null;
  checkedAt: Date;
  errorMessage?: string;
  consecutiveFailures: number;
}

@Injectable()
export class ConnectionHealthService {
  private readonly logger = new Logger(ConnectionHealthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly persistentConn: PersistentConnectionService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Run a health check for a single connection.
   * Updates DB, caches result in Redis, emits event if status changed.
   */
  async checkConnection(
    connectionId: string,
    triggeredBy: 'scheduler' | 'manual' | 'api' = 'scheduler',
  ): Promise<HealthStatus> {
    const conn = await this.db.queryOne<{
      id: string;
      org_id: string;
      connector_type: string;
      consecutive_failures: number;
    }>(
      `SELECT id, org_id, connector_type, consecutive_failures
       FROM datasource_connections
       WHERE id = $1 AND deleted_at IS NULL`,
      [connectionId],
    );

    if (!conn) throw new NotFoundException('Connection not found');

    const previousHealth = await this.redis.getJson<{ isHealthy: boolean }>(
      RedisKeys.connHealth(connectionId),
    );

    const start = Date.now();
    let isHealthy = false;
    let errorMessage: string | undefined;

    try {
      await this.persistentConn.testPing(connectionId);
      isHealthy = true;
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(`Health check failed for connection ${connectionId}: ${errorMessage}`);
    }

    const latencyMs = Date.now() - start;
    const consecutiveFailures = isHealthy ? 0 : conn.consecutive_failures + 1;

    // Update DB
    await this.db.query(
      `UPDATE datasource_connections
       SET last_health_check = NOW(),
           last_health_ok = $2,
           status = CASE WHEN $2 THEN 'active'::connection_status ELSE 'error'::connection_status END,
           consecutive_failures = $3,
           error_count = CASE WHEN $2 THEN error_count ELSE error_count + 1 END,
           updated_at = NOW()
       WHERE id = $1`,
      [connectionId, isHealthy, consecutiveFailures],
    );

    // Log to health log table
    await this.db.query(
      `INSERT INTO connection_health_logs (connection_id, org_id, is_healthy, latency_ms, error_message, error_code, checked_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        connectionId,
        conn.org_id,
        isHealthy,
        isHealthy ? latencyMs : null,
        errorMessage || null,
        null,
        triggeredBy,
      ],
    );

    // Cache health status
    const health: HealthStatus = {
      connectionId,
      isHealthy,
      latencyMs: isHealthy ? latencyMs : null,
      checkedAt: new Date(),
      errorMessage,
      consecutiveFailures,
    };
    await this.redis.setJson(RedisKeys.connHealth(connectionId), health, RedisTTL.CONN_HEALTH);

    // Emit event if health status changed
    if (previousHealth && previousHealth.isHealthy !== isHealthy) {
      this.events.emit('connection.health_changed', {
        connectionId,
        orgId: conn.org_id,
        isHealthy,
        previousIsHealthy: previousHealth.isHealthy,
        consecutiveFailures,
      });
    }

    return health;
  }

  /** Get cached health status (or null if not yet checked) */
  async getCachedHealth(connectionId: string): Promise<HealthStatus | null> {
    return this.redis.getJson<HealthStatus>(RedisKeys.connHealth(connectionId));
  }

  /** Get health history from DB (paginated) */
  async getHealthHistory(
    connectionId: string,
    orgId: string,
    limit = 100,
    offset = 0,
  ) {
    return this.db.queryMany(
      `SELECT id, is_healthy, latency_ms, error_message, checked_at, checked_by
       FROM connection_health_logs
       WHERE connection_id = $1 AND org_id = $2
       ORDER BY checked_at DESC
       LIMIT $3 OFFSET $4`,
      [connectionId, orgId, limit, offset],
    );
  }

  /** Get aggregate health summary for an org's connections */
  async getOrgHealthSummary(orgId: string) {
    return this.db.queryMany(
      `SELECT
         dc.id,
         dc.name,
         dc.connector_type,
         dc.status,
         dc.last_health_check,
         dc.last_health_ok,
         dc.consecutive_failures,
         dc.error_count
       FROM datasource_connections dc
       WHERE dc.org_id = $1 AND dc.deleted_at IS NULL
       ORDER BY dc.consecutive_failures DESC, dc.name`,
      [orgId],
    );
  }

  /**
   * Get all connections due for a health check.
   * Used by the HealthCheck background processor.
   */
  async getDueForHealthCheck(limit = 100): Promise<Array<{ id: string; org_id: string }>> {
    return this.db.queryMany(
      `SELECT id, org_id
       FROM datasource_connections
       WHERE deleted_at IS NULL
         AND status IN ('active', 'error')
         AND (
           last_health_check IS NULL
           OR last_health_check < NOW() - (health_check_interval_sec || ' seconds')::INTERVAL
         )
       ORDER BY last_health_check ASC NULLS FIRST
       LIMIT $1`,
      [limit],
    );
  }
}
