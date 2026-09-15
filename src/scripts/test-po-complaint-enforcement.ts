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

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const { processComplaintMessage } = require('../agents/complaintAgent');

async function runEnforcementTests() {
  console.log('=== Testing AI Assistant PO Orders Module Enforcement ===\n');
  let passed = 0;
  let failed = 0;
  const testSenderPhone = '919999999999';

  // --- TEST 1: Non-existent PO string should be REJECTED ---
  console.log('Test 1: Non-existent PO string should be REJECTED...');
  try {
    const countBefore = await getComplaintCount('Delta Structural Steel');
    const res1 = await processComplaintMessage(
      'Log a complaint for Delta Structural Steel on PO-NONEXISTENT-999: surface rust on 10 MT plates',
      testSenderPhone,
    );
    const countAfter = await getComplaintCount('Delta Structural Steel');

    if (
      res1.includes('❌ *Cannot Log Complaint') &&
      countAfter === countBefore
    ) {
      console.log(
        '   PASS: Non-existent PO was rejected without creating complaint row.',
      );
      console.log('   Snippet:', res1.split('\n')[0]);
      passed++;
    } else {
      console.error(
        '   FAIL: Non-existent PO was not properly rejected:',
        res1,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL with error:', err.message);
    failed++;
  }

  // --- TEST 2: Inquiry ID in non-won stage should be REJECTED ---
  console.log(
    '\nTest 2: Inquiry ID in non-won stage (e.g. qualified/quoted) should be REJECTED...',
  );
  try {
    // Find a non-won deal
    const { data: nonWonDeals } = await supabase
      .from('deals')
      .select('id, stage, customer_name')
      .neq('stage', 'won')
      .limit(1);

    if (nonWonDeals && nonWonDeals.length > 0) {
      const nonWon = nonWonDeals[0];
      const shortCode = `#INQ-${nonWon.id.substring(0, 6).toUpperCase()}`;
      const countBefore = await getComplaintCount(nonWon.customer_name);

      const res2 = await processComplaintMessage(
        `Log a complaint for ${nonWon.customer_name} on ${shortCode}: wrong specifications delivered`,
        testSenderPhone,
      );
      const countAfter = await getComplaintCount(nonWon.customer_name);

      if (
        res2.includes(
          '❌ *Cannot Log Complaint - Not an Order in Orders Module*',
        ) &&
        res2.includes(nonWon.stage.toUpperCase()) &&
        countAfter === countBefore
      ) {
        console.log(
          `   PASS: Non-won inquiry (${shortCode}, stage: ${nonWon.stage}) was correctly blocked.`,
        );
        console.log('   Snippet:', res2.split('\n')[0]);
        passed++;
      } else {
        console.error(
          '   FAIL: Non-won inquiry was not blocked as expected:',
          res2,
        );
        failed++;
      }
    } else {
      console.log('   SKIP: No non-won deals found to test.');
    }
  } catch (err: any) {
    console.error('   FAIL with error:', err.message);
    failed++;
  }

  // --- TEST 3: Customer with 0 won orders should be REJECTED ---
  console.log(
    '\nTest 3: Customer with 0 won orders in Orders module should be REJECTED...',
  );
  try {
    const zeroOrderCustomer = 'Acme Zero Order Industries ' + Date.now();
    const res3 = await processComplaintMessage(
      `Quality complaint for ${zeroOrderCustomer}: 10 MT HR Coil cracked`,
      testSenderPhone,
    );
    const countAfter = await getComplaintCount(zeroOrderCustomer);

    if (
      res3.includes(
        '❌ *Cannot Log Complaint - No Confirmed Orders in Orders Module*',
      ) &&
      countAfter === 0
    ) {
      console.log(
        '   PASS: Customer with 0 won orders was blocked without creating complaint.',
      );
      console.log('   Snippet:', res3.split('\n')[0]);
      passed++;
    } else {
      console.error(
        '   FAIL: Customer with 0 won orders was not blocked:',
        res3,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL with error:', err.message);
    failed++;
  }

  // --- TEST 4: Won order with explicit PO should be ACCEPTED ---
  console.log(
    '\nTest 4: Won order with explicit PO in Orders module should be ACCEPTED...',
  );
  let testWonDeal1: any = null;
  try {
    const testCust1 = 'Test Won Customer One';
    const testPo = `PO-TEST-${Date.now()}`;
    const { data: newDeal } = await supabase
      .from('deals')
      .insert({
        customer_name: testCust1,
        stage: 'won',
        po_number: testPo,
        total_amount: 500000,
      })
      .select()
      .single();

    testWonDeal1 = newDeal;

    const res4 = await processComplaintMessage(
      `Log a complaint for ${testCust1} on ${testPo}: surface rust on 15 MT HR Coil`,
      testSenderPhone,
    );

    const { data: loggedComp } = await supabase
      .from('complaints')
      .select('*')
      .eq('deal_id', testWonDeal1.id)
      .eq('po_number', testPo);

    if (
      res4.includes('🚨 *Customer Complaint Logged*') &&
      res4.includes(testPo) &&
      loggedComp &&
      loggedComp.length === 1
    ) {
      console.log(
        '   PASS: Complaint successfully logged linked to won deal and PO!',
      );
      console.log('   Linked Deal ID:', loggedComp[0].deal_id);
      console.log('   Linked PO:', loggedComp[0].po_number);
      passed++;
    } else {
      console.error(
        '   FAIL: Complaint was not properly logged for won deal with PO:',
        res4,
      );
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL with error:', err.message);
    failed++;
  } finally {
    if (testWonDeal1) {
      await supabase.from('complaints').delete().eq('deal_id', testWonDeal1.id);
      await supabase.from('deals').delete().eq('id', testWonDeal1.id);
    }
  }

  // --- TEST 5: Won order without separate PO accepts Inquiry ID as PO ---
  console.log(
    '\nTest 5: Won order without separate PO accepts Inquiry ID as PO...',
  );
  let testWonDeal2: any = null;
  try {
    const testCust2 = 'Test Won Customer Two';
    const { data: newDeal2 } = await supabase
      .from('deals')
      .insert({
        customer_name: testCust2,
        stage: 'won',
        po_number: null,
        total_amount: 750000,
      })
      .select()
      .single();

    testWonDeal2 = newDeal2;
    const dealCode = `#INQ-${testWonDeal2.id.substring(0, 6).toUpperCase()}`;

    const res5 = await processComplaintMessage(
      `Log a complaint for ${testCust2} on ${dealCode}: thickness variation beyond tolerance`,
      testSenderPhone,
    );

    const { data: loggedComp2 } = await supabase
      .from('complaints')
      .select('*')
      .eq('deal_id', testWonDeal2.id);

    if (
      res5.includes('🚨 *Customer Complaint Logged*') &&
      loggedComp2 &&
      loggedComp2.length === 1 &&
      loggedComp2[0].po_number === dealCode
    ) {
      console.log('   PASS: Won order accepted Inquiry ID as PO successfully!');
      console.log('   Linked Deal ID:', loggedComp2[0].deal_id);
      console.log('   Linked PO (Inquiry ID):', loggedComp2[0].po_number);
      passed++;
    } else {
      console.error('   FAIL: Inquiry ID as PO failed:', res5);
      failed++;
    }
  } catch (err: any) {
    console.error('   FAIL with error:', err.message);
    failed++;
  } finally {
    if (testWonDeal2) {
      await supabase.from('complaints').delete().eq('deal_id', testWonDeal2.id);
      await supabase.from('deals').delete().eq('id', testWonDeal2.id);
    }
  }

  console.log(`\n=== Final Result: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

async function getComplaintCount(customerName: string): Promise<number> {
  const { data } = await supabase
    .from('complaints')
    .select('id')
    .ilike('customer_name', `%${customerName.trim()}%`);
  return (data || []).length;
}

runEnforcementTests();
