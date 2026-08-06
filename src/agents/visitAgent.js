/**
 * KRA 8 / KRA 9 - Customer Site Visit & Meeting Agent
 *
 * Tracks field visits made by salesperson to customer locations.
 * Each visit is a separate log — multiple visits to same customer in a day are valid.
 *
 * EDGE CASES HANDLED:
 * 1.  Normal visit log → insert to customer_visits + log KRA
 * 2.  Missing customer name → ask for clarification
 * 3.  Multiple visits same day to same customer → allowed (each is a separate activity)
 * 4.  Visit with no remarks → defaults to "On-site meeting" instead of raw message text
 * 5.  Visit with person name/designation mentioned → captured and stored
 * 6.  Monthly visit count includes ALL visits (not just unique customers)
 * 7.  Customer not in recurring_customers → still logs visit (new prospect visits happen)
 * 8.  Hinglish/casual messages → AI handles semantic parsing
 * 9.  Avoid logging raw message as remarks (could be very long) → use AI-extracted summary
 * 10. Contact number extraction → stored in contact_no if mentioned
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase } = require('../supabase');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const VISIT_AGENT_PROMPT = `
You are the Specialized Site Visit & Meeting AI Agent (KRA 9) for Enlight Metals.
Your job is to parse salesperson customer site visit reports or field meeting logs.

The salesperson message may be informal, in Hinglish, or missing expected keywords.
Understand the meaning and context — do not look for specific words.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no prose, no markdown, no backticks):
{
  "customer_name": "<customer/company name visited, else null>",
  "person_met": "<name or designation of person met (e.g. 'Mr. Sharma, Purchase Manager'), else null>",
  "contact_no": "<phone number of person met if mentioned, else null>",
  "remarks": "<concise 1-2 line summary of what was discussed or outcome of the visit, else null>",
  "visit_outcome": "positive|neutral|negative",
  "confidence": <float 0.0 to 1.0>
}

Rules:
- "visit_outcome": 
  - "positive" → order expected, interest shown, deal progressed, positive response
  - "negative" → customer not available, bad response, rejected meeting
  - "neutral" → routine check-in, no specific outcome mentioned
- "remarks": Write a clean, concise summary — do NOT just copy the raw message.

Return ONLY the JSON object.
`;

async function processVisitMessage(text, senderPhone) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent(VISIT_AGENT_PROMPT + '\n\nSalesperson message:\n' + text);
    const rawText = result.response.text().trim();
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const data = JSON.parse(cleaned);

    // Edge Case 2: Missing customer name
    if (!data.customer_name) {
      return `⚠️ *Visit Agent — Customer Name Missing*\n\nPlease specify the *Customer/Company* you visited.\nExample: _"Visited Delta Structural Steel today, met Mr. Sharma, discussed pricing"_`;
    }

    const customerName  = data.customer_name.trim();
    // Edge Case 4 & 9: Use AI-extracted remarks instead of raw message
    const remarks       = data.remarks || 'On-site meeting';
    const personMet     = data.person_met || null;
    const contactNo     = data.contact_no || null;
    const visitOutcome  = data.visit_outcome || 'neutral';

    // Edge Case 1: Insert visit record
    await supabase.from('customer_visits').insert({
      customer_name:     customerName,
      salesperson_phone: senderPhone,
      person_met:        personMet,
      contact_no:        contactNo,
      remarks:           remarks,
      visited_at:        new Date().toISOString(),
    });

    // Log to KRA 9
    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number:        9,
      kra_type:          'customer_visit',
      customer_name:     customerName,
      description:       `Visit: ${customerName}${personMet ? ` (Met: ${personMet})` : ''} — ${remarks}`,
      month: new Date().getMonth() + 1,
      year:  new Date().getFullYear(),
    });

    // Edge Case 6: Count ALL visits this month (not just unique customers)
    const { data: visitLogs } = await supabase
      .from('kra_logs')
      .select('id')
      .eq('salesperson_phone', senderPhone)
      .eq('kra_number', 9)
      .eq('month', new Date().getMonth() + 1)
      .eq('year', new Date().getFullYear());

    const totalVisits = visitLogs ? visitLogs.length : 1;

    // Edge Case 7: Update last_order_date on recurring_customers if customer exists
    // (updates their "last contact" signal for churn tracking)
    await supabase
      .from('recurring_customers')
      .update({ updated_at: new Date().toISOString() })
      .ilike('customer_name', `%${customerName}%`);

    const outcomeEmoji = {
      positive: '🟢',
      neutral:  '🟡',
      negative: '🔴',
    }[visitOutcome] || '🟡';

    return `🚗 *KRA 9 - Customer Visit Logged!*\n\n` +
      `Customer: *${customerName}*\n` +
      (personMet  ? `Person Met: *${personMet}*\n` : '') +
      (contactNo  ? `Contact: *${contactNo}*\n` : '') +
      `Outcome: ${outcomeEmoji} *${visitOutcome.charAt(0).toUpperCase() + visitOutcome.slice(1)}*\n` +
      `Notes: ${remarks}\n` +
      `\nTotal Visits This Month: *${totalVisits}*\n\n` +
      `Updated KRA 9 Customer Visit Dashboard! ✅`;

  } catch (error) {
    console.error('Visit Agent Error:', error.message);
    return `⚠️ Could not process site visit update: ${error.message}`;
  }
}

module.exports = { processVisitMessage };
