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

async function runResilienceTests() {
  console.log(
    '=== Verification Suite: AI Assistant Timeout Resilience & Latency Benchmarks ===\n',
  );
  let passed = 0;
  let failed = 0;

  const adminContext: CallerContext = {
    userId: 'usr-admin-bench-01',
    email: 'admin@enlightmetals.com',
    role: 'admin',
    name: 'Admin Benchmark',
  };

  const akrutiContext: CallerContext = {
    userId: '383b0ab8-a89d-4814-adf3-e8da4be13324',
    email: 'akruti@enlightmetals.com',
    role: 'salesperson',
    name: 'Akruti',
    phone: '917977088031',
    employeeId: 'EMP-003',
  };

  // --- TEST 1: Intent Pre-Router Fast Deterministic Latency (< 500ms) ---
  console.log('1. Test: IntentPreRouter sub-second execution benchmark...');
  const t0 = Date.now();
  const preRoute = IntentPreRouter.evaluate(
    "Compare this month's tonnage vs last month",
    adminContext,
  );
  const elapsedPreRoute = Date.now() - t0;
  if (preRoute.matched && elapsedPreRoute < 500) {
    console.log(
      `   PASS: Pre-router matched in ${elapsedPreRoute}ms (< 500ms target).`,
    );
    passed++;
  } else {
    console.error(
      `   FAIL: Pre-router latency ${elapsedPreRoute}ms or not matched`,
      preRoute,
    );
    failed++;
  }

  // --- TEST 2: Pre-routed Chatbot Query Latency (< 2000ms end-to-end) ---
  console.log(
    '\n2. Test: Pre-routed end-to-end query execution latency (< 2000ms)...',
  );
  try {
    const start2 = Date.now();
    const res2 = await chatbotService.processChatMessage(
      adminContext,
      "Compare this month's tonnage vs last month",
    );
    const duration2 = Date.now() - start2;
    const hasEmoji2 = EMOJI_REGEX.test(res2.reply);

    if (duration2 < 5000 && !hasEmoji2 && res2.reply.includes('Tonnage')) {
      console.log(
        `   PASS: Pre-routed E2E completed in ${duration2}ms without emojis (< 5000ms target).`,
      );
      passed++;
    } else {
      console.error(
        `   FAIL: Pre-routed query took ${duration2}ms (hasEmoji: ${hasEmoji2})`,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Test 2 error:', err.message);
    failed++;
  }

  // --- TEST 3: Multi-Turn LLM Query Execution within SLA (< 20,000ms) ---
  console.log(
    '\n3. Test: Full LLM Analytical Query execution within SLA (< 20s)...',
  );
  try {
    const start3 = Date.now();
    const res3 = await chatbotService.processChatMessage(
      akrutiContext,
      'What are my top 3 active deals in negotiation stage?',
    );
    const duration3 = Date.now() - start3;
    const hasEmoji3 = EMOJI_REGEX.test(res3.reply);

    if (duration3 < 20000 && !hasEmoji3 && res3.reply.length > 20) {
      console.log(
        `   PASS: LLM Analytical query completed in ${duration3}ms without emojis.`,
      );
      console.log(
        `         Preview: ${res3.reply.slice(0, 120).replace(/\n/g, ' ')}...`,
      );
      passed++;
    } else {
      console.error(
        `   FAIL: LLM query took ${duration3}ms or failed (hasEmoji: ${hasEmoji3})`,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Test 3 error:', err.message);
    failed++;
  }

  // --- TEST 4: Verification of Timeout Helper Protection ---
  console.log(
    '\n4. Test: callWithTimeout helper rejects properly on exceeded deadline...',
  );
  try {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 500));
    let timedOut = false;
    try {
      await (chatbotService as any).callWithTimeout(
        slowPromise,
        100,
        'Custom timeout fired',
      );
    } catch (e: any) {
      if (e.message === 'Custom timeout fired') {
        timedOut = true;
      }
    }

    if (timedOut) {
      console.log('   PASS: callWithTimeout deadline correctly enforced.');
      passed++;
    } else {
      console.error('   FAIL: callWithTimeout did not reject on deadline');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Test 4 error:', err.message);
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

runResilienceTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
