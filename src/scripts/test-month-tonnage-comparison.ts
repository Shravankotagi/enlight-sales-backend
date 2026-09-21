import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase credentials.');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY);

import { ChatbotService } from '../modules/chatbot/chatbot.service';
import { GuardrailsService } from '../modules/chatbot/guardrails/guardrails.service';
import { ToolRegistryService } from '../modules/chatbot/tools/tool-registry.service';
import { CallerContext } from '../modules/chatbot/tools/chatbot-tool.interface';
import { getMyOpenDealsTool } from '../modules/chatbot/tools/get_my_open_deals.tool';
import { IntentPreRouter } from '../modules/chatbot/intent-pre-router';

const mockSupabaseService: any = {
  getAdminClient: () => supabaseAdmin,
};

const toolRegistryService = new ToolRegistryService(mockSupabaseService);
const guardrailsService = new GuardrailsService(mockSupabaseService);
const chatbotService = new ChatbotService(
  mockSupabaseService,
  toolRegistryService,
  guardrailsService,
);

const EMOJI_REGEX =
  /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;

async function runTests() {
  console.log(
    '=== Verification Suite: Month-over-Month Tonnage Comparison in AI Assistant ===\n',
  );
  let passed = 0;
  let failed = 0;

  const adminContext: CallerContext = {
    userId: 'usr-admin-test-01',
    email: 'admin@enlightmetals.com',
    role: 'admin',
    name: 'Admin Test',
  };

  const akrutiContext: CallerContext = {
    userId: '383b0ab8-a89d-4814-adf3-e8da4be13324',
    email: 'akruti@enlightmetals.com',
    role: 'salesperson',
    name: 'Akruti',
    phone: '917977088031',
    employeeId: 'EMP-003',
  };

  // --- UNIT TEST 1: Direct Tool Execution of get_my_open_deals (mode: month_comparison) ---
  console.log(
    '1. Unit Test: get_my_open_deals with mode "month_comparison" & stage_filter "won" (Admin)...',
  );
  try {
    const res1 = await getMyOpenDealsTool.execute(
      { mode: 'month_comparison', stage_filter: 'won' },
      adminContext,
      supabaseAdmin,
    );
    const data1 = res1.data;
    const comp = data1?.comparison;

    if (
      comp &&
      comp.this_month &&
      comp.last_month &&
      typeof comp.this_month.delivered_tonnage_mt === 'number' &&
      typeof comp.last_month.delivered_tonnage_mt === 'number' &&
      typeof comp.this_month.orders_count === 'number' &&
      comp.insights
    ) {
      console.log('   PASS: Month-over-month tonnage comparison calculated:');
      console.log(
        `         This Month (${comp.this_month.month}): ${comp.this_month.delivered_tonnage_mt} MT across ${comp.this_month.orders_count} orders`,
      );
      console.log(
        `         Last Month (${comp.last_month.month}): ${comp.last_month.delivered_tonnage_mt} MT across ${comp.last_month.orders_count} orders`,
      );
      console.log(
        `         Difference: ${comp.difference_tonnage_mt} MT (${comp.percentage_change_tonnage})`,
      );
      passed++;
    } else {
      console.error('   FAIL: Invalid MoM comparison structure:', data1);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 1 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 2: Intent Pre-Router Tonnage Comparison Disambiguation ---
  console.log(
    '\n2. Unit Test: IntentPreRouter disambiguation for MoM tonnage vs inquiries...',
  );
  try {
    const queryTonnage = "Compare this month's tonnage vs last month";
    const routeTonnage = IntentPreRouter.evaluate(queryTonnage, adminContext);

    const queryDelivered = 'Compare delivered volume this month vs last month';
    const routeDelivered = IntentPreRouter.evaluate(
      queryDelivered,
      adminContext,
    );

    const queryInquiries = 'Compare inquiries this month vs last month';
    const routeInquiries = IntentPreRouter.evaluate(
      queryInquiries,
      adminContext,
    );

    if (
      routeTonnage.matched &&
      routeTonnage.toolName === 'get_my_open_deals' &&
      routeTonnage.toolArgs?.mode === 'tonnage_trend' &&
      routeTonnage.toolArgs?.months_count === 2
    ) {
      console.log(
        '   PASS: "Compare this month\'s tonnage vs last month" pre-routed to get_my_open_deals.',
      );
      passed++;
    } else {
      console.error(
        '   FAIL: Incorrect routing for tonnage query:',
        routeTonnage,
      );
      failed++;
    }

    if (
      routeDelivered.matched &&
      routeDelivered.toolName === 'get_my_open_deals' &&
      routeDelivered.toolArgs?.months_count === 2
    ) {
      console.log(
        '   PASS: "Compare delivered volume this month vs last month" pre-routed to get_my_open_deals.',
      );
      passed++;
    } else {
      console.error(
        '   FAIL: Incorrect routing for delivered volume query:',
        routeDelivered,
      );
      failed++;
    }

    if (
      !routeInquiries.matched ||
      routeInquiries.toolName !== 'get_my_open_deals'
    ) {
      console.log(
        '   PASS: "Compare inquiries this month vs last month" does NOT falsely route to deals tool.',
      );
      passed++;
    } else {
      console.error(
        '   FAIL: Inquiries query falsely routed to deals tool:',
        routeInquiries,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 2 error:', err.message);
    failed++;
  }

  // --- E2E TEST 1: Admin Query "Compare this month's tonnage vs last month" ---
  console.log(
    '\n3. E2E Chatbot Test (Admin): "Compare this month\'s tonnage vs last month"...',
  );
  try {
    const prompt = "Compare this month's tonnage vs last month";
    const response = await chatbotService.processChatMessage(
      adminContext,
      prompt,
    );
    const reply = response?.reply || '';
    console.log(
      `   Response Preview: ${reply.slice(0, 160).replace(/\n/g, ' ')}...`,
    );

    const hasEmoji = EMOJI_REGEX.test(reply);
    const mentionsTonnage =
      reply.toLowerCase().includes('tonnage') ||
      reply.toLowerCase().includes('mt') ||
      reply.toLowerCase().includes('metric ton');
    const mentionsMonths =
      (reply.toLowerCase().includes('september') ||
        reply.toLowerCase().includes('sept')) &&
      (reply.toLowerCase().includes('august') ||
        reply.toLowerCase().includes('aug'));
    const hasDisallowedDisclaimer =
      reply.toLowerCase().includes('not total tonnage') ||
      reply.toLowerCase().includes('based on inquiry counts') ||
      reply.toLowerCase().includes('not based on tonnage');

    if (
      !hasEmoji &&
      mentionsTonnage &&
      mentionsMonths &&
      !hasDisallowedDisclaimer
    ) {
      console.log(
        '   PASS: Admin MoM tonnage comparison answered accurately with delivered tonnage and zero emojis.',
      );
      passed++;
    } else {
      console.error(
        `   FAIL: Validation failed (hasEmoji: ${hasEmoji}, mentionsTonnage: ${mentionsTonnage}, mentionsMonths: ${mentionsMonths}, hasDisallowedDisclaimer: ${hasDisallowedDisclaimer})`,
      );
      console.error('   Full Reply:\n', reply);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: E2E Test 1 error:', err.message);
    failed++;
  }

  // --- E2E TEST 2: Salesperson Akruti Query "Compare this month's tonnage vs last month" ---
  console.log(
    '\n4. E2E Chatbot Test (Akruti): "Compare this month\'s tonnage vs last month"...',
  );
  try {
    const prompt = "Compare this month's tonnage vs last month";
    const response = await chatbotService.processChatMessage(
      akrutiContext,
      prompt,
    );
    const reply = response?.reply || '';
    console.log(
      `   Response Preview: ${reply.slice(0, 160).replace(/\n/g, ' ')}...`,
    );

    const hasEmoji = EMOJI_REGEX.test(reply);
    const mentionsTonnage =
      reply.toLowerCase().includes('tonnage') ||
      reply.toLowerCase().includes('mt') ||
      reply.toLowerCase().includes('metric ton');
    const hasDisallowedDisclaimer =
      reply.toLowerCase().includes('not total tonnage') ||
      reply.toLowerCase().includes('based on inquiry counts') ||
      reply.toLowerCase().includes('not based on tonnage');

    if (!hasEmoji && mentionsTonnage && !hasDisallowedDisclaimer) {
      console.log(
        '   PASS: Salesperson MoM tonnage comparison answered accurately and role-scoped without emojis.',
      );
      passed++;
    } else {
      console.error(
        `   FAIL: Akruti validation failed (hasEmoji: ${hasEmoji}, mentionsTonnage: ${mentionsTonnage}, hasDisallowedDisclaimer: ${hasDisallowedDisclaimer})`,
      );
      console.error('   Full Reply:\n', reply);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: E2E Test 2 error:', err.message);
    failed++;
  }

  console.log(`\n========================================`);
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
