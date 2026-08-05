const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const EXTRACTION_PROMPT = `
You are an inquiry parser for an Indian B2B steel distributor called Enlight Metals.
Input may be English, Hindi, or Hinglish. It could be typed text OR a photo of a 
Purchase Order, handwritten requirement, or printed RFQ.

Extract the following into ONLY a JSON object (no prose, no markdown, no backticks):

{
  "customer": {
    "name": "",
    "contact_person": "",
    "phone": "",
    "gst": "",
    "address": "",
    "match_status": "matched|fuzzy|new"
  },
  "line_items": [
    {
      "sku_text": "",
      "grade": "",
      "dimensions": "",
      "quantity": 0,
      "unit": "MT|KG|PCS",
      "rate": 0,
      "amount": 0,
      "confidence": 0.0
    }
  ],
  "po_number": "",
  "po_date": "",
  "delivery_location": "",
  "delivery_date": "",
  "payment_terms": "",
  "total_amount": 0,
  "overall_confidence": 0.0,
  "inquiry_type": "purchase_order|inquiry|visiting_card|unknown"
}

Rules:
- Quantities: normalize to MT where unit is tonnes/ton/MT; keep KG/PCS as stated
- SKU text: preserve the customer exact words in sku_text
- If a field is absent return null - never invent values
- DATE RULE: Current Year is 2026. Any date specifying month/day (e.g. "20 August", "25 August") MUST ALWAYS use year 2026 (e.g. 2026-08-20). NEVER output past years like 2024 or 2025.
- CONFIDENCE RULE:
  * 1.0 (100%) ONLY when quantity, product, unit, AND explicit rate/price per MT are stated.
  * 0.85 when rate is auto-derived from rate sheet.
  * 0.75 - 0.80 when rate or customer details are missing.
- overall_confidence: average of line item confidences, capped at 0.85 if rate is auto-derived.
- inquiry_type: "purchase_order" if PO number present, "inquiry" if just a requirement
- Return ONLY the JSON object. No prose. No markdown. No backticks.
`;

const { supabase } = require('./supabase');

async function getLatestActiveRatesText() {
  try {
    const { data: sheets } = await supabase
      .from('rate_sheets')
      .select('id, date, rate_sheet_items(*)')
      .order('created_at', { ascending: false })
      .limit(1);

    if (sheets && sheets.length > 0 && sheets[0].rate_sheet_items?.length > 0) {
      const items = sheets[0].rate_sheet_items;
      const formatted = items
        .map(
          (i) =>
            `- ${i.category || 'Steel'} (${i.grade || 'Standard'}${i.dimensions ? ` ${i.dimensions}` : ''}): ₹${Number(i.price_per_mt || 0).toLocaleString('en-IN')}/MT`,
        )
        .join('\n');
      return `\nOFFICIAL ACTIVE RATE SHEET (Use these per-MT prices to calculate rate and total_amount when rate is not explicitly stated in the input):\n${formatted}\n`;
    }
  } catch (err) {
    console.error('Error fetching rate sheet for Gemini:', err.message);
  }
  return '';
}

function postProcessExtraction(parsed) {
  if (!parsed) return parsed;

  // 1. Delivery Date Year Correction (Ensure 2026 or future year)
  if (parsed.delivery_date) {
    const parts = parsed.delivery_date.split('-');
    if (parts.length === 3 && parseInt(parts[0]) < 2026) {
      parsed.delivery_date = `2026-${parts[1]}-${parts[2]}`;
    }
  }

  // 2. Line Item Rate and Amount calculation
  let totalCalculatedAmount = 0;
  let hasMissingRate = false;

  if (Array.isArray(parsed.line_items) && parsed.line_items.length > 0) {
    parsed.line_items.forEach((item) => {
      const qty = Number(item.quantity || 0);
      let rate = Number(item.rate || 0);
      let amount = Number(item.amount || 0);

      if (qty > 0 && amount > 0 && rate === 0) {
        rate = Math.round(amount / qty);
        item.rate = rate;
      }

      if (qty > 0 && rate > 0 && amount === 0) {
        amount = qty * rate;
        item.amount = amount;
      }

      if (rate === 0) {
        hasMissingRate = true;
      }

      totalCalculatedAmount += amount;
    });
  }

  if (totalCalculatedAmount > 0 && (!parsed.total_amount || parsed.total_amount === 0)) {
    parsed.total_amount = totalCalculatedAmount;
  }

  // 3. Realistic Confidence Adjustment
  if (hasMissingRate && parsed.overall_confidence > 0.8) {
    parsed.overall_confidence = 0.8;
  }

  return parsed;
}

