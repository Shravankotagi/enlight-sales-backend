/**
 * KRA 5 - Payment Collection Agent
 * 
 * DESIGN PRINCIPLE: One row per customer in payment_tracking.
 * When a new payment update arrives for an existing customer, we UPDATE that row 
 * rather than inserting a new one. This prevents double-counting.
 *
 * EDGE CASES HANDLED:
 * 1. First payment (advance) - creates a new row
 * 2. Follow-up installment - updates existing row, adds to collected, recalculates outstanding
 * 3. Explicit pending stated - uses that as the source of truth for outstanding
 * 4. Full payment settlement - marks status as 'collected', outstanding = 0
 * 5. Outstanding-only update (no payment) - updates outstanding without adding to collected
 * 6. Missing customer name - tries to recall last active deal customer, else asks
 * 7. Missing amount - asks for clarification
 * 8. Deal total not found - works purely on reported amounts without assuming deal total
 * 9. No double-counting - checks existing row before inserting
 * 10. Overpayment - outstanding clamped to 0, marks fully paid
 * 11. Image receipts - same upsert logic applied
 * 12. Hinglish/casual messages - AI parses meaning, not keywords
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase } = require('../supabase');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PAYMENT_AGENT_PROMPT = `
You are the Specialized Payment Collection AI Agent (KRA 5) for Enlight Metals.
Your job is to parse salesperson payment reports, advance receipts, outstanding balance updates, or pending amount messages.

The salesperson message may be informal, in Hinglish, or missing expected keywords.
Understand the meaning and context — do not look for specific words.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no prose, no markdown, no backticks):
{
  "customer_name": "<customer/company name, else null>",
  "amount_paid": <numeric amount collected/received/advance this time ONLY, else 0>,
  "amount_pending": <numeric outstanding/pending amount explicitly stated, else 0>,
  "payment_type": "advance|installment|full_settlement|outstanding_update",
  "is_full_payment": <true if message says full payment done, else false>,
  "confidence": <float 0.0 to 1.0>
}

Rules — understand meaning, not keywords:
- "amount_paid": Only what was actually received/collected THIS time (not cumulative). E.g. "5 lakh diya" = 500000.
- "amount_pending": Only what is still explicitly pending. E.g. "baaki 3 lakh" = 300000.
- "is_full_payment": true ONLY if message clearly says full/complete payment cleared.
- If someone says "paid 5L, rest 3L pending" → amount_paid=500000, amount_pending=300000.
- If someone says "5L outstanding cleared" → amount_paid=500000, is_full_payment=true.
- If someone says "3L still pending" → amount_paid=0, amount_pending=300000.
- Understand casual phrasing: "50k de diya" = 50000 paid, "2L baki hai" = 200000 pending.
- "k" or "K" suffix = thousands. "L" or "lakh" suffix = 100000. "cr" = 10000000.

Return ONLY the JSON object.
`;

/**
 * Gets the single payment tracking record for a customer (most recent).
 */
async function getExistingPaymentRecord(customerName) {
  const { data, error } = await supabase
    .from('payment_tracking')
    .select('*')
    .ilike('customer_name', `%${customerName}%`)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0];
}

/**
 * Gets the deal total amount for a customer from the deals table.
 */
async function getDealTotal(customerName) {
  const { data } = await supabase
    .from('deals')
    .select('total_amount, stage')
    .ilike('customer_name', `%${customerName}%`)
    .order('created_at', { ascending: false })
    .limit(1);

  if (data && data.length > 0 && data[0].total_amount) {
    return Number(data[0].total_amount) || 0;
  }
  return 0;
}

/**
 * Get recent deal customer name for context memory.
 */
async function getLastCustomerForSalesperson(senderPhone) {
  const { data } = await supabase
    .from('deals')
    .select('customer_name')
    .eq('salesperson_phone', senderPhone)
    .not('customer_name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (data && data.length > 0 && data[0].customer_name) {
    return data[0].customer_name;
  }

  // Also check recent kra_logs for KRA 5
  const { data: logs } = await supabase
    .from('kra_logs')
    .select('customer_name')
    .eq('salesperson_phone', senderPhone)
    .eq('kra_number', 5)
    .not('customer_name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (logs && logs.length > 0 && logs[0].customer_name) {
    return logs[0].customer_name;
  }

  return null;
}

/**
 * Core upsert logic: Create or update a payment_tracking row for this customer.
 * Always maintains a SINGLE row per customer.
 */
