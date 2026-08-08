/**
 * KRA 1 - Sales Achievement & Pipeline Agent
 *
 * DESIGN PRINCIPLES:
 * - One deal per customer inquiry. Stage updates modify THAT deal, never create a new one.
 * - A "won" event logs to KRA 1. A "lost" event logs to KRA 4 loss analytics.
 * - KRA 5 (Payment) is NEVER touched here. Payment is explicitly separate.
 * - PO images mark the existing deal as won, never create a duplicate deal.
 * - Multi-item requirements (e.g. 20 MT CR Sheets + 10 MT MS Plates) extract as SEPARATE line items,
 *   match each against the rate sheet individually, and compute exact total.
 */

const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { supabase, verifyAndGetCustomerName, saveActiveSession } = require('../supabase');
const { syncActivity } = require('./biginSyncAgent');

const SALES_AGENT_PROMPT = `
You are the Specialized Sales Achievement & Pipeline Agent for Enlight Metals (B2B Steel Distributor).
Your job is to analyze salesperson messages reporting sales actions, deal status updates, stage changes, or customer product requirements/inquiries.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no markdown, no prose, no backticks):
{
  "action": "stage_update|purchase_order|inquiry",
  "customer_name": "<company/customer name, else null>",
  "target_stage": "new_inquiry|qualified|quoted|negotiation|won|lost",
  "line_items": [
    {
      "product_requirement": "<specific product name e.g. CR Sheets, MS Plates, HR Coil>",
      "quantity_mt": <numeric tonnage for this specific item e.g. 20>,
      "rate_per_mt": <numeric per-MT price if mentioned in message, else null>
    }
  ],
  "total_amount": <numeric total deal value in rupees ONLY if explicitly mentioned in text, else 0>,
  "delivery_location": "<city/address if mentioned, else null>",
  "delivery_date": "<delivery deadline if mentioned, else null>",
  "po_number": "<PO number if mentioned, else null>",
  "po_date": "<PO date YYYY-MM-DD if mentioned, else null>",
  "loss_reason": "<inferred reason if deal was lost, else null>",
  "confidence": <float 0.0 to 1.0>
}

Rules for line_items:
- If multiple materials/products are mentioned (e.g. "20 MT CR sheets and 10 MT of MS plates"), create a SEPARATE object in line_items for EACH material!
- Extract the exact tonnage (quantity_mt) for each material individually.
- If only 1 material is mentioned, line_items should contain 1 object.

Return ONLY the JSON object.
`;

/**
 * Finds the best matching existing deal for a customer.
 * Priority: salesperson's own deals → active stages first → most recent.
 */
async function findBestDeal(customerName, senderPhone) {
  const { data: ownActive } = await supabase
    .from('deals')
    .select('*')
    .ilike('customer_name', `%${customerName}%`)
    .eq('salesperson_phone', senderPhone)
    .not('stage', 'in', '("won","lost")')
    .order('created_at', { ascending: false })
    .limit(1);

  if (ownActive && ownActive.length > 0) return ownActive[0];

  const { data: ownAny } = await supabase
    .from('deals')
    .select('*')
    .ilike('customer_name', `%${customerName}%`)
    .eq('salesperson_phone', senderPhone)
    .order('created_at', { ascending: false })
    .limit(1);

  return ownAny && ownAny.length > 0 ? ownAny[0] : null;
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

  return items.reduce((total, item) => {
    const itemAmount = Number(item.amount) || (Number(item.quantity || 0) * Number(item.rate || 0));
    return total + itemAmount;
  }, 0);
}

/**
 * Checks if KRA 1 was already logged for a specific deal.
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
 * Looks up price per MT from official active rate sheet for a given product text.
 */
async function lookupRateSheetPrice(productText) {
  try {
    if (!productText) return null;

    const { data: latestSheet } = await supabase
      .from('rate_sheets')
      .select('id')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!latestSheet) return null;

    const { data: items } = await supabase
      .from('rate_sheet_items')
      .select('sku_text, category, price_per_mt')
      .eq('rate_sheet_id', latestSheet.id);

    if (!items || items.length === 0) return null;

    const textLower = productText.toLowerCase();

    // 1. Exact/substring match on sku_text (e.g. "CR Sheets", "MS Plates")
    let matched = items.find(
      (i) =>
        i.sku_text &&
        (textLower.includes(i.sku_text.toLowerCase()) ||
          i.sku_text.toLowerCase().includes(textLower)),
    );

    // 2. Substring match on category
    if (!matched) {
      matched = items.find(
        (i) =>
          i.category &&
          (textLower.includes(i.category.toLowerCase()) ||
            i.category.toLowerCase().includes(textLower)),
      );
    }

    // 3. Word token match
    if (!matched) {
      const words = textLower.split(/\s+/).filter((w) => w.length > 2);
      matched = items.find((i) =>
        words.some(
          (w) =>
            (i.sku_text && i.sku_text.toLowerCase().includes(w)) ||
            (i.category && i.category.toLowerCase().includes(w)),
        ),
      );
    }

    if (matched && Number(matched.price_per_mt) > 0) {
      return {
        price_per_mt: Number(matched.price_per_mt),
        matched_sku: matched.sku_text || matched.category,
      };
    }
    return null;
  } catch (err) {
    console.error('[SalesAgent] Rate sheet lookup error:', err.message);
    return null;
  }
}

