/**
 * KRA 2 - New Customer Acquisition Agent
 *
 * DESIGN PRINCIPLES:
 * - One entry per NEW customer in recurring_customers table.
 * - KRA 2 log is only created ONCE per customer per salesperson (not on updates/re-onboarding).
 * - If customer already exists and is assigned to this salesperson → update profile, no new KRA 2 log.
 * - If customer exists but is assigned to a different salesperson → treat as new acquisition for this salesperson.
 *
 * EDGE CASES HANDLED:
 * 1.  New customer, full info → insert to recurring_customers + log KRA 2
 * 2.  New customer, partial info → insert with available info + prompt for missing fields
 * 3.  Customer already onboarded by THIS salesperson → update profile, NO duplicate KRA 2 log
 * 4.  Customer exists under different salesperson → count as new acquisition for this salesperson
 * 5.  Missing customer name → ask for clarification
 * 6.  Duplicate KRA 2 log prevention → check existing KRA logs before logging
 * 7.  Monthly progress count → computed from distinct customers, not raw log count
 * 8.  GST / phone / city all optional but prompted if missing
 * 9.  Hinglish/casual → AI handles semantic parsing
 */

const { supabase } = require('../supabase');
const { syncActivity } = require('./biginSyncAgent');

const CUSTOMER_AGENT_PROMPT = `
You are the Specialized Customer Onboarding AI Agent (KRA 2) for Enlight Metals.
Your job is to parse salesperson new customer acquisition reports.

The salesperson message may be informal, in Hinglish, or missing expected keywords.
Understand the meaning and context — do not look for specific words.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no prose, no markdown, no backticks):
{
  "customer_name": "<new company/customer name, else null>",
  "contact_person": "<contact person/owner name if mentioned, else null>",
  "phone": "<phone number if mentioned (digits only), else null>",
  "gst": "<GST number if mentioned, else null>",
  "city": "<city/location if mentioned, else null>",
  "confidence": <float 0.0 to 1.0>
}

Return ONLY the JSON object.
`;

/**
 * Check if KRA 2 was already logged for this customer by this salesperson this month.
 * Prevents duplicate KRA 2 logs when the same customer info is re-sent.
 */
async function isKRA2AlreadyLogged(senderPhone, customerName) {
  const month = new Date().getMonth() + 1;
  const year  = new Date().getFullYear();

  const { data } = await supabase
    .from('kra_logs')
    .select('id')
    .eq('salesperson_phone', senderPhone)
    .eq('kra_number', 2)
    .eq('month', month)
    .eq('year', year)
    .ilike('customer_name', `%${customerName}%`)
    .limit(1);

  return data && data.length > 0;
}

/**
 * Count distinct customers onboarded this month by this salesperson.
 */
async function getMonthlyOnboardCount(senderPhone) {
  const month = new Date().getMonth() + 1;
  const year  = new Date().getFullYear();

  const { data } = await supabase
    .from('kra_logs')
    .select('customer_name')
    .eq('salesperson_phone', senderPhone)
    .eq('kra_number', 2)
    .eq('month', month)
    .eq('year', year);

  if (!data || data.length === 0) return 0;

  // Count distinct customer names
  const distinct = new Set(data.map(r => (r.customer_name || '').toLowerCase().trim()));
  return distinct.size;
}

