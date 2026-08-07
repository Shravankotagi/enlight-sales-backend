/**
 * KRA 1 - Sales Achievement & Pipeline Agent
 *
 * DESIGN PRINCIPLES:
 * - One deal per customer inquiry. Stage updates modify THAT deal, never create a new one.
 * - A "won" event logs to KRA 1. A "lost" event logs to KRA 4 loss analytics.
 * - KRA 5 (Payment) is NEVER touched here. Payment is explicitly separate.
 * - PO images mark the existing deal as won, never create a duplicate deal.
 *
 * EDGE CASES HANDLED:
 * 1.  Stage update (won/lost/negotiation/quoted/qualified) on existing deal → update deal
 * 2.  Stage update for customer not in DB → create new deal at that stage
 * 3.  Won deal → log KRA 1, set won_at timestamp
 * 4.  Lost deal → log KRA 4 loss reason, never log KRA 1
 * 5.  Duplicate won → check if deal already marked won, skip KRA 1 re-log
 * 6.  Missing customer name → ask for clarification
 * 7.  Deal value update with rate × qty → compute and store total_amount
 * 8.  Customer name partial match (fuzzy ILIKE) → find best existing deal
 * 9.  Salesperson's own deal priority → search own deals first, then global
 * 10. PO image → update existing deal if found, else create new won deal
 * 11. Multiple open deals for same customer → pick the most recent non-won/lost one
 * 12. Hinglish/casual message → AI interprets meaning, not keywords
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase, verifyAndGetCustomerName, saveActiveSession } = require('../supabase');
const { syncActivity } = require('./biginSyncAgent');
const axios = require('axios');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SALES_AGENT_PROMPT = `
You are the Specialized Sales Achievement & Pipeline Agent for Enlight Metals (B2B Steel Distributor).
Your job is to analyze salesperson messages reporting sales actions, deal status updates, or stage changes.

The salesperson message may be informal, in Hinglish, or missing expected keywords.
Understand the meaning and context — do not look for specific words.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no markdown, no prose, no backticks):
{
  "action": "stage_update|purchase_order",
  "customer_name": "<company/customer name, else null>",
  "target_stage": "won|lost|negotiation|quoted|qualified",
  "loss_reason": "<inferred reason if deal was lost, else null>",
  "rate_per_mt": <numeric per-MT price if mentioned e.g. 51000 per MT, else 0>,
  "total_amount": <numeric total deal value in rupees if explicitly mentioned, else 0>,
  "po_number": "<PO number if mentioned, else null>",
  "confidence": <float 0.0 to 1.0>
}

Rules for target_stage — understand MEANING, not keywords:
- "won": deal finalized, confirmed, accepted, order placed, PO received, customer said yes
- "lost": deal refused, rejected, cancelled, customer said no, competitor won
- "negotiation": ongoing discussion, bargaining, counter-offer, price haggling
- "quoted": price/quote sent or shared, proforma sent
- "qualified": new requirement received, customer interested, lead confirmed

Rules for loss_reason:
- Infer from context (price too high, competitor cheaper, delivery mismatch, payment terms, product unavailable)
- If not clearly a loss, set to null

IMPORTANT:
- If a message says "deal won" or "order confirm" with no amount, set total_amount=0 (we will look it up from DB)
- Do NOT invent amounts. Only set total_amount if explicitly stated in the message.

Return ONLY the JSON object.
`;

/**
 * Finds the best matching existing deal for a customer.
 * Priority: salesperson's own deals → active stages first → most recent.
 */
async function findBestDeal(customerName, senderPhone) {
  // 1. Own deals, active stages first (not won/lost yet)
  const { data: ownActive } = await supabase
    .from('deals')
    .select('*')
    .ilike('customer_name', `%${customerName}%`)
    .eq('salesperson_phone', senderPhone)
    .not('stage', 'in', '("won","lost")')
    .order('created_at', { ascending: false })
    .limit(1);

  if (ownActive && ownActive.length > 0) return ownActive[0];

  // 2. Global search — active stages
  const { data: globalActive } = await supabase
    .from('deals')
    .select('*')
    .ilike('customer_name', `%${customerName}%`)
    .not('stage', 'in', '("won","lost")')
    .order('created_at', { ascending: false })
    .limit(1);

  if (globalActive && globalActive.length > 0) return globalActive[0];

  return null;
}

