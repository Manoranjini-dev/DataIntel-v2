// ──────────────────────────────────────────────
// SchemaGraph — In-Memory Schema Representation
// ──────────────────────────────────────────────

import { createHash } from 'crypto';
import { ForeignKey, SchemaMetadata, TableSchema } from '../common/types';
import { CompressedRelationship, CompressedSchema, JoinValidation } from './types';

export class SchemaGraph {
  private readonly tables: Map<string, TableSchema> = new Map();
  private readonly columnIndex: Map<string, Set<string>> = new Map(); // table → columns
  private readonly foreignKeyIndex: Map<string, ForeignKey[]> = new Map(); // table → FKs
  private readonly reverseFK: Map<string, string[]> = new Map(); // table.col → [table.col, ...]
  private readonly schemaHash: string;

  readonly database: string;
  readonly extractedAt: Date;

  constructor(private readonly metadata: SchemaMetadata) {
    this.database = metadata.database;
    this.extractedAt = metadata.extractedAt;

    // Build indices
    for (const table of metadata.tables) {
      this.tables.set(table.name.toLowerCase(), table);

      const cols = new Set(table.columns.map((c) => c.name.toLowerCase()));
      this.columnIndex.set(table.name.toLowerCase(), cols);

      this.foreignKeyIndex.set(table.name.toLowerCase(), table.foreignKeys);

      for (const fk of table.foreignKeys) {
        const key = `${table.name.toLowerCase()}.${fk.columnName.toLowerCase()}`;
        const target = `${fk.referencedTable.toLowerCase()}.${fk.referencedColumn.toLowerCase()}`;

        if (!this.reverseFK.has(key)) {
          this.reverseFK.set(key, []);
        }
        this.reverseFK.get(key)!.push(target);

        // Also index reverse direction
        if (!this.reverseFK.has(target)) {
          this.reverseFK.set(target, []);
        }
        this.reverseFK.get(target)!.push(key);
      }
    }

    // Compute schema hash for audit
    this.schemaHash = this.computeHash();
  }

  /** Get shaped schema for the topology API — full columns + FK topology */
  getStructuredSchema() {
    let totalColumns = 0;

    const tables = Array.from(this.tables.values()).map((t) => {
      const fkColumns = new Set(t.foreignKeys.map((fk) => fk.columnName.toLowerCase()));

      const columns = t.columns.map((c) => ({
        name: c.name,
        type: c.type,
        isPrimaryKey: c.isPrimaryKey ?? t.primaryKeys.includes(c.name),
        isForeignKey: fkColumns.has(c.name.toLowerCase()),
        nullable: c.nullable ?? true,
      }));

      totalColumns += columns.length;

      // Build "referenced by" list from reverse FK index
      const referencedBy: { fromTable: string; fromColumn: string; toColumn: string }[] = [];
      for (const [key, targets] of this.reverseFK) {
        for (const target of targets) {
          if (target.startsWith(`${t.name.toLowerCase()}.`)) {
            const [fromTable, fromColumn] = key.split('.');
            const toColumn = target.split('.')[1];
            // Only include if the direction is that something else points TO this table
            if (fromTable !== t.name.toLowerCase()) {
              referencedBy.push({ fromTable, fromColumn, toColumn });
            }
          }
        }
      }

      return {
        name: t.name,
        columns,
        primaryKeys: t.primaryKeys,
        foreignKeys: t.foreignKeys.map((fk) => ({
          columnName: fk.columnName,
          referencedTable: fk.referencedTable,
          referencedColumn: fk.referencedColumn,
        })),
        referencedBy,
      };
    });

    const relationships: { from: string; to: string }[] = [];
    for (const [tableName, fks] of this.foreignKeyIndex) {
      for (const fk of fks) {
        relationships.push({
          from: `${tableName}.${fk.columnName}`,
          to: `${fk.referencedTable}.${fk.referencedColumn}`,
        });
      }
    }

    return {
      database: this.database,
      hash: this.schemaHash,
      extractedAt: this.extractedAt,
      tables,
      relationships,
      stats: {
        totalTables: tables.length,
        totalColumns,
        totalRelationships: relationships.length,
      },
    };
  }

