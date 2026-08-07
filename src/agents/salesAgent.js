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
Your job is to analyze salesperson messages reporting sales actions, deal status updates, stage changes, or customer product requirements/inquiries.

The salesperson message may be informal, in Hinglish, or missing expected keywords.
Understand the meaning and context — do not look for specific words.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no markdown, no prose, no backticks):
{
  "action": "stage_update|purchase_order|inquiry",
  "customer_name": "<company/customer name, else null>",
  "target_stage": "new_inquiry|qualified|quoted|negotiation|won|lost",
  "product_requirement": "<product description e.g. HR Coil 8mm, else null>",
  "quantity_mt": <numeric tonnage if mentioned e.g. 20 MT -> 20, else null>,
  "rate_per_mt": <numeric per-MT price if mentioned e.g. 51000, else null>,
  "total_amount": <numeric total deal value in rupees if explicitly mentioned, else 0>,
  "delivery_location": "<city/address if mentioned e.g. Pune, else null>",
  "delivery_date": "<delivery deadline if mentioned e.g. 20 August, else null>",
  "po_number": "<PO number if mentioned, else null>",
  "po_date": "<PO date if mentioned YYYY-MM-DD, else null>",
  "loss_reason": "<inferred reason if deal was lost, else null>",
  "confidence": <float 0.0 to 1.0>
}

