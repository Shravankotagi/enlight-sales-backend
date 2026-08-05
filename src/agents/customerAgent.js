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

    const notesText = data.contact_person ? `Owner: ${data.contact_person}` : null;

    if (existing && existing.length > 0) {
      // Re-assign & update customer record
      await supabase
        .from('recurring_customers')
        .update({
          assigned_salesperson_phone: senderPhone,
          customer_phone: data.phone || existing[0].customer_phone || null,
          customer_gst: data.gst || existing[0].customer_gst || null,
          customer_address: data.city || existing[0].customer_address || null,
          notes: notesText || existing[0].notes || null,
          is_active: true,
        })
        .eq('id', existing[0].id);
    } else {
      // Insert new customer using valid columns
      await supabase.from('recurring_customers').insert({
        customer_name: customerName,
        customer_phone: data.phone || null,
        customer_gst: data.gst || null,
        customer_address: data.city || null,
        notes: notesText,
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

    // Check missing profile info to prompt salesperson
    const missingInfo = [];
    if (!data.phone) missingInfo.push('• 📱 *Mobile Number*');
    if (!data.contact_person) missingInfo.push('• 👤 *Owner / Contact Person Name*');
    if (!data.city) missingInfo.push('• 📍 *City / Location*');
    if (!data.gst) missingInfo.push('• 🧾 *GSTIN* (optional)');

    let promptSuffix = '';
    if (missingInfo.length > 0) {
      promptSuffix =
        `\n\n📌 *To complete ${customerName}'s profile, reply with missing details:*\n` +
        missingInfo.join('\n') +
        `\n\n*(e.g. "${customerName} phone 9876543210 owner Mr. Kapoor location Mumbai")*`;
    }

    return `👤 *KRA 2 - New Customer Onboarded!*\n\n` +
      `Company: *${customerName}*\n` +
      (data.contact_person ? `Contact/Owner: *${data.contact_person}*\n` : '') +
      (data.phone ? `Phone: *${data.phone}*\n` : '') +
      (data.city ? `City: *${data.city}*\n` : '') +
      `Monthly Progress: *${currentCount} / 3 Onboarded*\n\n` +
      `Added live to your Customers Dashboard! ✅` +
      promptSuffix;

  } catch (error) {
    console.error('Customer Agent Error:', error.message);
    return `⚠️ Could not process customer onboarding: ${error.message}`;
  }
}

module.exports = { processCustomerMessage };
