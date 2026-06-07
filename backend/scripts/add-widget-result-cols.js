require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running migration: add result_rows/result_columns to dashboard_widgets...');
    await client.query(`
      ALTER TABLE dashboard_widgets 
        ADD COLUMN IF NOT EXISTS result_rows JSONB,
        ADD COLUMN IF NOT EXISTS result_columns JSONB;
    `);
    console.log('✅ Migration complete');

    // Also update the migration SQL file
    console.log('Done.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
