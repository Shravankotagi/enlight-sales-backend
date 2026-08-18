import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

async function checkDeals() {
  const { data: deals, error } = await supabase
    .from('deals')
    .select('id, customer_name, stage, created_at, salesperson_phone');
  console.log(`Total deals in DB: ${deals?.length || 0}`);
  if (error) {
    console.error('Error fetching deals:', error);
    return;
  }
  if (deals) {
    console.log('\n--- All Deals in Database ---');
    deals.forEach((d, idx) => {
      console.log(
        `${idx + 1}. Customer: ${d.customer_name} | Stage: ${d.stage} | CreatedAt: ${d.created_at} | SalespersonPhone: ${d.salesperson_phone}`,
      );
    });
  }
}

checkDeals();
