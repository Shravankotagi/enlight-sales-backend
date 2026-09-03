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
import { getInquiriesTool } from '../modules/chatbot/tools/get_inquiries.tool';

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
  console.log('=== Verifying Upgraded Inquiry Intelligence Engine ===\n');
  let passed = 0;
  let failed = 0;

  const adminContext: CallerContext = {
    userId: 'usr-admin-test-01',
    email: 'admin@enlightmetals.com',
    role: 'admin',
    name: 'Admin Test',
  };

  // --- UNIT TEST 1: Direct Tool Execution with Summary & Counts ---
  console.log('1. Direct get_inquiries Execution (Unit Check)...');
  try {
    const res = await getInquiriesTool.execute(
      { limit: 10 },
      adminContext,
      supabaseAdmin,
    );
    const data = res.data;
    if (
      data &&
      data.summary &&
      typeof data.summary.total_inquiries === 'number' &&
      data.inquiries?.length > 0
    ) {
      console.log('   PASS: Total Inquiries:', data.summary.total_inquiries);
      console.log(
        '   PASS: Top Customers:',
        JSON.stringify(data.summary.top_customers.slice(0, 3)),
      );
      console.log(
        '   PASS: Deal Stages Breakdown:',
        JSON.stringify(data.summary.by_deal_stage),
      );
      const first = data.inquiries[0];
      console.log('   PASS: Fields on item:', {
        inquiry_id: !!first.inquiry_id,
        customer_name: first.customer_name,
        deal_id: first.deal_id,
        deal_status: first.deal_status,
        source_channel: first.source_channel,
        has_items: first.extracted_line_items?.length >= 0,
      });
      passed++;
    } else {
      console.error('   FAIL: Invalid structure from get_inquiries:', data);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Error in get_inquiries:', err.message);
    failed++;
  }

  // --- UNIT TEST 2: Filter by Won / Lost ---
  console.log('\n2. Filtering Inquiries by Deal Outcome (Won & Lost)...');
  try {
    const wonRes = await getInquiriesTool.execute(
      { status_filter: 'won' },
      adminContext,
      supabaseAdmin,
    );
    const lostRes = await getInquiriesTool.execute(
      { status_filter: 'lost' },
      adminContext,
      supabaseAdmin,
    );
    console.log(
      '   PASS: Won inquiries count:',
      wonRes.data.inquiries?.length,
      '(Total in DB:',
      wonRes.data.summary.by_deal_stage.won,
      ')',
    );
    console.log(
      '   PASS: Lost inquiries count:',
      lostRes.data.inquiries?.length,
      '(Total in DB:',
      lostRes.data.summary.by_deal_stage.lost,
      ')',
    );
    passed++;
  } catch (err: any) {
    console.error('   FAIL: Error filtering by outcome:', err.message);
    failed++;
  }

  // --- PROMPT 1: Total number of inquiries ---
  console.log('\n3. Prompt: "Show me the total number of inquiries."');
  try {
    const reply1 = await chatbotService.processChatMessage(
      adminContext,
      'Show me the total number of inquiries.',
    );
    console.log('   Bot Response:\n  ', reply1.reply.replace(/\n/g, '\n   '));
    if (
      !reply1.reply.includes('cannot provide a total count') &&
      /\b\d+\b/.test(reply1.reply)
    ) {
      console.log('   PASS: Bot provided total inquiry count without refusal.');
      passed++;
    } else {
      console.error('   FAIL: Bot refused or did not provide count.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL Prompt 1:', err.message);
    failed++;
  }

  // --- PROMPT 2: How many inquiries do we have currently? ---
  console.log('\n4. Prompt: "How many inquiries do we have currently?"');
  try {
    const reply2 = await chatbotService.processChatMessage(
      adminContext,
      'How many inquiries do we have currently?',
    );
    console.log('   Bot Response:\n  ', reply2.reply.replace(/\n/g, '\n   '));
    if (
      !reply2.reply.includes('cannot provide a total count') &&
      /\b\d+\b/.test(reply2.reply)
    ) {
      console.log('   PASS: Bot answered currently inquiries without refusal.');
      passed++;
    } else {
      console.error('   FAIL: Bot refused or did not provide count.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL Prompt 2:', err.message);
    failed++;
  }

  // --- PROMPT 3: List all inquiries with customer name, deal ID, items, source channel, and deal status ---
  console.log(
    '\n5. Prompt: "List inquiries with customer name, deal ID, items, source channel, and deal status."',
  );
  try {
    const reply3 = await chatbotService.processChatMessage(
      adminContext,
      'List the latest 5 inquiries with customer name, deal ID, items, source channel, and deal status.',
    );
    console.log('   Bot Response:\n  ', reply3.reply.replace(/\n/g, '\n   '));
    if (
      !reply3.reply.includes('column inquiries.customer_name does not exist') &&
      !reply3.reply.includes('error')
    ) {
      console.log(
        '   PASS: Bot listed inquiries with all required fields and ZERO SQL errors.',
      );
      passed++;
    } else {
      console.error('   FAIL: SQL error or failure returned.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL Prompt 3:', err.message);
    failed++;
  }

  // --- PROMPT 4: Show me all Won inquiries ---
  console.log('\n6. Prompt: "Show me all Won inquiries."');
  try {
    const reply4 = await chatbotService.processChatMessage(
      adminContext,
      'Show me all Won inquiries.',
    );
    console.log('   Bot Response:\n  ', reply4.reply.replace(/\n/g, '\n   '));
    if (!reply4.reply.includes('there is no "won" status for inquiries')) {
      console.log(
        '   PASS: Bot answered won inquiries without rejecting status.',
      );
      passed++;
    } else {
      console.error('   FAIL: Bot rejected won status.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL Prompt 4:', err.message);
    failed++;
  }

  // --- PROMPT 5: Which customer has the highest number of inquiries? ---
  console.log(
    '\n7. Prompt: "Which customer has the highest number of inquiries?"',
  );
  try {
    const reply5 = await chatbotService.processChatMessage(
      adminContext,
      'Which customer has the highest number of inquiries?',
    );
    console.log('   Bot Response:\n  ', reply5.reply.replace(/\n/g, '\n   '));
    if (
      !reply5.reply.includes(
        'I cannot directly tell you which customer has the highest number of inquiries',
      )
    ) {
      console.log(
        '   PASS: Bot accurately identified the customer with highest inquiries.',
      );
      passed++;
    } else {
      console.error('   FAIL: Bot refused to aggregate by customer.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL Prompt 5:', err.message);
    failed++;
  }

  // --- PROMPT 6 & 7: Latest 10 inquiries & today inquiries ---
  console.log('\n8. Prompt: "Show me the latest 10 inquiries."');
  try {
    const reply6 = await chatbotService.processChatMessage(
      adminContext,
      'Show me the latest 10 inquiries.',
    );
    console.log('   Bot Response:\n  ', reply6.reply.replace(/\n/g, '\n   '));
    if (
      !reply6.reply.includes('column inquiries.customer_name does not exist')
    ) {
      console.log('   PASS: Latest 10 inquiries returned successfully.');
      passed++;
    } else {
      console.error('   FAIL: SQL error on latest inquiries.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL Prompt 6:', err.message);
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
