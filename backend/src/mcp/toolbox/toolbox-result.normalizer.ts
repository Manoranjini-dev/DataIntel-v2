// ──────────────────────────────────────────────
// MCP Toolbox — Result Normalizer
// Converts Toolbox's `{ result: "<json>" }` payload into the existing
// MCPQueryResult shape so downstream consumers are untouched.
// ──────────────────────────────────────────────

import { MCPQueryResult } from '../types';

/** Shape of a successful Toolbox `POST /api/tool/{name}/invoke` response. */
export interface ToolboxInvokeResponse {
  /** JSON-encoded string: for execute-sql this is an array of row objects. */
  result: string;
}

/**
 * Parse the Toolbox `result` string into an array of row objects.
 * Toolbox returns rows as a JSON-encoded string; a bare `null`/empty means
 * "no rows" (e.g. a statement that returned nothing).
 */
function parseRows(result: string): Record<string, unknown>[] {
  if (result == null || result === '' || result === 'null') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    // Not JSON — surface as an error to the caller (triggers fallback).
    throw new Error(`Toolbox returned a non-JSON result: ${result.slice(0, 200)}`);
  }
  if (parsed == null) return [];
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  // A single object (rare) — wrap it as one row.
  if (typeof parsed === 'object') return [parsed as Record<string, unknown>];
  // A scalar (e.g. an error string embedded in result).
  throw new Error(`Toolbox returned an unexpected result: ${result.slice(0, 200)}`);
}

/** Derive an ordered column list from the returned rows. */
function deriveColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) seen.add(key);
    }
  }
  return Array.from(seen);
}

/**
 * Normalize a Toolbox invoke response into an `MCPQueryResult`.
 * @param maxRows optional cap mirroring MCP_MAX_RESULT_ROWS.
 */
export function normalizeToolboxResult(
  response: ToolboxInvokeResponse,
  executionTimeMs: number,
  maxRows?: number,
): MCPQueryResult {
  let rows = parseRows(response.result);
  const totalHits = rows.length;
  if (maxRows != null && rows.length > maxRows) {
    rows = rows.slice(0, maxRows);
  }
  return {
    rows,
    columns: deriveColumns(rows),
    rowCount: rows.length,
    executionTimeMs,
    ...(totalHits !== rows.length ? { totalHits } : {}),
  };
}