/**
 * Gets deal item amounts to compute total_amount if not explicitly stated.
 */
async function getDealAmountFromItems(dealId) {
  const { data: items } = await supabase
    .from('deal_items')
    .select('amount, quantity, rate')
    .eq('deal_id', dealId);

  if (!items || items.length === 0) return 0;

  const sum = items.reduce((total, item) => {
    const itemAmount = Number(item.amount) || (Number(item.quantity || 0) * Number(item.rate || 0));
    return total + itemAmount;
  }, 0);

  return sum;
}

/**
 * Checks if KRA 1 was already logged for a specific deal (to prevent duplicate won-logs).
 */
async function isKRA1AlreadyLogged(senderPhone, customerName) {
  const { data } = await supabase
    .from('kra_logs')
    .select('id')
    .eq('salesperson_phone', senderPhone)
    .eq('kra_number', 1)
    .ilike('customer_name', `%${customerName}%`)
    .limit(1);

  return data && data.length > 0;
}

/**
 * Main text message handler.
 */
async function processSalesMessage(text, senderPhone) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent(SALES_AGENT_PROMPT + '\n\nSalesperson message:\n' + text);
    const rawText = result.response.text().trim();
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const data = JSON.parse(cleaned);

    // Edge Case 6: Missing customer name
    if (!data.customer_name) {
      return `⚠️ *Sales Agent Request*\n\nPlease mention the *Customer/Company Name* to update the sales pipeline.\nExample: _"Delta Structural Steel deal won"_`;
    }

    const customerName = data.customer_name.trim();

    // Verify and get official customer name from salesperson's registered customers
    const { verifyAndGetCustomerName } = require('../supabase');
    const officialCustomerName = await verifyAndGetCustomerName(customerName, senderPhone);

    if (!officialCustomerName) {
      return `⚠️ *Client Not Found in your Customer List*\n\n` +
        `Client *"${customerName}"* is not registered under your salesperson account.\n\n` +
        `Please onboard this customer first under *KRA 2 (Customer Onboarding)* before updating pipeline stages.\n\n` +
        `*Example to onboard customer:*\n` +
        `_"New customer ${customerName} owner Mr. Kapoor location Mumbai phone 9876543210 gst 27AAAAA1111A1Z1"_`;
    }

    const finalCustomerName = officialCustomerName;
    const targetStage  = data.target_stage || 'qualified';

    const stageMap = {
      won:         'won',
      lost:        'lost',
      negotiation: 'negotiation',
      quoted:      'quoted',
      qualified:   'qualified',
    };
    const dbStage = stageMap[targetStage] || 'qualified';

    // Edge Case 8/9/11: Find best matching deal
    const existingDeal = await findBestDeal(finalCustomerName, senderPhone);

    let dealId = existingDeal ? existingDeal.id : null;
    let dealAmount = 0;

    // Resolve deal amount (priority: AI extracted > DB items > existing total)
    if (data.total_amount && Number(data.total_amount) > 0) {
      dealAmount = Number(data.total_amount);
    } else if (dealId) {
      const itemsTotal = await getDealAmountFromItems(dealId);
      dealAmount = itemsTotal > 0 ? itemsTotal : Number(existingDeal.total_amount || 0);
    }

    // Edge Case 7: If rate × qty was given but not total
    if (dealAmount === 0 && data.rate_per_mt && Number(data.rate_per_mt) > 0 && dealId) {
      const { data: items } = await supabase
        .from('deal_items')
        .select('quantity')
        .eq('deal_id', dealId);
      const totalQty = (items || []).reduce((s, i) => s + Number(i.quantity || 0), 0);
      if (totalQty > 0) dealAmount = totalQty * Number(data.rate_per_mt);
    }

    if (dealId) {
      // ---- UPDATE existing deal ----
      const updatePayload = {
        stage: dbStage,
      };

      // Only update amount if we have a new value and it's greater than 0
      if (dealAmount > 0) {
        updatePayload.total_amount = dealAmount;
      }

      if (dbStage === 'won') {
        updatePayload.won_at = new Date().toISOString();
      }

      if (dbStage === 'lost') {
        // If loss reason is present and valid, process loss update. Otherwise trigger interactive prompt.
        if (data.loss_reason && data.loss_reason !== 'Not specified' && data.loss_reason.length > 2) {
          updatePayload.loss_reason = data.loss_reason;
        } else {
          const { saveActiveSession } = require('../supabase');
          await saveActiveSession(senderPhone, finalCustomerName, `pending_loss_reason|${dealId}|${finalCustomerName}`);
          return `❌ *Marking Deal as Lost: ${finalCustomerName}*\n\n` +
            `Please reply with the reason for rejection (reply with a number or type your own reason):\n\n` +
            `1️⃣ Price too high\n` +
            `2️⃣ Credit terms / Payment terms mismatch\n` +
            `3️⃣ Delivery timeline delay\n` +
            `4️⃣ Material unavailable / Out of stock\n` +
            `5️⃣ Spec mismatch\n` +
            `6️⃣ Competitor relationship\n` +
            `7️⃣ Customer silent / No response\n` +
            `8️⃣ Cancelled by customer`;
        }
      }

      await supabase.from('deals').update(updatePayload).eq('id', dealId);
    } else {
      // ---- CREATE new deal ----
      if (dbStage === 'lost' && (!data.loss_reason || data.loss_reason === 'Not specified')) {
        // Find or create a temporary deal first so we can capture a loss reason for it
        const { data: tempDeal } = await supabase
          .from('deals')
          .insert({
            customer_name:     finalCustomerName,
            salesperson_phone: senderPhone,
            stage:             'negotiation',
            total_amount:      dealAmount || 0,
            inquiry_type:      'inquiry',
          })
          .select()
          .single();

        if (tempDeal) {
          const { saveActiveSession } = require('../supabase');
          await saveActiveSession(senderPhone, finalCustomerName, `pending_loss_reason|${tempDeal.id}|${finalCustomerName}`);
          return `❌ *Marking Deal as Lost: ${finalCustomerName}*\n\n` +
            `Please reply with the reason for rejection (reply with a number or type your own reason):\n\n` +
            `1️⃣ Price too high\n` +
            `2️⃣ Credit terms / Payment terms mismatch\n` +
            `3️⃣ Delivery timeline delay\n` +
            `4️⃣ Material unavailable / Out of stock\n` +
            `5️⃣ Spec mismatch\n` +
            `6️⃣ Competitor relationship\n` +
            `7️⃣ Customer silent / No response\n` +
            `8️⃣ Cancelled by customer`;
        }
      }

      const { data: newDeal } = await supabase
        .from('deals')
        .insert({
          customer_name:     finalCustomerName,
          salesperson_phone: senderPhone,
          stage:             dbStage,
          total_amount:      dealAmount || 0,
          inquiry_type:      'inquiry',
          won_at:            dbStage === 'won' ? new Date().toISOString() : null,
          loss_reason:       dbStage === 'lost' ? data.loss_reason : null,
        })
        .select()
        .single();

      if (newDeal) dealId = newDeal.id;
    }

    // Edge Case 5: KRA 1 — log won, but don't double-log if already won
    if (dbStage === 'won') {
      const alreadyLogged = await isKRA1AlreadyLogged(senderPhone, finalCustomerName);
      if (!alreadyLogged) {
        await supabase.from('kra_logs').insert({
          salesperson_phone: senderPhone,
          kra_number:        1,
          kra_type:          'sales_achievement',
          value:             dealAmount || 0,
          customer_name:     finalCustomerName,
          description:       `Deal Won: ${finalCustomerName} (₹${Number(dealAmount).toLocaleString('en-IN')})`,
          month: new Date().getMonth() + 1,
          year:  new Date().getFullYear(),
        });
      }
      await handlePaymentTrackingOnWon(dealId, finalCustomerName, dealAmount, senderPhone);
    }

    // Edge Case 4: KRA 4 — log loss reason (separate from KRA 1)
    if (dbStage === 'lost' && data.loss_reason) {
      await supabase.from('kra_logs').insert({
        salesperson_phone: senderPhone,
        kra_number:        4,
        kra_type:          'deal_lost',
        value:             dealAmount || 0,
        customer_name:     finalCustomerName,
        description:       `Deal Lost: ${finalCustomerName} — Reason: ${data.loss_reason}`,
        month: new Date().getMonth() + 1,
        year:  new Date().getFullYear(),
      });
    }

    // Async Zoho Bigin Smart Sync (non-blocking)
    syncActivity('deal', {
      customerName: finalCustomerName,
      stage:        dbStage,
      amount:       dealAmount,
      poNumber:     data.po_number,
      paymentTerms: data.payment_terms,
      products:     deal?.deal_items || [],
      senderPhone,
    });

    // Build reply
    // Build reply
    let replyMsg = '';
    if (dbStage === 'won') {
      replyMsg = `🏆 *KRA 1 - Deal Marked as WON!*\n\n` +
        `Customer: *${finalCustomerName}*\n` +
        `Stage: *Closed Won 🎉*\n` +
        (dealAmount > 0 ? `Deal Value: *₹${Number(dealAmount).toLocaleString('en-IN')}*\n` : '') +
        `\nUpdated KRA 1 Sales Achievement Dashboard! ✅`;
    } else if (dbStage === 'lost') {
      replyMsg = `❌ *Deal Marked as LOST*\n\n` +
        `Customer: *${finalCustomerName}*\n` +
        `Stage: *Closed Lost*\n` +
        (data.loss_reason ? `Reason: ${data.loss_reason}\n` : '') +
        `\nUpdated Loss Analytics Dashboard! 📉`;
    } else {
      const stageLabels = {
        negotiation: 'NEGOTIATION 🤝',
        quoted:      'QUOTED 📄',
        qualified:   'QUALIFIED ✅',
      };
      replyMsg = `🔄 *Pipeline Stage Updated!*\n\n` +
        `Customer: *${finalCustomerName}*\n` +
        `New Stage: *${stageLabels[dbStage] || dbStage.toUpperCase()}*\n\n` +
        `Synced live to Sales Dashboard! ✅`;
    }

    const { getCustomerMissingInfoPrompt } = require('../supabase');
    const missingPrompt = await getCustomerMissingInfoPrompt(finalCustomerName, senderPhone);
    return replyMsg + (missingPrompt || '');

  } catch (error) {
    console.error('Sales Agent Error:', error.message);
    return `⚠️ Could not process sales update: ${error.message}`;
  }
}

