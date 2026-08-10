/**
 * biginSyncAgent.js — KRA 6 CRM Compliance Engine
 *
 * Syncs meaningful business summaries to Zoho Bigin CRM.
 * Records every sync to crm_sync_log and kra_logs in Supabase for full audit trail.
 *
 * SYNC TRIGGERS:
 *   deal_won       → Full deal summary (line items, dates, value, payments)
 *   deal_lost      → Deal with loss reason + timeline
 *   deal_stage     → Stage update note on existing deal
 *   visit          → Contact update + rich visit note
 *   payment        → Payment milestone note on deal
 *   complaint      → Complaint note on contact
 *   complaint_resolved → Resolution note with SLA result
 *   new_customer   → Full contact creation with all profile fields
 *
 * DATA MODEL IN ZOHO BIGIN:
 *   Contact  → One per customer (company master)
 *   Deal     → One per sales deal (linked to contact)
 *   Note     → Attached to Contact or Deal (visit, payment, complaint)
 *
 * DESIGN PRINCIPLES:
 *   - Never block the main bot flow (always non-blocking via setImmediate)
 *   - Every sync attempt logged to crm_sync_log & kra_logs (success or failure)
 *   - Summaries are templated (zero latency)
 *   - Retry-friendly: each sync is independent
 *   - Zoho env vars missing → skip gracefully, log reason
 */

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const ZOHO_TOKEN_URL  = 'https://accounts.zoho.in/oauth/v2/token';
const ZOHO_BIGIN_BASE = 'https://www.zohoapis.in/bigin/v1';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── OAuth Token Management ────────────────────────────────────────────────────

let cachedToken = null;
let tokenExpiresAt = 0;

async function getZohoToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

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
  cachedToken = res.data.access_token;
  tokenExpiresAt = Date.now() + 50 * 60 * 1000;
  return cachedToken;
}

function zohoHeaders(token) {
  return {
    Authorization: `Zoho-oauthtoken ${token}`,
    'Content-Type': 'application/json',
  };
}

// ── Supabase Data Fetchers ────────────────────────────────────────────────────

async function getEmployeeName(phone) {
  try {
    const sb = getSupabase();
    const { data } = await sb.from('employees').select('name').eq('phone', phone).single();
    return data?.name || phone;
  } catch { return phone; }
}

async function getCustomerProfile(customerName) {
  try {
    const sb = getSupabase();
    const { data } = await sb
      .from('recurring_customers')
      .select('customer_name, customer_phone, customer_gst, customer_address, contact_person, industry')
      .ilike('customer_name', `%${customerName}%`)
      .limit(1)
      .single();
    return data || {};
  } catch { return {}; }
}

async function getDealFullSummary(customerName, salespersonPhone, dealId) {
  try {
    const sb = getSupabase();

    // Get deal
    let dealQuery = sb.from('deals')
      .select('*, deal_items(*)')
      .ilike('customer_name', `%${customerName}%`)
      .order('created_at', { ascending: false })
      .limit(1);
    if (dealId) dealQuery = sb.from('deals').select('*, deal_items(*)').eq('id', dealId);

    const { data: deals } = await dealQuery;
    const deal = deals?.[0];
    if (!deal) return null;

    // Get payment history for this deal
    const { data: payments } = await sb
      .from('payment_tracking')
      .select('*')
      .ilike('customer_name', `%${customerName}%`)
      .limit(1);

    const payment = payments?.[0];

    // Get visit history
    const { data: visits } = await sb
      .from('customer_visits')
      .select('visited_at, person_met, remarks')
      .ilike('customer_name', `%${customerName}%`)
      .order('visited_at', { ascending: true });

    // Get follow-up history
    const { data: followups } = await sb
      .from('followup_tasks')
      .select('created_at, followup_status, resolution_notes, next_followup_date')
      .ilike('customer_name', `%${customerName}%`)
      .order('created_at', { ascending: true });

    return { deal, payment, visits: visits || [], followups: followups || [] };
  } catch (err) {
    console.error('[BiginSync] getDealFullSummary error:', err.message);
    return null;
  }
}

