import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { ToolRegistryService } from '../modules/chatbot/tools/tool-registry.service';
import { CallerContext } from '../modules/chatbot/tools/chatbot-tool.interface';
import { ChatbotService } from '../modules/chatbot/chatbot.service';
import { GuardrailsService } from '../modules/chatbot/guardrails/guardrails.service';

async function testDeliveredTonnageTrend() {
  console.log('--- Testing AI-Assistant Delivered Tonnage Trend ---');

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

  const mockSupabaseService = {
    getAdminClient: () => supabaseAdmin,
  } as any;

  const registry = new ToolRegistryService(mockSupabaseService);
  const guardrails = new GuardrailsService(mockSupabaseService);
  const chatbotService = new ChatbotService(
    mockSupabaseService,
    registry,
    guardrails,
  );

  const adminCaller: CallerContext = {
    userId: 'test-admin-id',
    email: 'admin@enlightmetals.com',
    role: 'admin',
    name: 'Admin User',
  };

  // 1. Test Direct Tool Execution
  console.log(
    '\n1. Direct Execution of get_my_open_deals (mode: tonnage_trend):',
  );
  const toolResultRaw = await registry.executeTool(
    'get_my_open_deals',
    {
      stage_filter: 'won',
      mode: 'tonnage_trend',
      date_range: 'last_6_months',
    },
    adminCaller,
  );

  const parseResult = (raw: any) => {
    if (typeof raw === 'string') {
      const clean = raw
        .replace(/<untrusted_content[^>]*>/gi, '')
        .replace(/<\/untrusted_content>/gi, '')
        .trim();
      try {
        return JSON.parse(clean);
      } catch {
        return clean;
      }
    }
    return raw;
  };

  const toolData = parseResult(toolResultRaw);
  console.log('Tool Period:', toolData.summary?.trend_summary?.period);
  console.log(
    'Total Delivered Tonnage MT:',
    toolData.summary?.trend_summary?.total_delivered_tonnage_mt,
  );
  console.log(
    'Total Orders Count:',
    toolData.summary?.trend_summary?.total_delivered_orders_count,
  );
  console.log('Monthly Trend Count:', toolData.monthly_trend?.length);

  if (!toolData.monthly_trend || toolData.monthly_trend.length !== 6) {
    throw new Error(
      `Expected 6 monthly trend slots, got ${toolData.monthly_trend?.length}`,
    );
  }

  // 2. Test End-to-End Chatbot Query
  console.log(
    '\n2. End-to-End Chatbot Query: "What is the delivered tonnage trend for the last 6 months?"',
  );
  const chatResponse = await chatbotService.processChatMessage(
    adminCaller,
    'What is the delivered tonnage trend for the last 6 months?',
  );

  console.log('\n--- Assistant Reply ---');
  console.log(chatResponse.reply);
  console.log('-----------------------');

  const replyLower = chatResponse.reply.toLowerCase();
  if (
    replyLower.includes('cannot provide') ||
    replyLower.includes('do not have the capability') ||
    replyLower.includes('tools do not')
  ) {
    throw new Error('FAIL: Assistant still gave a tool capability refusal!');
  }

  if (!replyLower.includes('mt') && !replyLower.includes('tonnage')) {
    throw new Error('FAIL: Assistant reply does not mention MT or tonnage!');
  }

  console.log(
    '\nSUCCESS: AI-Assistant answered delivered tonnage trend query accurately without refusal!',
  );
}

testDeliveredTonnageTrend().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
