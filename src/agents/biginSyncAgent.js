/**
 * Zoho Bigin Smart Sync Agent
 *
 * Syncs the FINAL OUTCOME of every sales activity to Zoho Bigin CRM.
 * Replaces the old raw per-event sync with AI-generated summaries + full data.
 *
 * SYNC STRATEGY:
 * - Contact  → created/updated for every customer interaction
 * - Deal     → upserted (search by name, update if found, create if not)
 * - Note     → added to Contact for visits, payments, complaints
 *
 * Activities synced:
 *   1. deal         → Contact + Deal upsert
 *   2. visit        → Contact upsert + Note
 *   3. payment      → Contact upsert + Note + Deal description update
 *   4. complaint    → Contact upsert + Note
 *   5. new_customer → Contact create/update (full details)
 */

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const ZOHO_TOKEN_URL   = 'https://accounts.zoho.in/oauth/v2/token';
const ZOHO_BIGIN_BASE  = 'https://www.zohoapis.in/bigin/v1';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let cachedZohoToken = null;
let tokenExpiresAt = 0;

/**
 * Get a fresh Zoho OAuth access token using the stored refresh token.
 * Caches token for 50 minutes to avoid hitting Zoho OAuth rate limits.
 */
async function getZohoAccessToken() {
  if (cachedZohoToken && Date.now() < tokenExpiresAt) {
    return cachedZohoToken;
  }

  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id:     process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type:    'refresh_token',
  });
  const res = await axios.post(ZOHO_TOKEN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.data.access_token) throw new Error('No access_token in Zoho response');

  cachedZohoToken = res.data.access_token;
  tokenExpiresAt = Date.now() + 50 * 60 * 1000;
  return cachedZohoToken;
}

function zohoHeaders(token) {
  return {
    Authorization: 'Zoho-oauthtoken ' + token,
    'Content-Type': 'application/json',
  };
}

/**
 * Lookup the salesperson's name from Supabase by phone.
 */
async function getSalespersonName(phone) {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('employees')
      .select('name, role')
      .eq('phone', phone)
      .single();
    return data ? data.name : phone;
  } catch { return phone; }
}

/**
 * Lookup full customer details from recurring_customers.
 */
async function getCustomerDetails(customerName) {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('recurring_customers')
      .select('customer_name, customer_phone, customer_gst, customer_address, contact_person, avg_order_frequency_days')
      .ilike('customer_name', `%${customerName}%`)
      .single();
    return data || {};
  } catch { return {}; }
}

/**
 * Use Gemini to generate a professional 2-3 line CRM summary.
 */
