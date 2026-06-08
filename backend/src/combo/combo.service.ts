// ──────────────────────────────────────────────
// Combo Service — Datasource combo CRUD
// ──────────────────────────────────────────────

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OrgService } from '../org/org.service';
import { SafeAccount } from '../auth/auth.service';
import { SchemaMergerService } from './schema-merger.service';
import { ComboPlannerService } from './combo-planner.service';
import { ComboExecutorService } from './combo-executor.service';
import { ResultMergerService } from './result-merger.service';

@Injectable()
export class ComboService {
  private readonly logger = new Logger(ComboService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orgService: OrgService,
    private readonly schemaMerger: SchemaMergerService,
    private readonly planner: ComboPlannerService,
    private readonly executor: ComboExecutorService,
    private readonly resultMerger: ResultMergerService,
  ) {}

  async list(orgId: string, accountId: string) {
    await this.orgService.requireMember(orgId, accountId);
    return this.db.queryMany(
      `SELECT dc.*, array_agg(dcm.connection_id) AS connection_ids,
              array_agg(c.name) AS connection_names
       FROM datasource_combos dc
       LEFT JOIN datasource_combo_members dcm ON dcm.combo_id = dc.id
       LEFT JOIN datasource_connections c ON c.id = dcm.connection_id
       WHERE dc.org_id = $1
       GROUP BY dc.id
       ORDER BY dc.created_at DESC`,
      [orgId],
    );
  }

  async create(
    orgId: string,
    user: SafeAccount,
    data: { name: string; description?: string; connectionIds: string[] },
  ) {
    await this.orgService.requireRole(orgId, user.id, 'editor');

    const combo = await this.db.transaction(async (query) => {
      const comboResult = await query(
        `INSERT INTO datasource_combos (org_id, name, description, created_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [orgId, data.name, data.description || null, user.id],
      );
      const combo = comboResult.rows[0];

      for (const connId of data.connectionIds) {
        await query(
          `INSERT INTO datasource_combo_members (combo_id, connection_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [combo.id, connId],
        );
      }

      return combo;
    });

    await this.audit.log({
      orgId, accountId: user.id,
      eventType: 'combo_created',
      resourceType: 'combo', resourceId: combo.id,
      details: { name: data.name, connectionCount: data.connectionIds.length },
    });

    return combo;
  }

  async get(orgId: string, comboId: string, accountId: string) {
    await this.orgService.requireMember(orgId, accountId);
    const combo = await this.db.queryOne(
      `SELECT dc.*, array_agg(
         json_build_object('id', c.id, 'name', c.name, 'connectorType', c.connector_type,
                           'host', c.host, 'databaseName', c.database_name, 'status', c.status)
       ) AS connections
       FROM datasource_combos dc
       LEFT JOIN datasource_combo_members dcm ON dcm.combo_id = dc.id
       LEFT JOIN datasource_connections c ON c.id = dcm.connection_id
       WHERE dc.id = $1 AND dc.org_id = $2
       GROUP BY dc.id`,
      [comboId, orgId],
    );
    if (!combo) throw new NotFoundException('Combo not found');
    return combo;
  }

  async delete(orgId: string, comboId: string, user: SafeAccount) {
    await this.orgService.requireRole(orgId, user.id, 'admin');
    await this.get(orgId, comboId, user.id);
    await this.db.query('DELETE FROM datasource_combos WHERE id = $1', [comboId]);
    await this.audit.log({
      orgId, accountId: user.id,
      eventType: 'combo_deleted',
      resourceType: 'combo', resourceId: comboId,
    });
    return { success: true };
  }

  async addMember(orgId: string, comboId: string, connectionId: string, user: SafeAccount, alias?: string) {
    await this.orgService.requireRole(orgId, user.id, 'editor');
    
    const member = await this.db.queryOne(
      `INSERT INTO datasource_combo_members (combo_id, connection_id, alias)
       VALUES ($1, $2, $3)
       ON CONFLICT (combo_id, connection_id) DO UPDATE SET alias = EXCLUDED.alias
       RETURNING *`,
      [comboId, connectionId, alias || null]
    );

    await this.audit.log({
      orgId, accountId: user.id,
      eventType: 'combo_updated',
      resourceType: 'combo', resourceId: comboId,
      details: { action: 'member_added', connectionId },
    });

    return member;
  }

  async removeMember(orgId: string, comboId: string, connectionId: string, user: SafeAccount) {
    await this.orgService.requireRole(orgId, user.id, 'editor');
    
    await this.db.query(
      `DELETE FROM datasource_combo_members
       WHERE combo_id = $1 AND connection_id = $2`,
      [comboId, connectionId]
    );

    await this.audit.log({
      orgId, accountId: user.id,
      eventType: 'combo_updated',
      resourceType: 'combo', resourceId: comboId,
      details: { action: 'member_removed', connectionId },
    });
  }

