const { safeParseJSON } = require('./jsonUtils');

const testCases = [
  '```json\n{"customer_name": "Mehta", "total_amount": 1040000}\n```',
  '<function(update_deal_stage)>{"customer_name": "Supreme Steel"}</function>',
  'Here is the extracted JSON output:\n{"customer_name": "Delta Metals", "stage": "won"}\nHope this helps!',
  '{"customer_name": \'ABC Steel\', \'stage\': \'quoted\'}',
  'Invalid raw garbage string'
];

testCases.forEach((tc, idx) => {
  const result = safeParseJSON(tc, { fallback: true });
  console.log(`Test ${idx + 1}:`, JSON.stringify(result));
});
