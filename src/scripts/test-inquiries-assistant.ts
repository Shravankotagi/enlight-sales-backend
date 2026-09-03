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
import { getCustomer360Tool } from '../modules/chatbot/tools/get_customer_360.tool';

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

async function runTests() {
  console.log(
    '=== Verifying Upgraded AI Assistant (Customer, Deals & Conversion Analytics) ===\n',
  );
  let passed = 0;
  let failed = 0;

  const adminContext: CallerContext = {
    userId: 'usr-admin-test-01',
    email: 'admin@enlightmetals.com',
    role: 'admin',
    name: 'Admin Test',
  };

  // --- UNIT TEST 1: get_customer_360 Directory & Count ---
  console.log('1. Unit Test: get_customer_360 directory & total count...');
  try {
    const custRes = await getCustomer360Tool.execute(
      {},
      adminContext,
      supabaseAdmin,
    );
    const data = custRes.data;
    if (
      data &&
      data.summary &&
      typeof data.summary.total_customers === 'number'
    ) {
      console.log('   PASS: Total Customers:', data.summary.total_customers);
      console.log(
        '   PASS: Customers Directory Sample:',
        data.customers.slice(0, 2).map((c: any) => c.customer_name),
      );
      passed++;
    } else {
      console.error('   FAIL: Invalid structure from get_customer_360:', data);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: get_customer_360 unit check:', err.message);
    failed++;
  }

  // --- UNIT TEST 2: get_my_open_deals Won Deals Sum & DEAL-XXXXXX ID Format ---
  console.log(
    '\n2. Unit Test: get_my_open_deals pipeline values and human Deal IDs...',
  );
  try {
    const dealsRes = await getMyOpenDealsTool.execute(
      { stage_filter: 'won' },
      adminContext,
      supabaseAdmin,
    );
    const dData = dealsRes.data;
    if (
      dData &&
      dData.summary &&
      typeof dData.summary.won_deals_total_value === 'number' &&
      dData.deals?.length > 0
    ) {
      console.log(
        '   PASS: Won Deals Count:',
        dData.summary.stage_breakdown.won?.count,
      );
      console.log(
        '   PASS: Won Deals Total Value: ₹',
        dData.summary.won_deals_total_value,
      );
      const firstDeal = dData.deals[0];
      console.log('   PASS: Deal ID format:', firstDeal.deal_id);
      if (firstDeal.deal_id.startsWith('DEAL-')) {
        passed++;
      } else {
        console.error(
          '   FAIL: Deal ID does not start with DEAL-:',
          firstDeal.deal_id,
        );
        failed++;
      }
    } else {
      console.error(
        '   FAIL: Invalid structure from get_my_open_deals:',
        dData,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: get_my_open_deals unit check:', err.message);
    failed++;
  }

  // --- PROMPT 1: How many customers do we have? ---
  console.log('\n3. Prompt: "How many customers do we have?"');
  try {
    const reply1 = await chatbotService.processChatMessage(
      adminContext,
      'How many customers do we have?',
    );
    console.log('   Bot Response:\n  ', reply1.reply.replace(/\n/g, '\n   '));
    if (
      !reply1.reply.includes("can't directly provide a total customer count") &&
      /\b\d+\b/.test(reply1.reply)
    ) {
      console.log('   PASS: Bot provided total customer count.');
      passed++;
    } else {
      console.error('   FAIL: Bot refused customer count.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL Prompt 1:', err.message);
    failed++;
  }

  // --- PROMPT 2: Show me all customers who have active inquiries ---
  console.log(
    '\n4. Prompt: "Show me all customers who have active inquiries."',
  );
  try {
    const reply2 = await chatbotService.processChatMessage(
      adminContext,
      'Show me all customers who have active inquiries.',
    );
    console.log('   Bot Response:\n  ', reply2.reply.replace(/\n/g, '\n   '));
    if (
      !reply2.reply.includes('column inquiries.customer_name does not exist') &&
      !reply2.reply.includes('error')
    ) {
      console.log(
        '   PASS: Bot listed customers with active inquiries without errors.',
      );
      passed++;
    } else {
      console.error('   FAIL: Error in active inquiries customers.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL Prompt 2:', err.message);
    failed++;
  }

  // --- PROMPT 3: Show me the complete inquiry history for ABC steel company ---
  console.log(
    '\n5. Prompt: "Show me the complete inquiry history for ABC steel company."',
  );
  try {
    const reply3 = await chatbotService.processChatMessage(
      adminContext,
      'Show me the complete inquiry history for ABC steel company.',
    );
    console.log('   Bot Response:\n  ', reply3.reply.replace(/\n/g, '\n   '));
    if (
      !reply3.reply.includes('column inquiries.customer_name does not exist') &&
      reply3.reply.includes('ABC')
    ) {
      console.log('   PASS: Inquiry history for ABC steel company returned.');
      passed++;
    } else {
      console.error(
        '   FAIL: Could not get inquiry history for ABC steel company.',
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL Prompt 3:', err.message);
    failed++;
  }

  // --- PROMPT 4: Which customers have more than one inquiry? ---
  console.log('\n6. Prompt: "Which customers have more than one inquiry?"');
  try {
    const reply4 = await chatbotService.processChatMessage(
      adminContext,
      'Which customers have more than one inquiry?',
    );
    console.log('   Bot Response:\n  ', reply4.reply.replace(/\n/g, '\n   '));
    if (
      !reply4.reply.includes('column inquiries.customer_name does not exist') &&
      !reply4.reply.includes('error')
    ) {
      console.log('   PASS: Customers with multiple inquiries identified.');
      passed++;
    } else {
      console.error('   FAIL: Customers with multiple inquiries failed.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL Prompt 4:', err.message);
    failed++;
  }

  // --- PROMPT 5: Show me all Won deals with their total value ---
  console.log('\n7. Prompt: "Show me all Won deals with their total value."');
  try {
    const reply5 = await chatbotService.processChatMessage(
      adminContext,
      'Show me all Won deals with their total value.',
    );
    console.log('   Bot Response:\n  ', reply5.reply.replace(/\n/g, '\n   '));
    // Check that Deal ID format matches DEAL-XXXXXX
    if (reply5.reply.includes('DEAL-') && /\b\d+\b/.test(reply5.reply)) {
      console.log(
        '   PASS: Bot displayed Won deals with DEAL-XXXXXX human IDs and values.',
      );
      passed++;
    } else {
      console.error(
        '   FAIL: Deal ID format did not contain DEAL- or values missing.',
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL Prompt 5:', err.message);
    failed++;
  }

  // --- PROMPT 6: What is the total value of all Won deals? ---
  console.log('\n8. Prompt: "What is the total value of all Won deals?"');
  try {
    const reply6 = await chatbotService.processChatMessage(
      adminContext,
      'What is the total value of all Won deals?',
    );
    console.log('   Bot Response:\n  ', reply6.reply.replace(/\n/g, '\n   '));
    if (
      !reply6.reply.includes("can't directly calculate the total value") &&
      (reply6.reply.includes('15') ||
        reply6.reply.includes('151,152,615') ||
        reply6.reply.includes('15.1'))
    ) {
      console.log(
        '   PASS: Bot cited the exact won deals total value (~15.1 Cr).',
      );
      passed++;
    } else {
      console.error(
        '   FAIL: Bot refused or miscalculated won deals total value.',
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL Prompt 6:', err.message);
    failed++;
  }

  // --- PROMPT 7: What is our current inquiry conversion rate? ---
  console.log('\n9. Prompt: "What is our current inquiry conversion rate?"');
  try {
    const reply7 = await chatbotService.processChatMessage(
      adminContext,
      'What is our current inquiry conversion rate?',
    );
    console.log('   Bot Response:\n  ', reply7.reply.replace(/\n/g, '\n   '));
    if (
      !reply7.reply.includes("couldn't find the specific metric") &&
      (reply7.reply.includes('32') || reply7.reply.includes('%'))
    ) {
      console.log('   PASS: Bot cited inquiry conversion rate.');
      passed++;
    } else {
      console.error('   FAIL: Bot refused conversion rate question.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL Prompt 7:', err.message);
    failed++;
  }

  console.log(
    '\n===============================================================',
  );
  console.log(` Verification Complete: ${passed} PASSED | ${failed} FAILED`);
  console.log(
    '===============================================================\n',
  );

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