async function extractFromText(text) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const rateSheetInfo = await getLatestActiveRatesText();
    const prompt = EXTRACTION_PROMPT + rateSheetInfo + '\n\nInput text:\n' + text;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text().trim();
    
    // Clean response - remove any markdown backticks if present
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    
    const parsed = JSON.parse(cleaned);
    const postProcessed = postProcessExtraction(parsed);
    console.log('Gemini text extraction successful:', JSON.stringify(postProcessed, null, 2));
    return postProcessed;
  } catch (error) {
    console.error('Gemini text extraction error:', error.message);
    return {
      overall_confidence: 0,
      inquiry_type: 'unknown',
      error: error.message
    };
  }
}

async function extractFromImage(imageBuffer, mimeType) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    
    const imagePart = {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: mimeType || 'image/jpeg'
      }
    };
    
    const result = await model.generateContent([EXTRACTION_PROMPT, imagePart]);
    const response = await result.response;
    const rawText = response.text().trim();
    
    // Clean response
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    
    const parsed = JSON.parse(cleaned);
    const postProcessed = postProcessExtraction(parsed);
    console.log('Gemini image extraction successful:', JSON.stringify(postProcessed, null, 2));
    return postProcessed;
  } catch (error) {
    console.error('Gemini image extraction error:', error.message);
    return {
      overall_confidence: 0,
      inquiry_type: 'unknown',
      error: error.message
    };
  }
}

const INTENT_PROMPT = `
You are the intelligent message router for an Indian B2B steel distributor's WhatsApp sales bot.
A salesperson sends a text message. Your job is to understand what action they are reporting and classify it.

Return ONLY a JSON object with this structure (no prose, no markdown, no backticks):
{
  "intent": "<one of the intents below>",
  "customer_name": "<extracted customer/company name if mentioned, else null>",
  "amount_paid": <numeric amount paid/collected if mentioned, else 0>,
  "amount_pending": <numeric amount still pending/outstanding if mentioned, else 0>,
  "payment_status": "full|partial|pending",
  "confidence": 0.0
}

Valid intents:
- "stage_update"    : Updating deal status, deal value, total sale value, or pipeline stage (e.g. "mark X deal as won", "total payment amount of X is 10,20,000 update KRA 1", "X deal lost due to price", "negotiation with X", "quoted rate to X")
- "greeting"        : Salesperson greeting or general hello (e.g. "hi", "hii", "hello", "hey", "namaste", "good morning")
- "new_customer"    : Salesperson is announcing/reporting they acquired or onboarded a new customer (e.g. "new customer acquired", "new client onboarded", "naya customer mila", "got new business from X")
- "visit"           : Salesperson is reporting they visited a customer site (e.g. "visited X today", "X ke yahan gaya")
- "payment"         : Reporting a payment received/collected/advance or pending balance (e.g. "collected 50000 from X", "X paid 20000 advance rest 30000 pending", "payment collected from X", "full amount 1020000 is collected")
- "complaint"       : Reporting a customer complaint or rejection (e.g. "X ne reject kiya", "customer complaint")
- "complaint_resolve": Reporting a complaint/rejection was resolved (e.g. "resolved complaint", "issue fix ho gaya")
- "followup"        : Reporting they followed up with a customer (e.g. "followed up with X", "follow up kiya")
- "inquiry"         : A customer's product requirement or purchase order (e.g. "5 tons HR coil", "PO from X")
- "query"           : Asking for their own data/stats (e.g. "show me my visits", "KRA status")
- "unknown"         : Cannot determine a clear business action

Rules:
- If message mentions "KRA 1", "deal value", "total sale value", "won", "lost" -> intent MUST be "stage_update".
- If message mentions "KRA 5", "collected", "advance", "payment received" -> intent MUST be "payment".
- Be flexible. Accept Hinglish, broken English, casual phrasing.
- "payment_status": "partial" if advance paid or partial amount paid with remaining balance pending; "full" if full payment collected; "pending" if payment is due/pending.
- Return ONLY the JSON object.
`;

async function classifyIntent(text) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const prompt = INTENT_PROMPT + '\n\nSalesperson message:\n' + text;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text().trim();
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    console.log('Gemini intent classification:', JSON.stringify(parsed));
    return parsed;
  } catch (error) {
    console.error('Gemini intent classification error:', error.message);
    return { intent: 'unknown', customer_name: null, confidence: 0 };
  }
}

module.exports = { extractFromText, extractFromImage, classifyIntent };
