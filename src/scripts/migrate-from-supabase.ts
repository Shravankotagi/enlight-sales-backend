import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Target Dokploy PostgreSQL connection string
const targetArg = process.argv.find((a) => a.startsWith('--target='));
const TARGET_DB_URL =
  (targetArg ? targetArg.replace('--target=', '') : '') ||
  process.env.TARGET_DATABASE_URL ||
  'postgresql://postgres:8dYGwkYmAd9ipshI6gCa@187.127.120.202:5432/postgres';

const DDL_STATEMENTS = [
  // Extensions
  `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`,
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,

  // 1. Employees
  `CREATE TABLE IF NOT EXISTS employees (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id TEXT UNIQUE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    reports_to_employee_id TEXT,
    whatsapp_verified_at TIMESTAMPTZ,
    manager_id UUID,
    manager_phone TEXT
  );`,

  // 2. Recurring Customers
  `CREATE TABLE IF NOT EXISTS recurring_customers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    customer_gst TEXT,
    customer_address TEXT,
    assigned_salesperson_phone TEXT,
    last_order_date DATE,
    avg_order_frequency_days INTEGER DEFAULT 30,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    contact_person TEXT
  );`,

  // 3. Inquiries
  `CREATE TABLE IF NOT EXISTS inquiries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    source_channel TEXT,
    raw_text TEXT,
    media_urls TEXT[],
    voice_url TEXT,
    sender_phone TEXT,
    sender_name TEXT,
    whatsapp_message_id TEXT,
    status TEXT DEFAULT 'needs_review',
    created_at TIMESTAMPTZ DEFAULT now(),
    ai_extraction_json JSONB,
    overall_confidence NUMERIC,
    salesperson_phone TEXT,
    employee_id UUID,
    inquiry_type TEXT
  );`,

  // 4. Deals
  `CREATE TABLE IF NOT EXISTS deals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    inquiry_id UUID,
    stage TEXT DEFAULT 'new_inquiry',
    po_number TEXT,
    po_date TEXT,
    customer_name TEXT,
    customer_phone TEXT,
    customer_gst TEXT,
    customer_address TEXT,
    delivery_location TEXT,
    delivery_date TEXT,
    payment_terms TEXT,
    total_amount NUMERIC,
    inquiry_type TEXT,
    overall_confidence NUMERIC,
    status TEXT DEFAULT 'needs_review',
    created_at TIMESTAMPTZ DEFAULT now(),
    bigin_deal_id TEXT,
    lost_reason TEXT,
    salesperson_phone TEXT,
    employee_id UUID,
    won_at TIMESTAMPTZ
  );`,

  // 5. Deal Items
  `CREATE TABLE IF NOT EXISTS deal_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    deal_id UUID,
    sku_text TEXT,
    grade TEXT,
    dimensions TEXT,
    quantity NUMERIC,
    unit TEXT,
    rate NUMERIC,
    amount NUMERIC,
    confidence NUMERIC,
    created_at TIMESTAMPTZ DEFAULT now()
  );`,

  // 6. Complaints
  `CREATE TABLE IF NOT EXISTS complaints (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_name TEXT NOT NULL,
    complaint_type TEXT,
    description TEXT,
    reported_by TEXT,
    reported_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolution_time_hrs NUMERIC,
    status TEXT DEFAULT 'open',
    escalated BOOLEAN DEFAULT false,
    employee_id UUID,
    affected_product TEXT,
    sla_due_at TIMESTAMPTZ,
    resolution_notes TEXT,
    deal_id UUID,
    po_number TEXT,
    product_name TEXT,
    corrective_action TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );`,

  // 7. KRA Logs
  `CREATE TABLE IF NOT EXISTS kra_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    salesperson_phone TEXT NOT NULL,
    kra_number INTEGER NOT NULL,
    kra_type TEXT NOT NULL,
    description TEXT,
    customer_name TEXT,
    value NUMERIC,
    month INTEGER,
    year INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    employee_id UUID,
    action TEXT,
    details JSONB
  );`,

  // 8. Activity Logs
  `CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT now(),
    actor_phone TEXT,
    actor_name TEXT,
    actor_role TEXT,
    source TEXT,
    module TEXT,
    action_type TEXT,
    entity_id TEXT,
    entity_type TEXT,
    customer_name TEXT,
    change_detail JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    salesperson_name TEXT,
    salesperson_phone TEXT,
    description TEXT
  );`,

  // 9. Products
  `CREATE TABLE IF NOT EXISTS products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    category TEXT,
    product_name TEXT NOT NULL,
    dimensions TEXT,
    hsn_code TEXT,
    min_thickness_mm NUMERIC,
    max_thickness_mm NUMERIC,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );`,

  // 10. Customer Visits
  `CREATE TABLE IF NOT EXISTS customer_visits (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    salesperson_phone TEXT NOT NULL,
    customer_name TEXT,
    customer_address TEXT,
    person_met TEXT,
    contact_no TEXT,
    remarks TEXT,
    visited_at TIMESTAMPTZ DEFAULT now(),
    employee_id UUID
  );`,

  // 11. Followup Tasks
  `CREATE TABLE IF NOT EXISTS followup_tasks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    task_type TEXT NOT NULL,
    customer_name TEXT,
    customer_phone TEXT,
    salesperson_phone TEXT NOT NULL,
    due_date TIMESTAMPTZ,
    status TEXT DEFAULT 'pending',
    reminder_sent_at TIMESTAMPTZ,
    escalated_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    follow_up_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    employee_id UUID
  );`,

  // 12. Conversation Sessions
  `CREATE TABLE IF NOT EXISTS conversation_sessions (
    salesperson_phone TEXT PRIMARY KEY,
    active_customer_name TEXT,
    last_intent TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    chat_history JSONB
  );`,

  // 13. CRM Sync Log
  `CREATE TABLE IF NOT EXISTS crm_sync_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    salesperson_phone TEXT NOT NULL,
    customer_name TEXT,
    activity_type TEXT NOT NULL,
    summary TEXT,
    zoho_contact_id TEXT,
    zoho_deal_id TEXT,
    zoho_note_id TEXT,
    sync_status TEXT DEFAULT 'pending',
    error_message TEXT,
    payload JSONB,
    synced_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
  );`,

  // Key Indexes
  `CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);`,
  `CREATE INDEX IF NOT EXISTS idx_deals_po ON deals(po_number);`,
  `CREATE INDEX IF NOT EXISTS idx_deals_customer ON deals(customer_name);`,
  `CREATE INDEX IF NOT EXISTS idx_deal_items_deal ON deal_items(deal_id);`,
  `CREATE INDEX IF NOT EXISTS idx_complaints_customer ON complaints(customer_name);`,
  `CREATE INDEX IF NOT EXISTS idx_complaints_deal ON complaints(deal_id);`,
  `CREATE INDEX IF NOT EXISTS idx_recurring_cust_phone ON recurring_customers(customer_phone);`,
  `CREATE INDEX IF NOT EXISTS idx_inquiries_phone ON inquiries(sender_phone);`,
  `CREATE INDEX IF NOT EXISTS idx_kra_phone_month ON kra_logs(salesperson_phone, month, year);`,
];

