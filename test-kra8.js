require('dotenv').config({ path: '../.env' });
const { 
  isComplaintReport, 
  isComplaintResolution,
  handleComplaintLog,
  handleComplaintResolution,
  checkComplaints,
  getComplaintSummary
} = require('./src/kra8');

async function test() {
  console.log('=== KRA 8 DETECTION TEST ===\n');

  const testMessages = [
    'ABC Fabricators complaint - wrong material delivered, they ordered HR but got CR',
    'Dynamic Industries quality issue - material rejected at site',
    'customer unhappy with billing, excess charged',
    'shikayat aaya SB Scafform se, delivery late thi',
    'need 10 MT HR coil',     // should be false
    'visited ABC today',       // should be false
    'RESOLVED ABC material replaced successfully',  // resolution
    'CLOSED DYNAMIC billing corrected and resent'   // resolution
  ];

  for (const msg of testMessages) {
    const isReport = isComplaintReport(msg);
    const isResolution = isComplaintResolution(msg);
    console.log(`"${msg.substring(0, 60)}..."`);
    console.log(`→ Is complaint: ${isReport} | Is resolution: ${isResolution}\n`);
  }

  console.log('\n=== COMPLAINT LOG TEST ===\n');
  const complaintMsg = 'ABC Fabricators complaint - they received wrong grade material, ordered MS E250 but got IS 2062, site rejected it completely';
  console.log('Logging complaint:', complaintMsg);
  const reply = await handleComplaintLog(complaintMsg, '919187305823');
  console.log('\nBot reply:\n' + reply);

  console.log('\n=== COMPLAINT CHECK TEST ===\n');
  await checkComplaints();

  console.log('\n=== COMPLAINT SUMMARY TEST ===\n');
  const summary = await getComplaintSummary('919187305823');
  console.log(summary);

  console.log('\n=== RESOLUTION TEST ===\n');
  const resolutionReply = await handleComplaintResolution(
    'RESOLVED ABC replaced material with correct grade, customer satisfied',
    '919187305823'
  );
  console.log('Resolution reply:\n' + resolutionReply);
}

test().catch(console.error);
