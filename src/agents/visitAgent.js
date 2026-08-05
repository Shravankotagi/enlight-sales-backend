const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase } = require('../supabase');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const VISIT_AGENT_PROMPT = `
You are the Specialized Site Visit & Meeting AI Agent (KRA 9) for Enlight Metals.
Your job is to parse salesperson customer site visit reports.

The salesperson message may be informal, in Hinglish, or missing expected keywords.
Understand the meaning and context — do not look for specific words.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no prose, no markdown, no backticks):
{
  "customer_name": "<customer/company name, else null>",
  "person_met": "<person met name/designation if mentioned, else null>",
  "remarks": "<visit notes/remarks, else null>",
  "confidence": <float 0.0 to 1.0>
}

Return ONLY the JSON object.
`;

async function processVisitMessage(text, senderPhone) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent(VISIT_AGENT_PROMPT + '\n\nSalesperson message:\n' + text);
    const rawText = result.response.text().trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);

    if (!data.customer_name) {
      return `⚠️ *Visit Agent Verification Needed*\n\nPlease specify the *Customer/Company Name* you visited to log your site visit.`;
    }

    const customerName = data.customer_name.trim();

    // Insert into customer_visits
    await supabase.from('customer_visits').insert({
      customer_name: customerName,
      salesperson_phone: senderPhone,
      person_met: data.person_met || 'Management',
      remarks: data.remarks || text,
      visited_at: new Date().toISOString(),
    });

    // Log to KRA 9
    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number: 9,
      kra_type: 'customer_visit',
      customer_name: customerName,
      description: `Visit Logged: ${customerName}${data.person_met ? ` (Met: ${data.person_met})` : ''}`,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    });

    // Count visits this month
    const { data: visitLogs } = await supabase
      .from('kra_logs')
      .select('id')
      .eq('salesperson_phone', senderPhone)
      .eq('kra_number', 9)
      .eq('month', new Date().getMonth() + 1)
      .eq('year', new Date().getFullYear());

    const totalVisits = visitLogs ? visitLogs.length : 1;

    return `🚗 *KRA 9 - Customer Visit Logged!*\n\n` +
      `Customer: *${customerName}*\n` +
      (data.person_met ? `Person Met: *${data.person_met}*\n` : '') +
      `Total Visits This Month: *${totalVisits} Visits*\n\n` +
      `Updated KRA 9 Customer Visit Dashboard! ✅`;

  } catch (error) {
    console.error('Visit Agent Error:', error.message);
    return `⚠️ Could not process site visit update: ${error.message}`;
  }
}

module.exports = { processVisitMessage };
