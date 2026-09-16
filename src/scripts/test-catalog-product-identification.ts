import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu;

function validateNoEmojis(testName: string, text: string) {
  if (EMOJI_REGEX.test(text)) {
    console.error(`[${testName}] FAILED: Emoji detected in response!`);
    throw new Error(`Emoji detected in ${testName}`);
  }
}

async function runCatalogProductIdentificationTests() {
  console.log('===========================================================');
  console.log('Master 28-Product Catalog & Multi-Item Requirement Tests');
  console.log('===========================================================\n');

  const { SupabaseService } =
    await import('../infrastructure/supabase/supabase.service');
  const { ConfigService } = await import('../config/config.service');
  const { ConfigService: NestConfigService } = await import('@nestjs/config');
  const { ChatbotService } = await import('../modules/chatbot/chatbot.service');
  const { ToolRegistryService } =
    await import('../modules/chatbot/tools/tool-registry.service');
  const { GuardrailsService } =
    await import('../modules/chatbot/guardrails/guardrails.service');

  const configService = new ConfigService(new NestConfigService());
  const supabaseService = new SupabaseService(configService);
  const toolRegistry = new ToolRegistryService(supabaseService);
  const guardrailsService = new GuardrailsService(supabaseService);
  const chatbotService = new ChatbotService(
    supabaseService,
    toolRegistry,
    guardrailsService,
  );

  const testCaller = {
    userId: 'test-catalog-rep-' + Date.now(),
    email: 'rep@enlightmetals.com',
    role: 'salesperson' as const,
    name: 'Sales Rep Test',
    phone: '919619226169',
  };

  const supabase = supabaseService.getClient();

  // -------------------------------------------------------------
  // TEST 1: The exact failing inquiry from user report
  // -------------------------------------------------------------
  console.log(
    '--- TEST 1: User Reported Multi-Item Inquiry (GP Sheet + MS Angle) ---',
  );
  const userMsg1 =
    'Inquiry requirement — GP Sheet 10000 kgs, MS Angle 50x50 15 MT. Deliver to Aurangabad. — Deccan Fabricators';
  console.log(`Input: "${userMsg1}"`);

  const response1 = await chatbotService.processChatMessage(
    testCaller,
    userMsg1,
  );
  console.log(`Response:\n${response1.reply}\n`);

  validateNoEmojis('TEST 1', response1.reply);

  // Verify response mentions both products
  const replyLower1 = response1.reply.toLowerCase();
  const hasGpSheetInReply =
    replyLower1.includes('gp sheet') ||
    replyLower1.includes('galvanized plain');
  const hasMsAngleInReply =
    replyLower1.includes('ms angle') || replyLower1.includes('angle');

  if (!hasGpSheetInReply) {
    throw new Error('TEST 1 FAILED: Response did not mention GP Sheet!');
  }
  if (!hasMsAngleInReply) {
    throw new Error('TEST 1 FAILED: Response did not mention MS Angle!');
  }
  console.log('✓ Response mentions both GP Sheet and MS Angle');

  // Extract deal / inquiry ID from response
  const inqMatch1 = response1.reply.match(
    /#?(?:DEAL|INQ)-([A-Fa-f0-9]{4,8})\b/i,
  );
  if (!inqMatch1) {
    throw new Error('TEST 1 FAILED: No Inquiry ID found in response!');
  }
  const inqCode1 = inqMatch1[1].toUpperCase();
  console.log(`✓ Found Inquiry ID: #${inqCode1}`);

  // Query database to verify both line items and HSN codes
  const { data: inqRows1 } = await supabase
    .from('inquiries')
    .select('*')
    .ilike('id', `%${inqCode1}%`)
    .limit(1);

  const inqRecord1 = inqRows1 && inqRows1.length > 0 ? inqRows1[0] : null;

  if (!inqRecord1) {
    // Try finding by deal code
    const { data: dealRows1 } = await supabase
      .from('deals')
      .select('*, deal_items(*)')
      .ilike('id', `%${inqCode1}%`)
      .limit(1);
    if (dealRows1 && dealRows1.length > 0) {
      console.log('✓ Found Deal in DB:', dealRows1[0].id);
      const items = dealRows1[0].deal_items || [];
      console.log(
        '  Deal Items in DB:',
        items.map((i: any) => ({
          sku: i.sku_text,
          dim: i.dimensions,
          qty: i.quantity,
          unit: i.unit,
          hsn: i.hsn_code,
        })),
      );
      if (items.length < 2) {
        throw new Error(
          `TEST 1 FAILED: Expected at least 2 items in deal, found ${items.length}`,
        );
      }
    }
  } else {
    console.log('✓ Found Inquiry in DB:', inqRecord1.id);
    const extraction = inqRecord1.ai_extraction_json || {};
    const lineItems = extraction.line_items || [];
    console.log(
      '  Extraction Line Items:',
      lineItems.map((li: any) => ({
        sku: li.sku_text,
        dim: li.dimensions,
        qty: li.quantity,
        unit: li.unit,
        hsn: li.hsn_code,
      })),
    );

    if (lineItems.length < 2) {
      throw new Error(
        `TEST 1 FAILED: Expected at least 2 line items in extraction, found ${lineItems.length}`,
      );
    }

    // Verify GP Sheet item
    const gpItem = lineItems.find(
      (li: any) =>
        (li.sku_text || '').toLowerCase().includes('gp sheet') ||
        (li.sku_text || '').toLowerCase().includes('galvanized plain'),
    );
    if (!gpItem) {
      throw new Error(
        'TEST 1 FAILED: GP Sheet missing from DB extraction line items!',
      );
    }
    console.log(
      '  ✓ GP Sheet line item found:',
      gpItem.sku_text,
      'Qty:',
      gpItem.quantity || gpItem.quantity_mt,
      'HSN:',
      gpItem.hsn_code,
    );

    // Verify MS Angle item
    const angleItem = lineItems.find((li: any) =>
      (li.sku_text || '').toLowerCase().includes('angle'),
    );
    if (!angleItem) {
      throw new Error(
        'TEST 1 FAILED: MS Angle missing from DB extraction line items!',
      );
    }
    console.log(
      '  ✓ MS Angle line item found:',
      angleItem.sku_text,
      'Qty:',
      angleItem.quantity || angleItem.quantity_mt,
      'HSN:',
      angleItem.hsn_code,
    );

    // Verify HSN codes
    if (gpItem.hsn_code !== '72104900') {
      console.warn(
        `  Notice: GP Sheet HSN is ${gpItem.hsn_code}, expected 72104900`,
      );
    } else {
      console.log('  ✓ GP Sheet HSN verified: 72104900');
    }

    if (
      angleItem.hsn_code !== '72162100' &&
      angleItem.hsn_code !== '72164000'
    ) {
      console.warn(
        `  Notice: MS Angle HSN is ${angleItem.hsn_code}, expected 72162100`,
      );
    } else {
      console.log(`  ✓ MS Angle HSN verified: ${angleItem.hsn_code}`);
    }
  }

  // -------------------------------------------------------------
  // TEST 2: Multi-Item Inquiry (HR Coil + Chequered Plate + MS Square Pipe)
  // -------------------------------------------------------------
  console.log(
    '\n--- TEST 2: Multi-Category Inquiry (HR Coil, Chequered Plate, MS Square Pipe) ---',
  );
  const userMsg2 =
    'New inquiry for Apex Steel: 25 MT HR Coil 2.5mm, 10 MT Chequered Plate 6mm, 5 MT MS Square Pipe 50x50x2mm. Deliver to Pune.';
  console.log(`Input: "${userMsg2}"`);

  const response2 = await chatbotService.processChatMessage(
    testCaller,
    userMsg2,
  );
  console.log(`Response:\n${response2.reply}\n`);

  validateNoEmojis('TEST 2', response2.reply);

  const replyLower2 = response2.reply.toLowerCase();
  if (!replyLower2.includes('hr coil')) {
    throw new Error('TEST 2 FAILED: Missing HR Coil in response!');
  }
  if (
    !replyLower2.includes('chequered') &&
    !replyLower2.includes('checkered')
  ) {
    throw new Error('TEST 2 FAILED: Missing Chequered Plate in response!');
  }
  if (!replyLower2.includes('square pipe') && !replyLower2.includes('pipe')) {
    throw new Error('TEST 2 FAILED: Missing MS Square Pipe in response!');
  }
  console.log(
    '✓ Response mentions HR Coil, Chequered Plate, and MS Square Pipe',
  );

  // -------------------------------------------------------------
  // TEST 3: Value Added Products (TMT Bar, GI Earthing Strip, Profile Roofing Sheet)
  // -------------------------------------------------------------
  console.log(
    '\n--- TEST 3: Value-Added Products Inquiry (TMT Bar, GI Earthing Strip, Profile Roofing Sheet) ---',
  );
  const userMsg3 =
    'Inquiry from Supreme Infra: 20 MT TMT Bar 12mm, 5 MT GI Earthing Strip 50x6mm, 15 MT Profile Roofing Sheet 0.5mm. Deliver to Nagpur.';
  console.log(`Input: "${userMsg3}"`);

  const response3 = await chatbotService.processChatMessage(
    testCaller,
    userMsg3,
  );
  console.log(`Response:\n${response3.reply}\n`);

  validateNoEmojis('TEST 3', response3.reply);

  const replyLower3 = response3.reply.toLowerCase();
  if (!replyLower3.includes('tmt')) {
    throw new Error('TEST 3 FAILED: Missing TMT Bar in response!');
  }
  if (
    !replyLower3.includes('earthing') &&
    !replyLower3.includes('gi earthing')
  ) {
    throw new Error('TEST 3 FAILED: Missing GI Earthing Strip in response!');
  }
  if (
    !replyLower3.includes('roofing') &&
    !replyLower3.includes('profile roofing') &&
    !replyLower3.includes('color coated') &&
    !replyLower3.includes('colour coated')
  ) {
    throw new Error(
      'TEST 3 FAILED: Missing Profile Roofing / Color Coated Sheet in response!',
    );
  }
  console.log(
    '✓ Response mentions TMT Bar, GI Earthing Strip, and Color Coated / Roofing Sheet',
  );

  console.log('\n===========================================================');
  console.log('ALL CATALOG PRODUCT IDENTIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('===========================================================');
}

runCatalogProductIdentificationTests().catch((err) => {
  console.error('Test run failed with error:', err);
  process.exit(1);
});
