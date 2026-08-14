import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function applyPhase4Guardrails() {
  console.log('=== Applying Phase 4 Spend Cap Table Migration to Database ===');

  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error(
      '❌ FAILED: Neither DIRECT_URL nor DATABASE_URL is set in .env',
    );
    process.exit(1);
  }

  console.log('Connecting to PostgreSQL database...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ Connected to database successfully.');

    const sqlFilePath = path.resolve(
      process.cwd(),
      'supabase-phase4-guardrails.sql',
    );
    if (!fs.existsSync(sqlFilePath)) {
      console.error(`❌ Migration file not found at ${sqlFilePath}`);
      process.exit(1);
    }

    const sql = fs.readFileSync(sqlFilePath, 'utf-8');
    console.log(
      `Executing Guardrails migration script (${sql.length} bytes)...`,
    );

    await client.query(sql);

    console.log(
      '✅ SUCCESS: Phase 4 daily_llm_usage table and RLS policies applied successfully!',
    );
  } catch (err: any) {
    console.error(
      '❌ Guardrails Migration Execution Error:',
      err.message || err,
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyPhase4Guardrails();