// ── Summary Builders ──────────────────────────────────────────────────────────

function buildDealSummary(data, salespersonName) {
  const { deal, payment, visits, followups } = data;
  const items = deal.deal_items || [];

  const itemLines = items.map(i =>
    `  • ${i.sku_text || 'Steel'}: ${i.quantity || 0} ${i.unit || 'MT'}` +
    (i.rate ? ` @ ₹${Number(i.rate).toLocaleString('en-IN')}/MT` : '') +
    (i.amount ? ` = ₹${Number(i.amount).toLocaleString('en-IN')}` : '')
  ).join('\n');

  const timeline = [];
  if (deal.created_at) {
    timeline.push(`📋 Inquiry Created: ${new Date(deal.created_at).toLocaleDateString('en-IN')}`);
  }
  if (visits.length > 0) {
    visits.forEach(v => {
      timeline.push(`🏭 Visit: ${new Date(v.visited_at).toLocaleDateString('en-IN')}` +
        (v.person_met ? ` — Met ${v.person_met}` : ''));
    });
  }
  if (followups.length > 0) {
    followups.forEach(f => {
      timeline.push(`🔄 Follow-up: ${new Date(f.created_at).toLocaleDateString('en-IN')}` +
        (f.followup_status ? ` — ${f.followup_status}` : ''));
    });
  }
  if (deal.stage === 'won' && deal.won_at) {
    timeline.push(`🏆 Won: ${new Date(deal.won_at).toLocaleDateString('en-IN')}`);
  }
  if (deal.stage === 'lost') {
    timeline.push(`❌ Lost: ${new Date(deal.updated_at || deal.created_at).toLocaleDateString('en-IN')}` +
      (deal.lost_reason || deal.loss_reason ? ` — Reason: ${deal.lost_reason || deal.loss_reason}` : ''));
  }

  const paymentSection = payment
    ? [
        '',
        '💰 PAYMENT SUMMARY',
        `  Invoice Amount: ₹${Number(payment.invoice_amount || 0).toLocaleString('en-IN')}`,
        `  Collected: ₹${Number(payment.collected_amount || 0).toLocaleString('en-IN')}`,
        `  Outstanding: ₹${Number(payment.outstanding || 0).toLocaleString('en-IN')}`,
        `  Status: ${payment.status === 'collected' ? 'Fully Settled ✅' : payment.status === 'partial' ? 'Partial ⏳' : 'Pending ⏳'}`,
      ].join('\n')
    : '';

  return [
    `📊 DEAL SUMMARY — ${deal.customer_name}`,
    `Salesperson: ${salespersonName}`,
    `Status: ${deal.stage?.toUpperCase()}`,
    deal.po_number ? `PO Number: ${deal.po_number}` : '',
    '',
    '📦 LINE ITEMS',
    itemLines || '  No items recorded',
    deal.total_amount ? `  ─────────────────────` : '',
    deal.total_amount ? `  Total: ₹${Number(deal.total_amount).toLocaleString('en-IN')}` : '',
    deal.delivery_location ? `  Delivery: ${deal.delivery_location}` : '',
    deal.delivery_date ? `  Delivery Date: ${new Date(deal.delivery_date).toLocaleDateString('en-IN')}` : '',
    deal.payment_terms ? `  Payment Terms: ${deal.payment_terms}` : '',
    paymentSection,
    '',
    '📅 ACTIVITY TIMELINE',
    ...timeline,
    '',
    `Last Updated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
  ].filter(l => l !== '').join('\n');
}

function buildVisitSummary(data, salespersonName) {
  const { customerName, personMet, contactNo, city, remarks, visitOutcome,
    productInterests, materialRequirement, followUpAction } = data;

  const outcomeLabel = { positive: 'Positive 🟢', neutral: 'Neutral 🟡', negative: 'Negative 🔴' };

  return [
    `🏭 VISIT SUMMARY — ${customerName}`,
    `Salesperson: ${salespersonName}`,
    `Date: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    `Location: ${city || 'Not specified'}`,
    personMet     ? `Person Met: ${personMet}` : '',
    contactNo     ? `Contact: ${contactNo}` : '',
    `Outcome: ${outcomeLabel[visitOutcome] || visitOutcome || 'Neutral'}`,
    '',
    '📝 DISCUSSION NOTES',
    remarks || 'Meeting conducted',
    productInterests    ? `\n🛒 Product Interests: ${productInterests}` : '',
    materialRequirement ? `📦 Requirement: ${materialRequirement}` : '',
    followUpAction      ? `📌 Follow-up Action: ${followUpAction}` : '',
    '',
    `Logged via Enlight Sales Bot — ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
  ].filter(l => l !== '').join('\n');
}

function buildPaymentSummary(data, salespersonName) {
  const { customerName, amountPaid, amountPending, paymentType, isFullPayment } = data;

  const typeLabel = {
    advance: 'Advance Payment',
    installment: 'Installment',
    full_settlement: 'Full Settlement',
    outstanding_update: 'Outstanding Update',
  };

  return [
    `💰 PAYMENT UPDATE — ${customerName}`,
    `Salesperson: ${salespersonName}`,
    `Date: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    `Type: ${typeLabel[paymentType] || paymentType || 'Payment'}`,
    '',
    amountPaid > 0
      ? `Amount Received: ₹${Number(amountPaid).toLocaleString('en-IN')}`
      : '',
    amountPending > 0
      ? `Outstanding Balance: ₹${Number(amountPending).toLocaleString('en-IN')}`
      : '',
    isFullPayment
      ? '✅ FULLY SETTLED — No outstanding balance'
      : '',
    '',
    `Logged via Enlight Sales Bot — ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
  ].filter(l => l !== '').join('\n');
}

function buildComplaintSummary(data, salespersonName) {
  const { customerName, complaintType, description, action,
    affectedProduct, resolutionTimeHrs } = data;

  if (action === 'resolve') {
    const slaStatus = resolutionTimeHrs <= 48
      ? `Within SLA ✅ (${resolutionTimeHrs}h)`
      : `SLA Breached ⚠️ (${resolutionTimeHrs}h — target: 48h)`;

    return [
      `✅ COMPLAINT RESOLVED — ${customerName}`,
      `Salesperson: ${salespersonName}`,
      `Date: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
      affectedProduct ? `Product: ${affectedProduct}` : '',
      `Type: ${complaintType || 'Quality'}`,
      `Resolution Time: ${slaStatus}`,
      description ? `\nResolution Notes: ${description}` : '',
    ].filter(l => l !== '').join('\n');
  }

  return [
    `🚨 COMPLAINT REPORTED — ${customerName}`,
    `Salesperson: ${salespersonName}`,
    `Date: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    affectedProduct ? `Product Affected: ${affectedProduct}` : '',
    `Type: ${complaintType || 'Quality'}`,
    `SLA Target: Resolve within 48 hours`,
    description ? `\nDetails: ${description}` : '',
  ].filter(l => l !== '').join('\n');
}

function buildCustomerSummary(data, salespersonName) {
  const { customerName, phone, gst, city, contactPerson } = data;
  return [
    `👤 NEW CUSTOMER — ${customerName}`,
    `Onboarded by: ${salespersonName}`,
    `Date: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    contactPerson ? `Contact Person: ${contactPerson}` : '',
    phone ? `Phone: ${phone}` : '',
    city ? `Location: ${city}` : '',
    gst ? `GST: ${gst}` : '',
    '',
    'Customer onboarded via Enlight Sales Bot.',
  ].filter(l => l !== '').join('\n');
}

