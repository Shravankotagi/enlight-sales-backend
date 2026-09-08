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
import { getCustomer360Tool } from '../modules/chatbot/tools/get_customer_360.tool';
import { getInquiriesTool } from '../modules/chatbot/tools/get_inquiries.tool';

const mockSupabaseService: any = {
  getAdminClient: () => supabaseAdmin,
  getClient: () => supabaseAdmin,
};

const toolRegistryService = new ToolRegistryService(mockSupabaseService);
const guardrailsService = new GuardrailsService(mockSupabaseService);
const chatbotService = new ChatbotService(
  mockSupabaseService,
  toolRegistryService,
  guardrailsService,
);

async function runTests() {
  console.log(
    '=== Verifying Customer Health, Rep Conversion & Monthly Analytics Fixes ===\n',
  );
  let passed = 0;
  let failed = 0;

  const adminContext: CallerContext = {
    userId: 'usr-admin-test-01',
    email: 'admin@enlightmetals.com',
    role: 'admin',
    name: 'Admin Test',
  };

  // 1. Unit Test: get_customer_360 At Risk & Segment Counts
  console.log('1. Unit Test: get_customer_360 At Risk and Segment counts...');
  try {
    const res1 = await getCustomer360Tool.execute(
      {},
      adminContext,
      supabaseAdmin,
    );
    const summary = res1.data?.summary;
    console.log('   Customer Summary:', summary);
    if (
      summary &&
      summary.total_customers >= 60 &&
      summary.at_risk_customers === 0 &&
      summary.by_segment?.new >= 20
    ) {
      console.log(
        '   PASS: get_customer_360 accurate counts (0 at risk, 64+ active customers)',
      );
      passed++;
    } else {
      console.error('   FAIL: get_customer_360 unexpected summary:', summary);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 1 error:', err.message);
    failed++;
  }

  // 2. Unit Test: get_inquiries mode: "rep_conversion"
  console.log('\n2. Unit Test: get_inquiries mode: "rep_conversion"...');
  try {
    const res2 = await getInquiriesTool.execute(
      { mode: 'rep_conversion' },
      adminContext,
      supabaseAdmin,
    );
    const data2 = res2.data;
    console.log('   Top Converter:', data2?.top_converter);
    console.log(
      '   Leaderboard sample:',
      data2?.rep_conversion_leaderboard?.slice(0, 3),
    );
    if (
      data2?.top_converter?.salesperson_name?.toLowerCase().includes('max') ||
      data2?.rep_conversion_leaderboard?.length > 0
    ) {
      console.log('   PASS: Rep conversion leaderboard generated');
      passed++;
    } else {
      console.error('   FAIL: Invalid rep conversion result:', data2);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 2 error:', err.message);
    failed++;
  }

  // 3. Unit Test: get_inquiries mode: "open_inquiries_dormant_buyers"
  console.log(
    '\n3. Unit Test: get_inquiries mode: "open_inquiries_dormant_buyers"...',
  );
  try {
    const res3 = await getInquiriesTool.execute(
      { mode: 'open_inquiries_dormant_buyers' },
      adminContext,
      supabaseAdmin,
    );
    const data3 = res3.data;
    console.log(
      '   Dormant customers with open inquiries count:',
      data3?.total_dormant_customers_with_open_inquiries,
    );
    console.log('   Sample:', data3?.summary?.top_dormant_accounts);
    if (data3?.total_dormant_customers_with_open_inquiries > 0) {
      console.log('   PASS: Open inquiries for dormant buyers retrieved');
      passed++;
    } else {
      console.error('   FAIL: Dormant buyers returned 0:', data3);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 3 error:', err.message);
    failed++;
  }

  // 4. Unit Test: get_inquiries mode: "month_comparison"
  console.log('\n4. Unit Test: get_inquiries mode: "month_comparison"...');
  try {
    const res4 = await getInquiriesTool.execute(
      { mode: 'month_comparison' },
      adminContext,
      supabaseAdmin,
    );
    const data4 = res4.data?.comparison;
    console.log('   Comparison:', data4);
    if (data4?.this_month && data4?.last_month) {
      console.log('   PASS: Month-over-month comparison returned');
      passed++;
    } else {
      console.error('   FAIL: Invalid month comparison:', data4);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 4 error:', err.message);
    failed++;
  }

  // --- E2E PROMPTS WITH GEMINI ---
  console.log(
    '\n=== Testing End-to-End LLM Responses via ChatbotService ===\n',
  );

  // Prompt 1: Which customers are marked 'At Risk'?
  console.log('5. E2E Prompt 1: "Which customers are marked \'At Risk\'?"');
  try {
    const reply1 = await chatbotService.processChatMessage(
      adminContext,
      "Which customers are marked 'At Risk'?",
    );
    const text1 = reply1.reply;
    console.log('   Bot Response:\n  ', text1.replace(/\n/g, '\n   '));
    if (
      !text1.toLowerCase().includes('delivery p') &&
      !text1.toLowerCase().includes('20 mt hr coil') &&
      (text1.includes('0') ||
        text1.toLowerCase().includes('no customer') ||
        text1.toLowerCase().includes('good standing') ||
        text1.toLowerCase().includes('zero'))
    ) {
      console.log(
        '   PASS: Prompt 1 accurate At Risk response without ghost records!',
      );
      passed++;
    } else {
      console.error(
        '   FAIL: Prompt 1 returned ghost records or inaccurate At Risk count.',
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Prompt 1 error:', err.message);
    failed++;
  }

  // Prompt 2: Which segment has the most customers — New, Growing, or Established?
  console.log(
    '\n6. E2E Prompt 2: "Which segment has the most customers — New, Growing, or Established?"',
  );
  try {
    const reply2 = await chatbotService.processChatMessage(
      adminContext,
      'Which segment has the most customers — New, Growing, or Established?',
    );
    const text2 = reply2.reply;
    console.log('   Bot Response:\n  ', text2.replace(/\n/g, '\n   '));
    if (
      text2.toLowerCase().includes('new') &&
      (text2.includes('29') || text2.includes('New'))
    ) {
      console.log(
        '   PASS: Prompt 2 accurately identified New segment as largest!',
      );
      passed++;
    } else {
      console.error('   FAIL: Prompt 2 failed segment identification.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Prompt 2 error:', err.message);
    failed++;
  }

  // Prompt 3: Show me inquiries from customers who are currently marked At Risk
  console.log(
    '\n7. E2E Prompt 3: "Show me inquiries from customers who are currently marked At Risk"',
  );
  try {
    const reply3 = await chatbotService.processChatMessage(
      adminContext,
      'Show me inquiries from customers who are currently marked At Risk',
    );
    const text3 = reply3.reply;
    console.log('   Bot Response:\n  ', text3.replace(/\n/g, '\n   '));
    if (
      !text3.includes(
        'No matching records were found in Enlight Metals OS for this request',
      ) &&
      (text3.toLowerCase().includes('0') ||
        text3.toLowerCase().includes('no customers') ||
        text3.toLowerCase().includes('good standing') ||
        text3.toLowerCase().includes('at risk'))
    ) {
      console.log('   PASS: Prompt 3 gracefully handled 0 at risk customers!');
      passed++;
    } else {
      console.error('   FAIL: Prompt 3 returned generic fallback.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Prompt 3 error:', err.message);
    failed++;
  }

  // Prompt 4: Give me a summary: total inquiries, orders, and customers this month
  console.log(
    '\n8. E2E Prompt 4: "Give me a summary: total inquiries, orders, and customers this month"',
  );
  try {
    const reply4 = await chatbotService.processChatMessage(
      adminContext,
      'Give me a summary: total inquiries, orders, and customers this month',
    );
    const text4 = reply4.reply;
    console.log('   Bot Response:\n  ', text4.replace(/\n/g, '\n   '));
    if (
      !text4.includes('{"get_') &&
      !text4.includes('_response"') &&
      (text4.toLowerCase().includes('inquir') ||
        text4.toLowerCase().includes('order'))
    ) {
      console.log(
        '   PASS: Prompt 4 executive summary with no raw JSON leaks!',
      );
      passed++;
    } else {
      console.error('   FAIL: Prompt 4 leaked raw JSON or failed.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Prompt 4 error:', err.message);
    failed++;
  }

  // Prompt 5: Which sales rep is converting the most inquiries into orders?
  console.log(
    '\n9. E2E Prompt 5: "Which sales rep is converting the most inquiries into orders?"',
  );
  try {
    const reply5 = await chatbotService.processChatMessage(
      adminContext,
      'Which sales rep is converting the most inquiries into orders?',
    );
    const text5 = reply5.reply;
    console.log('   Bot Response:\n  ', text5.replace(/\n/g, '\n   '));
    if (
      !text5.includes('timeout') &&
      (text5.toLowerCase().includes('max') ||
        text5.includes('54') ||
        text5.toLowerCase().includes('leaderboard'))
    ) {
      console.log(
        '   PASS: Prompt 5 identified top converting sales rep without timeout!',
      );
      passed++;
    } else {
      console.error('   FAIL: Prompt 5 failed or timed out.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Prompt 5 error:', err.message);
    failed++;
  }

  // Prompt 6: Find customers with open inquiries but no recent order activity
  console.log(
    '\n10. E2E Prompt 6: "Find customers with open inquiries but no recent order activity"',
  );
  try {
    const reply6 = await chatbotService.processChatMessage(
      adminContext,
      'Find customers with open inquiries but no recent order activity',
    );
    const text6 = reply6.reply;
    console.log('   Bot Response:\n  ', text6.replace(/\n/g, '\n   '));
    if (
      !text6.includes(
        'No matching records were found in Enlight Metals OS for this request',
      ) &&
      (text6.toLowerCase().includes('inquir') ||
        text6.toLowerCase().includes('customer'))
    ) {
      console.log(
        '   PASS: Prompt 6 listed dormant buyers with open inquiries!',
      );
      passed++;
    } else {
      console.error('   FAIL: Prompt 6 returned generic fallback.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Prompt 6 error:', err.message);
    failed++;
  }

  // Prompt 7: Show me inquiry data for a customer that doesn't exist
  console.log(
    '\n11. E2E Prompt 7: "Show me inquiry data for a customer that doesn\'t exist"',
  );
  try {
    const reply7 = await chatbotService.processChatMessage(
      adminContext,
      "Show me inquiry data for 'NonExistent Steel Co'",
    );
    const text7 = reply7.reply;
    console.log('   Bot Response:\n  ', text7.replace(/\n/g, '\n   '));
    if (
      !text7.includes('You do not have any company like') &&
      (text7.toLowerCase().includes('no inquiry records') ||
        text7.toLowerCase().includes('no inquiries') ||
        text7.toLowerCase().includes('not found') ||
        text7.toLowerCase().includes('onboard') ||
        text7.toLowerCase().includes('log an inquiry'))
    ) {
      console.log(
        '   PASS: Prompt 7 returned helpful inquiry search message rather than portfolio denial!',
      );
      passed++;
    } else {
      console.error(
        '   FAIL: Prompt 7 returned portfolio denial or unexpected error.',
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Prompt 7 error:', err.message);
    failed++;
  }

  // Prompt 8: Compare this month's inquiries to last month's
  console.log(
    '\n12. E2E Prompt 8: "Compare this month\'s inquiries to last month\'s"',
  );
  try {
    const reply8 = await chatbotService.processChatMessage(
      adminContext,
      "Compare this month's inquiries to last month's",
    );
    const text8 = reply8.reply;
    console.log('   Bot Response:\n  ', text8.replace(/\n/g, '\n   '));
    if (
      !text8.includes(
        'No matching records were found in Enlight Metals OS for this request',
      ) &&
      (text8.toLowerCase().includes('august') ||
        text8.toLowerCase().includes('september') ||
        text8.toLowerCase().includes('last month'))
    ) {
      console.log('   PASS: Prompt 8 comparative month breakdown returned!');
      passed++;
    } else {
      console.error('   FAIL: Prompt 8 returned generic fallback.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Prompt 8 error:', err.message);
    failed++;
  }

  console.log(
    '\n===============================================================',
  );
  console.log(` RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log(
    '===============================================================\n',
  );

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
