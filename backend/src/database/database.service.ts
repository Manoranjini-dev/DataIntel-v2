// ──────────────────────────────────────────────
// Database Service — Raw SQL helpers over pg Pool
// ──────────────────────────────────────────────

import { Injectable, Inject } from '@nestjs/common';
import { Pool, QueryResult, QueryResultRow } from 'pg';
import { DATABASE_POOL } from './database.constants';

@Injectable()
export class DatabaseService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** Execute a parameterized query */
  async query<T extends QueryResultRow = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    try {
      return await this.pool.query<T>(sql, params);
    } catch (error: any) {
      if (error.message?.includes('Connection terminated') || error.message?.includes('timeout')) {
        return await this.pool.query<T>(sql, params);
      }
      throw error;
    }
  }

  /** Get a single row or null */
  async queryOne<T extends QueryResultRow = any>(sql: string, params?: any[]): Promise<T | null> {
    const result = await this.query<T>(sql, params);
    return result.rows[0] || null;
  }

  /** Get all rows */
  async queryMany<T extends QueryResultRow = any>(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.query<T>(sql, params);
    return result.rows;
  }

  /** Execute within a transaction */
  async transaction<T>(fn: (query: (sql: string, params?: any[]) => Promise<QueryResult>) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn((sql, params) => client.query(sql, params));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
