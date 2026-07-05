// ──────────────────────────────────────────────
// MCP Toolbox — Config Service
// Owns generation of the sidecar's `tools.yaml` from live DataIntel
// connections. Debounced regeneration on connection mutations; atomic writes
// with 0600 perms; startup bootstrap + health wait.
//
// SECURITY: the generated file contains decrypted DB passwords. Its contents
// are NEVER logged — only source counts. It is written 0600 on a volume shared
// only with the co-located sidecar (tmpfs in prod).
// ──────────────────────────────────────────────

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { promises as fs } from 'fs';
import { dirname } from 'path';
import * as yaml from 'js-yaml';
import { DatabaseService } from '../../database/database.service';
import { decrypt } from '../../common/utils/encryption';
import { ConnectorType } from '../../common/types';
import { ToolboxClientService } from './toolbox-client.service';
import {
  MappableConnection,
  isMappable,
  mapConnectionToSource,
} from './toolbox-source.mapper';
import { executeSqlToolName } from './toolbox.constants';

interface ConnectionRow {
  id: string;
  connector_type: string;
  host: string;
  port: number;
  database_name: string;
  username: string;
  encrypted_password: string;
  ssl_enabled: boolean;
  connection_options: unknown;
}

const REGEN_DEBOUNCE_MS = 500;

@Injectable()
export class ToolboxConfigService implements OnModuleInit {
  private readonly logger = new Logger(ToolboxConfigService.name);

  private readonly enabled: boolean;
  private readonly configPath: string;
  private readonly encKey: string;
  private readonly routed: ReadonlySet<ConnectorType>;

  private debounceTimer: NodeJS.Timeout | null = null;
  /** Serializes writes so overlapping regenerations don't corrupt the file. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly toolboxClient: ToolboxClientService,
  ) {
    this.enabled = (this.config.get<string>('TOOLBOX_ENABLED') ?? 'false') === 'true';
    this.configPath = this.config.get<string>('TOOLBOX_CONFIG_PATH') ?? '/config/tools.yaml';
    this.encKey = this.config.getOrThrow<string>('CREDENTIAL_ENCRYPTION_KEY');
    this.routed = this.parseRoutedConnectors(
      this.config.get<string>('TOOLBOX_ROUTED_CONNECTORS') ?? 'mysql,postgres',
    );
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Toolbox disabled (TOOLBOX_ENABLED != true) — skipping config generation');
      return;
    }
    try {
      await this.regenerateNow();
      const healthy = await this.waitForHealth();
      this.logger.log(
        healthy
          ? 'Toolbox sidecar is healthy — routing enabled'
          : 'Toolbox sidecar not reachable yet — routing will fall back to native until healthy',
      );
    } catch (err: any) {
      // Never block app startup on Toolbox — the router falls back to native.
      this.logger.error(`Toolbox bootstrap failed (continuing on native path): ${err?.message}`);
    }
  }

  // ── Regeneration triggers ────────────────────

  /** Connection lifecycle events → debounced regeneration. */
  @OnEvent('connection.created')
  @OnEvent('connection.updated')
  @OnEvent('connection.deleted')
  @OnEvent('connection.credentials_rotated')
  scheduleRegen(): void {
    if (!this.enabled) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.regenerateNow().catch((err) =>
        this.logger.error(`Toolbox config regeneration failed: ${err?.message}`),
      );
    }, REGEN_DEBOUNCE_MS);
  }

  /** Generate + write immediately (awaits the write). Serialized. */
  async regenerateNow(): Promise<void> {
    this.writeChain = this.writeChain.then(() => this.generateAndWrite()).catch((err) => {
      this.logger.error(`Toolbox config write failed: ${err?.message}`);
    });
    return this.writeChain;
  }

  // ── Generation ───────────────────────────────

  private async generateAndWrite(): Promise<void> {
    const rows = await this.db.queryMany<ConnectionRow>(
      `SELECT id, connector_type, host, port, database_name, username,
              encrypted_password, ssl_enabled, connection_options
       FROM datasource_connections
       WHERE deleted_at IS NULL`,
    );

    const sources: Record<string, unknown> = {};
    const tools: Record<string, unknown> = {};
    let mapped = 0;
    let skipped = 0;

    for (const row of rows) {
      const type = row.connector_type as ConnectorType;
      if (!this.routed.has(type) || !isMappable(type)) {
        skipped++;
        continue;
      }
      try {
        const conn: MappableConnection = {
          connectorType: type,
          host: row.host,
          port: row.port,
          database: row.database_name,
          username: row.username,
          password: decrypt(row.encrypted_password, this.encKey),
          ssl: row.ssl_enabled,
          connectionOptions: this.parseOptions(row.connection_options),
        };
        const { sourceKey, source, toolKind } = mapConnectionToSource(conn);
        sources[sourceKey] = source;
        tools[executeSqlToolName(sourceKey)] = {
          kind: toolKind,
          source: sourceKey,
          description: 'Execute a read-only SQL statement for this connection.',
        };
        mapped++;
      } catch (err: any) {
        // A single bad connection must not poison the whole file.
        skipped++;
        this.logger.warn(`Skipping connection ${row.id} in Toolbox config: ${err?.message}`);
      }
    }

    const doc = yaml.dump({ sources, tools }, { lineWidth: -1, noRefs: true });
    await this.atomicWrite(this.configPath, doc);
    // NEVER log `doc` — it contains decrypted credentials.
    this.logger.log(`Toolbox config written: ${mapped} source(s), ${skipped} skipped`);
  }

  // ── Atomic file write (0600) ─────────────────

  private async atomicWrite(path: string, contents: string): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true }).catch(() => {});
    const tmp = `${path}.tmp`;
    const fh = await fs.open(tmp, 'w', 0o600);
    try {
      await fh.writeFile(contents, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.chmod(tmp, 0o600).catch(() => {});
    try {
      await fs.rename(tmp, path);
    } catch (err: any) {
      // Windows: rename over an existing file throws EEXIST/EPERM — unlink first.
      if (err?.code === 'EEXIST' || err?.code === 'EPERM') {
        await fs.rm(path, { force: true });
        await fs.rename(tmp, path);
      } else {
        throw err;
      }
    }
  }

  // ── Startup health wait ──────────────────────

  private async waitForHealth(maxAttempts = 10, delayMs = 500): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      if (await this.toolboxClient.probe()) return true;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
  }

  // ── Helpers ──────────────────────────────────

  private parseRoutedConnectors(csv: string): ReadonlySet<ConnectorType> {
    const set = new Set<ConnectorType>();
    for (const raw of csv.split(',')) {
      const v = raw.trim().toLowerCase();
      if (v) set.add(v as ConnectorType);
    }
    return set;
  }

  private parseOptions(value: unknown): Record<string, any> | null {
    if (!value) return null;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    if (typeof value === 'object') return value as Record<string, any>;
    return null;
  }
}