async function generateSummary(activityType, data) {
  try {
    const { invokeWithFallback } = require('../core/modelRouter');
    const { HumanMessage } = require('@langchain/core/messages');
    const prompts = {
      deal:         `Write a concise 2-3 line professional CRM note for a steel B2B deal update. Data: ${JSON.stringify(data)}. Include: what changed, amount if any, key context. No bullet points.`,
      visit:        `Write a concise 2-3 line professional CRM field visit note for a steel B2B company. Data: ${JSON.stringify(data)}. Include: who was met, what was discussed, outcome. No bullet points.`,
      payment:      `Write a concise 2-3 line professional CRM payment update note for a steel B2B company. Data: ${JSON.stringify(data)}. Include: amount received, outstanding if any, payment status. No bullet points.`,
      complaint:    `Write a concise 2-3 line professional CRM complaint note for a steel B2B company. Data: ${JSON.stringify(data)}. Include: issue type, severity, current status. No bullet points.`,
      new_customer: `Write a concise 2-3 line professional CRM new customer onboarding note for a steel B2B company. Data: ${JSON.stringify(data)}. Include: who they are, city, what was discussed. No bullet points.`,
    };
    const prompt = prompts[activityType] || `Summarize this CRM activity in 2-3 lines: ${JSON.stringify(data)}`;
    const result = await invokeWithFallback([new HumanMessage(prompt)]);
    return (typeof result.content === 'string' ? result.content : JSON.stringify(result.content)).trim();
  } catch (err) {
    console.error('Bigin summary generation error:', err.message);
    return `${activityType} update for ${data.customerName || 'customer'} logged on ${new Date().toLocaleDateString('en-IN')}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ZOHO BIGIN API CALLS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Search for a Contact in Bigin by company name. Returns the record ID or null.
 */
async function findBiginContact(customerName, token) {
  try {
    const res = await axios.get(`${ZOHO_BIGIN_BASE}/Contacts/search`, {
      headers: zohoHeaders(token),
      params: { criteria: `(Last_Name:equals:${customerName})`, fields: 'id,Last_Name' },
    });
    const records = res.data?.data;
    return records && records.length > 0 ? records[0].id : null;
  } catch { return null; }
}

/**
 * Create or update a Bigin Contact with full customer details.
 */
async function upsertBiginContact(customerDetails, salespersonName, token) {
  const name = customerDetails.customer_name || customerDetails.customerName || 'Unknown';
  const existingId = await findBiginContact(name, token);

  const payload = {
    data: [{
      Last_Name:    name,                // Required field in Bigin v1
      Company:      name,                // Company/Account name
      Phone:        customerDetails.customer_phone || customerDetails.phone || '',
      Mobile:       customerDetails.customer_phone || customerDetails.phone || '',
      City:         customerDetails.customer_address || customerDetails.city || '',
      Description:  [
        `Contact Person: ${customerDetails.contact_person || 'N/A'}`,
        `GST: ${customerDetails.customer_gst || customerDetails.gst || 'N/A'}`,
        `Salesperson: ${salespersonName}`,
        `Order Frequency: Every ${customerDetails.avg_order_frequency_days || 30} days`,
      ].join(' | '),
      Lead_Source:  'WhatsApp Bot',
    }],
  };

  if (existingId) {
    await axios.put(`${ZOHO_BIGIN_BASE}/Contacts/${existingId}`, payload, { headers: zohoHeaders(token) });
    return existingId;
  } else {
    const res = await axios.post(`${ZOHO_BIGIN_BASE}/Contacts`, payload, { headers: zohoHeaders(token) });
    return res.data?.data?.[0]?.details?.id || null;
  }
}

/**
 * Search for an existing Deal in Bigin by customer name. Returns ID or null.
 */
async function findBiginDeal(customerName, token) {
  try {
    const res = await axios.get(`${ZOHO_BIGIN_BASE}/Deals/search`, {
      headers: zohoHeaders(token),
      params: { criteria: `(Deal_Name:contains:${customerName})`, fields: 'id,Deal_Name,Stage' },
    });
    const records = res.data?.data;
    return records && records.length > 0 ? records[0] : null;
  } catch { return null; }
}

const STAGE_MAP = {
  won:         'Closed Won',
  lost:        'Closed Lost',
  negotiation: 'Negotiation/Review',
  quoted:      'Value Proposition',
  qualified:   'Qualification',
  new:         'Qualification',
};

/**
 * Create or update a Deal in Bigin with full context.
 */
async function upsertBiginDeal({ customerName, stage, amount, poNumber, salespersonName, summary, products, paymentTerms, contactId }, token) {
  const existing = await findBiginDeal(customerName, token);
  const dealName = `${customerName} - Steel Deal`;

  const productLine = products && products.length > 0
    ? products.map(p => `${p.sku_text || p.name || 'Item'}: ${p.quantity || 0} ${p.unit || 'MT'} @ ₹${p.rate || 0}`).join(', ')
    : 'See description';

  const description = [
    summary,
    ``,
    `📋 Details:`,
    `• Customer: ${customerName}`,
    `• Salesperson: ${salespersonName}`,
    `• Products: ${productLine}`,
    `• PO Number: ${poNumber || 'N/A'}`,
    `• Payment Terms: ${paymentTerms || 'N/A'}`,
    `• Last Updated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
  ].join('\n');

  const payload = {
    data: [{
      Deal_Name:    dealName,
      Stage:        STAGE_MAP[stage] || 'Qualification',
      Amount:       amount || 0,
      Closing_Date: new Date().toISOString().split('T')[0],
      Description:  description,
      Lead_Source:  'WhatsApp Bot',
      ...(contactId ? { Contact_Name: { id: contactId } } : {}),
    }],
  };

  if (existing) {
    await axios.put(`${ZOHO_BIGIN_BASE}/Deals/${existing.id}`, payload, { headers: zohoHeaders(token) });
    return existing.id;
  } else {
    try {
      const res = await axios.post(`${ZOHO_BIGIN_BASE}/Deals`, payload, { headers: zohoHeaders(token) });
      return res.data?.data?.[0]?.details?.id || null;
    } catch (err) {
      console.warn(`[BiginSync] Deal creation notice: ${err.response?.data?.data?.[0]?.message || err.message}`);
      return null;
    }
  }
}

