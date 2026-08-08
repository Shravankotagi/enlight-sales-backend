const fs = require('fs');
const path = require('path');

// Parse .env manually
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value.trim();
    }
  }
}

const { supabase } = require('./src/supabase');
const { runOrchestrator } = require('./src/core/orchestrator');

const TEST_SALESPERSON = "918262937458";
const TEST_COMPANY = "Reliance Steel Works";

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runFullLayerAudit() {
  console.log("=========================================================================");
  console.log("   FULL-STACK ARCHITECTURE END-TO-END AUDIT (LAYERS 1 THROUGH 7)         ");
  console.log("=========================================================================\n");

  let passes = 0;
  let fails = 0;

  function verify(layerName, description, condition, details) {
    if (condition) {
      console.log(`✅ [${layerName}] ${description}`);
      if (details) console.log(`   └─ Details: ${details}`);
      passes++;
    } else {
      console.log(`❌ [${layerName}] FAILED: ${description}`);
      if (details) console.log(`   └─ Details: ${details}`);
      fails++;
    }
  }

  // Cleanup test company records prior to test
  await supabase.from('kra_logs').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('payment_tracking').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('complaints').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('followup_tasks').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('deal_items').delete().filter('deal_id', 'in', `(select id from deals where customer_name = '${TEST_COMPANY}')`);
  await supabase.from('deals').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('inquiries').delete().ilike('raw_text', `%${TEST_COMPANY}%`);
  await supabase.from('customer_visits').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('recurring_customers').delete().eq('customer_name', TEST_COMPANY);

  // -------------------------------------------------------------------------
  // STEP 1: Site Visit Message (Testing Layers 1 -> 2 -> 3 -> 4 -> 5 -> 6)
  // -------------------------------------------------------------------------
  console.log("📌 STEP 1: Processing Field Visit Report...");
  const visitMsg = `Visited ${TEST_COMPANY} in Mumbai. Met owner Mr. Sharma mobile 9988776655. Discussed 100 MT HR Plates.`;
  console.log(`💬 Salesperson Input: "${visitMsg}"`);
  
  const reply1 = await runOrchestrator(visitMsg, TEST_SALESPERSON);
  verify("Layer 2 Orchestrator", "Brain correctly processed message & invoked visit tool", !reply1.includes("trouble connecting") && reply1.includes("Visit Logged"));

  const { data: recCust1 } = await supabase.from('recurring_customers').select('*').eq('customer_name', TEST_COMPANY);
  const { data: visit1 } = await supabase.from('customer_visits').select('*').eq('customer_name', TEST_COMPANY);
  const { data: kra9Log } = await supabase.from('kra_logs').select('*').eq('kra_number', 9).eq('customer_name', TEST_COMPANY);

  verify("Layer 4 Supabase DB", "Auto-created customer in recurring_customers (KRA 2)", recCust1?.length > 0 && recCust1[0].customer_phone === "9988776655", `Phone: ${recCust1?.[0]?.customer_phone}`);
  verify("Layer 4 Supabase DB", "Logged visit to customer_visits (KRA 9)", visit1?.length > 0 && visit1[0].person_met?.includes("Mr. Sharma"), `Met: ${visit1?.[0]?.person_met}`);
  verify("Layer 4 Supabase DB", "Logged score entry in kra_logs (KRA 9)", kra9Log?.length > 0, `Log: ${kra9Log?.[0]?.description}`);

  await delay(12000);

  // -------------------------------------------------------------------------
  // STEP 2: Product Requirement (Testing Layers 1 -> 2 -> 3 -> 4 -> 5 -> 6)
  // -------------------------------------------------------------------------
  console.log("\n📌 STEP 2: Processing Product Requirement / RFQ...");
  const reqMsg = `${TEST_COMPANY} requires 100 MT HR Plate 12mm for Mumbai delivery by 28 August`;
  console.log(`💬 Salesperson Input: "${reqMsg}"`);

  const reply2 = await runOrchestrator(reqMsg, TEST_SALESPERSON);
  verify("Layer 2 Orchestrator", "Brain correctly routed requirement to update_deal_stage", !reply2.includes("trouble connecting") && (reply2.includes("Sales Inquiry") || reply2.includes("Pipeline Logged")));

  const { data: deals2 } = await supabase.from('deals').select('*').eq('customer_name', TEST_COMPANY);
  const { data: items2 } = deals2?.length > 0 ? await supabase.from('deal_items').select('*').eq('deal_id', deals2[0].id) : { data: [] };
  const { data: inq2 } = await supabase.from('inquiries').select('*').ilike('raw_text', `%${TEST_COMPANY}%`);

  verify("Layer 4 Supabase DB", "Created deal at stage new_inquiry", deals2?.length > 0 && deals2[0].stage === "new_inquiry", `Stage: ${deals2?.[0]?.stage}, PO Date: ${deals2?.[0]?.po_date}`);
  verify("Layer 4 Supabase DB", "Created line item in deal_items", items2?.length > 0 && items2[0].quantity === 100, `Qty: ${items2?.[0]?.quantity} MT`);
  verify("Layer 4 Supabase DB", "Saved captured inquiry in inquiries table", inq2?.length > 0, `Raw Text: ${inq2?.[0]?.raw_text?.substring(0, 40)}`);

  await delay(12000);

  // -------------------------------------------------------------------------
  // STEP 3: Marking Deal as WON (Testing Layers 1 -> 2 -> 3 -> 4 -> 5 -> 6)
  // -------------------------------------------------------------------------
  console.log("\n📌 STEP 3: Processing Deal Won...");
  const wonMsg = `${TEST_COMPANY} deal won for ₹50,00,000`;
  console.log(`💬 Salesperson Input: "${wonMsg}"`);

  const reply3 = await runOrchestrator(wonMsg, TEST_SALESPERSON);
  verify("Layer 2 Orchestrator", "Brain correctly executed deal won routine", !reply3.includes("trouble connecting") && (reply3.includes("Deal Marked as WON") || reply3.includes("Closed Won")));

  const { data: wonDeals3 } = await supabase.from('deals').select('*').eq('customer_name', TEST_COMPANY).eq('stage', 'won');
  const { data: payTrack3 } = await supabase.from('payment_tracking').select('*').eq('customer_name', TEST_COMPANY);
  const { data: kra1Log } = await supabase.from('kra_logs').select('*').eq('kra_number', 1).eq('customer_name', TEST_COMPANY);

  verify("Layer 4 Supabase DB", "Updated deal stage to WON & generated PO number", wonDeals3?.length > 0 && wonDeals3[0].po_number?.startsWith("PO-"), `PO Number: ${wonDeals3?.[0]?.po_number}, Value: ₹${wonDeals3?.[0]?.total_amount}`);
  verify("Layer 4 Supabase DB", "Triggered payment_tracking creation with outstanding ₹50L", payTrack3?.length > 0 && payTrack3[0].outstanding === 5000000, `Invoice: ₹${payTrack3?.[0]?.invoice_amount}, Outstanding: ₹${payTrack3?.[0]?.outstanding}`);
  verify("Layer 4 Supabase DB", "Logged sales achievement in kra_logs (KRA 1)", kra1Log?.length > 0 && kra1Log[0].value === 5000000, `Value: ₹${kra1Log?.[0]?.value}`);

  await delay(12000);

  // -------------------------------------------------------------------------
  // STEP 4: Payment Received Message (Testing Layers 1 -> 2 -> 3 -> 4 -> 5 -> 6)
  // -------------------------------------------------------------------------
  console.log("\n📌 STEP 4: Processing Payment Collection...");
  const payMsg = `Received ₹20,00,000 advance payment from ${TEST_COMPANY} today`;
  console.log(`💬 Salesperson Input: "${payMsg}"`);

  const reply4 = await runOrchestrator(payMsg, TEST_SALESPERSON);
  verify("Layer 2 Orchestrator", "Brain correctly routed payment to log_payment", !reply4.includes("trouble connecting") && (reply4.includes("Payment Collection Logged") || reply4.includes("Payment Logged")));

  const { data: payTrack4 } = await supabase.from('payment_tracking').select('*').eq('customer_name', TEST_COMPANY);
  const { data: kra5Log } = await supabase.from('kra_logs').select('*').eq('kra_number', 5).eq('customer_name', TEST_COMPANY);

  verify("Layer 4 Supabase DB", "Updated payment_tracking (Collected: ₹20L, Outstanding: ₹30L, Status: partial)", payTrack4?.[0]?.collected_amount === 2000000 && payTrack4?.[0]?.outstanding === 3000000 && payTrack4?.[0]?.status === "partial", `Collected: ₹${payTrack4?.[0]?.collected_amount}, Outstanding: ₹${payTrack4?.[0]?.outstanding}`);
  verify("Layer 4 Supabase DB", "Logged payment collection in kra_logs (KRA 5)", kra5Log?.length > 0 && kra5Log[0].value === 2000000, `Value: ₹${kra5Log?.[0]?.value}`);

  await delay(12000);

  // -------------------------------------------------------------------------
  // STEP 5: Quality Complaint Message (Testing Layers 1 -> 2 -> 3 -> 4 -> 5 -> 6)
  // -------------------------------------------------------------------------
  console.log("\n📌 STEP 5: Processing Quality Complaint...");
  const complaintMsg = `${TEST_COMPANY} reported edge rust issue on HR Plate batch #902`;
  console.log(`💬 Salesperson Input: "${complaintMsg}"`);

  const reply5 = await runOrchestrator(complaintMsg, TEST_SALESPERSON);
  verify("Layer 2 Orchestrator", "Brain correctly routed complaint to log_complaint", !reply5.includes("trouble connecting") && (reply5.includes("Complaint Logged") || reply5.includes("Complaint Reported")));

  const { data: complaint5 } = await supabase.from('complaints').select('*').eq('customer_name', TEST_COMPANY);
  verify("Layer 4 Supabase DB", "Saved complaint in complaints table", complaint5?.length > 0 && complaint5[0].status === "pending", `Issue: ${complaint5?.[0]?.description}`);

  await delay(12000);

  // -------------------------------------------------------------------------
  // STEP 6: Retention Follow-up Message (Testing Layers 1 -> 2 -> 3 -> 4 -> 5 -> 6)
  // -------------------------------------------------------------------------
  console.log("\n📌 STEP 6: Processing Retention Follow-up...");
  const followupMsg = `Followed up with ${TEST_COMPANY} regarding next month repeat order`;
  console.log(`💬 Salesperson Input: "${followupMsg}"`);

  const reply6 = await runOrchestrator(followupMsg, TEST_SALESPERSON);
  verify("Layer 2 Orchestrator", "Brain correctly routed follow-up to log_retention_followup", !reply6.includes("trouble connecting") && (reply6.includes("Retention Follow-up Logged") || reply6.includes("Follow-up Logged")));

  const { data: task6 } = await supabase.from('followup_tasks').select('*').eq('customer_name', TEST_COMPANY);
  verify("Layer 4 Supabase DB", "Saved task in followup_tasks table (KRA 3)", task6?.length > 0, `Task Type: ${task6?.[0]?.task_type}`);

  // Cleanup test records after complete verification
  await supabase.from('kra_logs').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('payment_tracking').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('complaints').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('followup_tasks').delete().eq('customer_name', TEST_COMPANY);
  if (deals2?.[0]?.id) await supabase.from('deal_items').delete().eq('deal_id', deals2[0].id);
  await supabase.from('deals').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('customer_visits').delete().eq('customer_name', TEST_COMPANY);
  await supabase.from('recurring_customers').delete().eq('customer_name', TEST_COMPANY);

  console.log("\n=========================================================================");
  console.log(`   FULL-STACK ARCHITECTURE E2E AUDIT RESULT: ${passes} PASSED / ${fails} FAILED `);
  console.log("=========================================================================");

  process.exit(fails === 0 ? 0 : 1);
}

runFullLayerAudit().catch(err => {
  console.error("Full Layer Audit Error:", err);
  process.exit(1);
});
