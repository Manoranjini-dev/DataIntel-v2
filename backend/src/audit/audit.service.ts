// ──────────────────────────────────────────────
// Audit Service — Append-only audit log
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type AuditEventType =
  // Auth events
  | 'account_created' | 'login_success' | 'login_failed' | 'logout' | 'password_changed'
  // User-management events (Phase 1)
  | 'user_created' | 'user_updated' | 'user_activated' | 'user_deactivated'
  | 'user_reactivated' | 'user_deleted'
  | 'password_reset_requested' | 'password_reset_completed'
  | 'invitation_sent' | 'invitation_resent'
  // Connection events
  | 'connection_created' | 'connection_updated' | 'connection_deleted'
  | 'connection_test_success' | 'connection_test_failed' | 'connection_health_check'
  | 'connection_schema_synced' | 'connection_credentials_rotated'
  | 'connection_shared' | 'connection_share_revoked'
  | 'connection_refresh_scheduled' | 'connection_refresh_completed' | 'connection_refresh_failed'
  // Query events
  | 'query_generated' | 'query_validated' | 'query_executed' | 'query_failed'
  // Chat events
  | 'chat_created' | 'chat_archived' | 'chat_unarchived' | 'chat_deleted' | 'chat_message_promoted'
  // Dashboard events
  | 'dashboard_created' | 'dashboard_updated' | 'dashboard_published' | 'dashboard_deleted'
  | 'dashboard_page_created' | 'dashboard_page_deleted' | 'dashboard_generated'
  | 'widget_added' | 'widget_removed' | 'widget_executed' | 'widget_cache_invalidated'
  // Card events
  | 'card_created' | 'card_updated' | 'card_published' | 'card_deleted' | 'card_version_rollback'
  | 'card_shared' | 'card_share_revoked'
  // Combo events
  | 'combo_created' | 'combo_updated' | 'combo_deleted';

export interface AuditLogParams {
  accountId?: string;
  eventType: AuditEventType;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Write an audit log entry (fire-and-forget safe) */
  async log(params: AuditLogParams): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO audit_logs (account_id, event_type, resource_type, resource_id, details, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          params.accountId || null,
          params.eventType,
          params.resourceType || null,
          params.resourceId || null,
          JSON.stringify(params.details || {}),
          params.ipAddress || null,
          params.userAgent || null,
        ],
      );
    } catch (error) {
      // Audit log failures should never crash the application
      this.logger.error(`Failed to write audit log: ${error}`, { params });
    }
  }

  /**
   * Platform-level user-management audit logs (not org-scoped). Joins the
   * actor account for display. Maps the shared audit_logs columns onto the
   * PRD's actor/target/action/metadata shape.
   */
  async getUserManagementLogs(options: { limit?: number; offset?: number } = {}) {
    const { limit = 50, offset = 0 } = options;
    const rows = await this.db.queryMany(
      `SELECT l.id,
              l.account_id   AS actor_user_id,
              l.resource_id  AS target_user_id,
              l.event_type   AS action,
              l.details      AS metadata,
              l.created_at   AS timestamp,
              actor.display_name AS actor_name,
              actor.email        AS actor_email
         FROM audit_logs l
         LEFT JOIN accounts actor ON actor.id = l.account_id
        WHERE l.event_type IN (
          'user_created','user_updated','user_activated','user_deactivated',
          'user_reactivated','user_deleted','password_reset_requested',
          'password_reset_completed','invitation_sent','invitation_resent'
        )
        ORDER BY l.created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }
}
