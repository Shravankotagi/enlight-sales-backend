require('dotenv').config({ path: '../.env' });
const {
  checkPayments,
  handlePaymentUpdate,
  isPaymentUpdate,
  getPaymentSummary,
} = require('./src/kra5');

async function test() {
  console.log('=== KRA 5 DETECTION TEST ===\n');

  const testMessages = [
    'PAID ABC 4.15 lakhs received',
    'FOLLOWEDUP DYNAMIC will pay by Friday',
    'COLLECTED SB full payment done',
    'need 10 MT HR coil', // should be false
    'visited ABC today', // should be false
  ];

  for (const msg of testMessages) {
    const { isPaymentUpdate } = require('./src/kra5');
    console.log(`"${msg}"`);
    console.log(`→ Is payment update: ${isPaymentUpdate(msg)}\n`);
  }

  console.log('\n=== PAYMENT CHECK TEST ===\n');
  await checkPayments();

  console.log('\n=== PAYMENT SUMMARY TEST ===\n');
  const summary = await getPaymentSummary('919187305823');
  console.log(summary);

  console.log('\n=== PAYMENT UPDATE TEST ===\n');
  const reply = await handlePaymentUpdate(
    'PAID DYNAMIC full amount received 41 lakhs',
    '919187305823',
  );
  console.log('Reply:', reply);
}

test().catch(console.error);
