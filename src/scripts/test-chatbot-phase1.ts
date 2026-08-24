import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function runPhase1Tests() {
  console.log('=== Phase 1 Exit Criteria Verification Test ===\n');

  // Test 1: Unauthenticated Fail-Closed Check
  console.log('Test 1: Unauthenticated Request Check (Fail-Closed)...');
  try {
    const { ChatbotService } = await import(
      '../modules/chatbot/chatbot.service'
    );
    // Mock service instance for testing unit methods
    const mockSupabase: any = {
      getAdminClient: () => ({
        from: () => ({
          select: () => ({
            or: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }),
    };

    const service = new ChatbotService(mockSupabase, {} as any, {} as any);

    try {
      await service.resolveCallerContext(null);
      console.error(' FAIL: Null user did not throw UnauthorizedException');
      process.exit(1);
    } catch (err: any) {
      if (
        err.name === 'UnauthorizedException' ||
        err.status === 401 ||
        err.message.includes('Invalid or missing')
      ) {
        console.log(
          '   PASS: Unauthenticated request rejected with UnauthorizedException (401)',
        );
      } else {
        throw err;
      }
    }
  } catch (err: any) {
    console.error(' Test 1 Error:', err.message);
    process.exit(1);
  }

  // Test 2: Live Chatbot Service Processing & Turn Persistence Test
  console.log('\nTest 2: Live Chatbot Service & Gemini Connectivity Test...');
  try {
    const { SupabaseService } = await import(
      '../infrastructure/supabase/supabase.service'
    );
    const { ConfigService } = await import('../config/config.service');
    const { ConfigService: NestConfigService } = await import('@nestjs/config');
    const { ChatbotService } = await import(
      '../modules/chatbot/chatbot.service'
    );
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

    // Mock caller context for testing
    const mockCaller = {
      userId: 'test-phase1-user-' + Date.now(),
      email: 'test-pilot@enlightmetals.com',
      role: 'salesperson' as const,
      name: 'Pilot Sales Representative',
    };

    console.log(`  Sending test message for user ${mockCaller.email}...`);
    const result = await chatbotService.processChatMessage(
      mockCaller,
      'Hello Assistant! Can you confirm you are online for Phase 1 testing?',
    );

    console.log(`   PASS: Session Created: ${result.sessionId}`);
    console.log(`   PASS: Assistant Reply Received: "${result.reply.trim()}"`);

    // Verify session persistence in chat_messages
    console.log('\nTest 3: Session Persistence Check Across Reloads...');
    const history = await chatbotService.getSessionMessages(
      result.sessionId,
      mockCaller.userId,
    );
    console.log(
      `  Retrieved ${history.length} persisted message turns from database.`,
    );

    if (history.length >= 2) {
      console.log('  User message in DB:', history[0].content);
      console.log(
        '  Assistant reply in DB:',
        history[1].content.slice(0, 80) + '...',
      );
      console.log(
        '   PASS: Conversation turns successfully persisted to chat_messages table.',
      );
    } else {
      console.error(' FAIL: Message history count is less than 2');
      process.exit(1);
    }
  } catch (err: any) {
    console.error(' Phase 1 Test Error:', err.message || err);
    process.exit(1);
  }

  console.log('\n ALL PHASE 1 EXIT CRITERIA PASSED SUCCESSFULLY!');
}

runPhase1Tests();
