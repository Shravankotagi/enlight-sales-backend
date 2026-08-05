const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase } = require('../supabase');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const RETENTION_AGENT_PROMPT = `
You are the Specialized Customer Retention AI Agent (KRA 3) for Enlight Metals.
Your job is to parse customer follow-up reports, re-order inquiries, or client check-in notes.

The salesperson message may be informal, in Hinglish, or missing expected keywords.
Understand the meaning and context — do not look for specific words.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no prose, no markdown, no backticks):
{
  "customer_name": "<customer/company name, else null>",
  "followup_summary": "<summary of discussion/follow-up, else null>",
  "reorder_expected": <boolean true if reorder or purchase planned, else false>,
  "confidence": <float 0.0 to 1.0>
}

Return ONLY the JSON object.
`;

async function processRetentionMessage(text, senderPhone) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent(RETENTION_AGENT_PROMPT + '\n\nSalesperson message:\n' + text);
    const rawText = result.response.text().trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);

    if (!data.customer_name) {
      return `⚠️ *Retention Agent Verification Needed*\n\nPlease specify the *Customer/Company Name* for this follow-up update.`;
    }

    const customerName = data.customer_name.trim();

    // Log to KRA 3
    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number: 3,
      kra_type: 'customer_retention',
      customer_name: customerName,
      description: `Follow-up: ${customerName} (${data.followup_summary || 'Dormant client check-in'})`,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    });

    // Update customer last contact date if exists
    await supabase
      .from('recurring_customers')
      .update({ updated_at: new Date().toISOString() })
      .ilike('customer_name', `%${customerName}%`);

    return `🔄 *KRA 3 - Customer Retention Follow-up Logged!*\n\n` +
      `Customer: *${customerName}*\n` +
      (data.followup_summary ? `Summary: *${data.followup_summary}*\n` : '') +
      (data.reorder_expected ? `Status: *Re-order Expected Soon 📦*\n` : '') +
      `\nUpdated KRA 3 Customer Retention Dashboard! ✅`;

  } catch (error) {
    console.error('Retention Agent Error:', error.message);
    return `⚠️ Could not process retention update: ${error.message}`;
  }
}

module.exports = { processRetentionMessage };
