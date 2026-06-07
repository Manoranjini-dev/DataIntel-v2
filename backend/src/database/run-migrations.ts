// ──────────────────────────────────────────────
// Migration Runner Script
// Usage: npx ts-node -e "require('./run-migrations')"
//     or: node run-migrations.js (after build)
// Runs all pending migrations in order.
// ──────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();

  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id          SERIAL PRIMARY KEY,
        filename    TEXT NOT NULL UNIQUE,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Read all migration files sorted
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const row = await client.query(
        'SELECT id FROM _migrations WHERE filename = $1',
        [file],
      );
      if (row.rows.length > 0) {
        console.log(`  [SKIP] ${file} — already applied`);
        continue;
      }

      console.log(`  [RUN]  ${file} ...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO _migrations (filename) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
        console.log(`  [OK]   ${file}`);
      } catch (err: unknown) {
        await client.query('ROLLBACK');
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [FAIL] ${file}: ${msg}`);
        throw err;
      }
    }

    console.log('\n✅ All migrations applied successfully\n');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('\n❌ Migration failed:', err.message);
  process.exit(1);
});
