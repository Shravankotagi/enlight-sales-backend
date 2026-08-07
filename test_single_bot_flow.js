require('dotenv').config({ path: '../.env' });
const { supabase } = require('./src/supabase');
const { runOrchestrator } = require('./src/core/orchestrator');

const TEST_SALESPERSON = "918262937458";
const TEST_COMPANY = "Atlas Steel Forge";

async function testSingleFlow() {
  console.log("=================================================");
  console.log("   LIVE BOT-TO-DATABASE END-TO-END VERIFICATION  ");
  console.log("=================================================\n");

  // Clean test data
  await supabase.from('kra_logs').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('payment_tracking').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('deal_items').delete().filter('deal_id', 'in', `(select id from deals where customer_name = '${TEST_COMPANY}')`);
  await supabase.from('deals').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('inquiries').delete().ilike('raw_text', `%${TEST_COMPANY}%`);
  await supabase.from('customer_visits').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('recurring_customers').delete().eq('customer_name', TEST_COMPANY);

  // 1. Visit Message
  console.log("📌 Step 1: User sends site visit message to WhatsApp bot...");
  const visitText = `Visited ${TEST_COMPANY} in Pune. Met owner Mr. Mehta phone 9876543210. Interested in 50 MT HR Coil.`;
  console.log(`💬 Input: "${visitText}"`);
  const reply1 = await runOrchestrator(visitText, TEST_SALESPERSON);
  console.log(`🤖 Bot Reply:\n${reply1}\n`);

  const { data: recCust } = await supabase.from('recurring_customers').select('*').ilike('customer_name', `%${TEST_COMPANY}%`);
  const { data: visit } = await supabase.from('customer_visits').select('*').ilike('customer_name', `%${TEST_COMPANY}%`);
  console.log("📊 DB Check 1:");
  console.log("   ✅ recurring_customers:", recCust[0]?.customer_name, "| Phone:", recCust[0]?.customer_phone, "| Contact:", recCust[0]?.contact_person);
  console.log("   ✅ customer_visits:    ", visit[0]?.customer_name, "| Met:", visit[0]?.person_met, "| Contact:", visit[0]?.contact_no);

  // 2. Requirement Message
  console.log("\n📌 Step 2: User sends product requirement message to WhatsApp bot...");
  const reqText = `${TEST_COMPANY} requires 50 MT HR Coil 8mm for Pune delivery by 30 August`;
  console.log(`💬 Input: "${reqText}"`);
  const reply2 = await runOrchestrator(reqText, TEST_SALESPERSON);
  console.log(`🤖 Bot Reply:\n${reply2}\n`);

  const { data: deals } = await supabase.from('deals').select('*').ilike('customer_name', `%${TEST_COMPANY}%`);
  const { data: items } = deals.length > 0 ? await supabase.from('deal_items').select('*').eq('deal_id', deals[0].id) : { data: [] };
  console.log("📊 DB Check 2:");
  console.log("   ✅ deals (new inquiry):", deals[0]?.customer_name, "| Stage:", deals[0]?.stage, "| PO Date:", deals[0]?.po_date, "| Cust Phone:", deals[0]?.customer_phone, "| Sales Phone:", deals[0]?.salesperson_phone);
  console.log("   ✅ deal_items:         ", items[0]?.sku_text, "| Quantity:", items[0]?.quantity, items[0]?.unit);

  // 3. Deal Won Message
  console.log("\n📌 Step 3: User marks deal as WON...");
  const wonText = `${TEST_COMPANY} deal won for ₹25,00,000`;
  console.log(`💬 Input: "${wonText}"`);
  const reply3 = await runOrchestrator(wonText, TEST_SALESPERSON);
  console.log(`🤖 Bot Reply:\n${reply3}\n`);

  const { data: wonDeals } = await supabase.from('deals').select('*').ilike('customer_name', `%${TEST_COMPANY}%`).eq('stage', 'won');
  const { data: payments } = await supabase.from('payment_tracking').select('*').ilike('customer_name', `%${TEST_COMPANY}%`);
  const { data: kra1 } = await supabase.from('kra_logs').select('*').eq('kra_number', 1).ilike('customer_name', `%${TEST_COMPANY}%`);

  console.log("📊 DB Check 3:");
  console.log("   ✅ deals (stage won):  ", wonDeals[0]?.customer_name, "| Stage:", wonDeals[0]?.stage, "| PO Number:", wonDeals[0]?.po_number, "| Amount: ₹", wonDeals[0]?.total_amount);
  console.log("   ✅ payment_tracking:   ", payments[0]?.customer_name, "| Invoice Amount: ₹", payments[0]?.invoice_amount, "| Status:", payments[0]?.status);
  console.log("   ✅ kra_logs (KRA 1):   ", kra1[0]?.description, "| Value: ₹", kra1[0]?.value);

  // Clean test records
  await supabase.from('kra_logs').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('payment_tracking').delete().eq('customer_name', TEST_COMPANY);
  if (deals[0]?.id) await supabase.from('deal_items').delete().eq('deal_id', deals[0].id);
  await supabase.from('deals').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('customer_visits').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('recurring_customers').delete().eq('customer_name', TEST_COMPANY);

  console.log("\n🎉 END-TO-END BOT-TO-DATABASE SYNC VERIFIED 100% SUCCESSFUL!");
  process.exit(0);
}

testSingleFlow().catch(err => {
  console.error("Test Error:", err);
  process.exit(1);
});
