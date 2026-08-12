require('dotenv').config({ path: '../.env' });
const { extractFromText } = require('./src/gemini');

async function test() {
  const result = await extractFromText('need 10 MT HR coil 2mm by Friday, customer ABC Fabricators');
  console.log('Result:', JSON.stringify(result, null, 2));
}
test();