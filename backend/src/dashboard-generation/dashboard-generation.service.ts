// ──────────────────────────────────────────────
// Dashboard Generation Service
// ──────────────────────────────────────────────

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { SafeAccount } from '../auth/auth.service';

import { DashboardBuilderService, CreateWidgetDto } from '../dashboard/dashboard-builder.service';
import { LayoutEngineService } from './layout-engine.service';
import { WidgetRecommendationService, WidgetRecommendation, RichSchemaContext } from './widget-recommendation.service';

@Injectable()
export class DashboardGenerationService {
  private readonly logger = new Logger(DashboardGenerationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly builder: DashboardBuilderService,
    private readonly layoutEngine: LayoutEngineService,
    private readonly recommender: WidgetRecommendationService,

  ) {}

  /** Enqueue a dashboard generation job */
  async queueGenerationJob(
    user: SafeAccount,
    data: { intent: string; contextType: string; contextId: string; templateId?: string }
  ) {
    const jobRecord = await this.db.queryOne(
      `INSERT INTO dashboard_generation_jobs
         (requested_by, context, template_id, status)
       VALUES ($1, $2, $3, 'queued')
       RETURNING *`,
      [user.id, JSON.stringify({ intent: data.intent, contextType: data.contextType, contextId: data.contextId }), data.templateId || null]
    );

    // Execute asynchronously instead of using BullMQ
    setTimeout(() => {
      this.processGenerationJob(jobRecord!.id, user.id, data.intent, data.contextType, data.contextId)
        .catch(err => this.logger.error(`Dashboard generation failed for job ${jobRecord!.id}`, err));
    }, 100);

    return jobRecord;
  }

  /** Retrieve job status for polling */
  async getJobStatus(jobId: string, requesterId: string) {
    const job = await this.db.queryOne(
      `SELECT id, status, progress, dashboard_id, error
       FROM dashboard_generation_jobs
       WHERE id = $1 AND requested_by = $2`,
      [jobId, requesterId]
    );
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  /**
   * Actual worker execution payload (called by BullMQ processor).
   * Generates dashboard, pages, and widgets, then calculates layout.
   */
  async processGenerationJob(jobId: string, userId: string, intent: string, contextType: any, contextId: string) {
    // 1. Update status
    await this.db.query(`UPDATE dashboard_generation_jobs SET status = 'running', progress = 10, started_at = NOW() WHERE id = $1`, [jobId]);

    try {
      // 2. Fetch schema context from the connection/combo (full column detail)
      const schemaContext = await this.fetchSchemaContext(contextType, contextId);

      await this.db.query(`UPDATE dashboard_generation_jobs SET progress = 30 WHERE id = $1`, [jobId]);

      // 3. Get widget recommendations from LLM — pass empty existing prompts since this is a new dashboard
      const recommendations = await this.recommender.recommendWidgets(intent, schemaContext, []);

      await this.db.query(`UPDATE dashboard_generation_jobs SET progress = 60 WHERE id = $1`, [jobId]);

      // 4. Create actual dashboard via builder service
      const dash = await this.builder.createDashboard({ id: userId } as SafeAccount, {
        name: `Generated: ${intent.substring(0, 30)}...`,
        contextType,
        contextId,
        // AI generation always scaffolds a dashboard bound to a specific data
        // source context, so it belongs to the data source workflow.
        origin: 'datasource',
      });

      // 5. Get default page created by builder
      const pages = await this.builder.listPages(dash.id, userId);
      const pageId = pages[0].id;

      await this.db.query(`UPDATE dashboard_generation_jobs SET progress = 80 WHERE id = $1`, [jobId]);

      // 6. Map recommendations to widgets and apply layout engine
      const baseWidgets: Partial<CreateWidgetDto>[] = recommendations.map((rec: WidgetRecommendation) => ({
        widgetType: rec.widgetType,
        title: rec.title,
        datasourceContextType: contextType,
        datasourceContextId: contextId,
        queryDefinition: {
          prompt: rec.queryPrompt,
          // We leave the actual SQL blank for now, it will be generated lazily when widget executes
        }
      }));

      const laidOutWidgets = this.layoutEngine.calculateLayout(baseWidgets);

      // 7. Persist widgets
      for (const widget of laidOutWidgets) {
        await this.builder.addWidget(pageId, { id: userId } as SafeAccount, widget);
      }

      // 8. Mark job completed
      await this.db.query(
        `UPDATE dashboard_generation_jobs 
         SET status = 'completed', progress = 100, completed_at = NOW(), dashboard_id = $2 
         WHERE id = $1`, 
        [jobId, dash.id]
      );

    } catch (e: any) {
      this.logger.error(`Generation job ${jobId} failed:`, e.stack);
      await this.db.query(
        `UPDATE dashboard_generation_jobs SET status = 'failed', error = $2, completed_at = NOW() WHERE id = $1`,
        [jobId, e.message]
      );
    }
  }

  private async fetchSchemaContext(contextType: string, contextId: string): Promise<RichSchemaContext> {
    if (contextType === 'combo') {
      const members = await this.db.queryMany<any>(
        `SELECT dc.id as connection_id
         FROM datasource_combo_members dcm
         JOIN datasource_connections dc ON dc.id = dcm.connection_id
         WHERE dcm.combo_id = $1`,
        [contextId],
      );
      const schemaLines: string[] = [];
      const allTables: string[] = [];
      for (const m of members) {
        const { lines, tables } = await this.getConnectionSchema(m.connection_id);
        schemaLines.push(...lines);
        allTables.push(...tables);
      }
      return { schema: schemaLines.join('\n'), tables: allTables };
    }

    const { lines, tables } = await this.getConnectionSchema(contextId);
    return { schema: lines.join('\n'), tables };
  }

  private async getConnectionSchema(connectionId: string): Promise<{ lines: string[]; tables: string[] }> {
    const rows = await this.db.queryMany<any>(
      `SELECT ct.table_name, string_agg(
         cc.column_name || ' ' || cc.data_type ||
         CASE WHEN cc.is_primary_key THEN ' PK' ELSE '' END ||
         CASE WHEN NOT cc.is_nullable THEN ' NOT NULL' ELSE '' END,
         ', ' ORDER BY cc.ordinal_position
       ) AS columns
       FROM connection_schemas cs
       JOIN connection_tables ct ON ct.schema_id = cs.id
       JOIN connection_columns cc ON cc.table_id = ct.id
       WHERE cs.connection_id = $1
         AND cs.deleted_at IS NULL
         AND ct.deleted_at IS NULL
         AND cc.deleted_at IS NULL
       GROUP BY ct.table_name
       ORDER BY ct.table_name`,
      [connectionId],
    );
    const lines = rows.map((r: any) => `${r.table_name}(${r.columns})`);
    const tables = rows.map((r: any) => r.table_name);
    return { lines, tables };
  }
}
