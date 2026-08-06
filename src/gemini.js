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
You are the intelligent message router for Enlight Metals, an Indian B2B steel distributor.
A salesperson sends a WhatsApp message in English, Hindi, or Hinglish — casually, informally, 
without any fixed format. Your job is to understand the INTENT behind what they are reporting.

Think about what action the salesperson is describing, not what words they used.

Return ONLY a JSON object (no prose, no markdown, no backticks):
{
  "intent": "<one of the intents below>",
  "customer_name": "<extracted customer/company name if mentioned, else null>",
  "amount_paid": <numeric amount paid/collected if mentioned, else 0>,
  "amount_pending": <numeric amount still pending/outstanding if mentioned, else 0>,
  "payment_status": "full|partial|pending|unknown",
  "reasoning": "<one sentence explaining why you chose this intent>",
  "confidence": <float 0.0 to 1.0>
}

INTENT DEFINITIONS — understand the meaning, not the keywords:

"stage_update": The salesperson is telling you the STATUS of a deal changed.
  Examples (all different wordings, same intent):
  - "Supreme ka deal ho gaya" (deal finalized)
  - "Mehta Industries ne mana kar diya" (customer refused)
  - "ABC ke saath baat chal rahi hai" (negotiation ongoing)
  - "Rate bhej diya Maine" (quote was sent)
  - "Order pakka ho gaya 15 ton ka" (order confirmed)
  - "Wo nahi lenge, price jyada lagi unhe" (lost on price)

"payment": The salesperson is reporting money received, advance paid, or outstanding balance.
  Examples:
  - "Supreme ne 50 hazaar diye aaj" (payment received)
  - "Unka 2 lakh abhi bhi baaki hai" (outstanding pending)
  - "Advance aa gaya" (advance received)
  - "Full payment clear ho gayi" (fully paid)
  - "Partial mila, baaki next week" (partial payment)

"visit": The salesperson visited a customer's location or met them in person.
  Examples:
  - "Aaj Mehta ke yahan gaya tha" (visited today)
  - "Factory visit ki ABC ka" (factory visit done)
  - "Mr. Sharma se mila aaj office mein" (met person)
  - "Site pe gaye the, unse baat hui" (went to site)

"new_customer": The salesperson acquired or onboarded a new client they didn't have before, OR they are updating an existing customer's contact details, owner name, phone, address, location, or GST.
  Examples:
  - "Ek naya party mila, XYZ Steels" (new party found)
  - "New customer onboard hua" (new customer onboarded)
  - "Delta Structural Steel phone 9876543210 owner Mr. Kapoor" (customer detail update)
  - "Mehta Industries location Pune gst 27AAAAA1111A1Z1" (customer detail update)