/**
 * Add a Note to a Contact in Bigin v1.
 */
async function addBiginNote({ contactId, noteTitle, noteContent }, token) {
  const payload = {
    data: [{
      Note_Title:   noteTitle,
      Note_Content: noteContent,
      $se_module:   'Contacts',
      Parent_Id:    contactId,
    }],
  };
  try {
    await axios.post(`${ZOHO_BIGIN_BASE}/Notes`, payload, { headers: zohoHeaders(token) });
  } catch (err) {
    console.error('[BiginSync] Note add error:', err.response?.data || err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SYNC ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main sync function — call this from any agent after a successful activity log.
 *
 * @param {string} activityType - 'deal' | 'visit' | 'payment' | 'complaint' | 'new_customer'
 * @param {object} data         - Activity-specific data payload (see below for each type)
 *
 * Deal:         { customerName, stage, amount, poNumber, senderPhone, products, paymentTerms }
 * Visit:        { customerName, personMet, remarks, visitOutcome, senderPhone }
 * Payment:      { customerName, amountPaid, amountPending, paymentType, isFullPayment, senderPhone }
 * Complaint:    { customerName, complaintType, description, action, senderPhone }
 * New Customer: { customerName, phone, gst, city, contactPerson, senderPhone }
 */
async function syncActivity(activityType, data) {
  // Non-blocking — fire and forget, never crash the caller
  setImmediate(async () => {
    try {
      console.log(`[BiginSync] Starting sync: ${activityType} for ${data.customerName}`);

      const token           = await getZohoAccessToken();
      const salespersonName = await getSalespersonName(data.senderPhone);
      const customerDetails = await getCustomerDetails(data.customerName);

      // Merge incoming data with DB customer details
      const mergedCustomer = {
        ...customerDetails,
        customer_name:  data.customerName  || customerDetails.customer_name,
        customer_phone: data.phone         || customerDetails.customer_phone,
        customer_gst:   data.gst           || customerDetails.customer_gst,
        customer_address: data.city        || customerDetails.customer_address,
        contact_person: data.contactPerson || customerDetails.contact_person,
      };

      // Generate AI summary
      const summaryData = { ...data, salespersonName, customerDetails: mergedCustomer };
      const summary = await generateSummary(activityType, summaryData);

      // 1. Always upsert the Contact
      const contactId = await upsertBiginContact(mergedCustomer, salespersonName, token);

      // 2. Activity-specific sync
      switch (activityType) {
        case 'deal': {
          await upsertBiginDeal({
            customerName:  data.customerName,
            stage:         data.stage,
            amount:        data.amount,
            poNumber:      data.poNumber,
            salespersonName,
            summary,
            products:      data.products || [],
            paymentTerms:  data.paymentTerms,
            contactId,
          }, token);
          break;
        }

        case 'visit': {
          if (contactId) {
            await addBiginNote({
              contactId,
              noteTitle:   `Field Visit — ${new Date().toLocaleDateString('en-IN')}`,
              noteContent: [
                summary,
                '',
                `👤 Person Met: ${data.personMet || 'N/A'}`,
                `📊 Outcome: ${data.visitOutcome || 'neutral'}`,
                `📝 Remarks: ${data.remarks || 'N/A'}`,
                `👨‍💼 Salesperson: ${salespersonName}`,
                `📅 Date: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
              ].join('\n'),
            }, token);
          }
          break;
        }

        case 'payment': {
          if (contactId) {
            await addBiginNote({
              contactId,
              noteTitle:   `Payment Update — ${new Date().toLocaleDateString('en-IN')}`,
              noteContent: [
                summary,
                '',
                `💰 Amount Received: ₹${Number(data.amountPaid || 0).toLocaleString('en-IN')}`,
                `📋 Outstanding: ₹${Number(data.amountPending || 0).toLocaleString('en-IN')}`,
                `🏷️ Type: ${data.paymentType || 'N/A'}`,
                `✅ Full Settlement: ${data.isFullPayment ? 'Yes' : 'No'}`,
                `👨‍💼 Salesperson: ${salespersonName}`,
                `📅 Date: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
              ].join('\n'),
            }, token);
          }
          // Also update the deal description if there's an existing deal
          const dealData = {
            customerName: data.customerName,
            stage:        data.isFullPayment ? 'won' : 'negotiation',
            amount:       data.amountPaid || 0,
            salespersonName,
            summary,
            contactId,
            products:     [],
          };
          await upsertBiginDeal(dealData, token);
          break;
        }

        case 'complaint': {
          if (contactId) {
            await addBiginNote({
              contactId,
              noteTitle:   `Complaint ${data.action === 'resolve' ? 'Resolved' : 'Reported'} — ${new Date().toLocaleDateString('en-IN')}`,
              noteContent: [
                summary,
                '',
                `⚠️ Type: ${data.complaintType || 'N/A'}`,
                `📋 Action: ${data.action === 'resolve' ? '✅ Resolved' : '🔴 Reported'}`,
                `📝 Description: ${data.description || 'N/A'}`,
                `👨‍💼 Salesperson: ${salespersonName}`,
                `📅 Date: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
              ].join('\n'),
            }, token);
          }
          break;
        }

        case 'new_customer': {
          // Contact was already upserted above with full details
          // Add an onboarding note
          if (contactId) {
            await addBiginNote({
              contactId,
              noteTitle:   `New Customer Onboarded — ${new Date().toLocaleDateString('en-IN')}`,
              noteContent: [
                summary,
                '',
                `🏢 Company: ${data.customerName}`,
                `📱 Phone: ${data.phone || mergedCustomer.customer_phone || 'N/A'}`,
                `🧾 GST: ${data.gst || mergedCustomer.customer_gst || 'N/A'}`,
                `📍 City: ${data.city || mergedCustomer.customer_address || 'N/A'}`,
                `👤 Contact Person: ${data.contactPerson || mergedCustomer.contact_person || 'N/A'}`,
                `👨‍💼 Onboarded by: ${salespersonName}`,
                `📅 Date: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
              ].join('\n'),
            }, token);
          }
          break;
        }

        default:
          console.warn(`[BiginSync] Unknown activity type: ${activityType}`);
      }

      console.log(`[BiginSync] ✅ Synced ${activityType} for ${data.customerName} → Bigin`);
    } catch (err) {
      console.error(`[BiginSync] ❌ Sync failed for ${activityType}:`, err.response?.data || err.message);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEANUP UTILITY — Deletes ALL records from Bigin (Deals, Contacts, Notes)
// ─────────────────────────────────────────────────────────────────────────────

async function clearAllBiginData() {
  const results = { deleted: {}, errors: [] };
  try {
    console.log('[BiginSync] Starting full Bigin data cleanup...');
    const token = await getZohoAccessToken();

    // Delete Notes first (they reference Contacts/Deals), then Deals, then Contacts
    const moduleFields = {
      Notes:    'id,Note_Title',
      Deals:    'id,Deal_Name',
      Contacts: 'id,Full_Name',
    };

    for (const module of ['Notes', 'Deals', 'Contacts']) {
      results.deleted[module] = 0;
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        try {
          const res = await axios.get(`${ZOHO_BIGIN_BASE}/${module}`, {
            headers: zohoHeaders(token),
            params: { page, per_page: 100, fields: moduleFields[module] },
          });

          const records = res.data?.data || [];
          if (records.length === 0) {
            hasMore = false;
            break;
          }

          const ids = records.map(r => r.id).filter(Boolean);
          if (ids.length > 0) {
            const delRes = await axios.delete(`${ZOHO_BIGIN_BASE}/${module}`, {
              headers: zohoHeaders(token),
              params: { ids: ids.join(',') },
            });
            const deleted = delRes.data?.data?.filter(r => r.status === 'success').length || ids.length;
            results.deleted[module] += deleted;
            console.log(`[BiginSync] Deleted ${deleted} ${module} (page ${page})`);
          }

          hasMore = res.data?.info?.more_records === true;
          page++;
          await new Promise(r => setTimeout(r, 600));
        } catch (err) {
          const errMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
          console.error(`[BiginSync] Error on ${module} page ${page}:`, errMsg);
          results.errors.push(`${module}: ${errMsg}`);
          hasMore = false;
        }
      }

      console.log(`[BiginSync] ${module}: ${results.deleted[module]} total deleted`);
    }

    console.log('[BiginSync] ✅ Full Bigin cleanup complete:', results.deleted);
    return results;
  } catch (err) {
    console.error('[BiginSync] Cleanup failed:', err.message);
    throw err;
  }
}

module.exports = { syncActivity, clearAllBiginData };
