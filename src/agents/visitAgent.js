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
 * 4.  Visit with no remarks → defaults to "On-site meeting" (never a generic placeholder)
 * 5.  Visit with person name/designation mentioned → captured and stored
 * 6.  Monthly visit count includes ALL visits (not just unique customers)
 * 7.  Customer not in recurring_customers → still logs visit (new prospect visits happen)
 * 8.  Hinglish/casual messages → AI handles semantic parsing
 * 9.  Avoid logging raw message as remarks → use AI-extracted summary
 * 10. Contact number extraction → stored in contact_no if mentioned
 * 11. visit_outcome always persisted (positive/neutral/negative)
 * 12. Material requirement (qty + type) and follow-up action captured and stored
 * 13. No placeholder values ever stored — keep null if not mentioned
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase } = require('../supabase');
const { syncActivity } = require('./biginSyncAgent');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const VISIT_AGENT_PROMPT = `
You are the Specialized Site Visit & Meeting AI Agent (KRA 9) for Enlight Metals, a B2B steel distributor.
Your job is to parse salesperson customer site visit reports or field meeting logs.

The salesperson message may be informal, in Hinglish, or missing expected keywords.
Understand the meaning and context — do not look for specific words.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no prose, no markdown, no backticks):
{
  "customer_name": "<customer/company name visited, else null>",
  "person_met": "<full name and designation of person met (e.g. 'Mr. Sharma, Purchase Manager'), else null>",
  "contact_no": "<phone number of person met if explicitly mentioned, else null>",
  "remarks": "<rich, detailed summary of what was discussed, key decisions made, and outcome — 2-3 lines. Do NOT copy raw message. Do NOT use generic text like 'Field Visit' or 'Market Presence'. Capture the actual business context.>",
  "visit_outcome": "positive|neutral|negative",
  "material_requirement": "<steel product and quantity required by customer if mentioned (e.g. '50 MT HR Coil', '10 ton TMT bars'), else null>",
  "follow_up_action": "<specific action required next (e.g. 'Send quotation by tomorrow', 'Share rate sheet by Friday'), else null>",
  "confidence": <float 0.0 to 1.0>
}

Rules:
- "visit_outcome":
  - "positive" → order expected, interest shown, deal progressed, quotation requested, positive response
  - "negative" → customer not available, bad response, rejected meeting, not interested
  - "neutral" → routine check-in, no specific outcome mentioned
- "remarks": Write a rich, detailed, professional summary — capture WHAT was discussed, WHO decided WHAT, and what the next step is.
  - BAD: "Visited and market presence recorded"
  - GOOD: "Discussed HR Coil requirements of ~50 MT. Customer (Purchase Manager Mr. Sharma) requested formal quotation by tomorrow. Interest level is high."
- "material_requirement": Extract product type + quantity if mentioned. e.g. "50 MT HR Coil", "10 ton TMT Fe500"
- "follow_up_action": Extract the specific next action with deadline if mentioned. e.g. "Send quotation by tomorrow"
- "contact_no": Only set if a phone number is EXPLICITLY stated in the message. Otherwise null.
- NEVER invent or assume data not present in the message.

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

    const customerName = data.customer_name.trim();

    // Verify and get official customer name from salesperson's registered customers
    const { verifyAndGetCustomerName, saveActiveSession } = require('../supabase');
    const officialCustomerName = await verifyAndGetCustomerName(customerName, senderPhone);

    if (!officialCustomerName) {
      return `⚠️ *Client Not Found in your Customer List*\n\n` +
        `Client *"${customerName}"* is not registered under your salesperson account.\n\n` +
        `Please onboard this customer first under *KRA 2 (Customer Onboarding)* before logging visits.\n\n` +
        `*Example to onboard customer:*\n` +
        `_"New customer ${customerName} owner Mr. Kapoor location Mumbai phone 9876543210 gst 27AAAAA1111A1Z1"_\n\n` +
        `Once added, you can resend this visit update.`;
    }

    const finalCustomerName = officialCustomerName;

    // Extract all fields — NEVER use placeholder values
    const remarks            = data.remarks || 'On-site meeting';
    const personMet          = data.person_met || null;
    const contactNo          = data.contact_no || null;                    // null if not mentioned
    const visitOutcome       = data.visit_outcome || 'neutral';
    const materialRequirement = data.material_requirement || null;         // null if not mentioned
    const followUpAction      = data.follow_up_action || null;             // null if not mentioned

    // Insert visit record with all extracted data
    await supabase.from('customer_visits').insert({
      customer_name:        finalCustomerName,
      salesperson_phone:    senderPhone,
      person_met:           personMet,
      contact_no:           contactNo,
      remarks:              remarks,
      visit_outcome:        visitOutcome,
      material_requirement: materialRequirement,
      follow_up_action:     followUpAction,
      visited_at:           new Date().toISOString(),
    });

    // Log to KRA 9 with full business context
    const kraDescription = [
      `Visit: ${finalCustomerName}`,
      personMet           ? `Met: ${personMet}` : null,
      visitOutcome        ? `Outcome: ${visitOutcome}` : null,
      materialRequirement ? `Requirement: ${materialRequirement}` : null,
      followUpAction      ? `Follow-up: ${followUpAction}` : null,
      `Notes: ${remarks}`,
    ].filter(Boolean).join(' | ');

    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number:        9,
      kra_type:          'customer_visit',
      customer_name:     finalCustomerName,
      description:       kraDescription,
      month: new Date().getMonth() + 1,
      year:  new Date().getFullYear(),
    });

    // Save active session so follow-up messages (profile updates) link to this customer
    await saveActiveSession(senderPhone, finalCustomerName, 'visit_logged');

    // Count ALL visits this month
    const { data: visitLogs } = await supabase
      .from('kra_logs')
      .select('id')
      .eq('salesperson_phone', senderPhone)
      .eq('kra_number', 9)
      .eq('month', new Date().getMonth() + 1)
      .eq('year', new Date().getFullYear());

    const totalVisits = visitLogs ? visitLogs.length : 1;

    // Update last contact date on recurring_customers (churn tracking signal)
    await supabase
      .from('recurring_customers')
      .update({ updated_at: new Date().toISOString() })
      .ilike('customer_name', `%${finalCustomerName}%`);

    const outcomeEmoji = { positive: '🟢', neutral: '🟡', negative: '🔴' }[visitOutcome] || '🟡';

    const { getCustomerMissingInfoPrompt } = require('../supabase');
    const missingPrompt = await getCustomerMissingInfoPrompt(finalCustomerName, senderPhone);

    // Async Zoho Bigin Smart Sync
    syncActivity('visit', {
      customerName: finalCustomerName,
      personMet,
      remarks,
      visitOutcome,
      materialRequirement,
      followUpAction,
      senderPhone,
    });

    return `🚗 *KRA 9 - Customer Visit Logged!*\n\n` +
      `Customer: *${finalCustomerName}*\n` +
      (personMet           ? `Person Met: *${personMet}*\n` : '') +
      (contactNo           ? `Contact: *${contactNo}*\n` : '') +
      `Outcome: ${outcomeEmoji} *${visitOutcome.charAt(0).toUpperCase() + visitOutcome.slice(1)}*\n` +
      `Notes: ${remarks}\n` +
      (materialRequirement ? `📦 Requirement: *${materialRequirement}*\n` : '') +
      (followUpAction      ? `📌 Follow-up: *${followUpAction}*\n` : '') +
      `\nTotal Visits This Month: *${totalVisits}*\n\n` +
      `Updated KRA 9 Customer Visit Dashboard! ✅` + (missingPrompt || '');

  } catch (error) {
    console.error('Visit Agent Error:', error.message);
    return `⚠️ Could not process site visit update: ${error.message}`;
  }
}

module.exports = { processVisitMessage };