// (Old syncToBigin removed — replaced by biginSyncAgent.syncActivity)

/**
 * PO Image handler — finds existing deal or creates new won deal.
 * Edge Case 10: Never creates a duplicate deal if one already exists for the customer.
 */
async function processSalesImage(imageBuffer, mimeType, senderPhone) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const imagePart = {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: mimeType || 'image/jpeg',
      },
    };

    const prompt = `You are the Specialized Sales Achievement & PO Vision Agent for Enlight Metals.
Analyze this PO image / bill / handwritten slip and extract into JSON:
{
  "customer_name": "<company name if present, else null>",
  "po_number": "<PO number if present, else null>",
  "quantity_mt": <numeric quantity in MT if present, else 0>,
  "rate_per_mt": <numeric rate per MT if present, else 0>,
  "total_amount": <total value in rupees if stated, else 0>,
  "confidence": <float 0.0 to 1.0>
}
Return ONLY JSON. No prose. No markdown.`;

    const result = await model.generateContent([prompt, imagePart]);
    const rawText = result.response.text().trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);

    if (!data.customer_name) {
      return `⚠️ *PO Vision Agent — Customer Not Found*\n\nI parsed your PO image but the *Customer/Company Name* is not visible. Please reply with the company name to log this PO.`;
    }

    const customerName = data.customer_name.trim();

    // Verify and get official customer name from salesperson's registered customers
    const { verifyAndGetCustomerName } = require('../supabase');
    const officialCustomerName = await verifyAndGetCustomerName(customerName, senderPhone);

    if (!officialCustomerName) {
      return `⚠️ *PO Vision Agent — Client Not Found*\n\n` +
        `Client *"${customerName}"* detected in the PO image is not registered under your salesperson account.\n\n` +
        `Please onboard this customer first under *KRA 2 (Customer Onboarding)* before logging their orders.\n\n` +
        `*Example to onboard customer:*\n` +
        `_"New customer ${customerName} owner Mr. Kapoor location Mumbai phone 9876543210 gst 27AAAAA1111A1Z1"_`;
    }

    const finalCustomerName = officialCustomerName;
    let totalValue = Number(data.total_amount || 0);

    if (!totalValue && data.quantity_mt && data.rate_per_mt) {
      totalValue = Number(data.quantity_mt) * Number(data.rate_per_mt);
    }

    // Edge Case 10: Find existing deal first, don't create duplicate
    const existingDeal = await findBestDeal(finalCustomerName, senderPhone);

    let dealId;
    if (existingDeal) {
      await supabase
        .from('deals')
        .update({
          stage:        'won',
          total_amount: totalValue || existingDeal.total_amount || 0,
          po_number:    data.po_number || existingDeal.po_number || null,
          won_at:       new Date().toISOString(),
        })
        .eq('id', existingDeal.id);
      dealId = existingDeal.id;
    } else {
      const { data: newDeal } = await supabase
        .from('deals')
        .insert({
          customer_name:     finalCustomerName,
          salesperson_phone: senderPhone,
          stage:             'won',
          total_amount:      totalValue || 0,
          po_number:         data.po_number || null,
          inquiry_type:      'purchase_order',
          won_at:            new Date().toISOString(),
        })
        .select()
        .single();
      if (newDeal) dealId = newDeal.id;
    }

    // Edge Case 5: Only log KRA 1 once per customer
    const alreadyLogged = await isKRA1AlreadyLogged(senderPhone, finalCustomerName);
    if (!alreadyLogged) {
      await supabase.from('kra_logs').insert({
        salesperson_phone: senderPhone,
        kra_number:        1,
        kra_type:          'sales_achievement',
        value:             totalValue,
        customer_name:     finalCustomerName,
        description:       `PO Image Logged: ${finalCustomerName} (PO: ${data.po_number || 'N/A'})`,
        month: new Date().getMonth() + 1,
        year:  new Date().getFullYear(),
      });
    }
    await handlePaymentTrackingOnWon(dealId, finalCustomerName, totalValue, senderPhone);

    // Async Zoho Bigin Smart Sync (non-blocking)
    syncActivity('deal', {
      customerName: finalCustomerName,
      stage:        'won',
      amount:       totalValue,
      poNumber:     data.po_number,
      paymentTerms: data.payment_terms,
      products:     data.items || [],
      senderPhone,
    });

    const { getCustomerMissingInfoPrompt } = require('../supabase');
    const missingPrompt = await getCustomerMissingInfoPrompt(finalCustomerName, senderPhone);

    return `📦 *PO Document Processed & Logged!*\n\n` +
      `Customer: *${finalCustomerName}*\n` +
      (data.po_number ? `PO Number: *${data.po_number}*\n` : '') +
      (totalValue > 0 ? `Deal Value: *₹${Number(totalValue).toLocaleString('en-IN')}*\n` : '') +
      `Stage: *Closed Won 🎉*\n\n` +
      `Logged to KRA 1 Sales Achievement Dashboard! ✅` + (missingPrompt || '');

  } catch (err) {
    console.error('Sales Image Agent Error:', err.message);
    return `⚠️ Could not extract PO image details: ${err.message}`;
  }
}