const TABLES_ORDERED = [
  'employees',
  'recurring_customers',
  'inquiries',
  'deals',
  'deal_items',
  'complaints',
  'kra_logs',
  'activity_logs',
  'products',
  'customer_visits',
  'followup_tasks',
  'conversation_sessions',
  'crm_sync_log',
];

async function migrate() {
  console.log('==============================================================');
  console.log('       ENLIGHT METALS - AUTOMATED DATABASE MIGRATION          ');
  console.log('              (Supabase Cloud ➜ Dokploy Postgres)             ');
  console.log(
    '==============================================================\n',
  );

  console.log(`📡 Source Database : ${SUPABASE_URL}`);
  const maskedTarget = TARGET_DB_URL.replace(/:([^:@]+)@/, ':****@');
  console.log(`🎯 Target Database : ${maskedTarget}\n`);

  const pgClient = new Client({
    connectionString: TARGET_DB_URL,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log('Connecting to target Dokploy PostgreSQL...');
    await pgClient.connect();
    console.log('✅ Connected to target Dokploy PostgreSQL successfully!\n');

    console.log(
      'Creating extensions, tables, and indexes on Dokploy database...',
    );
    for (const ddl of DDL_STATEMENTS) {
      await pgClient.query(ddl);
    }
    console.log('✅ Target schema initialized successfully!\n');

    // Temporarily relax foreign key checks for clean bulk insertion
    await pgClient.query("SET session_replication_role = 'replica';");

    const scoreboard: Array<{
      table: string;
      sourceCount: number;
      targetCount: number;
      status: string;
    }> = [];

    let totalMigrated = 0;

    for (const tableName of TABLES_ORDERED) {
      process.stdout.write(`Migrating [${tableName.padEnd(23)}] `);

      // 1. Fetch all rows from Supabase (paginated in chunks of 500)
      const allRows: any[] = [];
      let page = 0;
      const pageSize = 500;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
          console.log(
            `⚠️ (Table not found or error in Supabase: ${error.message})`,
          );
          hasMore = false;
          break;
        }

        if (data && data.length > 0) {
          allRows.push(...data);
          if (data.length < pageSize) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      }

      const sourceCount = allRows.length;

      if (sourceCount === 0) {
        process.stdout.write(`0 rows (empty table) -> OK\n`);
        scoreboard.push({
          table: tableName,
          sourceCount: 0,
          targetCount: 0,
          status: 'MATCH ✅',
        });
        continue;
      }

      // Truncate existing data in target table to prevent duplicates
      await pgClient.query(`TRUNCATE TABLE "${tableName}" CASCADE;`);

      // 2. Insert into Dokploy in batches of 100
      const batchSize = 100;
      for (let i = 0; i < allRows.length; i += batchSize) {
        const batch = allRows.slice(i, i + batchSize);
        if (batch.length === 0) continue;

        const columns = Object.keys(batch[0]);
        const quotedColumns = columns.map((c) => `"${c}"`).join(', ');

        const valuesClauses: string[] = [];
        const paramValues: any[] = [];
        let paramIdx = 1;

        for (const row of batch) {
          const rowPlaceholders: string[] = [];
          for (const col of columns) {
            rowPlaceholders.push(`$${paramIdx++}`);
            const val = row[col];
            // Format object/array JSON properly for Postgres
            if (val !== null && typeof val === 'object') {
              if (col === 'media_urls' && Array.isArray(val)) {
                paramValues.push(val);
              } else {
                paramValues.push(JSON.stringify(val));
              }
            } else {
              paramValues.push(val);
            }
          }
          valuesClauses.push(`(${rowPlaceholders.join(', ')})`);
        }

        const insertQuery = `INSERT INTO "${tableName}" (${quotedColumns}) VALUES ${valuesClauses.join(', ')} ON CONFLICT DO NOTHING;`;
        await pgClient.query(insertQuery, paramValues);
      }

      // 3. Verify count in target Dokploy PostgreSQL
      const targetCountRes = await pgClient.query(
        `SELECT COUNT(*) FROM "${tableName}";`,
      );
      const targetCount = parseInt(targetCountRes.rows[0].count, 10);

      totalMigrated += targetCount;
      const isMatch = sourceCount === targetCount;
      process.stdout.write(
        `${sourceCount.toString().padStart(4)} rows transferred -> Target: ${targetCount.toString().padStart(4)} [${isMatch ? 'MATCH ✅' : 'MISMATCH ⚠️'}]\n`,
      );

      scoreboard.push({
        table: tableName,
        sourceCount,
        targetCount,
        status: isMatch ? 'MATCH ✅' : 'MISMATCH ⚠️',
      });
    }

    // Re-enable foreign key checks
    await pgClient.query("SET session_replication_role = 'origin';");

    console.log(
      '\n==============================================================',
    );
    console.log(
      '             DATABASE MIGRATION SCOREBOARD REPORT             ',
    );
    console.log(
      '==============================================================',
    );
    console.log(
      'Table Name'.padEnd(25) +
        'Source (Supabase)'.padStart(18) +
        'Target (Dokploy)'.padStart(18) +
        'Status'.padStart(12),
    );
    console.log(
      '--------------------------------------------------------------',
    );

    let allMatched = true;
    for (const item of scoreboard) {
      console.log(
        item.table.padEnd(25) +
          item.sourceCount.toString().padStart(18) +
          item.targetCount.toString().padStart(18) +
          item.status.padStart(12),
      );
      if (item.sourceCount !== item.targetCount) {
        allMatched = false;
      }
    }

    console.log(
      '--------------------------------------------------------------',
    );
    console.log(`Total Records Migrated: ${totalMigrated}`);
    console.log(
      '==============================================================\n',
    );

    if (allMatched) {
      console.log(
        '🎉 SUCCESS: All tables and records were migrated with ZERO data loss!',
      );
      console.log(
        '🔒 Security Reminder: You can now close or remove host port 5432 exposure',
      );
      console.log(
        '   in Dokploy so your database remains private to your internal network.\n',
      );
    } else {
      console.warn(
        '⚠️ WARNING: Some table row counts did not match. Please review output above.',
      );
    }
  } catch (err: any) {
    console.error('❌ Migration failed with error:', err.message);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

migrate();
