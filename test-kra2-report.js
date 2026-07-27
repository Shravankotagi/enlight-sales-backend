require('dotenv').config({ path: '../.env' });
const { isNewCustomer, logNewCustomer, 
        getNewCustomerSummary } = require('./src/kra2');
const { generateFullKRAReport } = require('./src/kraReport');

async function test() {
  console.log('=== KRA 2 TEST ===\n');

  // Test new customer detection
  const testCustomers = [
    'Dynamic Industries',    // already in DB — should be false
    'New XYZ Company Ltd',   // not in DB — should be true
    'ABC Fabricators'        // already in DB — should be false
  ];

  for (const customer of testCustomers) {
    const isNew = await isNewCustomer(customer);
    console.log(`"${customer}" → Is new: ${isNew}`);
  }

  console.log('\n=== KRA 2 SUMMARY ===\n');
  const summary = await getNewCustomerSummary('919187305823');
  console.log(summary);

  console.log('\n=== FULL KRA MONTHLY REPORT ===\n');
  const report = await generateFullKRAReport('919187305823');
  console.log(report);
}

test().catch(console.error);