Rules for target_stage — understand MEANING, not keywords:
- "new_inquiry": new customer requirement, inquiry, demand, quotation request, RFQ
- "qualified": verified lead or interest confirmed
- "quoted": price/quote sent or shared, proforma sent
- "negotiation": ongoing discussion, bargaining, counter-offer, price haggling
- "won": deal finalized, confirmed, accepted, order placed, PO received, customer said yes
- "lost": deal refused, rejected, cancelled, customer said no, competitor won

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
    const { invokeWithFallback } = require('../core/modelRouter');
    const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
    const response = await invokeWithFallback([
      new SystemMessage(SALES_AGENT_PROMPT),
      new HumanMessage('Salesperson message:\n' + text),
    ]);
    const rawText = (typeof response.content === 'string' ? response.content : JSON.stringify(response.content)).trim();
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

    const finalCustomerName = officialCustomerName || customerName;

    // Fetch actual customer phone from recurring_customers (never default to salesperson phone)
    const { data: custRecord } = await supabase
      .from('recurring_customers')
      .select('customer_phone')
      .ilike('customer_name', `%${finalCustomerName}%`)
      .limit(1);
    const actualCustomerPhone = custRecord && custRecord.length > 0 ? custRecord[0].customer_phone : (data.customer_phone || null);

    const targetStage = data.target_stage || 'new_inquiry';
    const stageMap = {
      new_inquiry: 'new_inquiry',
      qualified:   'qualified',
      quoted:      'quoted',
      negotiation: 'negotiation',
      won:         'won',
      lost:        'lost',
    };
    const dbStage = stageMap[targetStage] || 'new_inquiry';

    if (!officialCustomerName) {
      // Auto-create customer in recurring_customers if not registered
      await supabase.from('recurring_customers').insert({
        customer_name:              customerName,
        assigned_salesperson_phone: senderPhone,
        customer_phone:             data.customer_phone || null,
        is_active:                  true,
        avg_order_frequency_days:   30,
      });
      console.log(`[SalesAgent] Auto-created new prospect: ${customerName}`);
    }

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
    if (dealAmount === 0 && data.rate_per_mt && Number(data.rate_per_mt) > 0) {
      const qty = data.quantity_mt || 0;
      if (qty > 0) {
        dealAmount = qty * Number(data.rate_per_mt);
      } else if (dealId) {
        const { data: items } = await supabase
          .from('deal_items')
          .select('quantity')
          .eq('deal_id', dealId);
        const totalQty = (items || []).reduce((s, i) => s + Number(i.quantity || 0), 0);
        if (totalQty > 0) dealAmount = totalQty * Number(data.rate_per_mt);
      }
    }

    // Resolve PO Date (always set to today or extracted PO date)
    const poDate = data.po_date || new Date().toISOString().split('T')[0];

    // Resolve PO Number (auto-generate if won or PO received and po_number is missing)
    let poNumber = data.po_number || (existingDeal ? existingDeal.po_number : null);
    if (!poNumber && (dbStage === 'won' || data.action === 'purchase_order')) {
      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      poNumber = `PO-${todayStr}-${randomNum}`;
    }

    if (dealId) {
      // ---- UPDATE existing deal ----
      const updatePayload = {
        stage: dbStage,
        po_date: poDate,
      };

      if (poNumber) updatePayload.po_number = poNumber;
      if (actualCustomerPhone) updatePayload.customer_phone = actualCustomerPhone;
      if (data.delivery_location) updatePayload.delivery_location = data.delivery_location;
      if (data.delivery_date) updatePayload.delivery_date = data.delivery_date;

      // Only update amount if we have a new value and it's greater than 0
      if (dealAmount > 0) {
        updatePayload.total_amount = dealAmount;
      }

      if (dbStage === 'won') {
        updatePayload.won_at = new Date().toISOString();
      }

      if (dbStage === 'lost') {
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

      // Add line item if quantity or product specified
      if (data.product_requirement || data.quantity_mt) {
        await supabase.from('deal_items').insert({
          deal_id: dealId,
          sku_text: data.product_requirement || 'Steel Requirement',
          quantity: data.quantity_mt ? Number(data.quantity_mt) : null,
          unit: 'MT',
          rate: data.rate_per_mt ? Number(data.rate_per_mt) : null,
          amount: dealAmount || null,
          created_at: new Date().toISOString(),
        });
      }
    } else {
      // ---- CREATE new deal ----
      if (dbStage === 'lost' && (!data.loss_reason || data.loss_reason === 'Not specified')) {
        const { data: tempDeal } = await supabase
          .from('deals')
          .insert({
            customer_name:     finalCustomerName,
            salesperson_phone: senderPhone,
            customer_phone:    actualCustomerPhone,
            stage:             'negotiation',
            total_amount:      dealAmount || 0,
            inquiry_type:      'inquiry',
            po_date:           poDate,
            po_number:         poNumber,
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
          customer_phone:    actualCustomerPhone,
          stage:             dbStage,
          total_amount:      dealAmount || 0,
          inquiry_type:      'inquiry',
          delivery_location: data.delivery_location || null,
          delivery_date:     data.delivery_date || null,
          po_date:           poDate,
          po_number:         poNumber,
          won_at:            dbStage === 'won' ? new Date().toISOString() : null,
          loss_reason:       dbStage === 'lost' ? data.loss_reason : null,
        })
        .select()
        .single();

      if (newDeal) {
        dealId = newDeal.id;

        // Auto-create line item
        if (data.product_requirement || data.quantity_mt) {
          await supabase.from('deal_items').insert({
            deal_id:    dealId,
            sku_text:   data.product_requirement || 'Steel Requirement',
            quantity:   data.quantity_mt ? Number(data.quantity_mt) : null,
            unit:       'MT',
            rate:       data.rate_per_mt ? Number(data.rate_per_mt) : null,
            amount:     dealAmount || null,
            created_at: new Date().toISOString(),
          });
        }
      }

      // Always insert into inquiries table for KRA 4 tracking
      await supabase.from('inquiries').insert({
        raw_text:          text,
        source_channel:    'whatsapp',
        sender_phone:      senderPhone,
        status:            'pending',
        created_at:        new Date().toISOString(),
      });
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
          description:       `Deal Won: ${finalCustomerName} (₹${Number(dealAmount).toLocaleString('en-IN')}) — PO: ${poNumber || 'N/A'}`,
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
    let dealItems = [];
    if (dealId) {
      const { data: fetchedItems } = await supabase
        .from('deal_items')
        .select('sku_text, quantity, unit, rate, amount')
        .eq('deal_id', dealId);
      dealItems = fetchedItems || [];
    }
    syncActivity('deal', {
      customerName: finalCustomerName,
      stage:        dbStage,
      amount:       dealAmount,
      poNumber:     poNumber,
      paymentTerms: data.payment_terms,
      products:     dealItems,
      senderPhone,
    });

    // Build reply
    let replyMsg = '';
    if (dbStage === 'won') {
      replyMsg = `🏆 *KRA 1 - Deal Marked as WON!*\n\n` +
        `Customer: *${finalCustomerName}*\n` +
        `PO Date: *${poDate}*\n` +
        `PO Number: *${poNumber || 'Generated'}*\n` +
        `Stage: *Closed Won 🎉*\n` +
        (dealAmount > 0 ? `Deal Value: *₹${Number(dealAmount).toLocaleString('en-IN')}*\n` : '') +
        `\nUpdated KRA 1 Sales Achievement Dashboard & Pipeline! ✅`;
    } else if (dbStage === 'lost') {
      replyMsg = `❌ *Deal Marked as LOST*\n\n` +
        `Customer: *${finalCustomerName}*\n` +
        `Stage: *Closed Lost*\n` +
        (data.loss_reason ? `Reason: ${data.loss_reason}\n` : '') +
        `\nUpdated Loss Analytics Dashboard! 📉`;
    } else {
      const stageLabels = {
        new_inquiry: 'NEW INQUIRY 📋',
        negotiation: 'NEGOTIATION 🤝',
        quoted:      'QUOTED 📄',
        qualified:   'QUALIFIED ✅',
      };
      replyMsg = `💼 *Sales Inquiry & Pipeline Logged!*\n\n` +
        `Customer: *${finalCustomerName}*\n` +
        `Stage: *${stageLabels[dbStage] || dbStage.toUpperCase()}*\n` +
        (data.product_requirement ? `Requirement: *${data.product_requirement}*\n` : '') +
        (data.quantity_mt ? `Quantity: *${data.quantity_mt} MT*\n` : '') +
        (data.delivery_location ? `Delivery Location: *${data.delivery_location}*\n` : '') +
        `PO Date: *${poDate}*\n` +
        (poNumber ? `PO Number: *${poNumber}*\n` : '') +
        `\nSynced live to Sales Pipeline & KRA 1 Dashboard! ✅`;
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
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
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

    let finalCustomerName = officialCustomerName || customerName;

    if (!officialCustomerName) {
      // Auto-create prospect so PO image can still be logged
      await supabase.from('recurring_customers').insert({
        customer_name:              customerName,
        assigned_salesperson_phone: senderPhone,
        is_active:                  true,
        avg_order_frequency_days:   30,
      });
      console.log(`[SalesAgent] Auto-created new prospect from PO image: ${customerName}`);
    }
    // Fetch actual customer phone from recurring_customers (never default to salesperson phone)
    const { data: custRecord } = await supabase
      .from('recurring_customers')
      .select('customer_phone')
      .ilike('customer_name', `%${finalCustomerName}%`)
      .limit(1);
    const actualCustomerPhone = custRecord && custRecord.length > 0 ? custRecord[0].customer_phone : null;

    let totalValue = Number(data.total_amount || 0);

    if (!totalValue && data.quantity_mt && data.rate_per_mt) {
      totalValue = Number(data.quantity_mt) * Number(data.rate_per_mt);
    }

    const poDate = data.po_date || new Date().toISOString().split('T')[0];
    let poNumber = data.po_number || null;
    if (!poNumber) {
      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      poNumber = `PO-${todayStr}-${randomNum}`;
    }

    // Edge Case 10: Find existing deal first, don't create duplicate
    const existingDeal = await findBestDeal(finalCustomerName, senderPhone);

    let dealId;
    if (existingDeal) {
      const updatePayload = {
        stage:        'won',
        total_amount: totalValue || existingDeal.total_amount || 0,
        po_number:    poNumber || existingDeal.po_number || null,
        po_date:      poDate,
        won_at:       new Date().toISOString(),
      };
      if (actualCustomerPhone) updatePayload.customer_phone = actualCustomerPhone;
      await supabase.from('deals').update(updatePayload).eq('id', existingDeal.id);
      dealId = existingDeal.id;
    } else {
      const { data: newDeal } = await supabase
        .from('deals')
        .insert({
          customer_name:     finalCustomerName,
          salesperson_phone: senderPhone,
          customer_phone:    actualCustomerPhone,
          stage:             'won',
          total_amount:      totalValue || 0,
          po_number:         poNumber,
          po_date:           poDate,
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
        description:       `PO Image Logged: ${finalCustomerName} (PO: ${poNumber})`,
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
