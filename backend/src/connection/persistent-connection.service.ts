// ──────────────────────────────────────────────
// Persistent Connection Service
// Account-scoped CRUD + schema sync + health checks
// ──────────────────────────────────────────────

import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { MCPService } from '../mcp/mcp.service';
import { encrypt, decrypt } from '../common/utils/encryption';
import { CreateConnectionDto, UpdateConnectionDto } from './dto/persistent-connection.dto';
import { SafeAccount } from '../auth/auth.service';
import { ConnectorType } from '../common/types';
import { ConnectionPermissionsService } from './connection-permissions.service';
import { CacheService, CacheKeys } from '../cache/cache.service';

@Injectable()
export class PersistentConnectionService {
  private readonly logger = new Logger(PersistentConnectionService.name);
  private readonly encKey: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly mcpService: MCPService,
    private readonly config: ConfigService,
    private readonly connectionPermissions: ConnectionPermissionsService,
    private readonly cache: CacheService,
    private readonly events: EventEmitter2,
  ) {
    this.encKey = this.config.getOrThrow('CREDENTIAL_ENCRYPTION_KEY');
  }

  /**
   * List the connections a user can access: ones they own, ones shared with
   * them, or — for platform Admins — every connection (Admin always has
   * full visibility regardless of ownership).
   */
  async list(user: SafeAccount) {
    if (user.role === 'ADMIN') {
      return this.db.queryMany(
        `SELECT id, name, description, connector_type, host, port,
                database_name, username, ssl_enabled, connection_options,
                status, last_health_check, last_health_ok, schema_synced_at,
                created_by, created_at, updated_at,
                (created_by = $1) AS is_owner, 'owner' AS access_level
         FROM datasource_connections
         ORDER BY created_at DESC`,
        [user.id],
      );
    }

    return this.db.queryMany(
      `SELECT dc.id, dc.name, dc.description, dc.connector_type, dc.host, dc.port,
              dc.database_name, dc.username, dc.ssl_enabled, dc.connection_options,
              dc.status, dc.last_health_check, dc.last_health_ok, dc.schema_synced_at,
              dc.created_by, dc.created_at, dc.updated_at,
              (dc.created_by = $1) AS is_owner,
              CASE
                WHEN dc.created_by = $1 THEN 'owner'
                WHEN p.can_edit THEN 'edit'
                ELSE 'view'
              END AS access_level
       FROM datasource_connections dc
       LEFT JOIN datasource_permissions p
         ON p.connection_id = dc.id AND p.account_id = $1
            AND (p.expires_at IS NULL OR p.expires_at > NOW())
       WHERE dc.created_by = $1 OR p.account_id = $1
       ORDER BY dc.created_at DESC`,
      [user.id],
    );
  }

  /** Get a single connection, annotated with the caller's access level */
  async get(connId: string, accountId: string) {
    const level = await this.connectionPermissions.getAccessLevel(connId, accountId);
    if (!level) throw new ForbiddenException('You do not have access to this connection');

    const conn = await this.db.queryOne<any>(
      `SELECT id, name, description, connector_type, host, port,
              database_name, username, ssl_enabled, connection_options,
              status, last_health_check, last_health_ok, schema_synced_at,
              created_by, created_at, updated_at
       FROM datasource_connections
       WHERE id = $1`,
      [connId],
    );
    if (!conn) throw new NotFoundException('Connection not found');
    return { ...conn, access_level: level, is_owner: conn.created_by === accountId };
  }

  /** Create a persisted connection with encrypted password */
  async create(user: SafeAccount, dto: CreateConnectionDto) {
    if (user.role === 'VIEWER') {
      throw new ForbiddenException('Viewers cannot create data source connections');
    }

    const encryptedPassword = dto.password ? encrypt(dto.password, this.encKey) : encrypt('', this.encKey);

    const connectionOptions = {
      ...(dto.connectionOptions || {}),
      databricksHttpPath: dto.databricksHttpPath,
      bigqueryProjectId: dto.bigqueryProjectId,
      bigqueryDatasetId: dto.bigqueryDatasetId,
      bigqueryKeyJson: dto.bigqueryKeyJson,
    };

    const nextRefreshAt = new Date(Date.now() + 60 * 60_000);

    const conn = await this.db.queryOne(
      `INSERT INTO datasource_connections
         (name, description, connector_type, host, port, database_name,
          username, encrypted_password, ssl_enabled, connection_options, created_by,
          refresh_enabled, refresh_interval_minutes, next_refresh_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, name, description, connector_type, host, port,
                 database_name, username, ssl_enabled, status, created_by, created_at`,
      [
        dto.name, dto.description || null, dto.connectorType,
        dto.host || '', dto.port || 0, dto.databaseName || '', dto.username || '', encryptedPassword,
        dto.sslEnabled ?? dto.ssl ?? false,
        JSON.stringify(connectionOptions),
        user.id,
        true,
        60,
        nextRefreshAt,
      ],
    );

    await this.audit.log({
      accountId: user.id,
      eventType: 'connection_created',
      resourceType: 'connection', resourceId: conn!.id,
      details: { name: dto.name, connectorType: dto.connectorType, host: dto.host },
    });

    // Trigger Toolbox tools.yaml regeneration (no-op when Toolbox is disabled).
    this.events.emit('connection.created', { id: conn!.id });

    return conn;
  }

  /** Update connection (partial) */
  async update(connId: string, user: SafeAccount, dto: UpdateConnectionDto) {
    await this.connectionPermissions.requireAction(connId, user.id, 'edit');
    const existing = await this.get(connId, user.id);

    const encryptedPassword = dto.password
      ? encrypt(dto.password, this.encKey)
      : undefined;

    let mergedOptions = undefined;
    if (dto.connectionOptions || dto.databricksHttpPath || dto.bigqueryProjectId || dto.bigqueryDatasetId || dto.bigqueryKeyJson) {
      const currentOptions = typeof existing.connection_options === 'string'
        ? JSON.parse(existing.connection_options)
        : (existing.connection_options || {});

      mergedOptions = JSON.stringify({
        ...currentOptions,
        ...(dto.connectionOptions || {}),
        ...(dto.databricksHttpPath ? { databricksHttpPath: dto.databricksHttpPath } : {}),
        ...(dto.bigqueryProjectId ? { bigqueryProjectId: dto.bigqueryProjectId } : {}),
        ...(dto.bigqueryDatasetId ? { bigqueryDatasetId: dto.bigqueryDatasetId } : {}),
        ...(dto.bigqueryKeyJson ? { bigqueryKeyJson: dto.bigqueryKeyJson } : {}),
      });
    }

    const conn = await this.db.queryOne(
      `UPDATE datasource_connections SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         host = COALESCE($4, host),
         port = COALESCE($5, port),
         username = COALESCE($6, username),
         encrypted_password = COALESCE($7, encrypted_password),
         ssl_enabled = COALESCE($8, ssl_enabled),
         connection_options = COALESCE($9, connection_options),
         database_name = COALESCE($10, database_name),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, host, port, database_name, status, updated_at`,
      [connId, dto.name, dto.description, dto.host, dto.port,
       dto.username, encryptedPassword, dto.sslEnabled ?? dto.ssl, mergedOptions, dto.databaseName],
    );

    await this.audit.log({
      accountId: user.id, eventType: 'connection_updated',
      resourceType: 'connection', resourceId: connId, details: { name: dto.name },
    });

    this.events.emit('connection.updated', { id: connId });

    return conn;
  }

  /**
   * Delete a connection and perform a complete cleanup of every entity that is
   * exclusively associated with it. This prevents orphaned data and broken UI
   * references after the data source is removed.
   *
   * Removed automatically (in a single transaction):
   *   • Data Source dashboards (origin='datasource') scoped to this connection —
   *     and their pages, widgets, versions, filters, permissions (FK cascade) —
   *     plus their widget execution logs and generation jobs.
   *   • Chat sessions scoped to this connection (and their messages via FK cascade).
   *   • Query executions / generated-dashboard history tied to this connection.
   *   • The connection's schema, health logs, and credential rotations (FK cascade).
   *
   * Manual dashboards (origin='manual') that merely connect to this data source
   * are intentionally preserved — they are independent assets owned by the
   * Dashboards module and are not synchronized with this connection.
   *
   * Permission: only the connection owner may disconnect/delete it.
   */
  async delete(connId: string, user: SafeAccount) {
    await this.connectionPermissions.requireAction(connId, user.id, 'manage');
    await this.get(connId, user.id);

    await this.db.transaction(async (query) => {
      // 1. Identify the data-source dashboards owned by this connection.
      const dashRows = await query(
        `SELECT id FROM dashboards
         WHERE origin = 'datasource'
           AND context_type = 'connection' AND context_id = $1`,
        [connId],
      );
      const dashIds: string[] = dashRows.rows.map((r: any) => r.id);

      // 2. Remove generated-dashboard history / temporary artifacts (generation
      //    jobs) for this connection — both those that produced one of the
      //    deleted dashboards and those addressed at the connection directly.
      await query(
        `DELETE FROM dashboard_generation_jobs
         WHERE ( (context->>'contextId') = $1
                 OR (context->>'datasourceContextId') = $1
                 OR dashboard_id = ANY($2::uuid[]) )`,
        [connId, dashIds],
      );

      // 3. Remove widget execution logs for those dashboards (no FK cascade).
      if (dashIds.length > 0) {
        await query(
          `DELETE FROM widget_executions WHERE dashboard_id = ANY($1::uuid[])`,
          [dashIds],
        );
        // 4. Delete the dashboards — pages, widgets_v2, versions, filters and
        //    permissions are removed automatically via ON DELETE CASCADE.
        await query(
          `DELETE FROM dashboards WHERE id = ANY($1::uuid[])`,
          [dashIds],
        );
      }

      // 5. Remove query executions / chat history tied to this connection.
      //    (chats.connection_id is ON DELETE SET NULL, which would violate the
      //    chk_chat_scope CHECK constraint — so chats must be deleted explicitly
      //    BEFORE the connection row is removed.)
      await query(
        `DELETE FROM query_executions WHERE connection_id = $1`,
        [connId],
      );
      await query(
        `DELETE FROM chats WHERE connection_id = $1`,
        [connId],
      );

      // 6. Finally remove the connection itself. Schemas, tables, columns,
      //    health logs and credential rotations cascade via their FK.
      await query(
        `DELETE FROM datasource_connections WHERE id = $1`,
        [connId],
      );
    });

    // Drop any cached state keyed by this connection so deleted connections
    // never resurface via stale health/session/schema entries.
    await this.cache.del(
      CacheKeys.connHealth(connId),
      CacheKeys.connSession(connId),
      CacheKeys.connSchema(connId),
      CacheKeys.schemaSyncLock(connId),
      CacheKeys.schemaSyncStatus(connId),
    );

    await this.audit.log({
      accountId: user.id, eventType: 'connection_deleted',
      resourceType: 'connection', resourceId: connId,
    });

    this.events.emit('connection.deleted', { id: connId });
  }

  /** Test connection health and update status */
  async testConnection(connId: string, user: SafeAccount) {
    await this.connectionPermissions.requireAction(connId, user.id, 'view');
    const conn = await this.db.queryOne<any>(
      'SELECT * FROM datasource_connections WHERE id = $1',
      [connId],
    );
    if (!conn) throw new NotFoundException('Connection not found');

    const password = decrypt(conn.encrypted_password, this.encKey);
    const params = {
      host: conn.host, port: conn.port, username: conn.username,
      password, database: conn.database_name,
      connectorType: conn.connector_type as ConnectorType,
      ssl: conn.ssl_enabled,
      connectionOptions: typeof conn.connection_options === 'string' ? JSON.parse(conn.connection_options) : (conn.connection_options || {}),
    };

    const start = Date.now();
    let success = false;
    let errorMsg: string | null = null;

    try {
      await this.mcpService.testConnection(params);
      success = true;
    } catch (err: any) {
      errorMsg = err?.message || 'Connection failed';
    }

    const latencyMs = Date.now() - start;
    const newStatus = success ? 'active' : 'error';

    await this.db.query(
      `UPDATE datasource_connections
       SET status = $2, last_health_check = NOW(), last_health_ok = $3, updated_at = NOW()
       WHERE id = $1`,
      [connId, newStatus, success],
    );

    await this.audit.log({
      accountId: user.id,
      eventType: success ? 'connection_test_success' : 'connection_test_failed',
      resourceType: 'connection', resourceId: connId,
      details: { latencyMs, error: errorMsg },
    });

    return { success, latencyMs, error: errorMsg };
  }

  /** Sync schema from live datasource into normalized tables */
  async syncSchema(connId: string, user: SafeAccount) {
    await this.connectionPermissions.requireAction(connId, user.id, 'edit');
    await this.performSchemaSync(connId);

    await this.audit.log({
      accountId: user.id,
      eventType: 'connection_schema_synced',
      resourceType: 'connection', resourceId: connId,
    });

    return { success: true };
  }

  /**
   * Re-sync schema for a connection without an authenticated user — used by
   * the auto-refresh scheduler. Returns a status instead of throwing so the
   * caller can update refresh bookkeeping regardless of outcome.
   */
  async refreshNow(connId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.performSchemaSync(connId);
      return { success: true };
    } catch (err: any) {
      const message = err?.message || 'Refresh failed';
      this.logger.warn(`Auto-refresh failed for connection ${connId}: ${message}`);
      return { success: false, error: message };
    }
  }

  /** Core schema-sync logic shared by syncSchema() and refreshNow() */
  private async performSchemaSync(connId: string): Promise<void> {
    const conn = await this.db.queryOne<any>(
      'SELECT * FROM datasource_connections WHERE id = $1 AND deleted_at IS NULL',
      [connId],
    );
    if (!conn) throw new NotFoundException('Connection not found');

    const password = decrypt(conn.encrypted_password, this.encKey);
    // Get live schema using MCP
    const schemaResult = await this.mcpService.getSchema({
      host: conn.host, port: conn.port, username: conn.username,
      password, database: conn.database_name,
      connectorType: conn.connector_type as ConnectorType,
      ssl: conn.ssl_enabled,
      connectionOptions: typeof conn.connection_options === 'string' ? JSON.parse(conn.connection_options) : (conn.connection_options || {}),
    });

    // Persist schema into normalized tables
    await this.db.transaction(async (query) => {
      // Remove old schema
      await query(
        'DELETE FROM connection_schemas WHERE connection_id = $1',
        [connId],
      );

      // Infer schema name
      const schemaName = conn.database_name || 'default';

      const schemaRow = await query(
        `INSERT INTO connection_schemas (connection_id, schema_name)
         VALUES ($1, $2) RETURNING id`,
        [connId, schemaName],
      );
      const schemaId = schemaRow.rows[0].id;

      const tables = schemaResult?.tables || [];
      if (tables.length > 0) {
        const tableValues: any[] = [];
        const tablePlaceholders: string[] = [];
        let paramIdx = 1;

        for (const table of tables) {
          tablePlaceholders.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, 'table', $${paramIdx++})`);
          tableValues.push(schemaId, connId, table.name, table.rowCountEstimate || null);
        }

        const tablesRow = await query(
          `INSERT INTO connection_tables
             (schema_id, connection_id, table_name, table_type, row_count_estimate)
           VALUES ${tablePlaceholders.join(', ')} RETURNING id, table_name`,
          tableValues
        );

        const tableIdMap = new Map<string, string>();
        for (const row of tablesRow.rows) {
          tableIdMap.set(row.table_name, row.id);
        }

        const colValues: any[] = [];
        const colPlaceholders: string[] = [];

        for (const table of tables) {
          const tableId = tableIdMap.get(table.name);
          if (!tableId) continue;

          for (let i = 0; i < (table.columns || []).length; i++) {
            const col = table.columns[i];
            const fk = (table.foreignKeys || []).find(f => f.columnName === col.name);

            colPlaceholders.push(''); // placeholder to maintain array length
            colValues.push(
              tableId, connId, col.name, col.type, col.nullable ?? true,
              col.isPrimaryKey ?? false, !!fk, fk ? fk.referencedTable : null, fk ? fk.referencedColumn : null,
              i, col.comment || null
            );
          }
        }

        if (colValues.length > 0) {
          const colsPerChunk = 5000;
          const paramsPerCol = 11;

          for (let i = 0; i < colPlaceholders.length; i += colsPerChunk) {
            const chunkEnd = Math.min(i + colsPerChunk, colPlaceholders.length);
            const chunkValues = colValues.slice(i * paramsPerCol, chunkEnd * paramsPerCol);

            const chunkPlaceholders = [];
            for (let j = 0; j < chunkEnd - i; j++) {
              const base = j * paramsPerCol;
              chunkPlaceholders.push(`($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10}, $${base+11})`);
            }

            await query(
              `INSERT INTO connection_columns
                 (table_id, connection_id, column_name, data_type, is_nullable,
                  is_primary_key, is_foreign_key, fk_ref_table, fk_ref_column,
                  ordinal_position, description)
               VALUES ${chunkPlaceholders.join(', ')}`,
              chunkValues
            );
          }
        }
      }

      // Update sync timestamp
      await query(
        'UPDATE datasource_connections SET schema_synced_at = NOW(), status = $1 WHERE id = $2',
        ['active', connId],
      );
    });

    this.logger.log(`Schema synced for connection ${connId}`);
  }

  /** Get persisted schema for a connection */
  async getSchema(connId: string, accountId: string) {
    await this.connectionPermissions.requireAction(connId, accountId, 'view');

    const schemas = await this.db.queryMany(
      'SELECT * FROM connection_schemas WHERE connection_id = $1',
      [connId],
    );

    const result = [];
    for (const schema of schemas) {
      const tables = await this.db.queryMany(
        'SELECT * FROM connection_tables WHERE schema_id = $1 ORDER BY table_name',
        [schema.id],
      );

      const tablesWithCols = await Promise.all(
        tables.map(async (t: any) => {
          const columns = await this.db.queryMany(
            'SELECT * FROM connection_columns WHERE table_id = $1 ORDER BY ordinal_position',
            [t.id],
          );
          return { ...t, columns };
        }),
      );

      result.push({ ...schema, tables: tablesWithCols });
    }

    return result;
  }

  /**
   * Simple ping test for a connection — used by ConnectionHealthService.
   * Does NOT update DB status; only throws if unhealthy.
   */
  async testPing(connId: string): Promise<void> {
    const conn = await this.db.queryOne<{
      encrypted_password: string;
      host: string;
      port: number;
      username: string;
      database_name: string;
      connector_type: string;
      ssl_enabled: boolean;
      connection_options: string;
    }>(
      'SELECT encrypted_password, host, port, username, database_name, connector_type, ssl_enabled, connection_options FROM datasource_connections WHERE id = $1 AND deleted_at IS NULL',
      [connId],
    );
    if (!conn) throw new Error('Connection not found');

    const { decrypt } = await import('../common/utils/encryption');
    const password = decrypt(conn.encrypted_password, this.encKey);

    const connOptions = typeof conn.connection_options === 'string' ? JSON.parse(conn.connection_options) : (conn.connection_options || {});
    await this.mcpService.testConnection({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password,
      database: conn.database_name,
      connectorType: conn.connector_type as ConnectorType,
      ssl: conn.ssl_enabled,
      connectionOptions: connOptions,
    });
  }

  /** Rotate connection credentials (owner only — sensitive) */
  async rotateCredentials(connId: string, user: SafeAccount, newPassword?: string): Promise<void> {
    await this.connectionPermissions.requireAction(connId, user.id, 'manage');

    await this.get(connId, user.id);

    // If newPassword is provided, encrypt and update it.
    // If not, we might re-encrypt the existing password with a new encryption key,
    // but in this implementation, we just update the password explicitly.
    if (!newPassword) {
      throw new Error('New password must be provided for credential rotation');
    }

    const encryptedPassword = encrypt(newPassword, this.encKey);

    await this.db.transaction(async (query) => {
      await query(
        'UPDATE datasource_connections SET encrypted_password = $1, updated_at = NOW() WHERE id = $2',
        [encryptedPassword, connId]
      );

      await query(
        `INSERT INTO connection_rotation_logs (connection_id, rotated_by, status)
         VALUES ($1, $2, 'success')`,
        [connId, user.id]
      );
    });

    await this.audit.log({
      accountId: user.id,
      eventType: 'connection_credentials_rotated',
      resourceType: 'connection', resourceId: connId,
    });

    this.events.emit('connection.credentials_rotated', { id: connId });

    this.logger.log(`Credentials rotated for connection ${connId} by user ${user.id}`);
  }
}
