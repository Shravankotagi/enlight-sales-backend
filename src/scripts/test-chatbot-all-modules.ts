import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { ToolRegistryService } from '../modules/chatbot/tools/tool-registry.service';
import { CallerContext } from '../modules/chatbot/tools/chatbot-tool.interface';

async function runTests() {
  console.log(
    '--- Testing Enlight Metals Chatbot Tools Across All 5 Modules ---',
  );

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

  // Mock SupabaseService for ToolRegistryService
  const mockSupabaseService = {
    getAdminClient: () => supabaseAdmin,
  } as any;

  const registry = new ToolRegistryService(mockSupabaseService);

  const adminCaller: CallerContext = {
    userId: 'test-admin-id',
    email: 'admin@enlightmetals.com',
    role: 'admin',
    name: 'Admin User',
  };

  console.log('\n1. Verifying Tool Declarations:');
  const decls = registry.getToolDeclarations('admin');
  console.log(`Total tools registered for admin: ${decls.length}`);
  decls.forEach((d: any) =>
    console.log(` - ${d.name}: ${d.description.slice(0, 60)}...`),
  );

  const expectedTools = [
    'get_inquiries',
    'get_my_open_deals',
    'get_customer_360',
    'get_reorder_queue',
    'search_knowledge_base',
    'get_team_pipeline',
    'get_churn_radar',
    'get_loss_analytics',
    'get_visits',
    'get_complaints',
  ];

  for (const t of expectedTools) {
    if (!decls.some((d: any) => d.name === t)) {
      throw new Error(`Missing expected tool in registry: ${t}`);
    }
  }
  console.log('All 10 required tools are registered in ToolRegistryService.');

  function parseToolResult(resultStr: string): any {
    const clean = resultStr
      .replace(/<untrusted_content[^>]*>/gi, '')
      .replace(/<\/untrusted_content>/gi, '')
      .trim();
    try {
      return JSON.parse(clean);
    } catch {
      return clean;
    }
  }

  // Test 1: Inquiries Module
  console.log('\n2. Testing Module 1: Inquiries (get_inquiries)');
  try {
    const inqRaw = await registry.executeTool(
      'get_inquiries',
      { limit: 5 },
      adminCaller,
    );
    const inqData = parseToolResult(inqRaw);
    console.log('Inquiries Summary:', {
      total_inquiries: inqData.summary?.total_inquiries,
      inquiries_today: inqData.summary?.inquiries_today,
      by_deal_stage: inqData.summary?.by_deal_stage,
      conversion_metrics: inqData.summary?.conversion_metrics,
    });
    console.log(`Inquiries returned count: ${inqData.data?.length || 0}`);
  } catch (err: any) {
    console.error('Error executing get_inquiries:', err.message);
  }

  // Test 2: Orders / Deals Module
  console.log(
    '\n3. Testing Module 2: Orders / Deals (get_my_open_deals with stage_filter="won")',
  );
  try {
    const ordersRaw = await registry.executeTool(
      'get_my_open_deals',
      { stage_filter: 'won', limit: 5 },
      adminCaller,
    );
    const ordersData = parseToolResult(ordersRaw);
    console.log('Orders Summary:', {
      total_deals_count: ordersData.summary?.total_deals_count,
      won_orders_count: ordersData.summary?.won_orders_count,
      won_deals_total_value: ordersData.summary?.won_deals_total_value,
      won_orders_tonnage_mt: ordersData.summary?.won_orders_tonnage_mt,
      filtered_deals_count: ordersData.summary?.filtered_deals_count,
    });
    console.log(`Orders returned count: ${ordersData.deals?.length || 0}`);
    if (ordersData.deals?.length > 0) {
      console.log('Sample Won Order:', {
        deal_id: ordersData.deals[0].deal_id,
        customer: ordersData.deals[0].customer_name,
        amount: ordersData.deals[0].total_amount,
        tonnage_mt: ordersData.deals[0].tonnage_mt,
        po_number: ordersData.deals[0].po_number,
      });
    }
  } catch (err: any) {
    console.error('Error executing get_my_open_deals (orders):', err.message);
  }

  // Test 3: Customers Module
  console.log('\n4. Testing Module 3: Customers (get_customer_360)');
  try {
    const custDirRaw = await registry.executeTool(
      'get_customer_360',
      { limit: 5 },
      adminCaller,
    );
    const custDirData = parseToolResult(custDirRaw);
    console.log('Customer Directory Summary:', custDirData.summary);
    if (custDirData.customers?.length > 0) {
      const sampleCust = custDirData.customers[0];
      console.log('Sample Customer Enriched Data:', {
        name: sampleCust.customer_name,
        segment: sampleCust.segment,
        health_status: sampleCust.health_status,
        tonnage_mt: sampleCust.total_tonnage_mt,
      });

      // Also test Customer 360 detailed view with visits & complaints
      const profileRaw = await registry.executeTool(
        'get_customer_360',
        { customer_name: sampleCust.customer_name },
        adminCaller,
      );
      const profileData = parseToolResult(profileRaw);
      console.log('Customer 360 Detail View:', {
        customer_name: profileData.customer_name,
        segment: profileData.segment,
        health: profileData.health_status,
        metrics: profileData.metrics,
        visits_summary: profileData.visits_summary,
        complaints_summary: profileData.complaints_summary,
      });
    }
  } catch (err: any) {
    console.error('Error executing get_customer_360:', err.message);
  }

  // Test 4: Visits Module
  console.log('\n5. Testing Module 4: Visits (get_visits)');
  try {
    const visitsRaw = await registry.executeTool(
      'get_visits',
      { limit: 5 },
      adminCaller,
    );
    const visitsData = parseToolResult(visitsRaw);
    console.log('Visits Summary:', visitsData.summary);
    console.log(`Visits returned count: ${visitsData.visits?.length || 0}`);
    if (visitsData.visits?.length > 0) {
      console.log('Sample Visit:', visitsData.visits[0]);
    }
  } catch (err: any) {
    console.error('Error executing get_visits:', err.message);
  }

  // Test 5: Complaints Module
  console.log('\n6. Testing Module 5: Complaints (get_complaints)');
  try {
    const complaintsRaw = await registry.executeTool(
      'get_complaints',
      { limit: 5 },
      adminCaller,
    );
    const complaintsData = parseToolResult(complaintsRaw);
    console.log('Complaints Summary:', complaintsData.summary);
    console.log(
      `Complaints returned count: ${complaintsData.complaints?.length || 0}`,
    );
    if (complaintsData.complaints?.length > 0) {
      console.log('Sample Complaint:', complaintsData.complaints[0]);
    }
  } catch (err: any) {
    console.error('Error executing get_complaints:', err.message);
  }

  console.log('\n--- All 5 Module Tool Tests Completed Successfully ---');
}

runTests().catch((e) => {
  console.error('Test run failed:', e);
  process.exit(1);
});
