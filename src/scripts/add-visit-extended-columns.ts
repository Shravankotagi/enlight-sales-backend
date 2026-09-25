import { Client } from 'pg';
import * as path from 'path';
import * as dotenv from 'dotenv';

const envPath = path.resolve(process.cwd(), 'em-os-backend/.env');
dotenv.config({ path: envPath });
dotenv.config();

async function migrateVisitExtendedColumns() {
  console.log('=== Adding extended visit columns to customer_visits table ===');

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
        ADD COLUMN IF NOT EXISTS email TEXT,
        ADD COLUMN IF NOT EXISTS designation TEXT,
        ADD COLUMN IF NOT EXISTS customer_type VARCHAR(50),
        ADD COLUMN IF NOT EXISTS visit_type VARCHAR(50) DEFAULT 'First Visit',
        ADD COLUMN IF NOT EXISTS outcome VARCHAR(20) DEFAULT 'positive',
        ADD COLUMN IF NOT EXISTS customer_probability VARCHAR(20),
        ADD COLUMN IF NOT EXISTS product_details TEXT,
        ADD COLUMN IF NOT EXISTS monthly_consumption TEXT,
        ADD COLUMN IF NOT EXISTS current_requirement TEXT,
        ADD COLUMN IF NOT EXISTS next_purchase_expected TEXT,
        ADD COLUMN IF NOT EXISTS delivery_location TEXT,
        ADD COLUMN IF NOT EXISTS preferred_make TEXT,
        ADD COLUMN IF NOT EXISTS payment_terms TEXT,
        ADD COLUMN IF NOT EXISTS gps_photo_url TEXT,
        ADD COLUMN IF NOT EXISTS gps_latitude NUMERIC,
        ADD COLUMN IF NOT EXISTS gps_longitude NUMERIC,
        ADD COLUMN IF NOT EXISTS gps_accuracy NUMERIC,
        ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

      CREATE INDEX IF NOT EXISTS idx_customer_visits_type
        ON customer_visits(customer_type);
      CREATE INDEX IF NOT EXISTS idx_customer_visits_prob
        ON customer_visits(customer_probability);
      CREATE INDEX IF NOT EXISTS idx_customer_visits_vtype
        ON customer_visits(visit_type);
      CREATE INDEX IF NOT EXISTS idx_customer_visits_outcome
        ON customer_visits(outcome);
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

    console.log('\nUpdated customer_visits columns:');
    console.table(res.rows);
  } catch (err: any) {
    console.error('Migration error:', err.message || err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrateVisitExtendedColumns();
