import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from backend .env or root .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function main() {
  console.log('=== Phase 0: Gemini API Connectivity Test ===');

  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY_1 ||
    process.env.GEMINI_API_KEY_2 ||
    process.env.GEMINI_API_KEY_3;

  if (!apiKey) {
    console.error(
      '❌ FAILED: Neither GEMINI_API_KEY nor GEMINI_API_KEY_1/2/3 is set in environment variables.',
    );
    console.log(
      'Please ensure GEMINI_API_KEY is configured in em-os-backend/.env',
    );
    process.exit(1);
  }

  console.log(`🔑 Gemini API Key configured: ***${apiKey.slice(-4)}`);

  // Target model specified in docs: gemini-3.6-flash
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  console.log(`🤖 Target Model: ${modelName}`);

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });

    console.log('Sending test prompt to Gemini API...');
    const response = await ai.models.generateContent({
      model: modelName,
      contents:
        'Respond with a single sentence confirming that the Enlight Sales OS Chatbot backend connection to Gemini is functional.',
    });

    console.log('\n✅ SUCCESS: Gemini Raw API Response Received:');
    console.log('--------------------------------------------------');
    console.log(response.text?.trim() || JSON.stringify(response));
    console.log('--------------------------------------------------');
  } catch (err: any) {
    console.warn(
      `\n⚠️ Primary test with @google/genai / ${modelName} encountered an issue:`,
      err?.message || err,
    );
    console.log('Retrying with LangChain Google GenAI fallback router...');

    try {
      const { ChatGoogleGenerativeAI } =
        await import('@langchain/google-genai');
      const { HumanMessage } = await import('@langchain/core/messages');

      const model = new ChatGoogleGenerativeAI({
        model: 'gemini-3.1-flash-lite',
        apiKey: apiKey,
        temperature: 0.1,
      });

      const res = await model.invoke([
        new HumanMessage(
          'Respond with a single sentence confirming that the Enlight Sales OS Chatbot backend connection is functional.',
        ),
      ]);

      console.log('\n✅ SUCCESS: Gemini LangChain Response Received:');
      console.log('--------------------------------------------------');
      console.log(
        typeof res.content === 'string'
          ? res.content
          : JSON.stringify(res.content),
      );
      console.log('--------------------------------------------------');
    } catch (fallbackErr: any) {
      console.error(
        '❌ FAILED: Gemini raw API call failed:',
        fallbackErr?.message || fallbackErr,
      );
      process.exit(1);
    }
  }
}

main();