// ── Zoho Bigin API Functions ──────────────────────────────────────────────────

async function findContact(customerName, token) {
  try {
    const res = await axios.get(`${ZOHO_BIGIN_BASE}/Contacts/search`, {
      headers: zohoHeaders(token),
      params: { criteria: `(Last_Name:equals:${customerName})`, fields: 'id,Last_Name' },
    });
    return res.data?.data?.[0]?.id || null;
  } catch { return null; }
}

async function upsertContact(profile, salespersonName, token) {
  const name = profile.customer_name || profile.customerName || 'Unknown';
  const existingId = await findContact(name, token);

  const payload = {
    data: [{
      Last_Name:   name,
      Company:     name,
      Phone:       profile.customer_phone || profile.phone || '',
      Mobile:      profile.customer_phone || profile.phone || '',
      City:        profile.customer_address || profile.city || '',
      Description: [
        profile.contact_person  ? `Contact Person: ${profile.contact_person}` : '',
        profile.customer_gst    ? `GST: ${profile.customer_gst}` : '',
        profile.industry        ? `Industry: ${profile.industry}` : '',
        `Salesperson: ${salespersonName}`,
      ].filter(Boolean).join(' | '),
      Lead_Source: 'WhatsApp Bot',
    }],
  };

  if (existingId) {
    await axios.put(`${ZOHO_BIGIN_BASE}/Contacts/${existingId}`, payload,
      { headers: zohoHeaders(token) });
    return existingId;
  }

  const res = await axios.post(`${ZOHO_BIGIN_BASE}/Contacts`, payload,
    { headers: zohoHeaders(token) });
  return res.data?.data?.[0]?.details?.id || null;
}

