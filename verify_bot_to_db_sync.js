require('dotenv').config({ path: '../.env' });
const { supabase } = require('./src/supabase');
const { runOrchestrator } = require('./src/core/orchestrator');

const TEST_SALESPERSON = "918262937458"; // Max's phone
const TEST_COMPANY = "Vanguard Engineering & Steel";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function verifyBotToDatabaseSync() {
  console.log("=========================================================================");
  console.log("   LIVE BOT-TO-DATABASE END-TO-END VERIFICATION AUDIT                 ");
  console.log("=========================================================================\n");

  // Clean up any existing test records first
  await supabase.from('kra_logs').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('followup_tasks').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('complaints').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('payment_tracking').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('deal_items').delete().filter('deal_id', 'in', `(select id from deals where customer_name = '${TEST_COMPANY}')`);
  await supabase.from('deals').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('inquiries').delete().ilike('raw_text', `%${TEST_COMPANY}%`);
  await supabase.from('customer_visits').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('recurring_customers').delete().eq('customer_name', TEST_COMPANY);

  // -------------------------------------------------------------------
  // STEP 1: Site Visit Message (KRA 9 + Auto-Onboard KRA 2)
  // -------------------------------------------------------------------
  console.log("-------------------------------------------------------------------------");
  console.log("📌 STEP 1: Sending Field Visit Message via Bot Orchestrator...");
  const visitMsg = `Visited ${TEST_COMPANY} in Nashik. Met owner Mr. Patil mobile 9876543210. Discussed 40 MT HR Sheets.`;
  console.log(`💬 User Input: "${visitMsg}"`);
  
  const botReply1 = await runOrchestrator(visitMsg, TEST_SALESPERSON);
  console.log(`🤖 Bot Reply:\n${botReply1}\n`);

  console.log("📊 Checking Database Tables for Step 1:");

  const { data: recCust1 } = await supabase
    .from('recurring_customers')
    .select('*')
    .ilike('customer_name', `%${TEST_COMPANY}%`)
    .limit(1);

  const { data: visit1 } = await supabase
    .from('customer_visits')
    .select('*')
    .ilike('customer_name', `%${TEST_COMPANY}%`)
    .limit(1);

  const { data: kra9Log } = await supabase
    .from('kra_logs')
    .select('*')
    .eq('kra_number', 9)
    .ilike('customer_name', `%${TEST_COMPANY}%`)
    .limit(1);

  console.log("   1. recurring_customers:", recCust1?.[0]?.customer_name, "| Phone:", recCust1?.[0]?.customer_phone, "| Contact:", recCust1?.[0]?.contact_person, "| Salesperson:", recCust1?.[0]?.assigned_salesperson_phone);
  console.log("   2. customer_visits:    ", visit1?.[0]?.customer_name, "| Met:", visit1?.[0]?.person_met, "| Phone:", visit1?.[0]?.contact_no, "| Remarks:", visit1?.[0]?.remarks?.substring(0, 40));
  console.log("   3. kra_logs (KRA 9):   ", kra9Log?.[0]?.description);

  await delay(12000);

  // -------------------------------------------------------------------
  // STEP 2: Product Requirement Message (Sales Pipeline & KRA 4)
  // -------------------------------------------------------------------
  console.log("\n-------------------------------------------------------------------------");
  console.log("📌 STEP 2: Sending Product Requirement Message via Bot Orchestrator...");
  const reqMsg = `${TEST_COMPANY} requires 40 MT HR Sheet 10mm for Nashik delivery by 25 August`;
  console.log(`💬 User Input: "${reqMsg}"`);

  const botReply2 = await runOrchestrator(reqMsg, TEST_SALESPERSON);
  console.log(`🤖 Bot Reply:\n${botReply2}\n`);

  console.log("📊 Checking Database Tables for Step 2:");

  const { data: deal2 } = await supabase
    .from('deals')
    .select('*')
    .ilike('customer_name', `%${TEST_COMPANY}%`)
    .order('created_at', { ascending: false })
    .limit(1);

  const { data: dealItems2 } = deal2 && deal2.length > 0 ? await supabase
    .from('deal_items')
    .select('*')
    .eq('deal_id', deal2[0].id) : { data: [] };

  const { data: inquiry2 } = await supabase
    .from('inquiries')
    .select('*')
    .ilike('raw_text', `%${TEST_COMPANY}%`)
    .order('created_at', { ascending: false })
    .limit(1);

  console.log("   4. deals (new inquiry):", deal2?.[0]?.customer_name, "| Stage:", deal2?.[0]?.stage, "| PO Date:", deal2?.[0]?.po_date, "| Cust Phone:", deal2?.[0]?.customer_phone, "| Sales Phone:", deal2?.[0]?.salesperson_phone);
  console.log("   5. deal_items:         ", dealItems2?.[0]?.sku_text, "| Qty:", dealItems2?.[0]?.quantity, dealItems2?.[0]?.unit);
  console.log("   6. inquiries:          ", inquiry2?.[0]?.raw_text, "| Status:", inquiry2?.[0]?.status);

  await delay(12000);

  // -------------------------------------------------------------------
  // STEP 3: Deal Won Message (KRA 1 & Payment Tracking)
  // -------------------------------------------------------------------
  console.log("\n-------------------------------------------------------------------------");
  console.log("📌 STEP 3: Marking Deal as WON via Bot Orchestrator...");
  const wonMsg = `${TEST_COMPANY} deal won for ₹20,00,000`;
  console.log(`💬 User Input: "${wonMsg}"`);

  const botReply3 = await runOrchestrator(wonMsg, TEST_SALESPERSON);
  console.log(`🤖 Bot Reply:\n${botReply3}\n`);

  console.log("📊 Checking Database Tables for Step 3:");

  const { data: dealWon3 } = await supabase
    .from('deals')
    .select('*')
    .ilike('customer_name', `%${TEST_COMPANY}%`)
    .eq('stage', 'won')
    .order('created_at', { ascending: false })
    .limit(1);

  const { data: payTrack3 } = await supabase
    .from('payment_tracking')
    .select('*')
    .ilike('customer_name', `%${TEST_COMPANY}%`)
    .limit(1);

  const { data: kra1Log } = await supabase
    .from('kra_logs')
    .select('*')
    .eq('kra_number', 1)
    .ilike('customer_name', `%${TEST_COMPANY}%`)
    .limit(1);

  console.log("   7. deals (stage won):  ", dealWon3?.[0]?.customer_name, "| Stage:", dealWon3?.[0]?.stage, "| PO Number:", dealWon3?.[0]?.po_number, "| PO Date:", dealWon3?.[0]?.po_date, "| Amount: ₹", dealWon3?.[0]?.total_amount);
  console.log("   8. payment_tracking:   ", payTrack3?.[0]?.customer_name, "| Invoice Amount: ₹", payTrack3?.[0]?.invoice_amount, "| Outstanding: ₹", payTrack3?.[0]?.outstanding, "| Status:", payTrack3?.[0]?.status);
  console.log("   9. kra_logs (KRA 1):   ", kra1Log?.[0]?.description, "| Value: ₹", kra1Log?.[0]?.value);

  await delay(12000);

  // -------------------------------------------------------------------
  // STEP 4: Payment Received Message (KRA 5)
  // -------------------------------------------------------------------
  console.log("\n-------------------------------------------------------------------------");
  console.log("📌 STEP 4: Logging Payment Collection via Bot Orchestrator...");
  const payMsg = `Received ₹8,00,000 advance payment from ${TEST_COMPANY} today`;
  console.log(`💬 User Input: "${payMsg}"`);

  const botReply4 = await runOrchestrator(payMsg, TEST_SALESPERSON);
  console.log(`🤖 Bot Reply:\n${botReply4}\n`);

  console.log("📊 Checking Database Tables for Step 4:");

  const { data: payTrack4 } = await supabase
    .from('payment_tracking')
    .select('*')
    .ilike('customer_name', `%${TEST_COMPANY}%`)
    .limit(1);

  const { data: kra5Log } = await supabase
    .from('kra_logs')
    .select('*')
    .eq('kra_number', 5)
    .ilike('customer_name', `%${TEST_COMPANY}%`)
    .limit(1);

  console.log("   10. payment_tracking:  ", payTrack4?.[0]?.customer_name, "| Collected: ₹", payTrack4?.[0]?.collected_amount, "| Outstanding: ₹", payTrack4?.[0]?.outstanding, "| Status:", payTrack4?.[0]?.status);
  console.log("   11. kra_logs (KRA 5):  ", kra5Log?.[0]?.description, "| Value: ₹", kra5Log?.[0]?.value);

  await delay(12000);

  // -------------------------------------------------------------------
  // STEP 5: Quality Complaint Message (KRA 8)
  // -------------------------------------------------------------------
  console.log("\n-------------------------------------------------------------------------");
  console.log("📌 STEP 5: Logging Quality Complaint via Bot Orchestrator...");
  const complaintMsg = `${TEST_COMPANY} reported surface scratch issue on HR Sheet batch #804`;
  console.log(`💬 User Input: "${complaintMsg}"`);

  const botReply5 = await runOrchestrator(complaintMsg, TEST_SALESPERSON);
  console.log(`🤖 Bot Reply:\n${botReply5}\n`);

  console.log("📊 Checking Database Tables for Step 5:");

  const { data: complaint5 } = await supabase
    .from('complaints')
    .select('*')
    .ilike('customer_name', `%${TEST_COMPANY}%`)
    .order('reported_at', { ascending: false })
    .limit(1);

  console.log("   12. complaints:        ", complaint5?.[0]?.customer_name, "| Issue:", complaint5?.[0]?.description, "| Reported By:", complaint5?.[0]?.reported_by, "| Status:", complaint5?.[0]?.status);

  await delay(12000);

  // -------------------------------------------------------------------
  // STEP 6: Retention Follow-up Message (KRA 3)
  // -------------------------------------------------------------------
  console.log("\n-------------------------------------------------------------------------");
  console.log("📌 STEP 6: Logging Retention Follow-up via Bot Orchestrator...");
  const followupMsg = `Followed up with ${TEST_COMPANY} regarding next month repeat order`;
  console.log(`💬 User Input: "${followupMsg}"`);

  const botReply6 = await runOrchestrator(followupMsg, TEST_SALESPERSON);
  console.log(`🤖 Bot Reply:\n${botReply6}\n`);

  console.log("📊 Checking Database Tables for Step 6:");

  const { data: task6 } = await supabase
    .from('followup_tasks')
    .select('*')
    .ilike('customer_name', `%${TEST_COMPANY}%`)
    .order('created_at', { ascending: false })
    .limit(1);

  console.log("   13. followup_tasks:    ", task6?.[0]?.customer_name, "| Task Type:", task6?.[0]?.task_type, "| Status:", task6?.[0]?.status);

  // -------------------------------------------------------------------
  // VERIFICATION SUMMARY
  // -------------------------------------------------------------------
  console.log("\n=========================================================================");
  console.log("                   FINAL BOT-TO-DB SYNC SUMMARY                        ");
  console.log("=========================================================================");
  
  const checks = {
    recurring_customers: recCust1?.[0]?.customer_phone === "9876543210" && recCust1?.[0]?.contact_person === "Mr. Patil",
    customer_visits:     visit1?.[0]?.person_met === "Mr. Patil" && visit1?.[0]?.contact_no === "9876543210",
    deals_new_inquiry:   deal2?.[0]?.stage === 'new_inquiry' && deal2?.[0]?.po_date !== null && deal2?.[0]?.customer_phone === "9876543210",
    deal_items:          dealItems2?.[0]?.quantity === 40,
    inquiries:           inquiry2?.[0]?.raw_text !== undefined,
    deals_won:           dealWon3?.[0]?.stage === 'won' && dealWon3?.[0]?.po_number !== null && dealWon3?.[0]?.total_amount === 2000000,
    payment_tracking:    payTrack4?.[0]?.collected_amount === 800000 && payTrack4?.[0]?.outstanding === 1200000,
    complaints:          complaint5?.[0]?.status === 'pending' && complaint5?.[0]?.reported_by === TEST_SALESPERSON,
    followup_tasks:      task6?.[0]?.status === 'pending' && task6?.[0]?.salesperson_phone === TEST_SALESPERSON,
    kra_logs:            kra1Log?.[0]?.value === 2000000 && kra5Log?.[0]?.value === 800000 && kra9Log?.[0]?.kra_number === 9,
  };

  let allPassed = true;
  for (const [key, passed] of Object.entries(checks)) {
    console.log(`${passed ? '✅ VERIFIED PASS' : '❌ FAIL'}: ${key}`);
    if (!passed) allPassed = false;
  }

  // Cleanup test data
  await supabase.from('kra_logs').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('followup_tasks').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('complaints').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('payment_tracking').delete().eq('customer_name', TEST_COMPANY);
  if (deal2?.[0]?.id) await supabase.from('deal_items').delete().eq('deal_id', deal2[0].id);
  await supabase.from('deals').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('inquiries').delete().ilike('raw_text', `%${TEST_COMPANY}%`);
  await supabase.from('customer_visits').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('recurring_customers').delete().eq('customer_name', TEST_COMPANY);

  if (allPassed) {
    console.log("\n🎉 ALL WHATSAPP BOT INPUTS ARE 100% PROPERLY SYNCED & SAVED TO SUPABASE DATABASE!");
  }

  process.exit(allPassed ? 0 : 1);
}

verifyBotToDatabaseSync().catch(err => {
  console.error("Verification script error:", err);
  process.exit(1);
});
