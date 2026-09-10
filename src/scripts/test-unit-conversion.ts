import { convertLineItemToMt as convertBackendTs } from '../modules/pricing/pricing.engine';
import { updateDealStageTool } from '../modules/chatbot/tools/update_deal_stage.tool';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const {
  convertLineItemToMt: convertBackendJs,
  calculatePricingSummary,
} = require('../utils/pricingEngine');

async function runTests() {
  console.log('=== TEST SUITE: AI ASSISTANT UNIT CONVERSION ENGINE ===\n');

  let passed = 0;
  let failed = 0;

  function assertEqual(
    actual: any,
    expected: any,
    label: string,
    tolerance: number = 0.01,
  ) {
    if (typeof expected === 'number' && typeof actual === 'number') {
      if (Math.abs(actual - expected) <= tolerance) {
        console.log(`PASS: ${label} -> got ${actual}`);
        passed++;
      } else {
        console.error(`FAIL: ${label} -> expected ${expected}, got ${actual}`);
        failed++;
      }
    } else if (actual === expected) {
      console.log(`PASS: ${label} -> got ${actual}`);
      passed++;
    } else {
      console.error(`FAIL: ${label} -> expected ${expected}, got ${actual}`);
      failed++;
    }
  }

  // 1. Test backend TypeScript engine formula
  console.log('--- 1. Backend TS Pricing Engine (pricing.engine.ts) ---');
  const res1Ts = convertBackendTs({
    sku_text: 'MS Sheet 5MM THK (1250 x 2500)',
    dimensions: '1250 x 2500',
    quantity: 150,
    unit: 'Nos',
  });
  // 1.25m * 2.5m * 5mm * 8 * 150 / 1000 = 18.75 MT
  assertEqual(res1Ts.mt, 18.75, '150 Nos 5mm 1250x2500 -> 18.75 MT (TS)');

  const res2Ts = convertBackendTs({
    sku_text: 'MS Sheet 6MM THK (1250 x 2500)',
    dimensions: '1250 x 2500',
    quantity: 100,
    unit: 'Pcs',
  });
  // 1.25m * 2.5m * 6mm * 8 * 100 / 1000 = 15.00 MT
  assertEqual(res2Ts.mt, 15.0, '100 Pcs 6mm 1250x2500 -> 15.00 MT (TS)');

  const res3Ts = convertBackendTs({
    sku_text: 'CR Sheet 1.00MM (1000 x 2000)',
    dimensions: '1000 x 2000',
    quantity: 220,
    unit: 'Sheets',
  });
  // 1.0m * 2.0m * 1.0mm * 8 * 220 / 1000 = 3.52 MT
  assertEqual(res3Ts.mt, 3.52, '220 Sheets 1.0mm 1000x2000 -> 3.52 MT (TS)');

  const res4Ts = convertBackendTs({
    sku_text: 'HR Coil',
    quantity: 5000,
    unit: 'KG',
  });
  assertEqual(res4Ts.mt, 5.0, '5000 KG -> 5.0 MT (TS)');

  const res5Ts = convertBackendTs({
    sku_text: 'MS Plate 12mm',
    dimensions: '5ft x 20ft',
    quantity: 10,
    unit: 'Plates',
  });
  // 1.524m * 6.096m * 12mm * 8 * 10 / 1000 = 8.91869 MT
  assertEqual(res5Ts.mt, 8.92, '10 Plates 12mm 5ft x 20ft -> 8.92 MT (TS)');

  // 2. Test backend CommonJS engine formula parity
  console.log('\n--- 2. Backend JS Pricing Engine (pricingEngine.js) ---');
  const res1Js = convertBackendJs({
    sku_text: 'MS Sheet 5MM THK (1250 x 2500)',
    dimensions: '1250 x 2500',
    quantity: 150,
    unit: 'Nos',
  });
  assertEqual(res1Js.mt, 18.75, '150 Nos 5mm 1250x2500 -> 18.75 MT (JS)');

  const res2Js = convertBackendJs({
    sku_text: 'MS Sheet 6MM THK (1250 x 2500)',
    dimensions: '1250 x 2500',
    quantity: 100,
    unit: 'Pcs',
  });
  assertEqual(res2Js.mt, 15.0, '100 Pcs 6mm 1250x2500 -> 15.00 MT (JS)');

  const res3Js = convertBackendJs({
    sku_text: 'CR Sheet 1.00MM (1000 x 2000)',
    dimensions: '1000 x 2000',
    quantity: 220,
    unit: 'Sheets',
  });
  assertEqual(res3Js.mt, 3.52, '220 Sheets 1.0mm 1000x2000 -> 3.52 MT (JS)');

  const summaryRes = calculatePricingSummary({
    line_items: [
      {
        sku_text: 'MS Sheet 5mm',
        dimensions: '1250x2500',
        quantity: 150,
        unit: 'Nos',
      },
      {
        sku_text: 'HR Coil',
        quantity: 12,
        unit: 'MT',
      },
    ],
  });
  assertEqual(
    summaryRes.totalQuantityMt,
    30.75,
    'Multi-item summary total MT = 18.75 + 12 = 30.75 MT',
  );

  // 3. Test End-to-End Inquiry Logging via AI Assistant update_deal_stage
  console.log('\n--- 3. End-to-End AI Assistant Inquiry Logging Flow ---');
  const callerContext = {
    userId: '919619226169',
    email: 'sales@enlightmetals.com',
    role: 'salesperson' as const,
    phone: '919619226169',
    name: 'Rishabh Makwana',
  };

  const uniqueSuffix = Date.now().toString().slice(-4);
  const testCustomer = `Precision Engineering ${uniqueSuffix}`;
  const inquiryMessage = `Inquiry from ${testCustomer}: 150 Nos MS Sheet 5mm 1250x2500 @ 54000/MT, delivery to Chakan Pune, payment 30 days credit`;

  console.log(
    `Executing update_deal_stage tool with message:\n"${inquiryMessage}"`,
  );
  const toolResult = await updateDealStageTool.execute(
    { text: inquiryMessage },
    callerContext,
    null as any,
  );
  console.log(`Tool Result Output:\n${toolResult.data}\n`);

  const hasTonnageDisplay =
    toolResult.data.includes('18.75 MT') ||
    toolResult.data.includes('150 Nos (18.75 MT)');
  assertEqual(
    hasTonnageDisplay,
    true,
    'AI Assistant confirmation displays 18.75 MT tonnage',
  );

  // Verify Supabase Database records
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const inqCodeMatch = toolResult.data.match(
      /#?(?:INQ|DEAL)-([A-Za-z0-9]+)/i,
    );
    const targetCode = inqCodeMatch ? inqCodeMatch[1] : '';

    let inqRecord = null;
    if (targetCode) {
      const { data: byCode } = await supabase
        .from('inquiries')
        .select('*')
        .or(`id.ilike.%${targetCode}%,id.eq.${targetCode}`)
        .limit(1);
      if (byCode && byCode.length > 0) inqRecord = byCode[0];
    }
    if (!inqRecord) {
      const { data: byCustomer } = await supabase
        .from('inquiries')
        .select('*')
        .ilike('sender_name', '%Precision Engineering%')
        .order('created_at', { ascending: false })
        .limit(1);
      if (byCustomer && byCustomer.length > 0) inqRecord = byCustomer[0];
    }

    if (inqRecord) {
      const aiJson = inqRecord.ai_extraction_json || {};
      console.log(
        'Inquiry ai_extraction_json:',
        JSON.stringify(aiJson, null, 2),
      );

      assertEqual(
        aiJson.quantityTons,
        18.75,
        'Inquiry ai_extraction_json.quantityTons is 18.75',
      );
      if (aiJson.line_items && aiJson.line_items.length > 0) {
        assertEqual(
          aiJson.line_items[0].quantity_mt,
          18.75,
          'Inquiry line item quantity_mt is 18.75',
        );
      }

      // Check deal_items table
      const { data: deals } = await supabase
        .from('deals')
        .select('*, deal_items(*)')
        .eq('inquiry_id', inqRecord.id)
        .limit(1);

      if (
        deals &&
        deals.length > 0 &&
        deals[0].deal_items &&
        deals[0].deal_items.length > 0
      ) {
        const item = deals[0].deal_items[0];
        console.log('Persisted deal_item:', item);
        assertEqual(
          Number(item.quantity),
          18.75,
          'deal_items table quantity is 18.75 MT',
        );
        assertEqual(item.unit, 'MT', 'deal_items table unit is MT');
      }
    } else {
      console.warn(
        'Could not find inquiry in Supabase table for customer Precision Engineering',
      );
    }
  }

  console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