/**
 * Main text message handler.
 */
async function processSalesMessage(text, senderPhone) {
  try {
    const { invokeWithFallback } = require('../core/modelRouter');
    const response = await invokeWithFallback([
      new SystemMessage(SALES_AGENT_PROMPT),
      new HumanMessage('Salesperson message:\n' + text),
    ]);
    const rawText = typeof response.content === 'string' ? response.content : JSON.stringify(response.content || '');
    const { safeParseJSON } = require('../utils/jsonUtils');
    const data = safeParseJSON(rawText, null);

    if (!data || data.confidence < 0.3) {
      return `❓ I couldn't clearly understand the deal update. Could you please specify the customer name and status (e.g. "Mehta Engineering 20 MT CR sheets quote sent")?`;
    }

    const customerName = data.customer_name;
    if (!customerName || customerName.length < 2) {
      const { saveActiveSession } = require('../supabase');
      await saveActiveSession(senderPhone, 'Unknown', 'pending_customer_for_deal');
      return `Which customer is this deal update for? Please reply with the customer/company name.`;
    }

    const officialCustomerName = await verifyAndGetCustomerName(
      customerName,
      senderPhone,
    );
    const finalCustomerName = officialCustomerName || customerName;

    const { data: custRecord } = await supabase
      .from('recurring_customers')
      .select('customer_phone')
      .ilike('customer_name', `%${finalCustomerName}%`)
      .limit(1);
    const actualCustomerPhone =
      custRecord && custRecord.length > 0
        ? custRecord[0].customer_phone
        : data.customer_phone || null;

    let targetStage = data.target_stage || 'new_inquiry';

    // Multi-item extraction and rate sheet price calculation
    let rawItems = [];
    if (Array.isArray(data.line_items) && data.line_items.length > 0) {
      rawItems = data.line_items;
    } else if (data.product_requirement || data.quantity_mt) {
      rawItems = [{
        product_requirement: data.product_requirement,
        quantity_mt: data.quantity_mt,
        rate_per_mt: data.rate_per_mt,
      }];
    }

    let calculatedTotal = 0;
    const processedItems = [];
    let hasUnlistedMaterial = false;
    let unlistedMaterialName = '';

    for (const item of rawItems) {
      const pName = item.product_requirement || 'Steel Requirement';
      const qty = Number(item.quantity_mt) || 0;
      let rate = Number(item.rate_per_mt) || 0;
      let autoRate = null;

      if (!rate) {
        autoRate = await lookupRateSheetPrice(pName);
        if (autoRate) {
          rate = autoRate.price_per_mt;
        } else if (qty > 0 || data.action === 'purchase_order') {
          hasUnlistedMaterial = true;
          unlistedMaterialName = pName;
        }
      }

      const itemAmount = qty > 0 && rate > 0 ? qty * rate : 0;
      calculatedTotal += itemAmount;

      processedItems.push({
        pName,
        qty,
        rate,
        itemAmount,
      });
    }

    if (hasUnlistedMaterial && calculatedTotal === 0) {
      const { saveActiveSession } = require('../supabase');
      await saveActiveSession(senderPhone, finalCustomerName, `pending_custom_rate|${finalCustomerName}|${unlistedMaterialName}`);
      return `⚠️ *Product Price Confirmation Required*\n\n` +
        `The material *"${unlistedMaterialName}"* is not listed in our active rate sheet.\n\n` +
        `Please confirm the per MT rate for *${unlistedMaterialName}* (e.g. reply _"${unlistedMaterialName} rate is 54000"_) so I can calculate the deal total and update KRA 1 & Sales Pipeline! 📈`;
    }

    let dealAmount = 0;
    if (data.total_amount && Number(data.total_amount) > 0) {
      dealAmount = Number(data.total_amount);
    } else if (calculatedTotal > 0) {
      dealAmount = calculatedTotal;
      if (targetStage === 'new_inquiry' || targetStage === 'qualified') {
        targetStage = 'quoted';
      }
    }

    const stageMap = {
      new_inquiry: 'new_inquiry',
      qualified: 'qualified',
      quoted: 'quoted',
      negotiation: 'negotiation',
      won: 'won',
      lost: 'lost',
    };
    const dbStage = stageMap[targetStage] || 'new_inquiry';

    if (!officialCustomerName) {
      const { ensureCustomerRecord } = require('../supabase');
      await ensureCustomerRecord(customerName, senderPhone, {
        customer_phone: data.customer_phone || null,
      });
      console.log(`[SalesAgent] Auto-created new prospect: ${customerName}`);
    }

    const existingDeal = await findBestDeal(finalCustomerName, senderPhone);
    let dealId = existingDeal ? existingDeal.id : null;

    if (dealAmount === 0 && dealId) {
      const itemsTotal = await getDealAmountFromItems(dealId);
      dealAmount = itemsTotal > 0 ? itemsTotal : Number(existingDeal.total_amount || 0);
    }

    const poDate = data.po_date || new Date().toISOString().split('T')[0];
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
      if (dealAmount > 0) updatePayload.total_amount = dealAmount;

      if (dbStage === 'won') updatePayload.won_at = new Date().toISOString();

      if (dbStage === 'lost') {
        if (data.loss_reason && data.loss_reason !== 'Not specified' && data.loss_reason.length > 2) {
          updatePayload.lost_reason = data.loss_reason;
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

      // Clean old deal items if new line items are provided
      if (processedItems.length > 0) {
        await supabase.from('deal_items').delete().eq('deal_id', dealId);
        for (const pItem of processedItems) {
          await supabase.from('deal_items').insert({
            deal_id: dealId,
            sku_text: pItem.pName,
            quantity: pItem.qty > 0 ? pItem.qty : null,
            unit: 'MT',
            rate: pItem.rate > 0 ? pItem.rate : null,
            amount: pItem.itemAmount > 0 ? pItem.itemAmount : null,
            created_at: new Date().toISOString(),
          });
        }
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

      const { data: newDeal, error: dealInsertErr } = await supabase
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
          lost_reason:       dbStage === 'lost' ? data.loss_reason : null,
        })
        .select()
        .single();

      if (dealInsertErr) {
        console.error('[SalesAgent] Fatal deals insert error:', dealInsertErr);
      }

      if (newDeal) {
        dealId = newDeal.id;
        for (const pItem of processedItems) {
          await supabase.from('deal_items').insert({
            deal_id: dealId,
            sku_text: pItem.pName,
            quantity: pItem.qty > 0 ? pItem.qty : null,
            unit: 'MT',
            rate: pItem.rate > 0 ? pItem.rate : null,
            amount: pItem.itemAmount > 0 ? pItem.itemAmount : null,
            created_at: new Date().toISOString(),
          });
        }
      }
    }

    // Edge Case 3: Log KRA 1 when deal is won
    if (dbStage === 'won') {
      const alreadyLogged = await isKRA1AlreadyLogged(
        senderPhone,
        finalCustomerName,
      );
      if (!alreadyLogged) {
        await supabase.from('kra_logs').insert({
          salesperson_phone: senderPhone,
          customer_name: finalCustomerName,
          kra_number: 1,
          kra_type: 'sales_achievement',
          metric_name: 'won_deal_value',
          value: dealAmount,
          notes: `Won deal for ${finalCustomerName}: ₹${dealAmount.toLocaleString('en-IN')}`,
          created_at: new Date().toISOString(),
        });
        console.log(`[SalesAgent] Logged KRA 1 for won deal: ${finalCustomerName} = ₹${dealAmount}`);
      }
    }

    // Trigger Zoho Bigin Sync
    try {
      syncActivity('deal', {
        customer_name: finalCustomerName,
        amount: dealAmount,
        stage: dbStage,
        po_number: poNumber,
      });
    } catch (e) {
      console.error('[SalesAgent] Zoho Bigin sync error:', e.message);
    }

    const { getCustomerMissingInfoPrompt } = require('../supabase');
    const missingPrompt = await getCustomerMissingInfoPrompt(finalCustomerName, senderPhone);

    const formattedAmount = dealAmount > 0 ? `₹${dealAmount.toLocaleString('en-IN')}` : 'To be calculated';
    const totalQty = processedItems.reduce((s, i) => s + i.qty, 0);

    let itemsBreakdownStr = '';
    if (processedItems.length > 0) {
      itemsBreakdownStr = processedItems
        .map((pi) => `  • *${pi.pName}*: ${pi.qty > 0 ? pi.qty + ' MT' : ''} ${pi.rate > 0 ? '@ ₹' + pi.rate.toLocaleString('en-IN') + '/MT = ₹' + pi.itemAmount.toLocaleString('en-IN') : ''}`)
        .join('\n');
    }

    let resultMsg =
      `💼 *Sales Inquiry & Pipeline Logged!* 🏗️\n\n` +
      `Customer: *${finalCustomerName}*\n` +
      `Stage: *${dbStage.toUpperCase()} 📄*\n` +
      (itemsBreakdownStr ? `Line Items:\n${itemsBreakdownStr}\n` : '') +
      (totalQty > 0 ? `Total Quantity: *${totalQty} MT*\n` : '') +
      `Calculated Deal Total: *${formattedAmount}* + GST\n` +
      `PO Date: *${poDate}*\n\n` +
      `Synced live to Sales Pipeline & KRA 1 Dashboard! ✅`;

    if (missingPrompt) {
      resultMsg += `\n\n${missingPrompt}`;
    }

    return resultMsg;
  } catch (error) {
    console.error('[SalesAgent] Error processing sales message:', error);
    return `⚠️ Error updating deal: ${error.message}`;
  }
}

module.exports = {
  processSalesMessage,
  findBestDeal,
  lookupRateSheetPrice,
};
