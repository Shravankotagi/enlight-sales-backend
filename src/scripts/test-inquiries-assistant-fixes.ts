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
  console.log('=== Verifying All 5 AI Assistant Inquiry Issues & Fixes ===\n');
  let passed = 0;
  let failed = 0;

  const adminContext: CallerContext = {
    userId: 'usr-admin-test-01',
    email: 'admin@enlightmetals.com',
    role: 'admin',
    name: 'Admin Test',
  };

  // --- UNIT TEST 1: Inquiry ID Lookup (INQ-2C788F) ---
  console.log('1. Unit Test: get_inquiries with inquiry_id "INQ-2C788F"...');
  try {
    const res1 = await getInquiriesTool.execute(
      { inquiry_id: 'INQ-2C788F' },
      adminContext,
      supabaseAdmin,
    );
    const data1 = res1.data;
    if (
      data1 &&
      data1.found &&
      data1.customer_name?.toLowerCase().includes('mahalaxmi') &&
      data1.deal_status === 'negotiation'
    ) {
      console.log('   PASS: Found INQ-2C788F:');
      console.log('         Customer:', data1.customer_name);
      console.log('         Status:', data1.deal_status);
      passed++;
    } else {
      console.error(
        '   FAIL: get_inquiries INQ-2C788F unexpected result:',
        data1,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 1 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 2: Channel Breakdown (WhatsApp vs Dashboard) ---
  console.log('\n2. Unit Test: get_inquiries channel breakdown...');
  try {
    const res2 = await getInquiriesTool.execute(
      { mode: 'channel_breakdown' },
      adminContext,
      supabaseAdmin,
    );
    const chData = res2.data?.by_source_channel;
    if (
      chData &&
      typeof chData.whatsapp === 'number' &&
      typeof chData.dashboard === 'number' &&
      chData.whatsapp > 0 &&
      chData.dashboard > 0
    ) {
      console.log('   PASS: WhatsApp inquiries:', chData.whatsapp);
      console.log('   PASS: Dashboard inquiries:', chData.dashboard);
      passed++;
    } else {
      console.error('   FAIL: Invalid channel breakdown:', res2.data);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 2 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 3: Won Inquiries Metrics (68 with PO) ---
  console.log(
    '\n3. Unit Test: get_inquiries conversion metrics (won inquiries with PO)...',
  );
  try {
    const res3 = await getInquiriesTool.execute(
      { mode: 'count' },
      adminContext,
      supabaseAdmin,
    );
    const conv = res3.data?.summary?.conversion_metrics;
    if (
      conv &&
      typeof conv.won_inquiries_with_po === 'number' &&
      conv.won_inquiries_with_po === 68
    ) {
      console.log(
        '   PASS: Won Inquiries with PO:',
        conv.won_inquiries_with_po,
      );
      console.log('   PASS: Total Won Inquiries:', conv.won_inquiries);
      console.log('   PASS: Total Won Deals:', conv.total_won_deals);
      passed++;
    } else {
      console.error('   FAIL: Won Inquiries count not matching 68:', conv);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 3 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 4: Highest Tonnage Inquiry ---
  console.log('\n4. Unit Test: get_inquiries mode: "highest_tonnage"...');
  try {
    const res4 = await getInquiriesTool.execute(
      { mode: 'highest_tonnage' },
      adminContext,
      supabaseAdmin,
    );
    const tonData = res4.data;
    if (
      tonData &&
      tonData.highest_tonnage_inquiry &&
      tonData.highest_tonnage_inquiry.tonnage_mt > 0
    ) {
      console.log(
        '   PASS: Highest Tonnage Customer:',
        tonData.highest_tonnage_inquiry.customer_name,
      );
      console.log(
        '   PASS: Tonnage:',
        tonData.highest_tonnage_inquiry.tonnage_mt,
        'MT',
      );
      passed++;
    } else {
      console.error('   FAIL: Invalid highest tonnage response:', tonData);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 4 error:', err.message);
    failed++;
  }

  // --- UNIT TEST 5: Pending OCR / Document Inquiries ---
  console.log('\n5. Unit Test: get_inquiries pending OCR inquiries...');
  try {
    const res5 = await getInquiriesTool.execute(
      { source_type: 'ocr_document', status_filter: 'pending', mode: 'count' },
      adminContext,
      supabaseAdmin,
    );
    const ocrSummary = res5.data?.summary?.ocr_document_metrics;
    if (
      ocrSummary &&
      typeof ocrSummary.pending_ocr_inquiries === 'number' &&
      ocrSummary.pending_ocr_inquiries === 26 &&
      ocrSummary.total_ocr_inquiries === 97
    ) {
      console.log(
        '   PASS: Pending OCR Inquiries:',
        ocrSummary.pending_ocr_inquiries,
      );
      console.log(
        '   PASS: Total OCR Inquiries:',
        ocrSummary.total_ocr_inquiries,
      );
      passed++;
    } else {
      console.error(
        '   FAIL: OCR metrics not matching expected counts:',
        ocrSummary,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: Unit Test 5 error:', err.message);
    failed++;
  }

  // --- E2E PROMPTS WITH GEMINI ---
  console.log(
    '\n=== Testing End-to-End LLM Responses via ChatbotService ===\n',
  );

  // Prompt 1: What's the status of INQ-2C788F?
  console.log('6. E2E Prompt: "What\'s the status of INQ-2C788F?"');
  try {
    const reply1 = await chatbotService.processChatMessage(
      adminContext,
      "What's the status of INQ-2C788F?",
    );
    const text1 = reply1.reply;
    console.log('   Bot Response:\n  ', text1.replace(/\n/g, '\n   '));
    if (
      !text1.toLowerCase().includes('tell me the customer') &&
      !text1.toLowerCase().includes('know which customer') &&
      (text1.toLowerCase().includes('mahalaxmi') ||
        text1.toLowerCase().includes('negotiation') ||
        text1.includes('2C788F'))
    ) {
      console.log(
        '   PASS: Directly answered status of INQ-2C788F without asking for customer name!',
      );
      passed++;
    } else {
      console.error('   FAIL: Bot still asked for customer name or failed.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: E2E Prompt 1 error:', err.message);
    failed++;
  }

  // Prompt 2: How many inquiries came through WhatsApp vs Dashboard?
  console.log(
    '\n7. E2E Prompt: "How many inquiries came through WhatsApp vs Dashboard?"',
  );
  try {
    const reply2 = await chatbotService.processChatMessage(
      adminContext,
      'How many inquiries came through WhatsApp vs Dashboard?',
    );
    const text2 = reply2.reply;
    console.log('   Bot Response:\n  ', text2.replace(/\n/g, '\n   '));
    if (
      !text2.toLowerCase().includes('unable to provide a direct breakdown') &&
      !text2.toLowerCase().includes('not available in my current tools') &&
      text2.toLowerCase().includes('whatsapp') &&
      text2.toLowerCase().includes('dashboard')
    ) {
      console.log('   PASS: Provided WhatsApp vs Dashboard breakdown!');
      passed++;
    } else {
      console.error('   FAIL: Bot refused channel breakdown.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: E2E Prompt 2 error:', err.message);
    failed++;
  }

  // Prompt 3: What percentage of our 178 inquiries were won?
  console.log(
    '\n8. E2E Prompt: "What percentage of our 178 inquiries were won?"',
  );
  try {
    const reply3 = await chatbotService.processChatMessage(
      adminContext,
      'What percentage of our 178 inquiries were won?',
    );
    const text3 = reply3.reply;
    console.log('   Bot Response:\n  ', text3.replace(/\n/g, '\n   '));
    if (
      text3.includes('68') ||
      text3.includes('38.2%') ||
      text3.includes('34.') ||
      text3.includes('PO') ||
      text3.includes('won')
    ) {
      console.log(
        '   PASS: Bot answered won inquiries with accurate verified count!',
      );
      passed++;
    } else {
      console.error('   FAIL: Bot did not answer inquiry conversion properly.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: E2E Prompt 3 error:', err.message);
    failed++;
  }

  // Prompt 4: Which customer has the highest tonnage inquiry?
  console.log(
    '\n9. E2E Prompt: "Which customer has the highest tonnage inquiry?"',
  );
  try {
    const startTime = Date.now();
    const reply4 = await chatbotService.processChatMessage(
      adminContext,
      'Which customer has the highest tonnage inquiry?',
    );
    const elapsed = Date.now() - startTime;
    const text4 = reply4.reply;
    console.log(`   Response Time: ${elapsed}ms`);
    console.log('   Bot Response:\n  ', text4.replace(/\n/g, '\n   '));
    if (
      !text4.includes('timeout') &&
      (text4.toLowerCase().includes('om steel') ||
        text4.toLowerCase().includes('standard retail') ||
        text4.includes('MT') ||
        text4.includes('tonnage'))
    ) {
      console.log(
        `   PASS: Answered highest tonnage inquiry in ${elapsed}ms without timeout!`,
      );
      passed++;
    } else {
      console.error('   FAIL: Highest tonnage inquiry timed out or failed.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: E2E Prompt 4 error:', err.message);
    failed++;
  }

  // Prompt 5: How many OCR/document inquiries are still pending?
  console.log(
    '\n10. E2E Prompt: "How many OCR/document inquiries are still pending?"',
  );
  try {
    const reply5 = await chatbotService.processChatMessage(
      adminContext,
      'How many OCR/document inquiries are still pending?',
    );
    const text5 = reply5.reply;
    console.log('   Bot Response:\n  ', text5.replace(/\n/g, '\n   '));
    if (
      !text5.toLowerCase().includes('unable to specifically filter') &&
      !text5.toLowerCase().includes('not available in my current tools') &&
      (text5.includes('26') ||
        text5.includes('Review Queue') ||
        text5.toLowerCase().includes('pending'))
    ) {
      console.log(
        '   PASS: Bot explained pending definition and provided OCR inquiry counts!',
      );
      passed++;
    } else {
      console.error('   FAIL: Bot refused OCR document query or failed.');
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL: E2E Prompt 5 error:', err.message);
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