  /** Get merged schema from all connections in a combo */
  async getMergedSchema(orgId: string, comboId: string, accountId: string) {
    await this.orgService.requireMember(orgId, accountId);
    const members = await this.db.queryMany(
      `SELECT dcm.connection_id, dcm.alias, c.name, c.connector_type, c.database_name
       FROM datasource_combo_members dcm
       JOIN datasource_connections c ON c.id = dcm.connection_id
       WHERE dcm.combo_id = $1`,
      [comboId],
    );

    const mergedSchema: any[] = [];
    for (const member of members) {
      const schemas = await this.db.queryMany(
        `SELECT cs.schema_name, ct.table_name, ct.row_count_estimate,
                array_agg(json_build_object(
                  'name', cc.column_name, 'type', cc.data_type,
                  'nullable', cc.is_nullable, 'isPrimaryKey', cc.is_primary_key
                )) AS columns
         FROM connection_schemas cs
         JOIN connection_tables ct ON ct.schema_id = cs.id
         JOIN connection_columns cc ON cc.table_id = ct.id
         WHERE cs.connection_id = $1
         GROUP BY cs.schema_name, ct.table_name, ct.row_count_estimate`,
        [member.connection_id],
      );

      mergedSchema.push({
        connectionId: member.connection_id,
        connectionName: member.name,
        alias: member.alias || member.name,
        connectorType: member.connector_type,
        databaseName: member.database_name,
        tables: schemas,
      });
    }

    return mergedSchema;
  }

  /**
   * Full combo query pipeline:
   * Merge schema → Plan → Execute → Merge results → Persist to query_executions
   */
  async executeQuery(
    orgId: string,
    comboId: string,
    user: SafeAccount,
    prompt: string,
    chatId?: string,
    messageId?: string,
  ) {
    await this.orgService.requireMember(orgId, user.id);
    const start = Date.now();

    // Persist user message immediately so history is ordered correctly.
    // We inline the two-query logic from ChatService.addMessage to avoid a
    // circular module dependency (ChatModule → QueryModule → ComboModule).
    let userMsg: any = null;
    if (chatId) {
      userMsg = await this.db.queryOne(
        `INSERT INTO chat_messages (chat_id, role, content) VALUES ($1, $2, $3) RETURNING *`,
        [chatId, 'user', prompt],
      ).catch(() => null);
      if (userMsg) {
        await this.db.query('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chatId]).catch(() => {});
      }
    }

    // Step 1: Build merged schema context
    const { sources, mergedContext } = await this.schemaMerger.buildMergedSchema(comboId);
    if (sources.length === 0) {
      throw new Error('Combo has no connections with synced schemas');
    }

    // Step 2: Generate multi-step plan
    const plan = await this.planner.plan(comboId, prompt, sources, mergedContext);

    // Step 3: Execute sub-queries in parallel
    const stepResults = await this.executor.executeAll(plan);

    // Step 4: Merge results
    const { rows, columns } = this.resultMerger.merge(stepResults, plan.merge);

    const totalMs = Date.now() - start;

    // Step 5: Persist to query_executions
    const subQueriesAudit = stepResults.map(sr => ({
      connectionId: sr.step.connectionId,
      alias: sr.step.alias,
      query: sr.step.query,
      status: sr.status,
      rowCount: sr.rowCount,
      executionTimeMs: sr.executionTimeMs,
      error: sr.error,
    }));

    const execStatus = stepResults.every(r => r.status === 'success') ? 'success' : 'failed';

    const execRecord = await this.db.queryOne(
      `INSERT INTO query_executions
         (org_id, chat_id, message_id, combo_id, executed_by, prompt,
          generated_query, status, execution_time_ms, row_count,
          result_preview, result_columns, sub_queries, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       RETURNING id`,
      [
        orgId, chatId || null, userMsg?.id || messageId || null, comboId, user.id, prompt,
        JSON.stringify(plan),
        execStatus,
        totalMs,
        rows.length,
        JSON.stringify(rows.slice(0, 25)),
        columns,
        JSON.stringify(subQueriesAudit),
      ],
    );

    // Persist assistant response as a chat message with insight + ui_hint
    if (chatId) {
      const insight = execStatus === 'success'
        ? `Executed across ${stepResults.length} source${stepResults.length !== 1 ? 's' : ''} using **${plan.merge?.strategy ?? 'join'}** merge. Found **${rows.length}** merged rows.`
        : `Query failed across ${stepResults.filter(r => r.status !== 'success').length} source(s).`;
      await this.db.queryOne(
        `INSERT INTO chat_messages (chat_id, role, content, execution_id, ui_hint)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [chatId, 'assistant', insight, execRecord?.id || null, plan.ui_hint || null],
      ).catch(() => null);
      await this.db.query('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chatId]).catch(() => {});
    }

    await this.audit.log({
      orgId, accountId: user.id,
      eventType: 'query_executed',
      resourceType: 'combo', resourceId: comboId,
      details: { prompt, steps: plan.steps.length, strategy: plan.merge.strategy, totalMs },
    });

    return {
      executionId: execRecord?.id,
      plan,
      stepResults: subQueriesAudit,
      rows,
      columns,
      rowCount: rows.length,
      totalExecutionTimeMs: totalMs,
      mergeStrategy: plan.merge.strategy,
      ui_hint: plan.ui_hint,
    };
  }
}