async function handlePaymentTrackingOnWon(dealId, customerName, amount, salespersonPhone) {
  try {
    const wonDate = new Date();
    const dueDate = new Date(wonDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const dueDateStr = dueDate.toISOString().split('T')[0];

    let existingRecord = null;
    if (dealId) {
      const { data: byDeal } = await supabase
        .from('payment_tracking')
        .select('id')
        .eq('deal_id', dealId)
        .limit(1);
      if (byDeal && byDeal.length > 0) {
        existingRecord = byDeal[0];
      }
    }

    if (!existingRecord) {
      const { data: byCust } = await supabase
        .from('payment_tracking')
        .select('id')
        .eq('customer_name', customerName)
        .limit(1);
      if (byCust && byCust.length > 0) {
        existingRecord = byCust[0];
      }
    }

    if (existingRecord) {
      await supabase
        .from('payment_tracking')
        .update({
          due_date: dueDateStr,
          invoice_amount: amount || undefined,
          deal_id: dealId || undefined,
          credit_period_days: 30,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingRecord.id);
    } else {
      await supabase.from('payment_tracking').insert({
        salesperson_phone: salespersonPhone,
        customer_name: customerName,
        invoice_amount: amount || 0,
        outstanding: amount || 0,
        status: 'pending',
        due_date: dueDateStr,
        deal_id: dealId || null,
        credit_period_days: 30,
        created_at: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error('Failed to handle payment tracking on won:', err.message);
  }
}

module.exports = { processSalesMessage, processSalesImage };
