import { Client } from 'pg';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function migrateVisitColumns() {
  console.log('=== Adding follow-up columns to customer_visits table ===');

  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('FAILED: Neither DIRECT_URL nor DATABASE_URL is set in .env');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL database successfully.');

    const sql = `
      ALTER TABLE customer_visits
        ADD COLUMN IF NOT EXISTS follow_up_action TEXT,
        ADD COLUMN IF NOT EXISTS follow_up_date DATE,
        ADD COLUMN IF NOT EXISTS follow_up_status VARCHAR(20) DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS follow_up_completed_at TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS idx_customer_visits_fu
        ON customer_visits(follow_up_date, follow_up_status);
    `;

    console.log('Executing DDL query...');
    await client.query(sql);
    console.log('DDL executed successfully.');

    const res = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'customer_visits'
      ORDER BY ordinal_position;
    `);

    console.log('\nCurrent customer_visits columns:');
    console.table(res.rows);
  } catch (err: any) {
    console.error('Migration error:', err.message || err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrateVisitColumns();
