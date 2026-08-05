const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase } = require('../supabase');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PAYMENT_AGENT_PROMPT = `
You are the Specialized Payment Collection AI Agent (KRA 5) for Enlight Metals.
Your job is to parse salesperson payment reports, advance receipts, outstanding balance updates, or pending amount messages.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no prose, no markdown, no backticks):
{
  "customer_name": "<customer/company name, else null>",
  "amount_paid": <numeric amount collected/received/advance, else 0>,
  "amount_pending": <numeric outstanding/pending amount, else 0>,
  "payment_type": "advance|installment|full_settlement|outstanding_update",
  "confidence": <float 0.0 to 1.0>
}

Rules:
- If message says "still payment of 700000 is pending from Supreme Structural Steel" or "700000 baki hai":
  customer_name = "Supreme Structural Steel", amount_paid = 0, amount_pending = 700000, payment_type = "outstanding_update"
- If message says "paid 20000 advance rest 30000 pending":
  amount_paid = 20000, amount_pending = 30000, payment_type = "advance"
- If message says "full payment received 50000":
  amount_paid = 50000, amount_pending = 0, payment_type = "full_settlement"

Return ONLY the JSON object.
`;

async function resolvePaymentBalance(customerName, newAmountPaid, explicitPending) {
  let dealTotal = 0;
  let priorCollected = 0;

  // 1. Look up recent deal total amount for this customer
  const { data: deals } = await supabase
    .from('deals')
    .select('total_amount')
    .ilike('customer_name', `%${customerName}%`)
    .order('created_at', { ascending: false })
    .limit(1);

  if (deals && deals.length > 0 && deals[0].total_amount) {
    dealTotal = Number(deals[0].total_amount) || 0;
  }

  // 2. Sum up all prior payments for this customer
  const { data: priorPayments } = await supabase
    .from('payment_tracking')
    .select('collected_amount')
    .ilike('customer_name', `%${customerName}%`);

  if (priorPayments && priorPayments.length > 0) {
    priorCollected = priorPayments.reduce((sum, p) => sum + (Number(p.collected_amount) || 0), 0);
  }

  let totalCollectedNow = priorCollected + newAmountPaid;
  let outstanding = 0;
  let isFullyPaid = false;

  if (explicitPending && explicitPending > 0) {
    outstanding = explicitPending;
    if (dealTotal > 0 && newAmountPaid === 0) {
      totalCollectedNow = Math.max(0, dealTotal - outstanding);
    }
  } else if (dealTotal > 0) {
    outstanding = Math.max(0, dealTotal - totalCollectedNow);
    isFullyPaid = totalCollectedNow >= dealTotal;
  } else {
    isFullyPaid = false;
  }

  if (outstanding === 0 && dealTotal > 0 && totalCollectedNow >= dealTotal) {
    isFullyPaid = true;
  }

  return {
    dealTotal,
    priorCollected,
    totalCollectedNow,
    outstanding,
    isFullyPaid,
    status: isFullyPaid ? 'collected' : 'partial',
    paymentType: isFullyPaid ? 'full_settlement' : (priorCollected > 0 ? 'installment' : 'advance')
  };
}

function extractPendingAmountRegex(text) {
  const pendingMatch = text.match(/(?:pending|baki|due|outstanding|balance|rest)\D*?(\d[\d,]*)/i) || 
                       text.match(/(\d[\d,]*)\D*?(?:pending|baki|due|outstanding|balance|rest)/i);
  if (pendingMatch && pendingMatch[1]) {
    const cleanNum = Number(pendingMatch[1].replace(/,/g, ''));
    if (!isNaN(cleanNum) && cleanNum > 0) return cleanNum;
  }
  return 0;
}

