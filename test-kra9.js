require('dotenv').config({ path: '../.env' });
const { isVisitLog, handleVisitLog, getWeeklyVisitCount } = require('./src/kra9');

const testMessages = [
  'visited ABC Fabricators today, met Rahul Singh, discussed HR coil pricing, positive meeting',
  'Dynamic Industries gaya tha, Shubham se mila, order expected next week',
  'site visit at SB Scafform, met procurement manager, they need MS flat urgently',
  'need 10 MT HR coil 2mm',  // should NOT be visit
  'my sales this month'       // should NOT be visit
];

async function test() {
  console.log('=== KRA 9 DETECTION TEST ===\n');

  for (const msg of testMessages) {
    console.log(`"${msg}"`);
    console.log(`→ Is visit: ${isVisitLog(msg)}\n`);
  }

  console.log('\n=== KRA 9 SAVE TEST ===\n');

  const visitMsg = 'visited ABC Fabricators today, met Rahul Singh, discussed HR coil 2mm pricing, very positive meeting, they will send PO by Friday';
  console.log('Logging visit:', visitMsg);

  const reply = await handleVisitLog(visitMsg, '919187305823');
  console.log('\nBot reply:\n' + reply);

  console.log('\n=== WEEKLY STATS ===\n');
  const stats = await getWeeklyVisitCount('919187305823');
  console.log('This week:', stats.count, 'visits,', stats.days, 'field days');
}

test().catch(console.error);
