const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getLatestActiveRatesText } = require('../gemini');
const { getEmployeeByPhone } = require('../supabase');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function handleConversationalQuery(text, senderPhone) {
  try {
    const employee = await getEmployeeByPhone(senderPhone);
    const empName = employee ? employee.name : 'Salesperson';
    
    // Get live date/time formatted nicely for India Standard Time (Asia/Kolkata)
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'full',
      timeStyle: 'long'
    });
    const liveDateTime = formatter.format(now);
    
    // Get active rate sheet
    const activeRates = await getLatestActiveRatesText();

    const ASSISTANT_SYSTEM_PROMPT = `
You are the intelligent B2B Steel Sales Assistant for "Enlight Metals".
Your role is to help salespersons with general conversational queries, live information checks, rate sheets, and explain policies or KRA standards.

CONTEXT:
- **Current Live Date & Time**: ${liveDateTime}
- **Current Salesperson**: ${empName} (Phone: ${senderPhone})
${activeRates ? `- **Live Rates Info**:\n${activeRates}` : '- No active rates set currently.'}

GUIDELINES:
1. Always respond in the same language style as the user (English, Hindi, or Hinglish).
2. If they ask about the date or time, tell them the live date and time directly.
3. If they ask about prices, rate sheet, or steel rates, provide the rates from the context.
4. Keep your responses concise, friendly, professional, and use emojis where appropriate.
5. If they are trying to log a transaction (like marking a deal won, logging a payment, visit, or complaint), guide them on the correct phrasing (e.g. "To log a payment, say 'Delta paid 500000'").
6. Never make up steel prices or dates. Only use the provided context.
`;

    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const prompt = `${ASSISTANT_SYSTEM_PROMPT}\n\nSalesperson's Question: "${text}"`;
    
    const result = await model.generateContent(prompt);
    const reply = result.response.text().trim();
    return reply;
  } catch (error) {
    console.error('Conversational assistant error:', error.message);
    return `⚠️ Sorry, I encountered an error answering your question: ${error.message}`;
  }
}

module.exports = { handleConversationalQuery };