  /** Get all table names */
  getTableNames(): string[] {
    return Array.from(this.tables.keys());
  }

  /** Get table schema */
  getTable(name: string): TableSchema | undefined {
    return this.tables.get(name.toLowerCase());
  }

  /** Validate that a table exists */
  validateTableExists(tableName: string): boolean {
    return this.tables.has(tableName.toLowerCase());
  }

  /** Validate that a column exists in a table */
  validateColumnExists(tableName: string, columnName: string): boolean {
    const cols = this.columnIndex.get(tableName.toLowerCase());
    return cols ? cols.has(columnName.toLowerCase()) : false;
  }

  /** Validate a join between two tables */
  validateJoin(
    leftTable: string,
    leftColumn: string,
    rightTable: string,
    rightColumn: string,
  ): JoinValidation {
    const leftKey = `${leftTable.toLowerCase()}.${leftColumn.toLowerCase()}`;
    const rightKey = `${rightTable.toLowerCase()}.${rightColumn.toLowerCase()}`;

    // Check if FK relationship exists in either direction
    const leftTargets = this.reverseFK.get(leftKey) || [];
    const rightTargets = this.reverseFK.get(rightKey) || [];

    if (leftTargets.includes(rightKey) || rightTargets.includes(leftKey)) {
      return { valid: true };
    }

    // Check if columns exist at minimum
    if (!this.validateColumnExists(leftTable, leftColumn)) {
      return {
        valid: false,
        reason: `Column '${leftColumn}' does not exist in table '${leftTable}'`,
      };
    }

    if (!this.validateColumnExists(rightTable, rightColumn)) {
      return {
        valid: false,
        reason: `Column '${rightColumn}' does not exist in table '${rightTable}'`,
      };
    }

    return { valid: true };
  }

  /** Get all foreign keys for a table */
  getForeignKeys(tableName: string): ForeignKey[] {
    return this.foreignKeyIndex.get(tableName.toLowerCase()) || [];
  }

  /** Compress schema for LLM context injection */
  compressSchemaForLLM(): CompressedSchema {
    const tables = Array.from(this.tables.values()).map((t) => ({
      name: t.name,
      columns: t.columns
        .map((c) => {
          const nestedMarker = c.comment === 'nested object' ? '[nested]' : '';
          return `${c.name}:${c.type}${nestedMarker}${c.isPrimaryKey ? '(PK)' : ''}${!c.nullable ? '(NOT NULL)' : ''}`;
        })
        .join(', '),
      primaryKeys: t.primaryKeys,
    }));

    const relationships: CompressedRelationship[] = [];
    for (const [tableName, fks] of this.foreignKeyIndex) {
      for (const fk of fks) {
        relationships.push({
          from: `${tableName}.${fk.columnName}`,
          to: `${fk.referencedTable}.${fk.referencedColumn}`,
          type: 'foreign_key',
        });
      }
    }

    return { database: this.database, tables, relationships };
  }

  /** Compress to minimal string for token efficiency */
  compressToString(): string {
    const compressed = this.compressSchemaForLLM();
    const lines: string[] = [`Database: ${compressed.database}`, ''];

    for (const table of compressed.tables) {
      lines.push(`TABLE ${table.name}: ${table.columns}`);
    }

    if (compressed.relationships.length > 0) {
      lines.push('');
      lines.push('RELATIONSHIPS:');
      for (const rel of compressed.relationships) {
        lines.push(`  ${rel.from} → ${rel.to}`);
      }
    }

    return lines.join('\n');
  }

  /** Get schema hash for audit */
  getSchemaHash(): string {
    return this.schemaHash;
  }

  private computeHash(): string {
    const content = JSON.stringify(
      Array.from(this.tables.values()).map((t) => ({
        name: t.name,
        columns: t.columns.map((c) => `${c.name}:${c.type}`),
      })),
    );
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }
}
