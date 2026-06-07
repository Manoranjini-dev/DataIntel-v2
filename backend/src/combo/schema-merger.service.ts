// ──────────────────────────────────────────────
// Schema Merger Service
// Merges normalized schemas from multiple connections
// into a single prefixed context string for the LLM
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ComboSchemaSource } from './combo.types';

@Injectable()
export class SchemaMergerService {
  private readonly logger = new Logger(SchemaMergerService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Build a merged schema context for a combo.
   * Each table is prefixed with [alias:db] so the LLM knows which source owns it.
   */
  async buildMergedSchema(comboId: string): Promise<{
    sources: ComboSchemaSource[];
    mergedContext: string;
  }> {
    // Get all connections in this combo
    const members = await this.db.queryMany<any>(
      `SELECT dcm.connection_id, dcm.alias, c.name, c.connector_type, c.database_name
       FROM datasource_combo_members dcm
       JOIN datasource_connections c ON c.id = dcm.connection_id
       WHERE dcm.combo_id = $1`,
      [comboId],
    );

    const sources: ComboSchemaSource[] = [];
    const contextParts: string[] = [];

    for (const member of members) {
      const alias = member.alias || member.name;
      const tables = await this.getConnectionTables(member.connection_id);

      sources.push({
        connectionId: member.connection_id,
        connectionName: member.name,
        alias,
        connectorType: member.connector_type,
        databaseName: member.database_name,
        tables,
      });

      // Build prefixed schema context for this source
      const tableLines = tables.map((t) => {
        const colDefs = t.columns
          .map((c) => `${c.name} ${c.type}${c.isPrimaryKey ? ' PRIMARY KEY' : ''}${!c.nullable ? ' NOT NULL' : ''}`)
          .join(', ');
        return `  [${alias}:${member.database_name}].${t.tableName}(${colDefs})${t.rowCountEstimate ? ` -- ~${t.rowCountEstimate.toLocaleString()} rows` : ''}`;
      });

      contextParts.push(
        `-- SOURCE: ${alias} (${member.connector_type}, db: ${member.database_name})\n` +
        tableLines.join('\n'),
      );
    }

    const mergedContext = contextParts.join('\n\n');
    this.logger.log(`Built merged schema for combo ${comboId}: ${sources.length} sources, total context ${mergedContext.length} chars`);

    return { sources, mergedContext };
  }

  private async getConnectionTables(connectionId: string) {
    const schemas = await this.db.queryMany<any>(
      'SELECT id FROM connection_schemas WHERE connection_id = $1',
      [connectionId],
    );

    const tables: ComboSchemaSource['tables'] = [];

    for (const schema of schemas) {
      const dbTables = await this.db.queryMany<any>(
        'SELECT id, table_name, row_count_estimate FROM connection_tables WHERE schema_id = $1',
        [schema.id],
      );

      for (const t of dbTables) {
        const columns = await this.db.queryMany<any>(
          `SELECT column_name AS name, data_type AS type, is_nullable AS nullable, is_primary_key AS "isPrimaryKey"
           FROM connection_columns WHERE table_id = $1 ORDER BY ordinal_position`,
          [t.id],
        );

        tables.push({
          tableName: t.table_name,
          rowCountEstimate: t.row_count_estimate,
          columns: columns.map((c: any) => ({
            name: c.name,
            type: c.type,
            nullable: c.nullable,
            isPrimaryKey: c.isPrimaryKey,
          })),
        });
      }
    }

    return tables;
  }
}
