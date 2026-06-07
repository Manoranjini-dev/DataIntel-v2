// ──────────────────────────────────────────────
// Result Merger — In-memory join/union/append/independent
// Merges sub-query results into a unified dataset
// ──────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { MergePlan, StepResult } from './combo.types';

@Injectable()
export class ResultMergerService {
  private readonly logger = new Logger(ResultMergerService.name);

  merge(
    stepResults: StepResult[],
    plan: MergePlan,
  ): { rows: Record<string, any>[]; columns: string[] } {
    const successResults = stepResults.filter(r => r.status === 'success');

    if (successResults.length === 0) {
      return { rows: [], columns: [] };
    }

    switch (plan.strategy) {
      case 'join':
        return this.hashJoin(successResults, plan.joinKey!, plan.outputColumns);
      case 'union':
        return this.union(successResults, plan.outputColumns);
      case 'append':
        return this.append(successResults);
      case 'independent':
      default:
        return this.independent(successResults);
    }
  }

  /**
   * In-memory hash join on a shared key column.
   * Left step is the "base" — all subsequent steps are joined onto it.
   * Missing keys → null values (left outer join behavior).
   */
  private hashJoin(
    results: StepResult[],
    joinKey: string,
    outputColumns?: string[],
  ): { rows: Record<string, any>[]; columns: string[] } {
    if (results.length === 1) {
      return { rows: results[0].rows, columns: results[0].columns };
    }

    const [base, ...rest] = results;
    let merged = base.rows.map(row => ({ ...row }));

    for (const result of rest) {
      // Build hash map: joinKey → row
      const hashMap = new Map<string, Record<string, any>>();
      for (const row of result.rows) {
        const key = String(row[joinKey] ?? '');
        hashMap.set(key, row);
      }

      // Merge each base row with its match
      merged = merged.map(baseRow => {
        const key = String(baseRow[joinKey] ?? '');
        const match = hashMap.get(key) || {};
        // Prefix duplicate column names with step alias
        const prefixed: Record<string, any> = {};
        for (const [col, val] of Object.entries(match)) {
          if (col === joinKey) continue; // Don't duplicate join key
          const colName = baseRow[col] !== undefined ? `${result.step.alias}_${col}` : col;
          prefixed[colName] = val;
        }
        return { ...baseRow, ...prefixed };
      });
    }

    // Build final column list — always include ALL merged columns so that
    // right-side projected columns (order_count, total_order_value, etc.) are
    // not dropped when the LLM plan's outputColumns only lists left-side columns.
    const allMergedCols = merged.length > 0 ? Object.keys(merged[0]) : [];
    let columns = allMergedCols;

    if (outputColumns?.length) {
      const outSet = new Set(outputColumns);
      // Only apply the filter when outputColumns actually covers all merged cols
      // (i.e. the plan is complete). If it's missing any merged col, fall back
      // to returning everything so we never silently drop right-side data.
      const planCoversAll = allMergedCols.every(c => outSet.has(c));
      if (planCoversAll) {
        columns = outputColumns.filter(c => allMergedCols.includes(c));
        merged = merged.map(row =>
          Object.fromEntries(columns.map(c => [c, row[c]])),
        );
      }
      // else: outputColumns is incomplete → return all merged columns as-is
    }

    this.logger.log(`Hash join: ${merged.length} merged rows, ${columns.length} columns`);
    return { rows: merged, columns };
  }

  /**
   * Union — concatenate rows vertically.
   * Adds a _source column to identify origin.
   */
  private union(
    results: StepResult[],
    outputColumns?: string[],
  ): { rows: Record<string, any>[]; columns: string[] } {
    const allRows: Record<string, any>[] = [];

    for (const result of results) {
      for (const row of result.rows) {
        allRows.push({ ...row, _source: result.step.alias });
      }
    }

    let columns = allRows.length > 0 ? [...Object.keys(allRows[0])] : [];
    if (outputColumns?.length) {
      const outSet = new Set(outputColumns);
      columns = columns.filter(c => outSet.has(c) || c === '_source');
    }

    this.logger.log(`Union: ${allRows.length} total rows from ${results.length} sources`);
    return { rows: allRows, columns };
  }

  /**
   * Append — results side by side in a nested structure.
   * Each result set is wrapped with its alias.
   */
  private append(
    results: StepResult[],
  ): { rows: Record<string, any>[]; columns: string[] } {
    // Return as flat rows with source prefix on columns
    const allRows: Record<string, any>[] = [];
    const maxRows = Math.max(...results.map(r => r.rows.length));
    const columns: string[] = [];

    for (const result of results) {
      for (const col of result.columns) {
        columns.push(`${result.step.alias}__${col}`);
      }
    }

    for (let i = 0; i < maxRows; i++) {
      const row: Record<string, any> = {};
      for (const result of results) {
        const sourceRow = result.rows[i] || {};
        for (const col of result.columns) {
          row[`${result.step.alias}__${col}`] = sourceRow[col] ?? null;
        }
      }
      allRows.push(row);
    }

    this.logger.log(`Append: ${allRows.length} rows, ${columns.length} columns`);
    return { rows: allRows, columns };
  }

  /**
   * Independent — return results as separate metadata-wrapped sets.
   * Serialized as: [{_result_set: 'alias', ...row}]
   */
  private independent(
    results: StepResult[],
  ): { rows: Record<string, any>[]; columns: string[] } {
    const allRows: Record<string, any>[] = [];
    const columns = new Set<string>(['_result_set']);

    for (const result of results) {
      for (const row of result.rows) {
        allRows.push({ _result_set: result.step.alias, ...row });
        Object.keys(row).forEach(c => columns.add(c));
      }
    }

    this.logger.log(`Independent: ${allRows.length} total rows`);
    return { rows: allRows, columns: Array.from(columns) };
  }
}
