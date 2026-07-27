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
- If a field is absent return null — never invent values
- confidence per line item: 1.0 only when quantity, product, and unit are all explicit
- overall_confidence: average of all line item confidences
- inquiry_type: "purchase_order" if PO number present, "inquiry" if just a requirement
- Return ONLY the JSON object. No prose. No markdown. No backticks.
`;

async function extractFromText(text) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const prompt = EXTRACTION_PROMPT + '\n\nInput text:\n' + text;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text().trim();
    
    // Clean response — remove any markdown backticks if present
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    
    const parsed = JSON.parse(cleaned);
    console.log('Gemini text extraction successful:', JSON.stringify(parsed, null, 2));
    return parsed;
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
    console.log('Gemini image extraction successful:', JSON.stringify(parsed, null, 2));
    return parsed;
  } catch (error) {
    console.error('Gemini image extraction error:', error.message);
    return {
      overall_confidence: 0,
      inquiry_type: 'unknown',
      error: error.message
    };
  }
}

module.exports = { extractFromText, extractFromImage };
