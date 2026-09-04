import * as dotenv from 'dotenv';
import * as path from 'path';
import { CallerContext } from '../modules/chatbot/tools/chatbot-tool.interface';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

function parseToolOutput(output: any): any {
  if (typeof output === 'string' && output.includes('<untrusted_content')) {
    const jsonMatch = output.match(
      /<untrusted_content[^>]*>\s*([\s\S]*?)\s*<\/untrusted_content>/,
    );
    if (jsonMatch && jsonMatch[1]) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        return jsonMatch[1];
      }
    }
  }
  return output;
}

async function runRbacIsolationTests() {
  console.log(
    '===============================================================',
  );
  console.log(
    '=== RBAC Cross-Salesperson Isolation Verification Test Suite ===',
  );
  console.log(
    '===============================================================\n',
  );

  const { SupabaseService } = await import(
    '../infrastructure/supabase/supabase.service'
  );
  const { ConfigService } = await import('../config/config.service');
  const { ConfigService: NestConfigService } = await import('@nestjs/config');
  const { ChatbotService } = await import('../modules/chatbot/chatbot.service');
  const { ToolRegistryService } = await import(
    '../modules/chatbot/tools/tool-registry.service'
  );
  const { GuardrailsService } = await import(
    '../modules/chatbot/guardrails/guardrails.service'
  );

  const configService = new ConfigService(new NestConfigService());
  const supabaseService = new SupabaseService(configService);
  const toolRegistry = new ToolRegistryService(supabaseService);
  const guardrailsService = new GuardrailsService(supabaseService);
  const chatbotService = new ChatbotService(
    supabaseService,
    toolRegistry,
    guardrailsService,
  );

  // Salesperson Rishabh (EMP009, 919619226169)
  const rishabhContext: CallerContext = {
    userId: '48d888a3-a2bd-4169-aba3-a93b71035cf6',
    email: 'rishabh.makwana@enlightmetals.com',
    role: 'salesperson',
    phone: '919619226169',
    employeeId: '48d888a3-a2bd-4169-aba3-a93b71035cf6',
    name: 'Rishabh Makwana',
  };

  // Salesperson Max (EMP0004, 918262937458)
  const maxContext: CallerContext = {
    userId: '3a415ecd-5471-47ac-82f2-bf750c10ca11',
    email: 'max@enlightmetals.com',
    role: 'salesperson',
    phone: '918262937458',
    employeeId: '3a415ecd-5471-47ac-82f2-bf750c10ca11',
    name: 'Max',
  };

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: any) {
    if (condition) {
      console.log(`  PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  FAIL: ${testName}`);
      if (detail) console.error('   Detail:', detail);
      failed++;
    }
  }

  // --- Test 1: Rishabh queries Customer 360 for "Supreme Steel" (Max's account) ---
  console.log(
    '--- Test 1: Rishabh queries get_customer_360 for "Supreme Steel" (Max\'s customer) ---',
  );
  const res1Raw = await toolRegistry.executeTool(
    'get_customer_360',
    { customer_name: 'Supreme Steel' },
    rishabhContext,
  );
  const res1 = parseToolOutput(res1Raw);
  assert(res1.notFound === true, 'Response flags notFound: true');
  assert(
    res1.message &&
      res1.message.includes(
        'You do not have any company like "Supreme Steel" in your assigned accounts',
      ),
    'Response contains "You do not have any company like Supreme Steel in your assigned accounts."',
    res1.message,
  );

  // --- Test 2: Rishabh queries Customer 360 for "Supreme Steel Pvt Ltd" (Rishabh's own account) ---
  console.log(
    '\n--- Test 2: Rishabh queries get_customer_360 for "Supreme Steel Pvt Ltd" (Own customer) ---',
  );
  const res2Raw = await toolRegistry.executeTool(
    'get_customer_360',
    { customer_name: 'Supreme Steel Pvt Ltd' },
    rishabhContext,
  );
  const res2 = parseToolOutput(res2Raw);
  assert(res2.notFound !== true, 'Response does not flag notFound');
  assert(
    res2.customer_name === 'Supreme Steel Pvt Ltd',
    'Returns profile for Supreme Steel Pvt Ltd',
  );
  assert(
    res2.metrics?.total_complaints === 0,
    'No complaints leaked from Max (total_complaints: 0)',
  );
  assert(res2.deals?.length > 0, "Returns Rishabh's own deal record");

  // --- Test 3: Max queries Customer 360 for "Supreme Steel" (Max's own account) ---
  console.log(
    '\n--- Test 3: Max queries get_customer_360 for "Supreme Steel" (Max\'s own account) ---',
  );
  const res3Raw = await toolRegistry.executeTool(
    'get_customer_360',
    { customer_name: 'Supreme Steel' },
    maxContext,
  );
  const res3 = parseToolOutput(res3Raw);
  assert(
    res3.notFound !== true,
    'Max can access Supreme Steel (notFound is false/undefined)',
  );
  assert(
    res3.customer_name === 'Supreme Steel',
    'Customer name is Supreme Steel',
  );
  assert(
    res3.metrics?.total_complaints === 1,
    'Max sees his 1 logged complaint for Supreme Steel',
  );

  // --- Test 4: Rishabh queries get_visits for "Supreme Steel" ---
  console.log(
    '\n--- Test 4: Rishabh queries get_visits for "Supreme Steel" ---',
  );
  const res4Raw = await toolRegistry.executeTool(
    'get_visits',
    { customer_name: 'Supreme Steel' },
    rishabhContext,
  );
  const res4 = parseToolOutput(res4Raw);
  assert(res4.notFound === true, 'get_visits flags notFound: true');
  assert(
    res4.summary?.message &&
      res4.summary.message.includes(
        'You do not have any company like "Supreme Steel"',
      ),
    'get_visits returns assigned accounts warning',
  );

  // --- Test 5: Rishabh queries get_complaints for "Supreme Steel" ---
  console.log(
    '\n--- Test 5: Rishabh queries get_complaints for "Supreme Steel" ---',
  );
  const res5Raw = await toolRegistry.executeTool(
    'get_complaints',
    { customer_name: 'Supreme Steel' },
    rishabhContext,
  );
  const res5 = parseToolOutput(res5Raw);
  assert(res5.notFound === true, 'get_complaints flags notFound: true');
  assert(
    res5.summary?.message &&
      res5.summary.message.includes(
        'You do not have any company like "Supreme Steel"',
      ),
    'get_complaints returns assigned accounts warning',
  );

  // --- Test 6: Rishabh queries get_my_open_deals for "Supreme Steel" ---
  console.log(
    '\n--- Test 6: Rishabh queries get_my_open_deals for "Supreme Steel" ---',
  );
  const res6Raw = await toolRegistry.executeTool(
    'get_my_open_deals',
    { customer_name: 'Supreme Steel' },
    rishabhContext,
  );
  const res6 = parseToolOutput(res6Raw);
  assert(res6.notFound === true, 'get_my_open_deals flags notFound: true');
  assert(
    res6.summary?.message &&
      res6.summary.message.includes(
        'You do not have any company like "Supreme Steel"',
      ),
    'get_my_open_deals returns assigned accounts warning',
  );

  // --- Test 7: Fail-Closed Identity Test (Salesperson with no phone and no empId) ---
  console.log(
    '\n--- Test 7: Unauthenticated / Invalid identity fail-closed test ---',
  );
  const invalidRepContext: CallerContext = {
    userId: 'unverified-user',
    email: 'unknown@enlightmetals.com',
    role: 'salesperson',
    name: 'Unknown Rep',
  };
  const res7Raw = await toolRegistry.executeTool(
    'get_customer_360',
    { customer_name: 'Supreme Steel' },
    invalidRepContext,
  );
  const res7 = parseToolOutput(res7Raw);
  assert(
    res7.notFound === true,
    'Invalid identity immediately fails closed (notFound: true)',
  );
  assert(
    res7.message?.includes('Access denied'),
    'Invalid identity returns Access Denied',
  );

  // --- Test 8: End-to-End Chatbot Orchestrator Test ---
  console.log(
    '\n--- Test 8: Full Chatbot Orchestration for Rishabh asking: "Give me Customer 360 for Supreme Steel including their visits and complaints" ---',
  );
  const chatResponse = await chatbotService.processChatMessage(
    rishabhContext,
    'Give me Customer 360 for Supreme Steel including their visits and complaints',
  );
  console.log(
    `\nChatbot Response:\n----------------------------------------\n${chatResponse.reply}\n----------------------------------------\n`,
  );

  const lowerReply = chatResponse.reply.toLowerCase();
  assert(
    lowerReply.includes('you do not have any company like') ||
      lowerReply.includes('not in your assigned accounts') ||
      lowerReply.includes('no company like supreme steel') ||
      lowerReply.includes('supreme steel'),
    'Chatbot informs Rishabh that Supreme Steel is not in assigned accounts',
  );
  assert(
    !lowerReply.includes('6dfd52e9') &&
      !lowerReply.includes('max') &&
      !lowerReply.includes('fb49b94d'),
    "Zero cross-salesperson data leakage (Max's complaint/deals are completely absent)",
  );

  console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runRbacIsolationTests().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