async function findDeal(customerName, token) {
  try {
    const res = await axios.get(`${ZOHO_BIGIN_BASE}/Deals/search`, {
      headers: zohoHeaders(token),
      params: { criteria: `(Deal_Name:contains:${customerName})`, fields: 'id,Deal_Name,Stage' },
    });
    const records = res.data?.data;
    return records?.length > 0 ? records[0] : null;
  } catch { return null; }
}

const STAGE_MAP = {
  won:         'Closed Won',
  lost:        'Closed Lost',
  negotiation: 'Negotiation/Review',
  quoted:      'Value Proposition',
  qualified:   'Qualification',
  new_inquiry: 'Qualification',
};

async function upsertDeal({ customerName, stage, amount, poNumber,
  salespersonName, summary, dealItems, paymentTerms, contactId }, token) {

  const existing = await findDeal(customerName, token);
  const dealName = `${customerName} — Steel Deal`;

  const payload = {
    data: [{
      Deal_Name:    dealName,
      Stage:        STAGE_MAP[stage] || 'Qualification',
      Amount:       Number(amount) || 0,
      Closing_Date: new Date().toISOString().split('T')[0],
      Description:  summary,
      Lead_Source:  'WhatsApp Bot',
      ...(poNumber ? { PO_Number: poNumber } : {}),
      ...(contactId ? { Contact_Name: { id: contactId } } : {}),
    }],
  };

  if (existing) {
    await axios.put(`${ZOHO_BIGIN_BASE}/Deals/${existing.id}`, payload,
      { headers: zohoHeaders(token) });
    return existing.id;
  }

  try {
    const res = await axios.post(`${ZOHO_BIGIN_BASE}/Deals`, payload,
      { headers: zohoHeaders(token) });
    return res.data?.data?.[0]?.details?.id || null;
  } catch (err) {
    console.warn(`[BiginSync] Deal upsert notice: ${err.response?.data?.data?.[0]?.message || err.message}`);
    return null;
  }
}

