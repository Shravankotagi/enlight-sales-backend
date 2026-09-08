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
import { getVisitsTool } from '../modules/chatbot/tools/get_visits.tool';

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
  console.log('=== Verifying All 7 AI Assistant Visits Issues & Fixes ===\n');
  let passed = 0;
  let failed = 0;

  const adminContext: CallerContext = {
    userId: 'usr-admin-test-01',
    email: 'admin@enlightmetals.com',
    role: 'admin',
    name: 'Admin Test',
  };

  const akrutiContext: CallerContext = {
    userId: 'usr-akruti-01',
    email: 'akruti@enlightmetals.com',
    role: 'salesperson',
    name: 'Akruti',
    phone: '9876543212',
    employeeId: 'EMP-003',
  };

  // --- UNIT TEST 1: Rep Filtering (Rishabh Makwana) ---
  console.log(
    '1. Unit Test: get_visits with salesperson_name "Rishabh Makwana"...',
  );
  try {
    const res1 = await getVisitsTool.execute(
      { salesperson_name: 'Rishabh Makwana' },
      adminContext,
      supabaseAdmin,
    );
    const data1 = res1.data;
    if (
      data1 &&
      Array.isArray(data1.visits) &&
      data1.visits.length > 0 &&
      data1.visits.every(
        (v: any) =>
          v.salesperson_name.toLowerCase().includes('rishabh') ||
          v.salesperson_phone.includes('9876543210'),
      )
    ) {
      console.log(
        `   PASS: Found ${data1.visits.length} visits handled by Rishabh Makwana.`,
      );
      passed++;
    } else {
      console.error('   FAIL: Unexpected visits for Rishabh Makwana:', data1);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 1 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 1b: RBAC on Rep Filtering (Akruti searching for Rishabh) ---
  console.log(
    '\n1b. Unit Test: RBAC check - salesperson Akruti requesting Rishabh Makwana visits...',
  );
  try {
    const res1b = await getVisitsTool.execute(
      { salesperson_name: 'Rishabh Makwana' },
      akrutiContext,
      supabaseAdmin,
    );
    if (res1b.data?.notFound === true) {
      console.log(
        '   PASS: Access denied for unauthorized rep request (RBAC enforced).',
      );
      passed++;
    } else {
      console.error(
        '   FAIL: RBAC failed to block unauthorized rep query:',
        res1b.data,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 1b error:', err.message);
    failed++;
  }

  // --- UNIT TEST 2: Location Filtering (Nashik) ---
  console.log('\n2. Unit Test: get_visits with location "Nashik"...');
  try {
    const res2 = await getVisitsTool.execute(
      { location: 'Nashik' },
      adminContext,
      supabaseAdmin,
    );
    const data2 = res2.data;
    if (
      data2 &&
      Array.isArray(data2.visits) &&
      data2.visits.length >= 1 &&
      data2.visits.some(
        (v: any) =>
          v.customer_name.toLowerCase().includes('rathi') ||
          (v.location || '').toLowerCase().includes('nashik') ||
          (v.remarks || '').toLowerCase().includes('nashik'),
      )
    ) {
      console.log(
        `   PASS: Found ${data2.visits.length} visit(s) in Nashik (Customer: ${data2.visits[0].customer_name}).`,
      );
      passed++;
    } else {
      console.error('   FAIL: No Nashik visits found:', data2);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 2 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 3: Salesperson Visit Leaderboard ---
  console.log('\n3. Unit Test: get_visits with mode "rep_leaderboard"...');
  try {
    const res3 = await getVisitsTool.execute(
      { mode: 'rep_leaderboard' },
      adminContext,
      supabaseAdmin,
    );
    const data3 = res3.data;
    const leaderboard = data3?.rep_visit_leaderboard;
    const topRep = data3?.top_salesperson;
    if (
      Array.isArray(leaderboard) &&
      leaderboard.length >= 2 &&
      topRep &&
      topRep.salesperson_name.toLowerCase().includes('rishabh') &&
      topRep.total_visits >= 15
    ) {
      console.log(
        `   PASS: Top salesperson is ${topRep.salesperson_name} with ${topRep.total_visits} visits.`,
      );
      console.log('         Leaderboard breakdown:');
      leaderboard.forEach((r: any, idx: number) => {
        console.log(
          `         #${idx + 1}: ${r.salesperson_name} - ${r.total_visits} visits (${r.positive_visits} positive, ${r.unique_customers_visited} accounts)`,
        );
      });
      passed++;
    } else {
      console.error('   FAIL: Invalid rep leaderboard:', data3);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 3 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 4: Week-over-Week Comparison ---
  console.log('\n4. Unit Test: get_visits with mode "week_comparison"...');
  try {
    const res4 = await getVisitsTool.execute(
      { mode: 'week_comparison' },
      adminContext,
      supabaseAdmin,
    );
    const comp = res4.data?.comparison;
    if (
      comp &&
      comp.this_week &&
      comp.last_week &&
      typeof comp.this_week.total_visits === 'number' &&
      typeof comp.last_week.total_visits === 'number' &&
      comp.insights
    ) {
      console.log('   PASS: Week comparison calculated successfully:');
      console.log(
        `         This Week (Last 7 Days): ${comp.this_week.total_visits} visits (${comp.this_week.daily_average})`,
      );
      console.log(
        `         Last Week (Days 8-14): ${comp.last_week.total_visits} visits (${comp.last_week.daily_average})`,
      );
      console.log(
        `         Net Difference: ${comp.difference} (${comp.percentage_change})`,
      );
      passed++;
    } else {
      console.error('   FAIL: Invalid week comparison:', res4.data);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 4 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 5: Visits Missing Location ---
  console.log('\n5. Unit Test: get_visits with missing_location: true...');
  try {
    const res5 = await getVisitsTool.execute(
      { missing_location: true },
      adminContext,
      supabaseAdmin,
    );
    const data5 = res5.data;
    if (
      data5 &&
      Array.isArray(data5.visits) &&
      data5.visits.length > 0 &&
      data5.visits.every((v: any) => !v.location)
    ) {
      console.log(
        `   PASS: Identified ${data5.visits.length} visits missing location.`,
      );
      passed++;
    } else {
      console.error('   FAIL: Invalid missing location results:', data5);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 5 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 6: Visits Missing Contact Person ---
  console.log(
    '\n6. Unit Test: get_visits with missing_contact_person: true...',
  );
  try {
    const res6 = await getVisitsTool.execute(
      { missing_contact_person: true },
      adminContext,
      supabaseAdmin,
    );
    const data6 = res6.data;
    if (
      data6 &&
      Array.isArray(data6.visits) &&
      data6.visits.length > 0 &&
      data6.visits.every((v: any) => !v.person_met && !v.contact_phone)
    ) {
      console.log(
        `   PASS: Identified ${data6.visits.length} visits missing contact person.`,
      );
      passed++;
    } else {
      console.error('   FAIL: Invalid missing contact person results:', data6);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 6 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 7: Duplicate Visits on Same Day ---
  console.log('\n7. Unit Test: get_visits with mode "duplicates"...');
  try {
    const res7 = await getVisitsTool.execute(
      { mode: 'duplicates' },
      adminContext,
      supabaseAdmin,
    );
    const data7 = res7.data;
    const groups = data7?.duplicate_visits_groups;
    if (
      Array.isArray(groups) &&
      groups.length > 0 &&
      groups.every((g: any) => g.duplicate_count > 1)
    ) {
      console.log(
        `   PASS: Detected ${groups.length} duplicate visit groups (${data7.total_duplicate_visits} total duplicate logs).`,
      );
      console.log(
        `         Top duplicate group: ${groups[0].customer_name} on ${groups[0].visit_date} with ${groups[0].duplicate_count} visits.`,
      );
      passed++;
    } else {
      console.error('   FAIL: Invalid duplicate visits groups:', data7);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 7 error:', err.message);
    failed++;
  }

  // --- E2E CHATBOT SERVICE TESTS ---
  console.log('\n=== Running E2E Chatbot LLM Prompt Tests ===\n');

  const e2ePrompts = [
    {
      name: 'Query 1: List all visits handled by Rishabh Makwana',
      prompt: 'List all visits handled by Rishabh Makwana',
      checks: (reply: string) =>
        (reply.toLowerCase().includes('rishabh') ||
          reply.toLowerCase().includes('visits')) &&
        reply.includes('|') &&
        !EMOJI_REGEX.test(reply),
    },
    {
      name: 'Query 2: Show me all visits in Nashik',
      prompt: 'Show me all visits in Nashik',
      checks: (reply: string) =>
        (reply.toLowerCase().includes('nashik') ||
          reply.toLowerCase().includes('rathi')) &&
        !EMOJI_REGEX.test(reply),
    },
    {
      name: 'Query 3: Which salesperson has logged the most visits?',
      prompt: 'Which salesperson has logged the most visits?',
      checks: (reply: string) =>
        reply.toLowerCase().includes('rishabh') &&
        (reply.includes('19') || reply.toLowerCase().includes('leaderboard')) &&
        !EMOJI_REGEX.test(reply),
    },
    {
      name: 'Query 4: How many visits happened this week vs last week?',
      prompt: 'How many visits happened this week vs last week?',
      checks: (reply: string) =>
        (reply.toLowerCase().includes('this week') ||
          reply.toLowerCase().includes('last week')) &&
        !EMOJI_REGEX.test(reply),
    },
    {
      name: 'Query 5: Which visits are missing a location?',
      prompt: 'Which visits are missing a location?',
      checks: (reply: string) =>
        (reply.toLowerCase().includes('location') ||
          reply.toLowerCase().includes('missing')) &&
        reply.includes('|') &&
        !EMOJI_REGEX.test(reply),
    },
    {
      name: "Query 6: Show me visits where the contact person wasn't recorded",
      prompt: "Show me visits where the contact person wasn't recorded",
      checks: (reply: string) =>
        (reply.toLowerCase().includes('contact') ||
          reply.toLowerCase().includes('person') ||
          reply.toLowerCase().includes('recorded')) &&
        reply.includes('|') &&
        !EMOJI_REGEX.test(reply),
    },
    {
      name: 'Query 7: List duplicate visits to the same customer on the same day',
      prompt: 'List duplicate visits to the same customer on the same day',
      checks: (reply: string) =>
        (reply.toLowerCase().includes('duplicate') ||
          reply.toLowerCase().includes('same day')) &&
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
