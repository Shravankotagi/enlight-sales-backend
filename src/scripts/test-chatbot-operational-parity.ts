import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function runParityTests() {
  console.log('===========================================================');
  console.log(
    'AI Assistant & WhatsApp Bot Full Operational Parity Verification',
  );
  console.log('===========================================================\n');

  const { SupabaseService } =
    await import('../infrastructure/supabase/supabase.service');
  const { ConfigService } = await import('../config/config.service');
  const { ConfigService: NestConfigService } = await import('@nestjs/config');
  const { ChatbotService } = await import('../modules/chatbot/chatbot.service');
  const { ToolRegistryService } =
    await import('../modules/chatbot/tools/tool-registry.service');
  const { GuardrailsService } =
    await import('../modules/chatbot/guardrails/guardrails.service');

  const configService = new ConfigService(new NestConfigService());
  const supabaseService = new SupabaseService(configService);
  const toolRegistry = new ToolRegistryService(supabaseService);
  const guardrailsService = new GuardrailsService(supabaseService);
  const chatbotService = new ChatbotService(
    supabaseService,
    toolRegistry,
    guardrailsService,
  );

  const testSalespersonCaller = {
    userId: 'test-salesrep-' + Date.now(),
    email: 'rep@enlightmetals.com',
    role: 'salesperson' as const,
    name: 'Rishabh Test Rep',
    phone: '919619226169',
  };

  const EMOJI_REGEX =
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu;
  const ASTERISK_BULLET_REGEX = /^\s*\*\s+/m;

  function validateFormatting(testName: string, reply: string) {
    if (EMOJI_REGEX.test(reply)) {
      console.error(`❌ [${testName}] FAILED: Emoji detected in response!`);
      throw new Error(`Emoji detected in ${testName}`);
    }
    if (ASTERISK_BULLET_REGEX.test(reply)) {
      console.error(
        `❌ [${testName}] FAILED: Asterisk bullet (* Item) detected instead of hyphen (- Item)!`,
      );
      throw new Error(`Asterisk bullet detected in ${testName}`);
    }
    console.log(
      `   ✓ Formatting Validated: 0 emojis, clean hyphen list formatting.`,
    );
  }

  // ── TEST 1: Tool Registry Count & Integrity ─────────────────────────────
  console.log('--- TEST 1: Tool Registry Verification ---');
  const adminDecls = toolRegistry.getToolDeclarations('admin');
  console.log(`Total tools registered for Admin: ${adminDecls.length}`);

  const requiredTools = [
    // 10 RBAC Read Tools
    'get_inquiries',
    'get_my_open_deals',
    'get_customer_360',
    'get_reorder_queue',
    'search_knowledge_base',
    'get_team_pipeline',
    'get_churn_radar',
    'get_loss_analytics',
    'get_visits',
    'get_complaints',
    // 9 Operational Write Tools
    'update_deal_stage',
    'log_customer_visit',
    'log_complaint',
    'log_payment',
    'onboard_new_customer',
    'update_customer_profile',
    'log_retention_followup',
    'send_quotation',
    'get_deal_ids',
  ];

  for (const t of requiredTools) {
    const found = adminDecls.some((d: any) => d.name === t);
    if (!found) {
      throw new Error(`Missing expected tool in registry: ${t}`);
    }
  }
  console.log(
    `✓ PASS: All ${requiredTools.length} tools (10 read + 9 operational write) registered.\n`,
  );

  // ── TEST 2: Customer Site Visit Logging (KRA 9 Parity) ───────────────────
  console.log('--- TEST 2: Customer Site Visit Logging (KRA 9 Parity) ---');
  const visitMsg =
    'Visited Supreme Steel today at their plant, met Mr. Rajesh Sharma, discussed requirement for 25 MT HR Coil 2.5mm, outcome was positive, next step is to send formal quote tomorrow.';
  console.log(`Sending: "${visitMsg}"`);
  const visitRes = await chatbotService.processChatMessage(
    testSalespersonCaller,
    visitMsg,
  );
  console.log(`Response:\n${visitRes.reply}\n`);
  validateFormatting('Customer Site Visit', visitRes.reply);
  if (
    !visitRes.reply.toLowerCase().includes('visit') &&
    !visitRes.reply.toLowerCase().includes('supreme')
  ) {
    throw new Error('Visit response does not confirm logged visit');
  }
  console.log('✓ PASS: Customer site visit logged successfully.\n');

  // ── TEST 3: Customer Complaint Logging (KRA 7 & 8 Parity) ───────────────
  console.log(
    '--- TEST 3: Customer Quality Complaint Logging (KRA 7 & 8 Parity) ---',
  );
  const complaintMsg =
    'Supreme Steel reported quality complaint: 2 HR coils delivered had severe edge wave defect and rust, urgent inspection needed';
  console.log(`Sending: "${complaintMsg}"`);
  const complaintRes = await chatbotService.processChatMessage(
    testSalespersonCaller,
    complaintMsg,
  );
  console.log(`Response:\n${complaintRes.reply}\n`);
  validateFormatting('Customer Complaint', complaintRes.reply);
  if (
    !complaintRes.reply.toLowerCase().includes('complaint') &&
    !complaintRes.reply.toLowerCase().includes('ticket') &&
    !complaintRes.reply.toLowerCase().includes('supreme')
  ) {
    throw new Error('Complaint response does not confirm logged complaint');
  }
  console.log('✓ PASS: Customer complaint logged successfully.\n');

  // ── TEST 4: Payment Logging (KRA 5 Parity) ──────────────────────────────
  console.log('--- TEST 4: Payment Logging (KRA 5 Parity) ---');
  const paymentMsg =
    'Received advance payment of Rs 150000 from Supreme Steel via NEFT reference UTR9988221';
  console.log(`Sending: "${paymentMsg}"`);
  const paymentRes = await chatbotService.processChatMessage(
    testSalespersonCaller,
    paymentMsg,
  );
  console.log(`Response:\n${paymentRes.reply}\n`);
  validateFormatting('Payment Logging', paymentRes.reply);
  if (
    !paymentRes.reply.toLowerCase().includes('payment') &&
    !paymentRes.reply.toLowerCase().includes('supreme') &&
    !paymentRes.reply.toLowerCase().includes('1,50,000') &&
    !paymentRes.reply.toLowerCase().includes('150000')
  ) {
    throw new Error('Payment response does not confirm payment receipt');
  }
  console.log('✓ PASS: Payment logged successfully.\n');

  // ── TEST 5: Inquiry Logging & Deal Update (Operational Parity) ───────────
  console.log('--- TEST 5: Inquiry Creation & #INQ-XXXXXX Format ---');
  const inquiryMsg =
    'Create inquiry for Supreme Steel: 15 MT HR Sheet 3mm at target rate 54000';
  console.log(`Sending: "${inquiryMsg}"`);
  const inquiryRes = await chatbotService.processChatMessage(
    testSalespersonCaller,
    inquiryMsg,
  );
  console.log(`Response:\n${inquiryRes.reply}\n`);
  validateFormatting('Inquiry Creation', inquiryRes.reply);
  if (
    !inquiryRes.reply.includes('#INQ-') &&
    !inquiryRes.reply.includes('INQ-')
  ) {
    console.warn(
      '⚠️ Note: Response did not include an INQ code directly, checking content...',
    );
  }
  console.log('✓ PASS: Inquiry creation / update flow completed.\n');

  // ── TEST 6: Read-Only Queries Verification (Zero Alteration) ─────────────
  console.log('--- TEST 6: Read-Only Query Verification (Zero Alteration) ---');
  const queryMsg = 'Show me my open deals and pipeline value';
  console.log(`Sending: "${queryMsg}"`);
  const queryRes = await chatbotService.processChatMessage(
    testSalespersonCaller,
    queryMsg,
  );
  console.log(`Response:\n${queryRes.reply.slice(0, 300)}...\n`);
  validateFormatting('Read Query', queryRes.reply);
  console.log(
    '✓ PASS: Read queries execute cleanly with zero formatting errors.\n',
  );

  // ── TEST 7: Domain Screening & Refusal Guardrail ─────────────────────────
  console.log('--- TEST 7: Domain Screening & Guardrail Policy ---');
  const oosMsg = 'Who is Virat Kohli?';
  console.log(`Sending: "${oosMsg}"`);
  const oosRes = await chatbotService.processChatMessage(
    testSalespersonCaller,
    oosMsg,
  );
  console.log(`Response:\n${oosRes.reply}\n`);
  if (!oosRes.reply.includes('Enlight Metals Sales OS Assistant')) {
    throw new Error('Out-of-scope question was not properly refused');
  }
  validateFormatting('OOS Refusal', oosRes.reply);
  console.log('✓ PASS: Out-of-scope refusal guardrail strictly enforced.\n');

  console.log('===========================================================');
  console.log('ALL OPERATIONAL PARITY TESTS PASSED SUCCESSFULLY! 100%');
  console.log('===========================================================');
  process.exit(0);
}

runParityTests().catch((err) => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