async function upsertPaymentTracking({
  customerName,
  senderPhone,
  newAmountPaid,   // amount received THIS time
  explicitPending, // outstanding as explicitly stated (or 0 if not stated)
  isFullPayment,   // true if message said "full payment done"
  paymentType,
}) {
  const existing = await getExistingPaymentRecord(customerName);
  const dealTotal = await getDealTotal(customerName);

  let finalCollected;
  let finalOutstanding;
  let finalInvoiceAmount;
  let finalStatus;
  let finalPaymentType = paymentType;

  if (existing) {
    // --- UPDATE existing row ---
    const priorCollected = Number(existing.collected_amount) || 0;
    const priorInvoice   = Number(existing.invoice_amount)   || 0;

    // Invoice amount: prefer deal total, then existing invoice, then compute from reported
    finalInvoiceAmount = dealTotal || priorInvoice ||
      (newAmountPaid + explicitPending) ||
      priorCollected + (Number(existing.outstanding) || 0);

    // Collected: add new payment to prior
    finalCollected = priorCollected + newAmountPaid;

    // Outstanding calculation (priority: explicit > full payment > auto-calc)
    if (isFullPayment) {
      finalOutstanding = 0;
      finalCollected = finalInvoiceAmount > 0 ? finalInvoiceAmount : finalCollected;
      finalPaymentType = 'full_settlement';
    } else if (explicitPending > 0) {
      finalOutstanding = explicitPending;
    } else if (dealTotal > 0) {
      finalOutstanding = Math.max(0, dealTotal - finalCollected);
    } else {
      // No deal total, no explicit pending → can't auto-calculate outstanding
      finalOutstanding = Math.max(0, Number(existing.outstanding) - newAmountPaid);
    }

    // Clamp
    finalOutstanding = Math.max(0, finalOutstanding);
    finalCollected   = Math.min(finalCollected, finalInvoiceAmount > 0 ? finalInvoiceAmount : finalCollected);

    // Determine status
    finalStatus = finalOutstanding <= 0 ? 'collected' : 'partial';

    if (newAmountPaid <= 0 && explicitPending > 0) {
      finalPaymentType = 'outstanding_update';
    }

    await supabase
      .from('payment_tracking')
      .update({
        invoice_amount:   finalInvoiceAmount > 0 ? finalInvoiceAmount : null,
        collected_amount: finalCollected,
        outstanding:      finalOutstanding,
        status:           finalStatus,
        payment_type:     finalPaymentType,
        paid_date:        finalStatus === 'collected' ? new Date().toISOString().split('T')[0] : null,
        updated_at:       new Date().toISOString(),
      })
      .eq('id', existing.id);

  } else {
    // --- INSERT new row ---
    finalInvoiceAmount = dealTotal || (newAmountPaid + explicitPending) || newAmountPaid;
    finalCollected     = newAmountPaid;

    if (isFullPayment) {
      finalOutstanding   = 0;
      finalCollected     = finalInvoiceAmount > 0 ? finalInvoiceAmount : newAmountPaid;
      finalPaymentType   = 'full_settlement';
    } else if (explicitPending > 0) {
      finalOutstanding   = explicitPending;
    } else if (dealTotal > 0) {
      finalOutstanding   = Math.max(0, dealTotal - finalCollected);
    } else {
      // No deal, no pending stated — mark outstanding as unknown (0 but partial)
      finalOutstanding   = 0;
    }

    finalOutstanding = Math.max(0, finalOutstanding);
    finalStatus      = finalOutstanding <= 0 && finalCollected >= finalInvoiceAmount && finalInvoiceAmount > 0
      ? 'collected'
      : (finalOutstanding <= 0 && explicitPending <= 0 ? 'partial' : 'partial');

    // If only a pending update with no payment, keep as pending
    if (newAmountPaid <= 0 && explicitPending > 0) {
      finalStatus      = 'pending';
      finalPaymentType = 'outstanding_update';
      finalCollected   = 0;
    }

    await supabase.from('payment_tracking').insert({
      customer_name:    customerName,
      salesperson_phone: senderPhone,
      invoice_amount:   finalInvoiceAmount > 0 ? finalInvoiceAmount : null,
      collected_amount: finalCollected,
      outstanding:      finalOutstanding,
      status:           finalStatus,
      payment_type:     finalPaymentType,
      paid_date:        finalStatus === 'collected' ? new Date().toISOString().split('T')[0] : null,
      created_at:       new Date().toISOString(),
    });
  }

  return {
    finalCollected,
    finalOutstanding,
    finalInvoiceAmount,
    finalStatus,
    dealTotal,
    existing: !!existing,
  };
}

/**
 * Main text message handler.
 */
