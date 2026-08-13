require('dotenv').config({ path: '../.env' });
const { transcribeAudio } = require('./src/assemblyai');
const { extractFromText } = require('./src/gemini');

async function test() {
  // Simulate a voice note transcript
  // (In real test you would pass an actual audio buffer)
  console.log('Testing voice pipeline with simulated transcript...');

  const simulatedTranscript =
    'bhai Dynamic Industries ka order aaya hai, unhe chahiye 15 MT HR coil 2mm aur 5 MT MS flat 150x6mm, delivery Friday tak Pune mein, payment 30 days';

  console.log('Simulated transcript:', simulatedTranscript);

  const extraction = await extractFromText(simulatedTranscript);
  console.log('Extraction from voice transcript:');
  console.log(JSON.stringify(extraction, null, 2));
}

test().catch(console.error);
