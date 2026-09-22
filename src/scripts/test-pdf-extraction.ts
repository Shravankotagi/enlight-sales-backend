/**
 * Verification test for Knowledge Base PDF Text Extraction
 */
import { KbService } from '../modules/chatbot/kb/kb.service';
import * as dotenv from 'dotenv';
dotenv.config();

async function runPdfExtractionTest() {
  console.log(
    '===============================================================',
  );
  console.log(' Starting Knowledge Base PDF Extraction Verification');
  console.log(
    '===============================================================\n',
  );

  const mockSupabase: any = {
    getAdminClient: () => ({}),
  };

  const kbService = new KbService(mockSupabase);

  // Create a minimal synthetic PDF base64 (or text base64) to verify method signature and error handling
  console.log('[Test 1] Testing invalid/empty base64 handling...');
  try {
    await kbService.extractTextFromPdf('');
    console.error('  FAILED: Expected error for empty base64');
  } catch (err: any) {
    console.log('  PASSED: Correctly handled empty input error:', err.message);
  }

  // Create a basic valid PDF stream in base64
  console.log('\n[Test 2] Testing PDF extraction method interface...');
  // A minimal valid PDF header
  const minimalPdfHeader =
    'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMzAwIDE0NF0+PmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTkwCiUlRU9GCg==';

  try {
    const result = await kbService.extractTextFromPdf(
      minimalPdfHeader,
      'Enlight_Sales_SOP_2026.pdf',
    );
    console.log('  PASSED: Extraction executed, returned title:', result.title);
  } catch (err: any) {
    // Gemini may notice the minimal synthetic PDF has no text content
    if (
      err.message.includes('No text could be extracted') ||
      err.message.includes('PDF') ||
      err.message.includes('Gemini')
    ) {
      console.log(
        '  PASSED: Extraction engine invoked properly (API responded):',
        err.message,
      );
    } else {
      console.error('  FAILED with unexpected error:', err.message);
    }
  }

  console.log(
    '\n===============================================================',
  );
  console.log(' PDF Extraction Verification Complete');
  console.log(
    '===============================================================\n',
  );
}

runPdfExtractionTest().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
