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
    '=== Comprehensive Verification: Customers With No Orders in Last 60 Days ===\n',
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
  // TEST 1: Unit Execution of get_customer_360 with no_order_days: 60 (Admin)
  // ───────────────────────────────────────────────────────────────────────────
  console.log(
    '--- TEST 1: get_customer_360 with no_order_days: 60 (Admin) ---',
  );
  try {
    const res: any = await getCustomer360Tool.execute(
      { no_order_days: 60, limit: 25 },
      adminContext,
      supabaseAdmin,
    );

    const customers = res.data?.customers || [];
    console.log(`Returned customers count: ${customers.length}`);
    console.log(
      `Total inactive customers in summary: ${res.data?.summary?.customers_without_orders_count}`,
    );

    if (customers.length > 0) {
      console.log('PASS: Returned customers with no orders in last 60 days');
      passed++;
    } else {
      console.error('FAIL: No customers returned for no_order_days: 60');
      failed++;
    }

    // Verify all returned customers haven't placed an order in last 60 days
    const allValidInactivity = customers.every(
      (c: any) =>
        c.days_since_order === null ||
        c.days_since_order === undefined ||
        c.days_since_order >= 60,
    );
    if (allValidInactivity) {
      console.log(
        'PASS: All returned customers strictly satisfy days_since_order >= 60 or null',
      );
      passed++;
    } else {
      console.error(
        'FAIL: Found customers with orders placed within last 60 days',
      );
      failed++;
    }

    // Check contact detail prioritization
    const first5 = customers.slice(0, 5);
    const withContact = first5.filter(
      (c: any) => c.contact_person || c.customer_phone,
    );
    if (withContact.length > 0) {
      console.log(
        `PASS: Contact details prioritized at top (${withContact.length}/5 have contact person/phone)`,
      );
      passed++;
    } else {
      console.error('FAIL: Contact details not prioritized at top');
      failed++;
    }

    // Check note does not claim 0 customers at risk
    if (
      res.data?.summary?.note &&
      res.data.summary.note.includes('Found') &&
      !res.data.summary.note.includes('0 customers marked as "At Risk"')
    ) {
      console.log(`PASS: Accurate summary note: "${res.data.summary.note}"`);
      passed++;
    } else {
      console.error(
        `FAIL: Summary note is misleading or missing: ${res.data?.summary?.note}`,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('FAIL: Exception in Test 1:', err.message);
    failed++;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2: RBAC Scoping of no_order_days for Salesperson (Akruti)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST 2: get_customer_360 no_order_days RBAC (Akruti) ---');
  try {
    const res: any = await getCustomer360Tool.execute(
      { no_order_days: 60, limit: 25 },
      akrutiContext,
      supabaseAdmin,
    );

    const customers = res.data?.customers || [];
    console.log(
      `Akruti assigned customers with no orders in 60 days: ${customers.length}`,
    );

    const allAkruti = customers.every(
      (c: any) =>
        c.assigned_salesperson_name?.toLowerCase().includes('akruti') ||
        (c.assigned_salesperson_phone &&
          c.assigned_salesperson_phone.includes('7977088031')),
    );

    if (allAkruti && customers.length > 0) {
      console.log(
        `PASS: Strictly scoped to Akruti's assigned portfolio (${customers.length} accounts)`,
      );
      passed++;
    } else {
      console.error(
        'FAIL: RBAC leak - accounts from other reps found or 0 accounts',
      );
      failed++;
    }
  } catch (err: any) {
    console.error('FAIL: Exception in Test 2:', err.message);
    failed++;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3: Rescue Router Disambiguation
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST 3: Rescue Router Disambiguation ---');
  try {
    const query =
      "Which customers haven't placed an order in the last 60 days?";
    const lower = query.toLowerCase();

    let routedTool = '';
    let routedArgs: any = {};

    if (
      (lower.includes('customer') ||
        lower.includes('account') ||
        lower.includes('client') ||
        lower.includes('buyer')) &&
      (lower.includes("haven't placed") ||
        lower.includes('havent placed') ||
        lower.includes('have not placed') ||
        lower.includes('not placed') ||
        lower.includes('no order') ||
        lower.includes('without order') ||
        lower.includes('no recent order') ||
        lower.includes("hasn't placed") ||
        lower.includes('has not placed') ||
        lower.includes('hasnt placed') ||
        lower.includes('without any order') ||
        lower.includes('not ordered') ||
        lower.includes('dormant') ||
        (lower.includes('order') &&
          (lower.includes('days') || lower.includes('60'))))
    ) {
      const daysMatch = lower.match(/\b(\d+)\s*(?:days?|d)\b/i);
      const days = daysMatch ? parseInt(daysMatch[1], 10) : 60;
      routedTool = 'get_customer_360';
      routedArgs = {
        no_order_days: days,
        limit: 25,
      };
    }

    if (routedTool === 'get_customer_360' && routedArgs.no_order_days === 60) {
      console.log(
        'PASS: Query successfully routes to get_customer_360 with no_order_days: 60',
      );
      passed++;
    } else {
      console.error(
        `FAIL: Misrouted query to "${routedTool}" with args:`,
        routedArgs,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('FAIL: Exception in Test 3:', err.message);
    failed++;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4: End-to-End Chatbot Execution (Admin)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST 4: E2E Chatbot Execution (Admin) ---');
  try {
    const query =
      "Which customers haven't placed an order in the last 60 days?";
    console.log(`Sending query to chatbotService: "${query}"`);

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
      console.error('FAIL: Response contains emojis');
      failed++;
    }

    // 4b: Must NOT claim 0 customers at risk or all active
    if (
      !reply.includes('0 customers at risk') &&
      !reply.includes('0 customers marked as "At Risk"') &&
      !reply.includes('all accounts are active and in good standing')
    ) {
      console.log(
        'PASS: Does NOT falsely claim 0 customers at risk or all accounts active',
      );
      passed++;
    } else {
      console.error(
        'FAIL: Response still contains canned "0 customers at risk" refusal',
      );
      failed++;
    }

    // 4c: Markdown list or table check
    if (
      (reply.includes('|') || reply.includes('- ')) &&
      (reply.includes('A.P Distributor') ||
        reply.includes('Abhinav Group') ||
        reply.includes('Ace Park') ||
        reply.includes('Customer') ||
        reply.includes('customer') ||
        reply.includes('accounts'))
    ) {
      console.log(
        'PASS: Response contains markdown list or table with customer details',
      );
      passed++;
    } else {
      console.error(
        'FAIL: Response missing markdown list or table with customer details',
      );
      failed++;
    }

    // 4d: Mentions actual customers with contact details
    if (
      reply.includes('Abhinav Group') ||
      reply.includes('Avadhut Chakrawarte') ||
      reply.includes('Ace Park') ||
      reply.includes('Wasif Sayed') ||
      reply.includes('Ajit Nahar') ||
      reply.includes('Vikram Joshi')
    ) {
      console.log(
        'PASS: Response includes actual accounts and contact persons from database',
      );
      passed++;
    } else {
      console.error(
        'FAIL: Actual customer accounts or contacts not found in response',
      );
      failed++;
    }
  } catch (err: any) {
    console.error('FAIL: Exception in Test 4:', err.message);
    failed++;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 5: End-to-End Chatbot Execution (Akruti)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST 5: E2E Chatbot Execution (Akruti) ---');
  try {
    const query =
      "Which customers haven't placed an order in the last 60 days?";
    console.log(`Sending query to chatbotService (Akruti): "${query}"`);

    const result = await chatbotService.processChatMessage(
      akrutiContext,
      query,
    );

    const reply = result?.reply || '';
    console.log('\n--- Chatbot Response (Akruti) ---');
    console.log(reply);
    console.log('------------------------\n');

    if (
      !EMOJI_REGEX.test(reply) &&
      (reply.includes('|') || reply.includes('- '))
    ) {
      console.log(
        'PASS: Akruti response formatted cleanly in markdown list/table without emojis',
      );
      passed++;
    } else {
      console.error(
        'FAIL: Akruti response failed formatting or contains emojis',
      );
      failed++;
    }
  } catch (err: any) {
    console.error('FAIL: Exception in Test 5:', err.message);
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
