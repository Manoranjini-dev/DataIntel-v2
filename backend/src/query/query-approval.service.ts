// ──────────────────────────────────────────────
// Query Approval Service — Handles human-in-the-loop query review
// ──────────────────────────────────────────────

import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OrgPermissionsService } from '../org/org-permissions.service';
import { SafeAccount } from '../auth/auth.service';

@Injectable()
export class QueryApprovalService {
  private readonly logger = new Logger(QueryApprovalService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orgPermissions: OrgPermissionsService,
  ) {}

  /** Create an approval request for a generated query execution */
  async requestApproval(orgId: string, executionId: string, requester: SafeAccount) {
    await this.orgPermissions.requireMember(orgId, requester.id);

    // Verify execution exists and belongs to org
    const exec = await this.db.queryOne(
      `SELECT id, status FROM query_executions WHERE id = $1 AND org_id = $2`,
      [executionId, orgId]
    );
    if (!exec) throw new NotFoundException('Query execution not found');

    const approval = await this.db.queryOne(
      `INSERT INTO query_approvals (org_id, execution_id, requested_by, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [orgId, executionId, requester.id]
    );

    await this.audit.log({
      orgId, accountId: requester.id,
      eventType: 'query_approval_requested', resourceType: 'query_execution', resourceId: executionId,
    });

    return approval;
  }

  /** Review an approval request (approve or reject) */
  async reviewApproval(orgId: string, approvalId: string, reviewer: SafeAccount, status: 'approved' | 'rejected', comment?: string) {
    await this.orgPermissions.requireRole(orgId, reviewer.id, 'admin'); // Admins only for now

    const approval = await this.db.queryOne(
      `SELECT * FROM query_approvals WHERE id = $1 AND org_id = $2 AND status = 'pending'`,
      [approvalId, orgId]
    );
    if (!approval) throw new NotFoundException('Pending approval not found');

    const updated = await this.db.queryOne(
      `UPDATE query_approvals
       SET status = $3, reviewed_by = $4, review_comment = $5, reviewed_at = NOW()
       WHERE id = $1 AND org_id = $2
       RETURNING *`,
      [approvalId, orgId, status, reviewer.id, comment || null]
    );

    // If approved, trigger execution logic (typically handled by returning the status to the orchestrator or queueing execution)
    // The execution will be kicked off by the controller or orchestrator once status is verified

    await this.audit.log({
      orgId, accountId: reviewer.id,
      eventType: 'query_approval_reviewed' as any, resourceType: 'query_approval', resourceId: approvalId,
      details: { status, comment },
    });

    return updated;
  }

  /** Get list of pending approvals for an org */
  async listPending(orgId: string, reviewer: SafeAccount) {
    await this.orgPermissions.requireRole(orgId, reviewer.id, 'admin');
    
    return this.db.queryMany(
      `SELECT qa.*, e.generated_query, e.prompt, a.display_name as requester_name
       FROM query_approvals qa
       JOIN query_executions e ON e.id = qa.execution_id
       JOIN accounts a ON a.id = qa.requested_by
       WHERE qa.org_id = $1 AND qa.status = 'pending'
       ORDER BY qa.requested_at DESC`,
      [orgId]
    );
  }

  /** Check if a query requires approval based on org settings */
  async requiresApproval(orgId: string): Promise<boolean> {
    const settings = await this.db.queryOne<{ query_approval_required: boolean }>(
      `SELECT query_approval_required FROM org_settings WHERE org_id = $1`,
      [orgId]
    );
    return settings?.query_approval_required ?? false;
  }
}
