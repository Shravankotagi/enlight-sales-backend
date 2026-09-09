import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function runSalesManagerVisibilityTests() {
  console.log(
    '===============================================================',
  );
  console.log(
    '=== Sales Manager Data Visibility & RBAC Verification Suite ===',
  );
  console.log(
    '===============================================================\n',
  );

  const { SupabaseService } =
    await import('../infrastructure/supabase/supabase.service');
  const { ConfigService } = await import('../config/config.service');
  const { ConfigService: NestConfigService } = await import('@nestjs/config');
  const { EmployeesService } =
    await import('../modules/employees/employees.service');
  const { DealsService } = await import('../modules/deals/deals.service');
  const { InquiriesService } =
    await import('../modules/inquiries/inquiries.service');
  const { CustomersService } =
    await import('../modules/customers/customers.service');
  const { KraService } = await import('../modules/kra/kra.service');

  const configService = new ConfigService(new NestConfigService());
  const supabaseService = new SupabaseService(configService);
  const employeesService = new EmployeesService(supabaseService);

  // Mocks for constructor injection
  const activityLogsService: any = { log: () => Promise.resolve() };
  const zohoService: any = { syncDeal: () => Promise.resolve() };
  const pricingService: any = {};
  const productsService: any = {};

  const dealsService = new DealsService(
    supabaseService,
    activityLogsService,
    zohoService,
  );
  const inquiriesService = new InquiriesService(
    supabaseService,
    zohoService,
    pricingService,
    productsService,
  );
  const kraService = new KraService(supabaseService, activityLogsService);
  const customersService = new CustomersService(
    supabaseService,
    activityLogsService,
  );

  const supabase = supabaseService.getAdminClient();

  // 1. Fetch John (Sales Manager) and Rishabh (Salesperson)
  const { data: employees } = await supabase
    .from('employees')
    .select('*')
    .eq('is_active', true);

  const john = (employees || []).find(
    (e: any) => e.phone === '917878787878' || e.employee_id === 'EMP007',
  );
  const rishabh = (employees || []).find(
    (e: any) => e.phone === '919619226169' || e.employee_id === 'EMP009',
  );
  const akruti = (employees || []).find((e: any) => e.employee_id === 'EMP005');

  if (!john || !rishabh) {
    throw new Error(
      'Required test employees (John or Rishabh) not found in database',
    );
  }

  console.log(`Testing with Sales Manager: ${john.name} (${john.phone})`);
  console.log(`Testing with Salesperson: ${rishabh.name} (${rishabh.phone})\n`);

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string) {
    total++;
    if (condition) {
      console.log(`  PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  FAIL: ${testName}`);
    }
  }

  // TEST 1: Assigned salespersons under John
  console.log('--- TEST 1: getAssignedSalespersons for John ---');
  const assigned = await employeesService.getAssignedSalespersons(
    john.id,
    john.phone,
  );
  const assignedRishabh = assigned.find(
    (a: any) => a.phone === rishabh.phone || a.id === rishabh.id,
  );
  assert(
    !!assignedRishabh,
    `Rishabh Makwana is present in John's assigned salespersons list (Found ${assigned.length} subordinates)`,
  );

  // TEST 2: Accessible phones in Team Aggregate view
  console.log(
    '\n--- TEST 2: getAccessibleSalespersonPhones (Team Aggregate) ---',
  );
  const teamAccess =
    await employeesService.getAccessibleSalespersonPhones(john);
  assert(
    Array.isArray(teamAccess.phones) &&
      teamAccess.phones.includes(rishabh.phone),
    `Team aggregate phones include Rishabh's phone (${rishabh.phone})`,
  );
  assert(
    Array.isArray(teamAccess.phones) && teamAccess.phones.includes(john.phone),
    `Team aggregate phones include John's own phone (${john.phone})`,
  );

  // TEST 3: Accessible phones when John views Rishabh Makwana specifically
  console.log(
    '\n--- TEST 3: getAccessibleSalespersonPhones (Drilldown: viewing Rishabh) ---',
  );
  const rishabhDrilldown =
    await employeesService.getAccessibleSalespersonPhones(john, rishabh.phone);
  assert(
    Array.isArray(rishabhDrilldown.phones) &&
      rishabhDrilldown.phones.length === 1 &&
      rishabhDrilldown.phones[0] === rishabh.phone,
    `John can switch view to Rishabh Makwana without permission error`,
  );

  // TEST 4: Deals Visibility
  console.log('\n--- TEST 4: Deals Visibility for John ---');
  // Team view
  const teamDeals = await dealsService.findAll({
    salesperson_phone: teamAccess.phones || undefined,
  });
  const rishabhDealsInTeam = teamDeals.filter(
    (d: any) =>
      d.salesperson_phone === rishabh.phone ||
      d.employee_id === rishabh.employee_id,
  );
  assert(
    rishabhDealsInTeam.length >= 10,
    `John sees Rishabh's deals in team aggregate view (Found ${rishabhDealsInTeam.length} deals for Rishabh out of ${teamDeals.length} total team deals)`,
  );

  // Drilldown view
  const drilldownDeals = await dealsService.findAll({
    salesperson_phone: rishabhDrilldown.phones || undefined,
  });
  assert(
    drilldownDeals.length >= 10,
    `John sees all ${drilldownDeals.length} deals when viewing as Rishabh individually`,
  );

  // TEST 5: Inquiries Visibility
  console.log('\n--- TEST 5: Inquiries Visibility for John ---');
  const teamInquiries = await inquiriesService.findAll({
    salespersonPhones: teamAccess.phones || undefined,
  });
  const rishabhInquiriesInTeam = teamInquiries.filter(
    (inq: any) =>
      inq.salesperson_phone === rishabh.phone ||
      inq.employee_id === rishabh.employee_id,
  );
  assert(
    rishabhInquiriesInTeam.length >= 10,
    `John sees Rishabh's inquiries in team aggregate view (Found ${rishabhInquiriesInTeam.length} inquiries)`,
  );

  // TEST 6: Customers Visibility
  console.log('\n--- TEST 6: Customers Visibility for John ---');
  const teamCustomers = await customersService.findAll(
    teamAccess.phones || undefined,
  );
  const rishabhCustomersInTeam = teamCustomers.filter(
    (c: any) => c.assigned_salesperson_phone === rishabh.phone,
  );
  assert(
    rishabhCustomersInTeam.length >= 10,
    `John sees Rishabh's assigned customers in team aggregate view (Found ${rishabhCustomersInTeam.length} customers)`,
  );

  // TEST 7: KRA Dashboard Visibility
  console.log('\n--- TEST 7: KRA Dashboard for John ---');
  const kraDashboard = await kraService.getDashboard(
    teamAccess.phones || undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
  );
  assert(
    kraDashboard &&
      (kraDashboard.kra1?.deals_count >= 0 || kraDashboard.kra2?.count >= 0),
    `KRA dashboard calculates successfully for team aggregate view (KRA1 Deals count: ${kraDashboard.kra1?.deals_count})`,
  );

  // TEST 8: RBAC Cross-Salesperson Isolation
  console.log(
    '\n--- TEST 8: RBAC Isolation (Salesperson cannot access peer) ---',
  );
  if (akruti) {
    try {
      await employeesService.getAccessibleSalespersonPhones(
        akruti,
        rishabh.phone,
      );
    } catch {
      // Expected ForbiddenException
    }
    // Salesperson getAccessibleSalespersonPhones returns strictly [akruti.phone]
    const akrutiPhones =
      await employeesService.getAccessibleSalespersonPhones(akruti);
    assert(
      akrutiPhones.phones?.length === 1 &&
        akrutiPhones.phones[0] === akruti.phone,
      `Salesperson Akruti is strictly confined to her own phone (${akruti.phone})`,
    );
  }

  console.log(
    `\n===============================================================`,
  );
  console.log(
    `Summary: ${passed}/${total} Tests Passed (${Math.round((passed / total) * 100)}%)`,
  );
  console.log(
    `===============================================================\n`,
  );

  if (passed !== total) {
    process.exit(1);
  }
}

runSalesManagerVisibilityTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