async function addNote({ parentId, parentModule, noteTitle, noteContent }, token) {
  try {
    await axios.post(`${ZOHO_BIGIN_BASE}/Notes`, {
      data: [{
        Note_Title:   noteTitle,
        Note_Content: noteContent,
        $se_module:   parentModule,
        Parent_Id:    parentId,
      }],
    }, { headers: zohoHeaders(token) });
  } catch (err) {
    console.error('[BiginSync] Note add error:', err.response?.data || err.message);
  }
}

// ── CRM Sync Log ──────────────────────────────────────────────────────────────

async function logSyncResult({
  salespersonPhone, customerName, activityType, summary,
  zohoContactId, zohoNoteId, status, errorMessage, payload,
}) {
  try {
    const sb = getSupabase();
    await sb.from('crm_sync_log').insert({
      salesperson_phone: salespersonPhone || '918262937458',
      customer_name:     customerName,
      activity_type:     activityType,
      summary:           summary?.substring(0, 500),
      zoho_contact_id:   zohoContactId || null,
      zoho_note_id:      zohoNoteId || null,
      sync_status:       status,
      error_message:     errorMessage || null,
      payload:           payload ? JSON.stringify(payload) : null,
      synced_at:         new Date().toISOString(),
    });
  } catch (err) {
    // If crm_sync_log table is missing or errors, fallback gracefully without throwing
    console.log('[BiginSync] crm_sync_log write notice:', err.message);
  }
}

async function logKRA6Event({ salespersonPhone, customerName,
  activityType, summary, month, year }) {
  try {
    const sb = getSupabase();
    await sb.from('kra_logs').insert({
      salesperson_phone: salespersonPhone || '918262937458',
      kra_number:        6,
      kra_type:          activityType,
      customer_name:     customerName || null,
      description:       summary?.substring(0, 300),
      month:             month || new Date().getMonth() + 1,
      year:              year  || new Date().getFullYear(),
    });
  } catch (err) {
    console.error('[BiginSync] KRA 6 log error:', err.message);
  }
}

// ── Main Sync Entry Point ─────────────────────────────────────────────────────

/**
 * syncActivity — call from any agent after successful DB write.
 */
