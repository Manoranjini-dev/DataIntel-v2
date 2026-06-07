// ──────────────────────────────────────────────
// Audit Service — Append-only audit log
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type AuditEventType =
  // Auth events
  | 'account_created' | 'login_success' | 'login_failed' | 'logout' | 'password_changed'
  // Org events
  | 'org_created' | 'org_updated' | 'member_invited' | 'member_removed' | 'member_role_changed'
  | 'org_invitation_sent' | 'org_invitation_accepted' | 'org_invitation_revoked'
  // Connection events
  | 'connection_created' | 'connection_updated' | 'connection_deleted'
  | 'connection_test_success' | 'connection_test_failed' | 'connection_health_check'
  | 'connection_schema_synced' | 'connection_credentials_rotated'
  // Query events
  | 'query_generated' | 'query_validated' | 'query_executed' | 'query_failed'
  | 'query_approval_requested' | 'query_approval_granted' | 'query_approval_rejected'
  // Chat events
  | 'chat_created' | 'chat_archived' | 'chat_unarchived' | 'chat_deleted' | 'chat_message_promoted'
  // Dashboard events
  | 'dashboard_created' | 'dashboard_updated' | 'dashboard_published' | 'dashboard_deleted'
  | 'dashboard_page_created' | 'dashboard_page_deleted' | 'dashboard_generated'
  | 'widget_added' | 'widget_removed' | 'widget_executed' | 'widget_cache_invalidated'
  // Card events
  | 'card_created' | 'card_updated' | 'card_published' | 'card_deleted' | 'card_version_rollback'
  // Combo events
  | 'combo_created' | 'combo_updated' | 'combo_deleted';

export interface AuditLogParams {
  orgId?: string;
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
        `INSERT INTO audit_logs (org_id, account_id, event_type, resource_type, resource_id, details, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          params.orgId || null,
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

  /** Get audit logs for an org with pagination */
  async getOrgLogs(
    orgId: string,
    options: { limit?: number; offset?: number; eventType?: AuditEventType } = {},
  ) {
    const { limit = 50, offset = 0, eventType } = options;
    const params: any[] = [orgId, limit, offset];
    let whereClause = 'WHERE org_id = $1';

    if (eventType) {
      whereClause += ' AND event_type = $4';
      params.push(eventType);
    }

    return this.db.queryMany(
      `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      params,
    );
  }
}