async function processPaymentMessage(text, senderPhone) {
  try {
    // Pre-clean Indian number formatting (1,20,000 → 120000)
    const cleanedText = text
      .replace(/(\d+),(\d{3})/g, '$1$2')
      .replace(/(\d+),(\d{3})/g, '$1$2')
      .replace(/(\d+\.?\d*)\s*[Ll](?:akh)?/g, (_, n) => String(Math.round(parseFloat(n) * 100000)))
      .replace(/(\d+\.?\d*)\s*[Kk]/g, (_, n) => String(Math.round(parseFloat(n) * 1000)));

    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent(PAYMENT_AGENT_PROMPT + '\n\nSalesperson message:\n' + cleanedText);
    const rawText = result.response.text().trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);

    let customerName = data.customer_name ? data.customer_name.trim() : null;

    // Edge Case 6: Missing customer name — try context memory
    if (!customerName) {
      customerName = await getLastCustomerForSalesperson(senderPhone);
    }

    if (!customerName) {
      return `⚠️ *Payment Agent — Customer Missing*\n\nPlease specify the *Customer/Company Name* for this payment record.\nExample: _"Delta Structural Steel paid 5 lakh"_`;
    }

    const amountPaid    = Math.max(0, Number(data.amount_paid    || 0));
    const amountPending = Math.max(0, Number(data.amount_pending || 0));
    const isFullPayment = !!data.is_full_payment;

    // Verify and get official customer name from salesperson's registered customers
    const { verifyAndGetCustomerName } = require('../supabase');
    const officialCustomerName = await verifyAndGetCustomerName(customerName, senderPhone);

    if (!officialCustomerName) {
      return `⚠️ *Client Not Found in your Customer List*\n\n` +
        `Client *"${customerName}"* is not registered under your salesperson account.\n\n` +
        `Please onboard this customer first under *KRA 2 (Customer Onboarding)* before logging payments.\n\n` +
        `*Example to onboard customer:*\n` +
        `_"New customer ${customerName} owner Mr. Kapoor location Mumbai phone 9876543210 gst 27AAAAA1111A1Z1"_\n\n` +
        `Once added, you can resend this payment update.`;
    }

    const finalCustomerName = officialCustomerName;

    // Edge Case 7: Both amounts zero and not a full payment — ask for clarification
    if (amountPaid <= 0 && amountPending <= 0 && !isFullPayment) {
      return `⚠️ *Payment Agent — Amount Missing*\n\nPlease specify the *Payment Amount* or *Outstanding Pending Amount* for *${finalCustomerName}*.\nExample: _"Delta paid 5 lakh, rest 3 lakh pending"_`;
    }

    const paymentType = data.payment_type || (amountPaid > 0 ? 'advance' : 'outstanding_update');

    // Upsert into payment_tracking (one row per customer, always)
    const result2 = await upsertPaymentTracking({
      customerName:    finalCustomerName,
      senderPhone,
      newAmountPaid:   amountPaid,
      explicitPending: amountPending,
      isFullPayment,
      paymentType,
    });

    // Log to kra_logs for KRA 5 dashboard counter
    const isFullyPaid = result2.finalStatus === 'collected';
    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number:        5,
      kra_type:          isFullyPaid ? 'payment_collected' : 'payment_advance',
      value:             amountPaid > 0 ? amountPaid : 0,
      customer_name:     finalCustomerName,
      description:       `Payment Update: ${finalCustomerName}` +
        (amountPaid > 0 ? ` | Received: ₹${amountPaid.toLocaleString('en-IN')}` : '') +
        (result2.finalOutstanding > 0 ? ` | Outstanding: ₹${result2.finalOutstanding.toLocaleString('en-IN')}` : ' | Fully Settled 🎉'),
      month: new Date().getMonth() + 1,
      year:  new Date().getFullYear(),
    });

    // Build reply
    const lines = [
      `💰 *KRA 5 - Payment ${result2.existing ? 'Updated' : 'Logged'}!*`,
      ``,
      `Customer: *${finalCustomerName}*`,
    ];

    if (result2.finalInvoiceAmount > 0) {
      lines.push(`Deal Total Value: *₹${result2.finalInvoiceAmount.toLocaleString('en-IN')}*`);
    }
    if (amountPaid > 0) {
      lines.push(`Amount Received This Time: *₹${amountPaid.toLocaleString('en-IN')}*`);
    }
    lines.push(`Total Collected So Far: *₹${result2.finalCollected.toLocaleString('en-IN')}*`);

    if (result2.finalOutstanding > 0) {
      lines.push(`Outstanding Balance: *₹${result2.finalOutstanding.toLocaleString('en-IN')} ⏳*`);
      lines.push(`Status: *Partial / Advance Payment 💳*`);
    } else {
      lines.push(`Outstanding Balance: *₹0*`);
      lines.push(`Status: *Fully Paid / Settled 🎉*`);
    }

    lines.push(``, `Updated KRA 5 Payment Collection Dashboard! ✅`);
    return lines.join('\n');

  } catch (error) {
    console.error('Payment Agent Error:', error.message);
    return `⚠️ Could not process payment update: ${error.message}`;
  }
}