"followup": The salesperson followed up or checked in with an existing customer.
  Examples:
  - "Mehta ko call kiya, soch rahe hain" (called, they're thinking)
  - "Follow kar raha hoon Supreme ka" (following up)
  - "Unse dobara baat ki" (spoke again)
  - "Check in kiya, interested hain" (checked in)

"complaint": A customer raised an issue, rejected material, or reported a problem.
  Examples:
  - "ABC ne material wapas kiya" (material returned)
  - "Quality issue aa gaya unka" (quality issue)
  - "Customer complaint hai Mehta ka" (complaint)
  - "Unhone reject kar diya" (rejected)

"complaint_resolve": A previously reported complaint or issue has been resolved.
  Examples:
  - "Mehta ka issue solve ho gaya" (issue solved)
  - "Complaint fix kar di" (complaint fixed)
  - "Ab theek hai, unhone accept kar liya" (accepted now)

"inquiry": A customer's product requirement — what steel they want to buy.
  Examples:
  - "5 ton HR coil chahiye ABC ko" (product requirement)
  - "Mehta ne rate manga 10mm ka" (rate asked for)
  - "PO aaya hai Supreme ka" (purchase order received)

"query": The salesperson is asking for their performance stats, dashboard link, or asking general informational questions (e.g. today's date/time, current steel rates/prices, explaining bot features, or general information).
  Examples:
  - "what is todays date" (date/time query)
  - "rate sheet dikhao" (pricing query)
  - "today's price of HR Coil" (pricing query)
  - "Mere kitne visits hue?" (performance stats)
  - "KRA status dikhao" (show KRA status)
  - "Aaj ka dashboard dikhao" (show today's dashboard)

"greeting": Just a hello or check-in with no business content.
  Examples: "Hi", "Hello", "Good morning", "Namaste", "Kya haal hai"

"unknown": You genuinely cannot determine any business intent or it is a general conversational remark.

IMPORTANT RULES:
- Judge by the MEANING of the message, not by the presence of specific words
- A message can lack any keywords and still have a clear intent
- When confidence is below 0.5, prefer "unknown" and let the system ask for clarification
- "reasoning" field: explain your choice in plain English, one sentence
- Return ONLY the JSON object
`;

async function classifyIntent(text) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const nowStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'long' });
    const contextPrompt = `Context:\n- Today's date and time in India: ${nowStr}\n\n`;
    const prompt = contextPrompt + INTENT_PROMPT + '\n\nSalesperson message:\n' + text;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text().trim();
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    console.log(`Intent: ${parsed.intent} | Confidence: ${parsed.confidence} | Reason: ${parsed.reasoning || parsed.intent}`);
    return parsed;
  } catch (error) {
    console.error('Gemini intent classification error:', error.message);
    return { intent: 'unknown', customer_name: null, confidence: 0, reasoning: 'Error during classification' };
  }
}

const QUERY_CLASSIFIER_PROMPT = `
You are an intelligent query router for a B2B steel sales system.
Your job is to classify the salesperson's request into one of the following categories:

DATA QUERIES (about the salesperson's own work):
- "dashboard_link": requests login link, website, portal URL, dashboard URL, open dashboard.
- "sales_summary": requests sales report, sales numbers, deals created/won count and value.
- "kra_status": requests performance report, KRA status, KRA achievements, targets status, my performance.
- "visit_summary": requests visits count total, how many visits did I do.
- "payment_summary": requests outstanding payment totals, collection summary, overdue totals.
- "complaint_summary": requests complaints logged count, customer issues summary.
- "full_report": requests full monthly report, complete KRA report card, monthly report.
- "deals_this_week": requests this week's deals list, week deals, is hafte ke deals.
- "pending_deals": requests pending deals list, open deals, active deals, incomplete deals.
- "pending_inquiries": requests pending inquiries list, review queue, inquiries to be processed.
- "new_customers_summary": requests KRA 2 new customer onboarding summary, POs received, how many new customers.
- "won_customers": requests won customer names, list of won deals with customers and products, who I won deals with, KRA 1 breakdown.
- "active_deals_detail": requests active deals pipeline with items and amounts, my current deals with products.
- "customer_list": requests full customer list, all my customers, registered clients, my client directory.
- "rate_sheet": requests today's rate sheet, current steel prices, current rates, bhav, what are the rates.
- "visit_list": requests customer visit list, who I visited, my visits this month, field visit log.
- "payment_aging": requests outstanding dues per customer, overdue list, who hasn't paid, payment aging, baaki list.
- "lost_deals": requests lost deals breakdown, rejected deals, why deals were lost, loss reasons.

ASSISTANT QUERIES (legitimate but handled by conversational AI):
- "general": hello/greetings, how to log something, what is today's date, help with bot usage, general steel industry questions.

BLOCKED QUERIES (must be rejected — outside scope):
- "blocked": asking about another specific salesperson's performance, sales or deals by name; asking the bot to perform admin actions (lock/create/modify rate sheets); asking for product recommendations for a client; asking completely off-topic unrelated questions (jokes, news, cricket scores, etc.); asking the bot to access systems it cannot (email, CRM admin, reports for other users).

Examples:
- "give me the won customer names" → "won_customers" (confidence 0.95)
- "performace report august" → "kra_status" (confidence 0.90)
- "bhav kya hai" → "rate_sheet" (confidence 0.85)
- "baaki list dikhao" → "payment_aging" (confidence 0.90)
- "is hafte ke deals" → "deals_this_week" (confidence 0.90)
- "show kumar varma sales" → "blocked" (confidence 0.98)
- "lock the rate sheet" → "blocked" (confidence 0.98)
- "suggest products for Tata" → "blocked" (confidence 0.95)
- "what's the cricket score" → "blocked" (confidence 0.95)
- "hello" → "general" (confidence 0.90)
- "how do I log a visit?" → "general" (confidence 0.85)

Return ONLY a JSON object (no markdown, no prose, no backticks):
{
  "category": "<one of the categories above>",
  "confidence": <float 0.0 to 1.0>,
  "target_salesperson": "<full name of the salesperson mentioned in the query if any, else null>"
}
`;

async function classifyQueryType(text) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const prompt = QUERY_CLASSIFIER_PROMPT + '\n\nQuery: "' + text + '"';
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text().trim();
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    console.log(`Query Category: ${parsed.category} | Confidence: ${parsed.confidence}`);
    return parsed;
  } catch (error) {
    console.error('Gemini query classification error:', error.message);
    return { category: 'general', confidence: 0 };
  }
}

module.exports = { extractFromText, extractFromImage, classifyIntent, getLatestActiveRatesText, classifyQueryType };
