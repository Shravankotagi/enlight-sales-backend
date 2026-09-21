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
  console.log(
    '=== Comprehensive Verification: Visit Follow-ups Integration in AI Assistant ===\n',
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
  };

  // --- UNIT TEST 1: Follow-up due today for Admin (Sigma Industries) ---
  console.log(
    '1. Unit Test: get_visits with follow_up_filter: "due_today" for Admin...',
  );
  try {
    const res1 = await getVisitsTool.execute(
      { follow_up_filter: 'due_today' },
      adminContext,
      supabaseAdmin,
    );
    const visits = res1.data?.visits || [];
    if (
      visits.length === 1 &&
      visits[0].customer_name.toLowerCase().includes('sigma') &&
      visits[0].follow_up_urgency === 'today'
    ) {
      console.log(
        `   PASS: Correctly returned 1 follow-up due today (${visits[0].customer_name} - ${visits[0].follow_up_action}).`,
      );
      passed++;
    } else {
      console.error('   FAIL: Unexpected visits for Admin due_today:', visits);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 1 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 2: Follow-up due today for Akruti (0 records, scoped) ---
  console.log(
    '\n2. Unit Test: get_visits with follow_up_filter: "due_today" for Akruti...',
  );
  try {
    const res2 = await getVisitsTool.execute(
      { follow_up_filter: 'due_today' },
      akrutiContext,
      supabaseAdmin,
    );
    const visits = res2.data?.visits || [];
    if (Array.isArray(visits) && visits.length === 0) {
      console.log(
        '   PASS: Correctly returned 0 follow-ups due today for Akruti (portfolio scoped).',
      );
      passed++;
    } else {
      console.error('   FAIL: Expected 0 visits for Akruti due_today:', visits);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 2 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 3: Overdue follow-ups for Admin ---
  console.log(
    '\n3. Unit Test: get_visits with follow_up_filter: "overdue" for Admin...',
  );
  try {
    const res3 = await getVisitsTool.execute(
      { follow_up_filter: 'overdue' },
      adminContext,
      supabaseAdmin,
    );
    const visits = res3.data?.visits || [];
    if (
      visits.length >= 2 &&
      visits.every((v: any) => v.follow_up_urgency === 'overdue')
    ) {
      console.log(
        `   PASS: Correctly identified ${visits.length} overdue follow-up(s).`,
      );
      passed++;
    } else {
      console.error('   FAIL: Overdue filter failed:', visits);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 3 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 4: Follow-up summary mode ---
  console.log('\n4. Unit Test: get_visits with mode: "follow_up_summary"...');
  try {
    const res4 = await getVisitsTool.execute(
      { mode: 'follow_up_summary' },
      adminContext,
      supabaseAdmin,
    );
    const metrics = res4.data?.follow_up_metrics;
    if (
      metrics &&
      metrics.due_today >= 1 &&
      metrics.overdue >= 2 &&
      metrics.total_with_follow_up >= 20
    ) {
      console.log(
        '   PASS: Summary mode metrics calculated accurately:',
        metrics,
      );
      passed++;
    } else {
      console.error('   FAIL: Follow-up summary metrics invalid:', metrics);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 4 error:', err.message);
    failed++;
  }

  // --- E2E PROMPTS ---
  console.log('\n=== Running E2E Chatbot LLM Prompt Tests ===\n');

  const e2ePrompts = [
    {
      name: 'Query 1: Show visit follow-ups due today (Salesperson Akruti)',
      context: akrutiContext,
      prompt: 'Show visit follow-ups due today',
      checks: (reply: string) =>
        (reply.toLowerCase().includes('no visit follow-up') ||
          reply.toLowerCase().includes('no follow-up') ||
          reply.toLowerCase().includes('no pending')) &&
        !EMOJI_REGEX.test(reply),
    },
    {
      name: 'Query 2: Show visit follow-ups due today (Admin)',
      context: adminContext,
      prompt: 'Show visit follow-ups due today',
      checks: (reply: string) =>
        reply.toLowerCase().includes('sigma') && !EMOJI_REGEX.test(reply),
    },
    {
      name: 'Query 3: Show overdue visit follow-ups',
      context: adminContext,
      prompt: 'Show overdue visit follow-ups',
      checks: (reply: string) =>
        (reply.toLowerCase().includes('bhushan') ||
          reply.toLowerCase().includes('anshul')) &&
        reply.toLowerCase().includes('overdue') &&
        reply.includes('|') &&
        !EMOJI_REGEX.test(reply),
    },
    {
      name: 'Query 4: Give me a summary of visit follow-ups',
      context: adminContext,
      prompt: 'Give me a summary of visit follow-ups',
      checks: (reply: string) =>
        (reply.toLowerCase().includes('follow-up') ||
          reply.toLowerCase().includes('due today')) &&
        !EMOJI_REGEX.test(reply),
    },
  ];

  for (let i = 0; i < e2ePrompts.length; i++) {
    const p = e2ePrompts[i];
    console.log(`Running E2E ${i + 1}: "${p.prompt}" (${p.context.role})...`);
    try {
      const response = await chatbotService.processChatMessage(
        p.context,
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
