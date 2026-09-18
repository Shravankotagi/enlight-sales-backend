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
    '=== Comprehensive Verification: Top Customer Accounts by Tonnage in AI Assistant ===\n',
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

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 1: Unit Execution of get_customer_360 tool in top_customers mode (Admin)
  // ───────────────────────────────────────────────────────────────────────────
  console.log(
    '--- TEST 1: get_customer_360 Tool top_customers Mode (Admin) ---',
  );
  try {
    const res: any = await getCustomer360Tool.execute(
      { mode: 'top_customers', sort_by: 'tonnage_desc', limit: 5 },
      adminContext,
      supabaseAdmin,
    );

    const customers = res.data?.customers || [];
    console.log(`Returned customers count: ${customers.length}`);
    if (customers.length >= 5) {
      console.log('PASS: Returned 5 top customer accounts');
      passed++;
    } else {
      console.error(
        `FAIL: Expected at least 5 customers, got ${customers.length}`,
      );
      failed++;
    }

    let isDescending = true;
    for (let i = 0; i < customers.length - 1; i++) {
      if (customers[i].total_tonnage_mt < customers[i + 1].total_tonnage_mt) {
        isDescending = false;
        break;
      }
    }
    if (isDescending && customers[0].total_tonnage_mt > 0) {
      console.log(
        `PASS: Customers correctly sorted descending by tonnage. Top customer: "${customers[0].customer_name}" with ${customers[0].total_tonnage_mt} MT`,
      );
      passed++;
    } else {
      console.error('FAIL: Customers not sorted descending or tonnage is 0');
      failed++;
    }

    if (
      Array.isArray(res.data?.summary?.top_customers_by_tonnage) &&
      res.data.summary.top_customers_by_tonnage.length > 0
    ) {
      console.log(
        `PASS: summary.top_customers_by_tonnage populated (${res.data.summary.top_customers_by_tonnage.length} items)`,
      );
      passed++;
    } else {
      console.error('FAIL: summary.top_customers_by_tonnage missing or empty');
      failed++;
    }
  } catch (err: any) {
    console.error('FAIL: Exception during Test 1:', err.message);
    failed++;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2: RBAC Scoping of top_customers for Salesperson (Akruti)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST 2: get_customer_360 top_customers RBAC (Akruti) ---');
  try {
    const res: any = await getCustomer360Tool.execute(
      { mode: 'top_customers', sort_by: 'tonnage_desc', limit: 5 },
      akrutiContext,
      supabaseAdmin,
    );

    const customers = res.data?.customers || [];
    console.log(`Akruti assigned top customers count: ${customers.length}`);

    // Check that every customer belongs to Akruti (phone 7977088031)
    const allAkruti = customers.every(
      (c: any) =>
        c.assigned_salesperson_name?.toLowerCase().includes('akruti') ||
        (c.assigned_salesperson_phone &&
          c.assigned_salesperson_phone.includes('7977088031')),
    );

    if (allAkruti && customers.length > 0) {
      console.log(
        `PASS: Strictly scoped to Akruti's accounts. Top account: "${customers[0].customer_name}" (${customers[0].total_tonnage_mt} MT, ${customers[0].total_orders} orders)`,
      );
      passed++;
    } else {
      console.error(
        'FAIL: RBAC leak - customers from other reps present or 0 customers',
      );
      failed++;
    }
  } catch (err: any) {
    console.error('FAIL: Exception during Test 2:', err.message);
    failed++;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3: Rescue Router Disambiguation Check
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST 3: Rescue Router Disambiguation ---');
  try {
    // 3a: "List my top 5 customer accounts by tonnage this year" should route to get_customer_360
    const msgCustomer = 'List my top 5 customer accounts by tonnage this year';
    const lowerCust = msgCustomer.toLowerCase();

    let routedTool = '';
    let routedArgs: any = {};
    if (
      (lowerCust.includes('highest') ||
        lowerCust.includes('top') ||
        lowerCust.includes('largest') ||
        lowerCust.includes('maximum')) &&
      (lowerCust.includes('tonnage') ||
        lowerCust.includes('volume') ||
        lowerCust.includes('weight'))
    ) {
      if (
        lowerCust.includes('inquir') ||
        lowerCust.includes('rfq') ||
        lowerCust.includes('lead')
      ) {
        routedTool = 'get_inquiries';
        routedArgs = { mode: 'highest_tonnage', sort_by: 'tonnage_desc' };
      } else if (
        lowerCust.includes('customer') ||
        lowerCust.includes('account') ||
        lowerCust.includes('client') ||
        lowerCust.includes('buyer')
      ) {
        const limitMatch = lowerCust.match(/\b(?:top|first)\s+(\d+)\b/i);
        const limit = limitMatch ? parseInt(limitMatch[1], 10) : 5;
        routedTool = 'get_customer_360';
        routedArgs = { mode: 'top_customers', sort_by: 'tonnage_desc', limit };
      }
    }

    if (
      routedTool === 'get_customer_360' &&
      routedArgs.mode === 'top_customers' &&
      routedArgs.sort_by === 'tonnage_desc' &&
      routedArgs.limit === 5
    ) {
      console.log(
        'PASS: "List my top 5 customer accounts by tonnage this year" correctly routes to get_customer_360 (mode: top_customers, sort_by: tonnage_desc, limit: 5)',
      );
      passed++;
    } else {
      console.error(
        `FAIL: Misrouted customer tonnage query to "${routedTool}" with args:`,
        routedArgs,
      );
      failed++;
    }

    // 3b: "Which customer has the highest tonnage inquiry?" should route to get_inquiries
    const msgInquiry = 'Which customer has the highest tonnage inquiry?';
    const lowerInq = msgInquiry.toLowerCase();
    let routedInqTool = '';
    let routedInqArgs: any = {};
    if (
      (lowerInq.includes('highest') ||
        lowerInq.includes('top') ||
        lowerInq.includes('largest') ||
        lowerInq.includes('maximum')) &&
      (lowerInq.includes('tonnage') ||
        lowerInq.includes('volume') ||
        lowerInq.includes('weight'))
    ) {
      if (
        lowerInq.includes('inquir') ||
        lowerInq.includes('rfq') ||
        lowerInq.includes('lead')
      ) {
        routedInqTool = 'get_inquiries';
        routedInqArgs = { mode: 'highest_tonnage', sort_by: 'tonnage_desc' };
      }
    }

    if (
      routedInqTool === 'get_inquiries' &&
      routedInqArgs.mode === 'highest_tonnage'
    ) {
      console.log(
        'PASS: "Which customer has the highest tonnage inquiry?" correctly routes to get_inquiries (mode: highest_tonnage)',
      );
      passed++;
    } else {
      console.error(
        `FAIL: Misrouted inquiry tonnage query to "${routedInqTool}" with args:`,
        routedInqArgs,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('FAIL: Exception during Test 3:', err.message);
    failed++;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4: End-to-End Chatbot Service Execution (Admin & Rep)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST 4: E2E Chatbot Service Execution ---');
  try {
    const query = 'List my top 5 customer accounts by tonnage this year';
    console.log(`Sending query to chatbotService (Admin): "${query}"`);

    const result = await chatbotService.processChatMessage(adminContext, query);

    const reply = result?.reply || '';
    console.log('\n--- Chatbot Response (Admin) ---');
    console.log(reply);
    console.log('------------------------\n');

    // 4a: Emoji check
    if (!EMOJI_REGEX.test(reply)) {
      console.log('PASS: ZERO emojis in response');
      passed++;
    } else {
      console.error('FAIL: Response contains prohibited emojis');
      failed++;
    }

    // 4b: Markdown table check
    if (
      reply.includes('|') &&
      (reply.includes('Customer') ||
        reply.includes('customer') ||
        reply.includes('Account'))
    ) {
      console.log(
        'PASS: Response contains markdown table of customer accounts',
      );
      passed++;
    } else {
      console.error('FAIL: Response missing markdown table');
      failed++;
    }

    // 4c: Inquiry ID check (must NOT be inquiries!)
    if (
      !reply.includes('#INQ-') &&
      !reply.includes('CR Sheet') &&
      !reply.includes('MS Sheet')
    ) {
      console.log(
        'PASS: Response does NOT confuse customer accounts with inquiries (no #INQ- codes)',
      );
      passed++;
    } else {
      console.error(
        'FAIL: Response incorrectly includes inquiry codes (#INQ-) or inquiry products',
      );
      failed++;
    }

    // 4d: Top customer presence
    if (
      reply.includes('Omega Metal & Alloy Industries') ||
      reply.includes('Western Fabricators') ||
      reply.includes('SS Industries')
    ) {
      console.log('PASS: Response includes actual database customer accounts');
      passed++;
    } else {
      console.error('FAIL: Actual customer accounts not mentioned in response');
      failed++;
    }

    // 4e: Akruti Rep E2E Check
    console.log(`\nSending query to chatbotService (Akruti): "${query}"`);
    const akrutiResult = await chatbotService.processChatMessage(
      akrutiContext,
      query,
    );
    const akrutiReply = akrutiResult?.reply || '';
    console.log('\n--- Chatbot Response (Akruti) ---');
    console.log(akrutiReply);
    console.log('------------------------\n');

    if (
      !EMOJI_REGEX.test(akrutiReply) &&
      akrutiReply.includes('Western Fabricators')
    ) {
      console.log(
        'PASS: Akruti E2E response contains her top customer (Western Fabricators) without emojis',
      );
      passed++;
    } else {
      console.error('FAIL: Akruti E2E response failed validation');
      failed++;
    }
  } catch (err: any) {
    console.error('FAIL: Exception during Test 4:', err.message);
    failed++;
  }

  console.log(
    `\n=== Verification Complete: ${passed} PASSED, ${failed} FAILED ===`,
  );
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Fatal error running tests:', e);
  process.exit(1);
});
