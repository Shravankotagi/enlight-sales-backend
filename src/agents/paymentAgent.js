const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase } = require('../supabase');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PAYMENT_AGENT_PROMPT = `
You are the Specialized Payment Collection AI Agent (KRA 5) for Enlight Metals.
Your job is to parse salesperson payment reports, advance receipts, or outstanding settlement messages.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no prose, no markdown, no backticks):
{
  "customer_name": "<customer/company name, else null>",
  "amount_paid": <numeric amount collected/received/advance, else 0>,
  "amount_pending": <numeric outstanding/pending amount, else 0>,
  "payment_type": "advance|installment|full_settlement",
  "confidence": <float 0.0 to 1.0>
}

Rules:
- If message says "paid 20000 advance rest 30000 pending":
  amount_paid = 20000, amount_pending = 30000, payment_type = "advance"
- If message says "full payment received 50000":
  amount_paid = 50000, amount_pending = 0, payment_type = "full_settlement"

Return ONLY the JSON object.
`;

async function processPaymentMessage(text, senderPhone) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent(PAYMENT_AGENT_PROMPT + '\n\nSalesperson message:\n' + text);
    const rawText = result.response.text().trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);

    // Accuracy Check: Missing Customer Name
    if (!data.customer_name) {
      return `⚠️ *Payment Agent Verification Needed*\n\nPlease specify the *Customer/Company Name* for this payment record so it can be logged accurately into your KRA 5 Dashboard.`;
    }

    // Accuracy Check: Missing Amount
    if (!data.amount_paid || data.amount_paid <= 0) {
      return `⚠️ *Payment Agent Verification Needed*\n\nPlease specify the *Amount Paid/Collected (₹)* for ${data.customer_name}.`;
    }

    const customerName = data.customer_name.trim();
    const amountPaid = Number(data.amount_paid);
    const amountPending = Number(data.amount_pending || 0);

    const paymentStatus = amountPending > 0 ? 'partial' : 'collected';

    // Insert into payment_tracking
    await supabase.from('payment_tracking').insert({
      customer_name: customerName,
      salesperson_phone: senderPhone,
      invoice_amount: amountPaid + amountPending,
      collected_amount: amountPaid,
      outstanding: amountPending,
      status: paymentStatus,
      payment_type: data.payment_type || 'advance',
      created_at: new Date().toISOString(),
    });

    // Log to kra_logs for KRA 5
    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number: 5,
      kra_type: data.payment_type === 'advance' ? 'payment_advance' : 'payment_collected',
      value: amountPaid,
      customer_name: customerName,
      description: `Payment Received: ${customerName} (₹${amountPaid.toLocaleString('en-IN')}${amountPending > 0 ? ` | Outstanding: ₹${amountPending.toLocaleString('en-IN')}` : ''})`,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    });

    return `💰 *KRA 5 - Payment Collection Logged!*\n\n` +
      `Customer: *${customerName}*\n` +
      `Amount Received: *₹${amountPaid.toLocaleString('en-IN')}*\n` +
      (amountPending > 0 ? `Outstanding Balance: *₹${amountPending.toLocaleString('en-IN')}*\n` : `Status: *Fully Paid / Settled 🎉*\n`) +
      `\nUpdated KRA 5 Payment Collection Dashboard! ✅`;

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

    // Save payment
    await supabase.from('payment_tracking').insert({
      customer_name: customerName,
      salesperson_phone: senderPhone,
      invoice_amount: amountPaid,
      collected_amount: amountPaid,
      outstanding: 0,
      status: 'collected',
      payment_type: data.payment_type || 'advance',
      created_at: new Date().toISOString(),
    });

    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number: 5,
      kra_type: 'payment_collected',
      value: amountPaid,
      customer_name: customerName,
      description: `Payment Receipt Image Logged: ${customerName} (₹${amountPaid.toLocaleString('en-IN')})`,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    });

    return `💰 *Payment Receipt Image Logged!*\n\n` +
      `Customer: *${customerName}*\n` +
      `Amount Collected: *₹${amountPaid.toLocaleString('en-IN')}*\n` +
      `Status: *Collected & Verified ✅*\n\n` +
      `Updated KRA 5 Payment Collection Dashboard!`;

  } catch (err) {
    console.error('Payment Image Agent Error:', err.message);
    return `⚠️ Could not parse payment receipt image: ${err.message}`;
  }
}

module.exports = { processPaymentMessage, processPaymentImage };