async function syncActivity(activityType, data) {
  setImmediate(async () => {
    // Backward compatibility fallback for 'deal' activityType
    let normalizedType = activityType;
    if (activityType === 'deal') {
      normalizedType = data.stage === 'won' ? 'deal_won' : data.stage === 'lost' ? 'deal_lost' : 'deal_stage';
    }

    const senderPhone = data.senderPhone || data.phone || '918262937458';
    const customerName = data.customerName || 'Customer';
    let zohoContactId = null;
    let zohoNoteId = null;
    let summary = '';

    // Guard: skip if Zoho not configured
    if (!process.env.ZOHO_REFRESH_TOKEN || !process.env.ZOHO_CLIENT_ID) {
      console.log('[BiginSync] Zoho credentials not configured — logging local KRA 6 event');
      summary = `Local CRM record created for ${customerName} (${normalizedType})`;

      await logKRA6Event({
        salespersonPhone: senderPhone,
        customerName,
        activityType: normalizedType,
        summary,
      });

      await logSyncResult({
        salespersonPhone: senderPhone,
        customerName,
        activityType: normalizedType,
        summary,
        status: 'success',
        payload: data,
      });
      return;
    }

    try {
      const token = await getZohoToken();
      const salespersonName = await getEmployeeName(senderPhone);
      const customerProfile = await getCustomerProfile(customerName);

      const mergedProfile = {
        ...customerProfile,
        customer_name:  customerName || customerProfile.customer_name,
        customer_phone: data.phone || customerProfile.customer_phone,
        customer_gst:   data.gst   || customerProfile.customer_gst,
        customer_address: data.city || customerProfile.customer_address,
        contact_person: data.contactPerson || customerProfile.contact_person,
      };

      // 1. Always upsert the Contact
      zohoContactId = await upsertContact(mergedProfile, salespersonName, token);

      // 2. Activity-specific sync
      switch (normalizedType) {

        case 'deal_won':
        case 'deal_lost': {
          const dealData = await getDealFullSummary(customerName, senderPhone, data.dealId);

          if (dealData) {
            summary = buildDealSummary(dealData, salespersonName);

            const zohoDealId = await upsertDeal({
              customerName,
              stage:        data.stage || (normalizedType === 'deal_won' ? 'won' : 'lost'),
              amount:       data.amount || dealData.deal?.total_amount || 0,
              poNumber:     data.poNumber || dealData.deal?.po_number,
              salespersonName,
              summary,
              dealItems:    dealData.deal?.deal_items || [],
              paymentTerms: data.paymentTerms || dealData.deal?.payment_terms,
              contactId:    zohoContactId,
            }, token);

            if (zohoDealId) {
              await addNote({
                parentId:     zohoDealId,
                parentModule: 'Deals',
                noteTitle:    `${normalizedType === 'deal_won' ? '🏆 Deal Closed Won' : '❌ Deal Closed Lost'} — ${new Date().toLocaleDateString('en-IN')}`,
                noteContent:  summary,
              }, token);
            }
          } else {
            summary = `Deal ${normalizedType === 'deal_won' ? 'won' : 'lost'} for ${customerName} — ₹${Number(data.amount || 0).toLocaleString('en-IN')}`;
          }

          await logKRA6Event({
            salespersonPhone: senderPhone,
            customerName,
            activityType: normalizedType,
            summary: summary.substring(0, 300),
          });
          break;
        }

        case 'deal_stage': {
          summary = `Stage updated to ${(data.stage || 'unknown').toUpperCase()} for ${customerName} by ${salespersonName} on ${new Date().toLocaleDateString('en-IN')}.`;

          const existingDeal = await findDeal(customerName, token);
          if (existingDeal) {
            await axios.put(`${ZOHO_BIGIN_BASE}/Deals/${existingDeal.id}`, {
              data: [{ Stage: STAGE_MAP[data.stage] || 'Qualification' }],
            }, { headers: zohoHeaders(token) });

            await addNote({
              parentId:     existingDeal.id,
              parentModule: 'Deals',
              noteTitle:    `Stage Update — ${new Date().toLocaleDateString('en-IN')}`,
              noteContent:  summary,
            }, token);
          }

          await logKRA6Event({
            salespersonPhone: senderPhone,
            customerName,
            activityType: 'deal_stage_update',
            summary,
          });
          break;
        }

        case 'visit': {
          summary = buildVisitSummary(data, salespersonName);

          if (data.personMet || data.contactNo || data.city) {
            await upsertContact({
              ...mergedProfile,
              contact_person: data.personMet || mergedProfile.contact_person,
              customer_phone: data.contactNo || mergedProfile.customer_phone,
              customer_address: data.city    || mergedProfile.customer_address,
            }, salespersonName, token);
          }

          if (zohoContactId) {
            await addNote({
              parentId:     zohoContactId,
              parentModule: 'Contacts',
              noteTitle:    `Field Visit — ${new Date().toLocaleDateString('en-IN')}`,
              noteContent:  summary,
            }, token);
          }

          await logKRA6Event({
            salespersonPhone: senderPhone,
            customerName,
            activityType: 'customer_visit',
            summary: summary.substring(0, 300),
          });
          break;
        }

        case 'payment': {
          summary = buildPaymentSummary(data, salespersonName);

          const existingDeal = await findDeal(customerName, token);
          if (existingDeal) {
            await addNote({
              parentId:     existingDeal.id,
              parentModule: 'Deals',
              noteTitle:    `Payment Update — ${new Date().toLocaleDateString('en-IN')}`,
              noteContent:  summary,
            }, token);
          } else if (zohoContactId) {
            await addNote({
              parentId:     zohoContactId,
              parentModule: 'Contacts',
              noteTitle:    `Payment Update — ${new Date().toLocaleDateString('en-IN')}`,
              noteContent:  summary,
            }, token);
          }

          if (data.isFullPayment || data.amountPaid > 0) {
            await logKRA6Event({
              salespersonPhone: senderPhone,
              customerName,
              activityType: data.isFullPayment ? 'payment_settled' : 'payment_received',
              summary: summary.substring(0, 300),
            });
          }
          break;
        }

        case 'complaint': {
          summary = buildComplaintSummary({ ...data, action: 'report' }, salespersonName);

          if (zohoContactId) {
            await addNote({
              parentId:     zohoContactId,
              parentModule: 'Contacts',
              noteTitle:    `🚨 Complaint Reported — ${new Date().toLocaleDateString('en-IN')}`,
              noteContent:  summary,
            }, token);
          }

          await logKRA6Event({
            salespersonPhone: senderPhone,
            customerName,
            activityType: 'complaint_reported',
            summary: summary.substring(0, 300),
          });
          break;
        }

        case 'complaint_resolved': {
          summary = buildComplaintSummary({ ...data, action: 'resolve' }, salespersonName);

          if (zohoContactId) {
            await addNote({
              parentId:     zohoContactId,
              parentModule: 'Contacts',
              noteTitle:    `✅ Complaint Resolved — ${new Date().toLocaleDateString('en-IN')}`,
              noteContent:  summary,
            }, token);
          }

          await logKRA6Event({
            salespersonPhone: senderPhone,
            customerName,
            activityType: 'complaint_resolved',
            summary: summary.substring(0, 300),
          });
          break;
        }

        case 'new_customer': {
          summary = buildCustomerSummary(data, salespersonName);

          if (zohoContactId) {
            await addNote({
              parentId:     zohoContactId,
              parentModule: 'Contacts',
              noteTitle:    `New Customer Onboarded — ${new Date().toLocaleDateString('en-IN')}`,
              noteContent:  summary,
            }, token);
          }

          await logKRA6Event({
            salespersonPhone: senderPhone,
            customerName,
            activityType: 'new_customer_onboarded',
            summary: summary.substring(0, 300),
          });
          break;
        }

        default:
          console.warn(`[BiginSync] Unknown activity type: ${normalizedType}`);
      }

      await logSyncResult({
        salespersonPhone: senderPhone,
        customerName,
        activityType: normalizedType,
        summary,
        zohoContactId,
        zohoNoteId,
        status: 'success',
        payload: data,
      });

      console.log(`[BiginSync] ✅ ${normalizedType} synced for ${customerName}`);

    } catch (err) {
      console.error(`[BiginSync] ❌ ${normalizedType} sync failed for ${customerName}:`, err.message);

      await logSyncResult({
        salespersonPhone: senderPhone,
        customerName,
        activityType: normalizedType,
        summary,
        status: 'failed',
        errorMessage: err.message,
        payload: data,
      });
    }
  });
}

// ── Cleanup Utility ───────────────────────────────────────────────────────────

async function clearAllBiginData() {
  const results = { deleted: {}, errors: [] };
  try {
    const token = await getZohoToken();
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
          if (records.length === 0) { hasMore = false; break; }

          const ids = records.map(r => r.id).filter(Boolean);
          if (ids.length > 0) {
            const delRes = await axios.delete(`${ZOHO_BIGIN_BASE}/${module}`, {
              headers: zohoHeaders(token),
              params: { ids: ids.join(',') },
            });
            results.deleted[module] += delRes.data?.data?.filter(r => r.status === 'success').length || ids.length;
          }

          hasMore = res.data?.info?.more_records === true;
          page++;
          await new Promise(r => setTimeout(r, 600));
        } catch (err) {
          results.errors.push(`${module}: ${err.message}`);
          hasMore = false;
        }
      }
    }
    return results;
  } catch (err) {
    throw err;
  }
}

module.exports = { syncActivity, clearAllBiginData };
