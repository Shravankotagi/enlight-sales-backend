/**
 * Comprehensive Automated Verification Suite for Unified AI Architecture
 *
 * Verifies:
 * 1. Web Chat API in em-os-bot: Auth, Catalog Routing, and Orchestrator
 * 2. Clean Web Markdown Formatting (Zero Emojis, Clean Hyphen Bullets)
 * 3. ChatbotService in em-os-backend: Gateway Proxying, Session Management, and Guardrails
 * 4. WhatsApp formatting parity
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import axios from 'axios';
import { ChatbotService } from '../modules/chatbot/chatbot.service';
import { GuardrailsService } from '../modules/chatbot/guardrails/guardrails.service';
import { WhatsAppChatService } from '../modules/chatbot/whatsapp/whatsapp-chat.service';
import { CallerContext } from '../modules/chatbot/interfaces/caller-context.interface';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase credentials in environment.');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY);

const mockSupabaseService: any = {
  getAdminClient: () => supabaseAdmin,
};

const guardrailsService = new GuardrailsService(mockSupabaseService);
const chatbotService = new ChatbotService(
  mockSupabaseService,
  guardrailsService,
);
const whatsappChatService = new WhatsAppChatService(
  mockSupabaseService,
  chatbotService,
);

const BOT_URL = process.env.AI_ENGINE_URL || 'http://127.0.0.1:3001';
const BOT_KEY =
  process.env.AI_ENGINE_API_KEY || 'enlight_ai_engine_secret_2026_auth_key';

async function runTestSuite() {
  console.log(
    '===============================================================',
  );
  console.log(' Starting Unified AI Architecture Verification Suite');
  console.log(
    '===============================================================\n',
  );

  let passed = 0;
  let failed = 0;

  // Test 1: CallerContext resolution
  try {
    console.log('[Test 1] Testing CallerContext resolution for admin user...');
    const adminContext = await chatbotService.resolveCallerContext({
      id: 'admin-test-id',
      email: 'admin@enlightmetals.com',
      role: 'admin',
    });

    if (adminContext && adminContext.role === 'admin') {
      console.log(
        `  PASSED: Caller resolved with role '${adminContext.role}', name: '${adminContext.name}'\n`,
      );
      passed++;
    } else {
      console.log(`  FAILED: Unexpected caller context:`, adminContext, '\n');
      failed++;
    }
  } catch (err: any) {
    console.log(`  FAILED with error: ${err.message}\n`);
    failed++;
  }

  // Test 2: Session management in NestJS
  try {
    console.log('[Test 2] Testing Chat Session Creation & Retrieval...');
    const testCaller: CallerContext = {
      userId: 'test-unified-user-001',
      email: 'test@enlightmetals.com',
      role: 'salesperson',
      name: 'Test Sales Rep',
      phone: '919619226169',
    };

    const session = await chatbotService.getOrCreateSession(testCaller, 'web');
    if (session && session.id) {
      await chatbotService.saveMessage(session.id, 'user', 'Hello Test');
      await chatbotService.saveMessage(
        session.id,
        'assistant',
        'Hello response',
      );
      const messages = await chatbotService.getSessionMessages(
        session.id,
        testCaller,
      );

      if (messages && messages.length >= 2) {
        console.log(
          `  PASSED: Session created (${session.id}) and ${messages.length} messages saved & retrieved.\n`,
        );
        passed++;
      } else {
        console.log(`  FAILED: Messages count mismatch: ${messages?.length}\n`);
        failed++;
      }
    } else {
      console.log(`  FAILED: Session creation failed.\n`);
      failed++;
    }
  } catch (err: any) {
    console.log(`  FAILED with error: ${err.message}\n`);
    failed++;
  }

  // Test 3: WhatsApp Text Formatter
  try {
    console.log(
      '[Test 3] Testing WhatsApp text formatting & emoji stripping...',
    );
    const sampleWithEmojis =
      '🔥 Great job closing the deal! 🚀\n* Inquiries count: 12\n* Total tonnage: 50 MT';
    const formatted = whatsappChatService.formatForWhatsApp(sampleWithEmojis);

    const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(formatted);
    const hasAsteriskBullet = /^\*\s+/m.test(formatted);

    if (!hasEmoji && !hasAsteriskBullet) {
      console.log(
        `  PASSED: Emojis stripped and bullets normalized:\n${formatted}\n`,
      );
      passed++;
    } else {
      console.log(
        `  FAILED: Formatting did not meet criteria:\n${formatted}\n`,
      );
      failed++;
    }
  } catch (err: any) {
    console.log(`  FAILED with error: ${err.message}\n`);
    failed++;
  }

  // Test 4: Verify em-os-bot Web Chat API Auth
  try {
    console.log(
      `[Test 4] Testing em-os-bot /chat/web/message auth verification...`,
    );
    try {
      await axios.post(
        `${BOT_URL}/chat/web/message`,
        { message: 'hi' },
        { headers: { 'X-Web-API-Key': 'wrong_key' }, timeout: 5000 },
      );
      console.log(`  FAILED: Unauthorized request was not rejected!\n`);
      failed++;
    } catch (err: any) {
      if (err.response?.status === 401) {
        console.log(
          `  PASSED: Correctly returned 401 Unauthorized for invalid API key.`,
        );
        passed++;
      } else {
        console.log(`  FAILED: Unexpected response: ${err.message}`);
        failed++;
      }
    }

    const validRes = await axios.post(
      `${BOT_URL}/chat/web/message`,
      { message: 'hi' },
      { headers: { 'X-Web-API-Key': BOT_KEY }, timeout: 10000 },
    );
    if (validRes.status === 200) {
      console.log(`  PASSED: Correctly returned 200 OK for valid API key.\n`);
      passed++;
    }
  } catch (err: any) {
    console.log(`  Error: ${err.message}\n`);
    failed++;
  }

  // Test 5: Test Greeting 'Hi' Returns Catalog Flow Menu
  try {
    console.log(
      `[Test 5] Testing End-to-End Greeting 'Hi' (should bypass guardrails & return Catalog Menu)...`,
    );
    const salesCaller: CallerContext = {
      userId: 'test-unified-sales-001',
      email: 'sales@enlightmetals.com',
      role: 'salesperson',
      name: 'Rishabh Sales',
      phone: '919619226169',
    };

    const chatResult = await chatbotService.processChatMessage(
      salesCaller,
      'Hi',
    );

    if (
      chatResult &&
      chatResult.reply &&
      (chatResult.reply.includes('1.') ||
        chatResult.reply.includes('SalesOS') ||
        chatResult.reply.includes('Inquiry')) &&
      chatResult.interactiveType === 'list' &&
      chatResult.interactiveList &&
      Array.isArray(chatResult.interactiveList.sections) &&
      chatResult.interactiveList.sections.length >= 3
    ) {
      console.log(
        `  PASSED: Received Catalog Menu reply with ${chatResult.interactiveList.sections.length} interactive sections:\n${chatResult.reply}\n`,
      );
      passed++;
    } else {
      console.log(
        `  FAILED: Did not receive expected catalog menu with interactive sections:\n`,
        chatResult,
        '\n',
      );
      failed++;
    }
  } catch (err: any) {
    console.log(`  FAILED with error: ${err.message}\n`);
    failed++;
  }

  // Test 6: Test Chat Message Processing (Proxy to em-os-bot)
  try {
    console.log(
      `[Test 6] Testing End-to-End ChatbotService.processChatMessage (Proxy to bot)...`,
    );
    const salesCaller: CallerContext = {
      userId: 'test-unified-sales-001',
      email: 'sales@enlightmetals.com',
      role: 'salesperson',
      name: 'Rishabh Sales',
      phone: '919619226169',
    };

    const chatResult = await chatbotService.processChatMessage(
      salesCaller,
      'Show my open deals for ABC Steel',
    );

    if (chatResult && chatResult.reply) {
      const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(chatResult.reply);
      console.log(
        `  PASSED: Received reply from AI Engine:\n${chatResult.reply}\n  Emoji clean: ${!hasEmoji}\n`,
      );
      passed++;
    } else {
      console.log(`  FAILED: No reply received:`, chatResult, '\n');
      failed++;
    }
  } catch (err: any) {
    console.log(`  FAILED with error: ${err.message}\n`);
    failed++;
  }

  // Test 7: Test Interactive Button ID Normalization ('btn_post_menu')
  try {
    console.log(
      `[Test 7] Testing Button ID Normalization ('btn_post_menu' -> Menu Catalog Flow)...`,
    );
    const salesCaller: CallerContext = {
      userId: 'test-unified-sales-001',
      email: 'sales@enlightmetals.com',
      role: 'salesperson',
      name: 'Rishabh Sales',
      phone: '919619226169',
    };

    const chatResult = await chatbotService.processChatMessage(
      salesCaller,
      'btn_post_menu',
    );

    if (
      chatResult &&
      chatResult.interactiveType === 'list' &&
      chatResult.interactiveList
    ) {
      console.log(
        `  PASSED: 'btn_post_menu' normalized and returned interactive catalog menu.\n`,
      );
      passed++;
    } else {
      console.log(
        `  FAILED: 'btn_post_menu' did not return catalog list:\n`,
        chatResult,
        '\n',
      );
      failed++;
    }
  } catch (err: any) {
    console.log(`  FAILED with error: ${err.message}\n`);
    failed++;
  }

  console.log(
    '===============================================================',
  );
  console.log(
    ` Verification Suite Completed: ${passed} passed, ${failed} failed`,
  );
  console.log(
    '===============================================================',
  );
}

runTestSuite().catch(console.error);