async function processPaymentMessage(text, senderPhone) {
  try {
    // Pre-clean formatted numbers (e.g. 10,20,000 -> 1020000)
    const cleanedText = text.replace(/(\d+),(\d+)/g, '$1$2').replace(/(\d+),(\d+)/g, '$1$2');

    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent(PAYMENT_AGENT_PROMPT + '\n\nSalesperson message:\n' + cleanedText);
    const rawText = result.response.text().trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);

    let customerName = data.customer_name ? data.customer_name.trim() : null;

    // Context Memory: Auto-fill recent customer name if missing in follow-up message
    if (!customerName) {
      const { data: recentDeals } = await supabase
        .from('deals')
        .select('customer_name')
        .eq('salesperson_phone', senderPhone)
        .order('created_at', { ascending: false })
        .limit(1);

      if (recentDeals && recentDeals.length > 0 && recentDeals[0].customer_name) {
        customerName = recentDeals[0].customer_name;
      }
    }

    // Accuracy Check: Missing Customer Name
    if (!customerName) {
      return `⚠️ *Payment Agent Verification Needed*\n\nPlease specify the *Customer/Company Name* for this payment record so it can be logged accurately into your KRA 5 Dashboard.`;
    }

    let amountPaid = Number(data.amount_paid || 0);
    let explicitPending = Number(data.amount_pending || 0);

    // Fallback: Deterministic Regex pre-parsing for pending balance
    if (explicitPending <= 0 && (cleanedText.toLowerCase().includes('pending') || cleanedText.toLowerCase().includes('baki') || cleanedText.toLowerCase().includes('due') || cleanedText.toLowerCase().includes('outstanding'))) {
      const regexPending = extractPendingAmountRegex(cleanedText);
      if (regexPending > 0) {
        explicitPending = regexPending;
      }
    }

    // Accuracy Check: Missing both Amount Paid and Amount Pending
    if (amountPaid <= 0 && explicitPending <= 0) {
      return `⚠️ *Payment Agent Verification Needed*\n\nPlease specify the *Payment Amount Collected (₹)* or *Outstanding Pending Amount (₹)* for ${customerName}.`;
    }

    // Compute balance from deal total and prior payments
    const balanceInfo = await resolvePaymentBalance(customerName, amountPaid, explicitPending);
    const amountPending = balanceInfo.outstanding;

    // Insert into payment_tracking
    await supabase.from('payment_tracking').insert({
      customer_name: customerName,
      salesperson_phone: senderPhone,
      invoice_amount: balanceInfo.dealTotal || (amountPaid + amountPending),
      collected_amount: amountPaid > 0 ? amountPaid : balanceInfo.totalCollectedNow,
      outstanding: amountPending,
      status: balanceInfo.status,
      payment_type: balanceInfo.paymentType,
      created_at: new Date().toISOString(),
    });

    // Log to kra_logs for KRA 5
    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number: 5,
      kra_type: balanceInfo.isFullyPaid ? 'payment_collected' : 'payment_advance',
      value: amountPaid > 0 ? amountPaid : balanceInfo.totalCollectedNow,
      customer_name: customerName,
      description: `Payment Update: ${customerName} (${amountPaid > 0 ? `Paid: ₹${amountPaid.toLocaleString('en-IN')}` : ''}${amountPending > 0 ? ` | Outstanding: ₹${amountPending.toLocaleString('en-IN')}` : ''})`,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    });

    return `💰 *KRA 5 - Payment Collection Logged!*\n\n` +
      `Customer: *${customerName}*\n` +
      (balanceInfo.dealTotal > 0 ? `Deal Total Value: *₹${balanceInfo.dealTotal.toLocaleString('en-IN')}*\n` : '') +
      (amountPaid > 0 ? `Amount Received: *₹${amountPaid.toLocaleString('en-IN')}*\n` : '') +
      (balanceInfo.dealTotal > 0 ? `Total Collected So Far: *₹${balanceInfo.totalCollectedNow.toLocaleString('en-IN')} / ₹${balanceInfo.dealTotal.toLocaleString('en-IN')}*\n` : '') +
      (amountPending > 0 
        ? `Outstanding Balance Pending: *₹${amountPending.toLocaleString('en-IN')} ⏳*\nStatus: *Advance / Partial Payment Pending 💳*` 
        : `Status: *Fully Paid / Settled 🎉*`) +
      `\n\nUpdated KRA 5 Payment Collection Dashboard! ✅`;

  } catch (error) {
    console.error('Payment Agent Error:', error.message);
    return `⚠️ Could not process payment update: ${error.message}`;
  }
}

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
  "customer_name": "<company/customer name if present, else null>",
  "amount_paid": <numeric amount paid, else 0>,
  "payment_type": "advance|installment|full_settlement",
  "confidence": <float 0.0 to 1.0>
}
Return ONLY JSON.`;

    const result = await model.generateContent([prompt, imagePart]);
    const rawText = result.response.text().trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);

    if (!data.amount_paid || data.amount_paid <= 0) {
      return `⚠️ *Payment Receipt Vision Agent Clarification Needed*\n\nI parsed your payment receipt image, but the *Amount Received* is not clear. Please reply with the exact payment amount.`;
    }

    if (!data.customer_name) {
      return `⚠️ *Payment Receipt Vision Agent Clarification Needed*\n\nReceipt for *₹${Number(data.amount_paid).toLocaleString('en-IN')}* detected! Please reply with the *Customer/Company Name* so it can be credited to KRA 5.`;
    }

    const customerName = data.customer_name.trim();
    const amountPaid = Number(data.amount_paid);

    const balanceInfo = await resolvePaymentBalance(customerName, amountPaid);

    // Save payment
    await supabase.from('payment_tracking').insert({
      customer_name: customerName,
      salesperson_phone: senderPhone,
      invoice_amount: balanceInfo.dealTotal || amountPaid,
      collected_amount: amountPaid,
      outstanding: balanceInfo.outstanding,
      status: balanceInfo.status,
      payment_type: balanceInfo.paymentType,
      created_at: new Date().toISOString(),
    });

    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number: 5,
      kra_type: balanceInfo.isFullyPaid ? 'payment_collected' : 'payment_advance',
      value: amountPaid,
      customer_name: customerName,
      description: `Payment Receipt Image Logged: ${customerName} (₹${amountPaid.toLocaleString('en-IN')})`,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    });

    return `💰 *Payment Receipt Image Logged!*\n\n` +
      `Customer: *${customerName}*\n` +
      (balanceInfo.dealTotal > 0 ? `Deal Total Value: *₹${balanceInfo.dealTotal.toLocaleString('en-IN')}*\n` : '') +
      `Amount Collected: *₹${amountPaid.toLocaleString('en-IN')}*\n` +
      (balanceInfo.dealTotal > 0 ? `Total Collected: *₹${balanceInfo.totalCollectedNow.toLocaleString('en-IN')} / ₹${balanceInfo.dealTotal.toLocaleString('en-IN')}*\n` : '') +
      (balanceInfo.outstanding > 0 
        ? `Outstanding Balance Pending: *₹${balanceInfo.outstanding.toLocaleString('en-IN')} ⏳*\nStatus: *Advance / Partial Payment Received 💳*` 
        : `Status: *Fully Paid / Settled 🎉*`) +
      `\n\nUpdated KRA 5 Payment Collection Dashboard! ✅`;

  } catch (err) {
    console.error('Payment Image Agent Error:', err.message);
    return `⚠️ Could not parse payment receipt image: ${err.message}`;
  }
}

module.exports = { processPaymentMessage, processPaymentImage };
