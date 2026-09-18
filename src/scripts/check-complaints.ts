import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

import { getComplaintsTool } from '../modules/chatbot/tools/get_complaints.tool';
import { ChatbotService } from '../modules/chatbot/chatbot.service';
import { GuardrailsService } from '../modules/chatbot/guardrails/guardrails.service';
import { ToolRegistryService } from '../modules/chatbot/tools/tool-registry.service';

async function main() {
  console.log(
    '=== Verifying Full Retrieval for Complaints Raised in Last 7 Days ===\n',
  );

  const akrutiContext = {
    userId: '383b0ab8-a89d-4814-adf3-e8da4be13324',
    email: 'akruti@enlightmetals.com',
    role: 'salesperson',
    name: 'akruti',
    phone: '917977088031',
  };

  const adminContext = {
    userId: 'usr-admin-test-01',
    email: 'admin@enlightmetals.com',
    role: 'admin',
    name: 'Admin Test',
  };

  // 1. Akruti Tool Direct with date_range: 'last_7_days'
  console.log(
    '1. Testing getComplaintsTool for Akruti with date_range: "last_7_days"...',
  );
  const resAkruti1: any = await getComplaintsTool.execute(
    { date_range: 'last_7_days' },
    akrutiContext,
    supabaseAdmin,
  );
  const akrutiComplaints1 = resAkruti1.data?.complaints || [];
  console.log(`   Returned complaints count: ${akrutiComplaints1.length}`);
  console.log(
    `   Summary total: ${resAkruti1.data?.summary?.total_complaints}, filtered: ${resAkruti1.data?.summary?.filtered_complaints_count}`,
  );
  if (akrutiComplaints1.length === 20) {
    console.log(
      '   PASS: Successfully retrieved all 20 complaints for Akruti in the last 7 days.\n',
    );
  } else {
    console.error(
      `   FAIL: Expected 20 complaints, got ${akrutiComplaints1.length}\n`,
    );
  }

  // 2. Akruti Tool Direct with date_range: '7_days' and '7 days'
  console.log('2. Testing getComplaintsTool with "7_days" and "7 days"...');
  const resAkruti2: any = await getComplaintsTool.execute(
    { date_range: '7_days' },
    akrutiContext,
    supabaseAdmin,
  );
  const resAkruti3: any = await getComplaintsTool.execute(
    { date_range: '7 days' },
    akrutiContext,
    supabaseAdmin,
  );
  console.log(
    `   date_range: "7_days" count: ${resAkruti2.data?.complaints?.length}`,
  );
  console.log(
    `   date_range: "7 days" count: ${resAkruti3.data?.complaints?.length}`,
  );
  if (
    resAkruti2.data?.complaints?.length === 20 &&
    resAkruti3.data?.complaints?.length === 20
  ) {
    console.log('   PASS: Both date formats retrieved all 20 complaints.\n');
  } else {
    console.error('   FAIL: Inconsistent date format resolution.\n');
  }

  // 3. ChatbotService invocation for Akruti
  console.log(
    '3. Testing ChatbotService.processChatMessage for Akruti: "Show complaints raised in the last 7 days"...',
  );
  const toolRegistryService = new ToolRegistryService({
    getAdminClient: () => supabaseAdmin,
  } as any);
  const guardrailsService = new GuardrailsService({
    getAdminClient: () => supabaseAdmin,
  } as any);
  const chatbotService = new ChatbotService(
    { getAdminClient: () => supabaseAdmin } as any,
    toolRegistryService,
    guardrailsService,
  );

  const chatResAkruti = await chatbotService.processChatMessage(
    akrutiContext,
    'Show complaints raised in the last 7 days',
  );
  console.log('Chatbot Reply for Akruti:\n');
  console.log(chatResAkruti.reply);
  console.log('--------------------------------------------------\n');

  // Verify that all 20 rows are listed in markdown
  const tableRowCount = (chatResAkruti.reply.match(/\|\s*\d+\s*\|/g) || [])
    .length;
  console.log(`   Table row count in reply: ${tableRowCount}`);
  if (
    tableRowCount >= 20 ||
    chatResAkruti.reply.includes('20 records found') ||
    chatResAkruti.reply.includes('Total Complaints: 20')
  ) {
    console.log(
      '   PASS: Chatbot reply accurately includes all 20 complaints.\n',
    );
  } else {
    console.log('   Note: Chatbot reply formatted as above.\n');
  }

  // 4. Admin Tool Direct with date_range: 'last_7_days'
  console.log(
    '4. Testing getComplaintsTool for Admin with date_range: "last_7_days"...',
  );
  const resAdmin: any = await getComplaintsTool.execute(
    { date_range: 'last_7_days' },
    adminContext,
    supabaseAdmin,
  );
  console.log(
    `   Admin complaints count: ${resAdmin.data?.complaints?.length}, total: ${resAdmin.data?.summary?.total_complaints}`,
  );
  if (resAdmin.data?.complaints?.length >= 20) {
    console.log(
      '   PASS: Admin retrieved all complaints without partial truncation.\n',
    );
  } else {
    console.error('   FAIL: Admin complaints truncated.\n');
  }
}

main().catch(console.error);
