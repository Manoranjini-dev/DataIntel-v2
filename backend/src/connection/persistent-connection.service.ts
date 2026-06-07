// ──────────────────────────────────────────────
// Persistent Connection Service
// Org-scoped CRUD + schema sync + health checks
// ──────────────────────────────────────────────

import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OrgService } from '../org/org.service';
import { MCPService } from '../mcp/mcp.service';
import { encrypt, decrypt } from '../common/utils/encryption';
import { CreateConnectionDto, UpdateConnectionDto } from './dto/persistent-connection.dto';
import { SafeAccount } from '../auth/auth.service';
import { ConnectorType } from '../common/types';

@Injectable()
export class PersistentConnectionService {
  private readonly logger = new Logger(PersistentConnectionService.name);
  private readonly encKey: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orgService: OrgService,
    private readonly mcpService: MCPService,
    private readonly config: ConfigService,
  ) {
    this.encKey = this.config.getOrThrow('CREDENTIAL_ENCRYPTION_KEY');
  }

  /** List all connections for an org (user must be a member) */
  async list(orgId: string, accountId: string) {
    await this.orgService.requireMember(orgId, accountId);
    return this.db.queryMany(
      `SELECT id, org_id, name, description, connector_type, host, port,
              database_name, username, ssl_enabled, connection_options,
              status, last_health_check, last_health_ok, schema_synced_at,
              created_by, created_at, updated_at
       FROM datasource_connections
       WHERE org_id = $1
       ORDER BY created_at DESC`,
      [orgId],
    );
  }

  /** Get a single connection */
  async get(orgId: string, connId: string, accountId: string) {
    await this.orgService.requireMember(orgId, accountId);
    const conn = await this.db.queryOne(
      `SELECT id, org_id, name, description, connector_type, host, port,
              database_name, username, ssl_enabled, connection_options,
              status, last_health_check, last_health_ok, schema_synced_at,
              created_by, created_at, updated_at
       FROM datasource_connections
       WHERE id = $1 AND org_id = $2`,
      [connId, orgId],
    );
    if (!conn) throw new NotFoundException('Connection not found');
    return conn;
  }

  /** Create a persisted connection with encrypted password */
  async create(orgId: string, user: SafeAccount, dto: CreateConnectionDto) {
    await this.orgService.requireRole(orgId, user.id, 'editor');

    const encryptedPassword = encrypt(dto.password, this.encKey);

    const conn = await this.db.queryOne(
      `INSERT INTO datasource_connections
         (org_id, name, description, connector_type, host, port, database_name,
          username, encrypted_password, ssl_enabled, connection_options, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, org_id, name, description, connector_type, host, port,
                 database_name, username, ssl_enabled, status, created_at`,
      [
        orgId, dto.name, dto.description || null, dto.connectorType,
        dto.host, dto.port, dto.databaseName, dto.username, encryptedPassword,
        dto.sslEnabled ?? false,
        JSON.stringify(dto.connectionOptions || {}),
        user.id,
      ],
    );

    await this.audit.log({
      orgId, accountId: user.id,
      eventType: 'connection_created',
      resourceType: 'connection', resourceId: conn!.id,
      details: { name: dto.name, connectorType: dto.connectorType, host: dto.host },
    });

    return conn;
  }

  /** Update connection (partial) */
  async update(orgId: string, connId: string, user: SafeAccount, dto: UpdateConnectionDto) {
    await this.orgService.requireRole(orgId, user.id, 'editor');
    const existing = await this.get(orgId, connId, user.id);

    const encryptedPassword = dto.password
      ? encrypt(dto.password, this.encKey)
      : undefined;

    const conn = await this.db.queryOne(
      `UPDATE datasource_connections SET
         name = COALESCE($3, name),
         description = COALESCE($4, description),
         host = COALESCE($5, host),
         port = COALESCE($6, port),
         username = COALESCE($7, username),
         encrypted_password = COALESCE($8, encrypted_password),
         ssl_enabled = COALESCE($9, ssl_enabled),
         updated_at = NOW()
       WHERE id = $1 AND org_id = $2
       RETURNING id, name, host, port, status, updated_at`,
      [connId, orgId, dto.name, dto.description, dto.host, dto.port,
       dto.username, encryptedPassword, dto.sslEnabled],
    );

    await this.audit.log({
      orgId, accountId: user.id, eventType: 'connection_updated',
      resourceType: 'connection', resourceId: connId, details: { name: dto.name },
    });

    return conn;
  }

  /** Delete a connection */
  async delete(orgId: string, connId: string, user: SafeAccount) {
    await this.orgService.requireRole(orgId, user.id, 'admin');
    await this.get(orgId, connId, user.id);
    await this.db.query(
      'DELETE FROM datasource_connections WHERE id = $1 AND org_id = $2',
      [connId, orgId],
    );
    await this.audit.log({
      orgId, accountId: user.id, eventType: 'connection_deleted',
      resourceType: 'connection', resourceId: connId,
    });
  }

  /** Test connection health and update status */
  async testConnection(orgId: string, connId: string, user: SafeAccount) {
    await this.orgService.requireMember(orgId, user.id);
    const conn = await this.db.queryOne<any>(
      'SELECT * FROM datasource_connections WHERE id = $1 AND org_id = $2',
      [connId, orgId],
    );
    if (!conn) throw new NotFoundException('Connection not found');

    const password = decrypt(conn.encrypted_password, this.encKey);
    const params = {
      host: conn.host, port: conn.port, username: conn.username,
      password, database: conn.database_name,
      connectorType: conn.connector_type as ConnectorType,
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
       SET status = $3, last_health_check = NOW(), last_health_ok = $4, updated_at = NOW()
       WHERE id = $1 AND org_id = $2`,
      [connId, orgId, newStatus, success],
    );

    await this.audit.log({
      orgId, accountId: user.id,
      eventType: success ? 'connection_test_success' : 'connection_test_failed',
      resourceType: 'connection', resourceId: connId,
      details: { latencyMs, error: errorMsg },
    });

    return { success, latencyMs, error: errorMsg };
  }

  /** Sync schema from live datasource into normalized tables */
  async syncSchema(orgId: string, connId: string, user: SafeAccount) {
    await this.orgService.requireRole(orgId, user.id, 'editor');
    const conn = await this.db.queryOne<any>(
      'SELECT * FROM datasource_connections WHERE id = $1 AND org_id = $2',
      [connId, orgId],
    );
    if (!conn) throw new NotFoundException('Connection not found');

    const password = decrypt(conn.encrypted_password, this.encKey);
    // Get live schema using MCP
    const schemaResult = await this.mcpService.getSchema({
      host: conn.host, port: conn.port, username: conn.username,
      password, database: conn.database_name,
      connectorType: conn.connector_type as ConnectorType,
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

      for (const table of (schemaResult?.tables || [])) {
        const tableRow = await query(
          `INSERT INTO connection_tables
             (schema_id, connection_id, table_name, table_type, row_count_estimate)
           VALUES ($1, $2, $3, 'table', $4) RETURNING id`,
          [schemaId, connId, table.name, table.rowCountEstimate || null],
        );
        const tableId = tableRow.rows[0].id;

        for (let i = 0; i < (table.columns || []).length; i++) {
          const col = table.columns[i];
          const fk = (table.foreignKeys || []).find(f => f.columnName === col.name);
          await query(
            `INSERT INTO connection_columns
               (table_id, connection_id, column_name, data_type, is_nullable,
                is_primary_key, is_foreign_key, fk_ref_table, fk_ref_column,
                ordinal_position, description)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [tableId, connId, col.name, col.type, col.nullable ?? true,
             col.isPrimaryKey ?? false, !!fk, fk ? fk.referencedTable : null, fk ? fk.referencedColumn : null,
             i, col.comment || null],
          );
        }
      }

      // Update sync timestamp
      await query(
        'UPDATE datasource_connections SET schema_synced_at = NOW(), status = $1 WHERE id = $2',
        ['active', connId],
      );
    });

    this.logger.log(`Schema synced for connection ${connId}`);
    return { success: true };
  }

  /** Get persisted schema for a connection */
  async getSchema(orgId: string, connId: string, accountId: string) {
    await this.orgService.requireMember(orgId, accountId);

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
    }>(
      'SELECT encrypted_password, host, port, username, database_name, connector_type FROM datasource_connections WHERE id = $1 AND deleted_at IS NULL',
      [connId],
    );
    if (!conn) throw new Error('Connection not found');

    const { decrypt } = await import('../common/utils/encryption');
    const password = decrypt(conn.encrypted_password, this.encKey);

    await this.mcpService.testConnection({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password,
      database: conn.database_name,
      connectorType: conn.connector_type as ConnectorType,
    });
  }

  /** Rotate connection credentials */
  async rotateCredentials(orgId: string, connId: string, user: SafeAccount, newPassword?: string): Promise<void> {
    await this.orgService.requireRole(orgId, user.id, 'admin');

    const conn = await this.get(orgId, connId, user.id);

    // If newPassword is provided, encrypt and update it.
    // If not, we might re-encrypt the existing password with a new encryption key,
    // but in this implementation, we just update the password explicitly.
    if (!newPassword) {
      throw new Error('New password must be provided for credential rotation');
    }

    const encryptedPassword = encrypt(newPassword, this.encKey);

    await this.db.transaction(async (query) => {
      await query(
        'UPDATE datasource_connections SET encrypted_password = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3',
        [encryptedPassword, connId, orgId]
      );

      await query(
        `INSERT INTO connection_rotation_logs (connection_id, rotated_by, status)
         VALUES ($1, $2, 'success')`,
        [connId, user.id]
      );
    });

    await this.audit.log({
      orgId, accountId: user.id,
      eventType: 'connection_credentials_rotated',
      resourceType: 'connection', resourceId: connId,
    });

    this.logger.log(`Credentials rotated for connection ${connId} by user ${user.id}`);
  }
}
