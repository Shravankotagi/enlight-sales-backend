require('dotenv').config({ path: '../.env' });
const { runNow } = require('./src/scheduler');
const { handleFollowUpReply } = require('./src/kra3');

async function test() {
  console.log('=== KRA 3 TEST ===\n');

  // Test 1: Run the recurring customer check
  console.log('Test 1: Running recurring customer check...\n');
  await runNow();

  console.log('\n--- Waiting 3 seconds ---\n');
  await new Promise((r) => setTimeout(r, 3000));

  // Test 2: Simulate salesperson reply
  console.log('Test 2: Simulating follow-up reply...\n');
  const reply = await handleFollowUpReply(
    'VISITED DYNAMIC met Shubham, discussed new order for next week',
    '919187305823',
  );
  console.log('Reply to salesperson:', reply);
}

test().catch(console.error);
