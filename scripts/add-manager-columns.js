const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const connStr = process.env.DIRECT_URL || process.env.DATABASE_URL;
  console.log(
    'Connecting with DB string:',
    connStr ? connStr.split('@')[1] : 'NONE',
  );
  if (!connStr) {
    console.error('No connection string available');
    return;
  }
  const client = new Client({ connectionString: connStr });
  try {
    await client.connect();
    console.log('Connected to PostgreSQL successfully!');

    // 1. Add manager_id and manager_phone columns to employees table if not present
    await client.query(`
      ALTER TABLE employees 
      ADD COLUMN IF NOT EXISTS manager_id uuid,
      ADD COLUMN IF NOT EXISTS manager_phone text;
    `);
    console.log(
      'Columns manager_id and manager_phone ensured in employees table!',
    );

    // 2. Query columns to verify
    const cols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'employees'
      ORDER BY ordinal_position;
    `);
    console.log('All columns of employees table:');
    console.table(cols.rows);

    // 3. Notify PostgREST to reload schema cache
    await client.query(`NOTIFY pgrst, 'reload schema';`);
    console.log('PostgREST schema cache reloaded!');
  } catch (err) {
    console.error('DB Migration Error:', err);
  } finally {
    await client.end();
  }
}

run();