async function processCustomerMessage(text, senderPhone) {
  try {
    const { invokeWithFallback } = require('../core/modelRouter');
    const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
    const response = await invokeWithFallback([
      new SystemMessage(CUSTOMER_AGENT_PROMPT),
      new HumanMessage('Salesperson message:\n' + text),
    ]);
    const rawText = (typeof response.content === 'string' ? response.content : JSON.stringify(response.content)).trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);

    const { getActiveSession, getFullActiveSession, saveActiveSession, verifyAndGetCustomerName } = require('../supabase');

    // ── Session Context & Pending Payload Resolution ──────────────────────
    let activeCustomer = await getActiveSession(senderPhone);
    const fullSession  = await getFullActiveSession(senderPhone);

    // If company name is missing, try to resolve from active customer session
    if (!data.customer_name && activeCustomer && activeCustomer !== 'PENDING_PROFILE') {
      data.customer_name = activeCustomer;
      console.log(`[CustomerAgent] Resolved missing company name from active session: "${activeCustomer}"`);
    }

    // Check if there was a pending profile update payload from a previous turn
    let pendingPayload = null;
    if (fullSession && fullSession.last_intent && fullSession.last_intent.startsWith('pending_profile|')) {
      try {
        const jsonStr = fullSession.last_intent.replace('pending_profile|', '');
        pendingPayload = JSON.parse(jsonStr);
      } catch (e) { /* ignore parse error */ }
    }

    // Merge pending profile details if available
    if (pendingPayload) {
      data.phone          = data.phone          || pendingPayload.phone          || null;
      data.contact_person = data.contact_person || pendingPayload.contact_person || null;
      data.city           = data.city           || pendingPayload.city           || null;
      data.gst            = data.gst            || pendingPayload.gst            || null;
    }

    // If STILL no customer name after session check
    if (!data.customer_name) {
      if (data.phone || data.contact_person || data.city || data.gst) {
        // Save pending profile data so when user responds with company name, it merges!
        const payloadStr = JSON.stringify({
          phone:          data.phone,
          contact_person: data.contact_person,
          city:           data.city,
          gst:            data.gst
        });
        await saveActiveSession(senderPhone, 'PENDING_PROFILE', `pending_profile|${payloadStr}`);
        return `Oops! I missed getting the *Company Name* for this customer. 😅\n\n` +
          `Could you please tell me the Company Name for ${data.contact_person ? `*${data.contact_person}*` : 'this contact'}` +
          (data.phone ? ` with mobile number *${data.phone}*` : '') + `?\n\n` +
          `Once I have that, I'll get their profile updated right away!`;
      }

      return `⚠️ *Customer Agent — Company Name Missing*\n\nPlease specify the *New Customer/Company Name* to log it under KRA 2.\nExample: _"New customer Mehta Industries owner Mr Mehta phone 9812345678 Pune"_`;
    }

    const customerName = data.customer_name.trim();

    // Verify and get official customer name from salesperson's registered customers (handles typos)
    const officialCustomerName = await verifyAndGetCustomerName(customerName, senderPhone);

    let existing = null;
    if (officialCustomerName) {
      const { data: found } = await supabase
        .from('recurring_customers')
        .select('id, assigned_salesperson_phone, customer_phone, customer_gst, customer_address, contact_person, notes')
        .eq('customer_name', officialCustomerName)
        .eq('assigned_salesperson_phone', senderPhone)
        .limit(1);
      existing = found;
    }

    const finalCustomerName = officialCustomerName || customerName;
    const notesText = data.contact_person ? `Owner: ${data.contact_person}` : null;
    let isNewAcquisition = true;

    if (existing && existing.length > 0) {
      const record = existing[0];

      // Edge Case 3: Same salesperson → update profile only, NOT a new acquisition
      if (record.assigned_salesperson_phone === senderPhone) {
        isNewAcquisition = false;
      }
      // Edge Case 4: Different salesperson → is a new acquisition for this salesperson

      // Always update the record with any new info provided
      await supabase
        .from('recurring_customers')
        .update({
          assigned_salesperson_phone: senderPhone,
          customer_phone:    data.phone          || record.customer_phone    || null,
          customer_gst:      data.gst            || record.customer_gst      || null,
          customer_address:  data.city           || record.customer_address  || null,
          contact_person:    data.contact_person || record.contact_person    || null,
          notes:             notesText           || record.notes             || null,
          is_active:         true,
          updated_at:        new Date().toISOString(),
        })
        .eq('id', record.id);
    } else {
      // officialCustomerName was null — do a direct fuzzy search as fallback
      // This catches typo variations ("Mehta Engg" vs "Mehta Engineering")
      const { data: fuzzyMatch } = await supabase
        .from('recurring_customers')
        .select('id, customer_name, assigned_salesperson_phone, customer_phone, customer_gst, customer_address, contact_person, notes')
        .ilike('customer_name', `%${customerName.split(' ')[0]}%`) // search by first word
        .eq('assigned_salesperson_phone', senderPhone)
        .limit(1);

      if (fuzzyMatch && fuzzyMatch.length > 0) {
        // Existing customer found via fuzzy match — update, don't insert
        const record = fuzzyMatch[0];
        isNewAcquisition = false;
        await supabase
          .from('recurring_customers')
          .update({
            customer_phone:   data.phone          || record.customer_phone    || null,
            customer_gst:     data.gst            || record.customer_gst      || null,
            customer_address: data.city           || record.customer_address  || null,
            contact_person:   data.contact_person || record.contact_person    || null,
            notes:            notesText           || record.notes             || null,
            is_active:        true,
            updated_at:       new Date().toISOString(),
          })
          .eq('id', record.id);

        // Prompt missing info for the found customer
        const missingInfo = [];
        if (!record.customer_phone && !data.phone) missingInfo.push('• 📱 *Mobile Number*');
        if (!record.contact_person && !data.contact_person) missingInfo.push('• 👤 *Owner / Contact Person Name*');
        if (!record.customer_address && !data.city) missingInfo.push('• 📍 *City / Location*');
        if (!record.customer_gst && !data.gst) missingInfo.push('• 🧾 *GSTIN* (optional)');
        const promptSuffix = missingInfo.length > 0
          ? `\n\n📌 *To complete the profile, reply with:*\n${missingInfo.join('\n')}`
          : '';

        return `ℹ️ *Customer Already Exists*\n\n` +
          `*${record.customer_name}* is already registered under your account.\n` +
          (data.contact_person ? `Contact updated to: *${data.contact_person}*\n` : '') +
          (data.phone          ? `Phone updated to: *${data.phone}*\n` : '') +
          (data.city           ? `City updated to: *${data.city}*\n` : '') +
          `\n_Profile updated — KRA 2 not re-counted to avoid duplicates._` +
          promptSuffix;
      } else {
        // Genuinely brand new customer — safe to insert
        await supabase.from('recurring_customers').insert({
          customer_name:              finalCustomerName,
          customer_phone:             data.phone || null,
          customer_gst:               data.gst   || null,
          customer_address:           data.city  || null,
          contact_person:             data.contact_person || null,
          notes:                      notesText,
          assigned_salesperson_phone: senderPhone,
          is_active:                  true,
          avg_order_frequency_days:   30,
        });
      }
    }

    // Sync contact_person and customer_phone to customer_visits rows for this customer
    if (data.contact_person || data.phone) {
      const visitUpdate = {};
      if (data.contact_person) visitUpdate.person_met = data.contact_person;
      if (data.phone)          visitUpdate.contact_no = data.phone;

      await supabase
        .from('customer_visits')
        .update(visitUpdate)
        .ilike('customer_name', `%${finalCustomerName}%`)
        .eq('salesperson_phone', senderPhone);
    }

    // Save active customer session context
    await saveActiveSession(senderPhone, finalCustomerName, 'onboarding_prompted');

    // Log KRA 2 once per customer per salesperson per month
    const alreadyLogged = await isKRA2AlreadyLogged(senderPhone, finalCustomerName);

    if (!alreadyLogged) {
      await supabase.from('kra_logs').insert({
        salesperson_phone: senderPhone,
        kra_number:        2,
        kra_type:          'new_customer',
        customer_name:     finalCustomerName,
        description:       `New Customer Onboarded: ${finalCustomerName}`,
        month:             new Date().getMonth() + 1,
        year:              new Date().getFullYear(),
      });
    }

    // Edge Case 7: Distinct count for accurate monthly progress
    const currentCount = await getMonthlyOnboardCount(senderPhone);

    // Prompt for missing info
    const missingInfo = [];
    if (!data.phone)          missingInfo.push('• 📱 *Mobile Number*');
    if (!data.contact_person) missingInfo.push('• 👤 *Owner / Contact Person Name*');
    if (!data.city)           missingInfo.push('• 📍 *City / Location*');
    if (!data.gst)            missingInfo.push('• 🧾 *GSTIN* (optional)');

    const promptSuffix = missingInfo.length > 0
      ? `\n\n📌 *To complete ${finalCustomerName}'s profile, reply with:*\n${missingInfo.join('\n')}` +
        `\n\n_(e.g. "${finalCustomerName} phone 9876543210 owner Mr. Kapoor location Mumbai")_`
      : '';

    if (alreadyLogged && !isNewAcquisition) {
      return `✅ *Customer Profile Updated!*\n\n` +
        `Company: *${finalCustomerName}*\n` +
        (data.contact_person ? `Contact: *${data.contact_person}*\n` : '') +
        (data.phone          ? `Phone: *${data.phone}*\n` : '') +
        (data.city           ? `City: *${data.city}*\n` : '') +
        `\n_Note: ${finalCustomerName} profile updated on your dashboard._` +
        promptSuffix;
    }

    // Async Zoho Bigin Smart Sync (both new onboarding and profile update)
    syncActivity('new_customer', {
      customerName:  finalCustomerName,
      phone:         data.phone || null,
      gst:           data.gst || null,
      city:          data.city || null,
      contactPerson: data.contact_person || null,
      senderPhone,
    });

    return `👤 *KRA 2 - New Customer Onboarded!*\n\n` +
      `Company: *${finalCustomerName}*\n` +
      (data.contact_person ? `Contact/Owner: *${data.contact_person}*\n` : '') +
      (data.phone          ? `Phone: *${data.phone}*\n` : '') +
      (data.city           ? `City: *${data.city}*\n` : '') +
      `Monthly Progress: *${currentCount} / 3 Onboarded*\n\n` +
      `Added live to your Customers Dashboard! ✅` +
      promptSuffix;

  } catch (error) {
    console.error('Customer Agent Error:', error.message);
    return `⚠️ Could not process customer onboarding: ${error.message}`;
  }
}

module.exports = { processCustomerMessage, isKRA2AlreadyLogged };
