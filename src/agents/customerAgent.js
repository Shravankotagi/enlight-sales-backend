const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase } = require('../supabase');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const CUSTOMER_AGENT_PROMPT = `
You are the Specialized Customer Onboarding AI Agent (KRA 2) for Enlight Metals.
Your job is to parse salesperson new customer acquisition reports.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no prose, no markdown, no backticks):
{
  "customer_name": "<new company/customer name, else null>",
  "contact_person": "<contact person name if mentioned, else null>",
  "phone": "<phone number if mentioned, else null>",
  "gst": "<GST number if mentioned, else null>",
  "city": "<city/address if mentioned, else null>",
  "confidence": <float 0.0 to 1.0>
}

Return ONLY the JSON object.
`;

async function processCustomerMessage(text, senderPhone) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent(CUSTOMER_AGENT_PROMPT + '\n\nSalesperson message:\n' + text);
    const rawText = result.response.text().trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);

    if (!data.customer_name) {
      return `⚠️ *Customer Agent Verification Needed*\n\nPlease specify the *New Customer/Company Name* you acquired to log it under KRA 2.`;
    }

    const customerName = data.customer_name.trim();

    // Check if customer already exists
    const { data: existing } = await supabase
      .from('recurring_customers')
      .select('id, assigned_salesperson_phone')
      .ilike('customer_name', `%${customerName}%`)
      .limit(1);

    if (existing && existing.length > 0) {
      // Re-assign to this salesperson
      await supabase
        .from('recurring_customers')
        .update({
          assigned_salesperson_phone: senderPhone,
          is_active: true,
        })
        .eq('id', existing[0].id);
    } else {
      // Insert new customer
      await supabase.from('recurring_customers').insert({
        customer_name: customerName,
        contact_person: data.contact_person || null,
        customer_phone: data.phone || null,
        customer_gst: data.gst || null,
        customer_address: data.city || null,
        assigned_salesperson_phone: senderPhone,
        is_active: true,
        avg_order_frequency_days: 30,
      });
    }

    // Log to KRA 2
    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number: 2,
      kra_type: 'new_customer',
      customer_name: customerName,
      description: `New Customer Onboarded: ${customerName}`,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    });

    // Count acquired customers this month
    const { data: kra2Logs } = await supabase
      .from('kra_logs')
      .select('id')
      .eq('salesperson_phone', senderPhone)
      .eq('kra_number', 2)
      .eq('month', new Date().getMonth() + 1)
      .eq('year', new Date().getFullYear());

    const currentCount = kra2Logs ? kra2Logs.length : 1;

    return `👤 *KRA 2 - New Customer Onboarded!*\n\n` +
      `Company: *${customerName}*\n` +
      (data.contact_person ? `Contact: ${data.contact_person}\n` : '') +
      `Monthly Target: *${currentCount} / 3 Onboarded*\n\n` +
      `Added directly to your Account & Customers Dashboard! ✅`;

  } catch (error) {
    console.error('Customer Agent Error:', error.message);
    return `⚠️ Could not process customer onboarding: ${error.message}`;
  }
}

module.exports = { processCustomerMessage };