/**
 * Image receipt handler - same upsert logic.
 */
async function processPaymentImage(imageBuffer, mimeType, senderPhone) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const imagePart = {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: mimeType || 'image/jpeg',
      },
    };

    const prompt = `You are the Specialized Payment Collection Vision Agent for Enlight Metals.
Analyze this payment receipt / UPI transfer screenshot / bank deposit slip image and extract into JSON:
{
  "customer_name": "<company/customer name if visible, else null>",
  "amount_paid": <numeric amount paid, else 0>,
  "payment_type": "advance|installment|full_settlement",
  "confidence": <float 0.0 to 1.0>
}
Return ONLY JSON. No prose. No markdown.`;

    const result = await model.generateContent([prompt, imagePart]);
    const rawText = result.response.text().trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);

    const amountPaid = Math.max(0, Number(data.amount_paid || 0));
    if (amountPaid <= 0) {
      return `⚠️ *Payment Receipt — Amount Not Clear*\n\nI parsed your payment receipt image, but could not read the amount. Please reply with the exact amount.\nExample: _"₹5,00,000 received from Delta Structural Steel"_`;
    }

    let customerName = data.customer_name ? data.customer_name.trim() : null;
    if (!customerName) {
      customerName = await getLastCustomerForSalesperson(senderPhone);
    }
    if (!customerName) {
      return `⚠️ *Payment Receipt — Customer Not Found*\n\nReceipt for *₹${amountPaid.toLocaleString('en-IN')}* detected! Please reply with the *Customer/Company Name* to credit this payment to KRA 5.`;
    }

    // Verify and get official customer name from salesperson's registered customers
    const { verifyAndGetCustomerName } = require('../supabase');
    const officialCustomerName = await verifyAndGetCustomerName(customerName, senderPhone);

    if (!officialCustomerName) {
      return `⚠️ *Payment Receipt Vision Agent — Client Not Found*\n\n` +
        `Client *"${customerName}"* detected in the receipt is not registered under your salesperson account.\n\n` +
        `Please onboard this customer first under *KRA 2 (Customer Onboarding)* before logging receipts.\n\n` +
        `*Example to onboard customer:*\n` +
        `_"New customer ${customerName} owner Mr. Kapoor location Mumbai phone 9876543210 gst 27AAAAA1111A1Z1"_\n\n` +
        `Once added, you can resend this PO.`;
    }

    const finalCustomerName = officialCustomerName;

    const result2 = await upsertPaymentTracking({
      customerName:    finalCustomerName,
      senderPhone,
      newAmountPaid:   amountPaid,
      explicitPending: 0,
      isFullPayment:   false,
      paymentType:     data.payment_type || 'advance',
    });

    const isFullyPaid = result2.finalStatus === 'collected';
    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number:        5,
      kra_type:          isFullyPaid ? 'payment_collected' : 'payment_advance',
      value:             amountPaid,
      customer_name:     finalCustomerName,
      description:       `Payment Receipt Image Logged: ${finalCustomerName} (₹${amountPaid.toLocaleString('en-IN')})`,
      month: new Date().getMonth() + 1,
      year:  new Date().getFullYear(),
    });

    const lines = [
      `💰 *Payment Receipt Logged!*`,
      ``,
      `Customer: *${finalCustomerName}*`,
    ];
    if (result2.finalInvoiceAmount > 0) lines.push(`Deal Total: *₹${result2.finalInvoiceAmount.toLocaleString('en-IN')}*`);
    lines.push(`Amount Collected: *₹${amountPaid.toLocaleString('en-IN')}*`);
    lines.push(`Total Collected So Far: *₹${result2.finalCollected.toLocaleString('en-IN')}*`);
    if (result2.finalOutstanding > 0) {
      lines.push(`Outstanding: *₹${result2.finalOutstanding.toLocaleString('en-IN')} ⏳*`);
      lines.push(`Status: *Partial Payment 💳*`);
    } else {
      lines.push(`Status: *Fully Paid / Settled 🎉*`);
    }
    lines.push(``, `Updated KRA 5 Payment Collection Dashboard! ✅`);
    return lines.join('\n');

  } catch (err) {
    console.error('Payment Image Agent Error:', err.message);
    return `⚠️ Could not parse payment receipt image: ${err.message}`;
  }
}

module.exports = { processPaymentMessage, processPaymentImage };
