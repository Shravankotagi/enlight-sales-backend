import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

async function checkRecurringCustomers() {
  const { data, count, error } = await supabase
    .from('recurring_customers')
    .select('*', { count: 'exact' });
  console.log(
    `recurring_customers count in DB: ${count} (data returned: ${data?.length})`,
  );
  if (error) console.error('Error:', error);
  if (data && data.length > 0) {
    console.log('Sample customer:', JSON.stringify(data[0]));
  }
}

checkRecurringCustomers();
