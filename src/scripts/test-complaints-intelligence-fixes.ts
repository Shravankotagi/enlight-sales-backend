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
import { getComplaintsTool } from '../modules/chatbot/tools/get_complaints.tool';
import { getReorderQueueTool } from '../modules/chatbot/tools/get_reorder_queue.tool';

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
    '=== Verifying All 4 AI Assistant Complaints & Intelligence Fixes ===\n',
  );
  let passed = 0;
  let failed = 0;

  const adminContext: CallerContext = {
    userId: 'usr-admin-test-01',
    email: 'admin@enlightmetals.com',
    role: 'admin',
    name: 'Admin Test',
  };

  // --- UNIT TEST 1: Rep Complaints Comparison (Max vs Rishabh) ---
  console.log(
    '1. Unit Test: get_complaints with mode "rep_complaints" (Max vs Rishabh)...',
  );
  try {
    const res1 = await getComplaintsTool.execute(
      { mode: 'rep_complaints' },
      adminContext,
      supabaseAdmin,
    );
    const data1 = res1.data;
    const leaderboard = data1?.rep_complaints_leaderboard;
    const rishabh = leaderboard?.find((r: any) =>
      r.salesperson_name.toLowerCase().includes('rishabh'),
    );
    const max = leaderboard?.find((r: any) =>
      r.salesperson_name.toLowerCase().includes('max'),
    );

    if (
      Array.isArray(leaderboard) &&
      rishabh &&
      max &&
      rishabh.total_complaints >= 10 &&
      max.total_complaints >= 8 &&
      rishabh.total_complaints > max.total_complaints
    ) {
      console.log('   PASS: Rep complaints calculated successfully:');
      console.log(
        `         Rishabh Makwana: ${rishabh.total_complaints} complaints (${rishabh.open_complaints} open, ${rishabh.resolved_complaints} resolved)`,
      );
      console.log(
        `         Max: ${max.total_complaints} complaints (${max.open_complaints} open, ${max.resolved_complaints} resolved)`,
      );
      console.log(
        `         Rep with more complaints: ${data1.summary?.max_vs_rishabh_comparison?.rep_with_more_complaints}`,
      );
      passed++;
    } else {
      console.error(
        '   FAIL: Invalid rep complaints comparison result:',
        data1,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 1 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 2: Product Category Breakdown ---
  console.log(
    '\n2. Unit Test: get_complaints with mode "product_category_breakdown"...',
  );
  try {
    const res2 = await getComplaintsTool.execute(
      { mode: 'product_category_breakdown' },
      adminContext,
      supabaseAdmin,
    );
    const data2 = res2.data;
    const breakdown = data2?.product_category_breakdown;
    const coil = breakdown?.find((b: any) => b.product_category === 'Coil');
    const plate = breakdown?.find((b: any) => b.product_category === 'Plate');
    const structural = breakdown?.find(
      (b: any) => b.product_category === 'Structural Steel',
    );

    if (
      Array.isArray(breakdown) &&
      coil &&
      plate &&
      structural &&
      coil.total_complaints >= 10 &&
      plate.total_complaints >= 5 &&
      structural.total_complaints >= 1
    ) {
      console.log('   PASS: Product category breakdown computed:');
      console.log(
        `         Coil: ${coil.total_complaints} complaints (${coil.percentage_of_total})`,
      );
      console.log(
        `         Plate / Sheet: ${plate.total_complaints} complaints (${plate.percentage_of_total})`,
      );
      console.log(
        `         Structural Steel: ${structural.total_complaints} complaints (${structural.percentage_of_total})`,
      );
      passed++;
    } else {
      console.error(
        '   FAIL: Invalid product category breakdown result:',
        data2,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 2 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 3: Negative Visits vs Complaints Correlation ---
  console.log(
    '\n3. Unit Test: get_complaints with mode "visit_correlation"...',
  );
  try {
    const res3 = await getComplaintsTool.execute(
      { mode: 'visit_correlation' },
      adminContext,
      supabaseAdmin,
    );
    const data3 = res3.data;
    const corr = data3?.visit_complaint_correlation;

    if (
      corr &&
      typeof corr.total_negative_visits === 'number' &&
      Array.isArray(corr.correlated_accounts) &&
      corr.correlated_accounts.some((a: any) =>
        a.customer_name.toLowerCase().includes('vardhaman'),
      ) &&
      corr.pattern_insights
    ) {
      console.log('   PASS: Visit-complaint correlation analyzed:');
      console.log(
        `         Total Negative Visits: ${corr.total_negative_visits}`,
      );
      console.log(
        `         Correlated Accounts: ${corr.correlated_accounts_count} (${corr.correlated_accounts[0]?.customer_name})`,
      );
      console.log(`         Correlation Rate: ${corr.correlation_rate}`);
      passed++;
    } else {
      console.error('   FAIL: Invalid visit correlation result:', data3);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 3 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 4: Average Reorder Cycle ---
  console.log('\n4. Unit Test: get_reorder_queue with mode "average_cycle"...');
  try {
    const res4 = await getReorderQueueTool.execute(
      { mode: 'average_cycle' },
      adminContext,
      supabaseAdmin,
    );
    const data4 = res4.data;
    const analytics = data4?.reorder_cycle_analytics;

    if (
      analytics &&
      analytics.total_tracked_customers >= 75 &&
      analytics.average_reorder_cycle_days === '30.3' &&
      Array.isArray(analytics.cadence_distribution)
    ) {
      console.log('   PASS: Average reorder cycle calculated:');
      console.log(
        `         Total Tracked Customers: ${analytics.total_tracked_customers}`,
      );
      console.log(
        `         Mean Average Cycle: ${analytics.average_reorder_cycle_display}`,
      );
      console.log(
        `         Cadence Breakdown:`,
        analytics.cadence_distribution
          .map((d: any) => `${d.cycle_days}d (${d.customer_count} accounts)`)
          .join(', '),
      );
      passed++;
    } else {
      console.error('   FAIL: Invalid average reorder cycle result:', data4);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 4 error:', err.message);
    failed++;
  }

  // --- E2E CHATBOT LLM PROMPT TESTS ---
  console.log('\n=== Running E2E Chatbot LLM Prompt Tests ===\n');

  const e2ePrompts = [
    {
      name: 'Query 1: Which sales rep has the most complaints logged against their customers — Max or Rishabh Makwana?',
      prompt:
        'Which sales rep has the most complaints logged against their customers — Max or Rishabh Makwana?',
      checks: (reply: string) =>
        reply.toLowerCase().includes('rishabh') &&
        (reply.includes('12') || reply.toLowerCase().includes('more')) &&
        !EMOJI_REGEX.test(reply),
    },
    {
      name: 'Query 2: Show me complaints by product type (Coil vs Plate vs Structural Steel)',
      prompt:
        'Show me complaints by product type (Coil vs Plate vs Structural Steel)',
      checks: (reply: string) =>
        reply.toLowerCase().includes('coil') &&
        reply.toLowerCase().includes('plate') &&
        (reply.includes('13') || reply.includes('50')) &&
        !EMOJI_REGEX.test(reply),
    },
    {
      name: 'Query 3: Is there a pattern between negative visits and complaints for the same customer?',
      prompt:
        'Is there a pattern between negative visits and complaints for the same customer?',
      checks: (reply: string) =>
        (reply.toLowerCase().includes('pattern') ||
          reply.toLowerCase().includes('correlation') ||
          reply.toLowerCase().includes('vardhaman') ||
          reply.toLowerCase().includes('yes')) &&
        !EMOJI_REGEX.test(reply),
    },
    {
      name: "Query 4: What's the average reorder cycle across all tracked customers?",
      prompt: "What's the average reorder cycle across all tracked customers?",
      checks: (reply: string) =>
        (reply.includes('30.3') ||
          reply.includes('30') ||
          reply.toLowerCase().includes('month')) &&
        !EMOJI_REGEX.test(reply),
    },
  ];

  for (let i = 0; i < e2ePrompts.length; i++) {
    const p = e2ePrompts[i];
    console.log(`Running E2E ${i + 1}: "${p.prompt}"...`);
    try {
      const response = await chatbotService.processChatMessage(
        adminContext,
        p.prompt,
      );
      const reply = response?.reply || '';
      console.log(
        `   Response Preview: ${reply.slice(0, 160).replace(/\n/g, ' ')}...`,
      );

      const hasEmoji = EMOJI_REGEX.test(reply);
      const passedChecks = p.checks(reply);

      if (passedChecks && !hasEmoji) {
        console.log(`   PASS: E2E ${i + 1} succeeded without emojis.\n`);
        passed++;
      } else {
        console.error(
          `   FAIL: E2E ${i + 1} validation failed (hasEmoji: ${hasEmoji}, checks: ${passedChecks})\n`,
        );
        console.error('   Full Reply:\n', reply);
        failed++;
      }
    } catch (err: any) {
      console.error(`   FAIL: E2E ${i + 1} error:`, err.message);
      failed++;
    }
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
