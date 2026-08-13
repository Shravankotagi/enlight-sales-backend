require('dotenv').config({
  path: require('path').join(__dirname, '..', '..', '.env'),
});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

(async () => {
  const SALESPERSON = '918262937458';

  const { data: kra4 } = await supabase
    .from('kra_logs')
    .select('id, customer_name')
    .eq('kra_number', 4)
    .eq('salesperson_phone', SALESPERSON);

  console.log(
    'All KRA4 entries:',
    kra4?.map((k) => k.customer_name),
  );

  const { data: customers } = await supabase
    .from('recurring_customers')
    .select('customer_name')
    .eq('assigned_salesperson_phone', SALESPERSON);

  const registered = (customers || []).map((c) =>
    c.customer_name.toLowerCase(),
  );
  console.log('Registered customers:', registered);

  // Delete KRA4 entries for customers NOT in registered list
  const toDelete = (kra4 || []).filter((k) => {
    const name = (k.customer_name || '').toLowerCase();
    return !registered.some(
      (r) => name.includes(r.slice(0, 5)) || r.includes(name.slice(0, 5)),
    );
  });

  console.log(
    'Stale entries to delete:',
    toDelete.map((t) => t.customer_name),
  );

  for (const entry of toDelete) {
    const { error } = await supabase
      .from('kra_logs')
      .delete()
      .eq('id', entry.id);
    if (error)
      console.error('Delete error:', entry.customer_name, error.message);
    else console.log('✅ Deleted stale KRA4 entry:', entry.customer_name);
  }

  console.log('Done. Stale KRA4 entries cleaned.');
})();
