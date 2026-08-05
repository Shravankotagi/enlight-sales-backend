const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase } = require('../supabase');
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
  "customer_name": "<company/customer name>",
  "target_stage": "won|lost|negotiation|quoted|qualified",
  "loss_reason": "<inferred reason if deal was lost, else null>",
  "rate_per_mt": <numeric per-MT price if mentioned e.g. 51000 per MT, else 0>,
  "total_amount": <numeric total deal value in rupees if explicitly mentioned, else 0>,
  "po_number": "<PO number if mentioned, else null>",
  "confidence": <float 0.0 to 1.0>
}

Rules for target_stage — understand meaning, not keywords:
- Any message indicating a deal was finalized, confirmed, accepted, or order placed -> "won"
- Any message indicating a deal was refused, rejected, cancelled, or customer declined -> "lost"
- Any message indicating ongoing discussion, bargaining, or counter-offer -> "negotiation"
- Any message indicating a price/quote was sent or shared -> "quoted"
- Any new requirement or RFQ received -> "qualified"

Rules for loss_reason — infer from context:
- Infer the reason why the deal was lost (e.g. price high, competitor lower rate, payment terms mismatch, delivery delay) if deal lost, else null.

Return ONLY the JSON object.
`;

async function processSalesMessage(text, senderPhone) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent(SALES_AGENT_PROMPT + '\n\nSalesperson message:\n' + text);
    const rawText = result.response.text().trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);

    if (!data.customer_name) {
      return `⚠️ *Sales Agent Request*\nPlease mention the Customer/Company Name to update the sales pipeline.`;
    }

    const customerName = data.customer_name.trim();
    const targetStage = data.target_stage || 'won';

    // 1. Prioritize deals with non-zero total_amount for this salesperson
    let { data: existingDeals } = await supabase
      .from('deals')
      .select('*')
      .ilike('customer_name', `%${customerName}%`)
      .eq('salesperson_phone', senderPhone)
      .order('total_amount', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);

    // 2. If no match for this salesperson, search company-wide
    if (!existingDeals || existingDeals.length === 0) {
      const { data: globalDeals } = await supabase
        .from('deals')
        .select('*')
        .ilike('customer_name', `%${customerName}%`)
        .order('total_amount', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1);
      existingDeals = globalDeals;
    }

    let dealId = existingDeals && existingDeals.length > 0 ? existingDeals[0].id : null;
    let existingAmount = existingDeals && existingDeals[0] ? Number(existingDeals[0].total_amount || 0) : 0;

    // Fetch quantity in MT if existing deal items present
    let quantityMt = 0;
    if (dealId) {
      const { data: items } = await supabase.from('deal_items').select('quantity').eq('deal_id', dealId);
      if (items && items.length > 0) {
        quantityMt = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
      }
    }

    let dealAmount = existingAmount;

    if (data.total_amount && data.total_amount > 0) {
      dealAmount = Number(data.total_amount);
    } else if (data.rate_per_mt && data.rate_per_mt > 0) {
      if (quantityMt > 0) {
        dealAmount = quantityMt * Number(data.rate_per_mt);
      } else {
        dealAmount = Number(data.rate_per_mt);
      }
    }

    if (dealId && dealAmount === 0) {
      const { data: items } = await supabase.from('deal_items').select('amount, quantity, rate').eq('deal_id', dealId);
      if (items && items.length > 0) {
        const itemSum = items.reduce((sum, i) => sum + (Number(i.amount) || Number(i.quantity || 0) * Number(i.rate || 0)), 0);
        if (itemSum > 0) dealAmount = itemSum;
      }
    }

    // Stage mapping
    const stageMap = {
      won: 'won',
      lost: 'lost',
      negotiation: 'negotiation',
      quoted: 'quoted',
      qualified: 'qualified',
    };
    const dbStage = stageMap[targetStage] || 'won';

    if (dealId) {
      // Update deal in Supabase
      await supabase
        .from('deals')
        .update({
          stage: dbStage,
          total_amount: dealAmount || undefined,
          won_at: dbStage === 'won' ? new Date().toISOString() : undefined,
          loss_reason: dbStage === 'lost' ? data.loss_reason || 'Not specified' : undefined,
        })
        .eq('id', dealId);
    } else {
      // Insert new deal
      const { data: newDeal } = await supabase
        .from('deals')
        .insert({
          customer_name: customerName,
          salesperson_phone: senderPhone,
          stage: dbStage,
          total_amount: dealAmount || 0,
          inquiry_type: 'purchase_order',
          won_at: dbStage === 'won' ? new Date().toISOString() : undefined,
          loss_reason: dbStage === 'lost' ? data.loss_reason || 'Not specified' : undefined,
        })
        .select()
        .single();
      if (newDeal) dealId = newDeal.id;
    }

    // Sync live to KRA 1 log
    if (dbStage === 'won') {
      await supabase.from('kra_logs').insert({
        salesperson_phone: senderPhone,
        kra_number: 1,
        kra_type: 'sales_achievement',
        value: dealAmount || 0,
        customer_name: customerName,
        description: `Deal Won: ${customerName} (₹${Number(dealAmount).toLocaleString('en-IN')})`,
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
      });
    }

    // Push to Zoho Bigin CRM
    syncToBigin(customerName, dbStage, dealAmount, data.po_number, senderPhone);

    // Format WhatsApp Response
    if (dbStage === 'won') {
      return `🏆 *KRA 1 - Deal Marked as WON!*\n\n` +
        `Customer: *${customerName}*\n` +
        `Stage: *Closed Won 🎉*\n` +
        `Deal Value: *₹${Number(dealAmount).toLocaleString('en-IN')}*\n\n` +
        `Updated KRA 1 Sales Achievement & synced live to Zoho Bigin! ✅`;
    } else if (dbStage === 'lost') {
      return `❌ *Deal Marked as LOST*\n\n` +
        `Customer: *${customerName}*\n` +
        `Stage: *Closed Lost*\n` +
        (data.loss_reason ? `Reason: ${data.loss_reason}\n` : '') +
        `Updated Loss Analytics & Zoho Bigin! 📉`;
    } else {
      return `🔄 *Pipeline Stage Updated!*\n\n` +
        `Customer: *${customerName}*\n` +
        `New Stage: *${dbStage.toUpperCase()}*\n\n` +
        `Synced live to Sales Dashboard & Zoho Bigin! ✅`;
    }

  } catch (error) {
    console.error('Sales Agent Error:', error.message);
    return `⚠️ Could not process sales update: ${error.message}`;
  }
}

// Background sync to Zoho Bigin
async function syncToBigin(customerName, stage, amount, poNumber, phone) {
  try {
    const refreshToken = process.env.ZOHO_REFRESH_TOKEN || '1000.92deffb421c05ba197867a3312e56475.758cee03c48e3a09f30b54d26ad2ccab';
    const clientId = process.env.ZOHO_CLIENT_ID || '1000.5DT0R10YNLSQX9S6EA7TOHC3TI8LQR';
    const clientSecret = process.env.ZOHO_CLIENT_SECRET || 'f4ebcd5a7e25659f5da35d5e72a1e367939d5c5efb';

    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    });

    const tokenRes = await axios.post('https://accounts.zoho.in/oauth/v2/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const accessToken = tokenRes.data.access_token;

    const biginStageMap = {
      won: 'Closed Won',
      lost: 'Closed Lost',
      negotiation: 'Negotiation/Review',
      quoted: 'Value Proposition',
      qualified: 'Qualification',
    };

    await axios.post(
      'https://www.zohoapis.in/bigin/v1/Deals',
      {
        data: [
          {
            Deal_Name: `${customerName} - Purchase Order`,
            Stage: biginStageMap[stage] || 'Qualification',
            Amount: amount || 0,
            Pipeline: 'Sales Pipeline Standard',
            Layout: { id: '1384628000000000173' },
            Description: `PO: ${poNumber || 'N/A'} | Customer: ${customerName} | Salesperson: ${phone}`,
            Closing_Date: new Date().toISOString().split('T')[0],
          },
        ],
      },
      {
        headers: {
          Authorization: 'Zoho-oauthtoken ' + accessToken,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (err) {
    console.error('Sales Agent Bigin Sync Error:', err.response?.data || err.message);
  }
}

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
  "total_amount": <total value in rupees, else 0>,
  "confidence": <float 0.0 to 1.0>
}
Return ONLY JSON.`;

    const result = await model.generateContent([prompt, imagePart]);
    const rawText = result.response.text().trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);

    if (!data.customer_name) {
      return `⚠️ *PO Vision Agent Clarification Needed*\n\nI parsed your PO image, but the *Customer/Company Name* is cut off or not clear. Please reply with the Company Name so it can be logged into your sales dashboard!`;
    }

    const customerName = data.customer_name.trim();
    let totalValue = data.total_amount || 0;

    if (!totalValue && data.quantity_mt && data.rate_per_mt) {
      totalValue = data.quantity_mt * data.rate_per_mt;
    }

    // Save PO deal
    await supabase.from('deals').insert({
      customer_name: customerName,
      salesperson_phone: senderPhone,
      stage: 'won',
      total_amount: totalValue,
      po_number: data.po_number || null,
      inquiry_type: 'purchase_order',
      won_at: new Date().toISOString(),
    });

    // Log to KRA 1
    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number: 1,
      kra_type: 'sales_achievement',
      value: totalValue,
      customer_name: customerName,
      description: `PO Image Logged: ${customerName} (PO: ${data.po_number || 'N/A'})`,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    });

    // Sync to Zoho Bigin
    syncToBigin(customerName, 'won', totalValue, data.po_number, senderPhone);

    return `📦 *PO Document Processed & Logged!*\n\n` +
      `Customer: *${customerName}*\n` +
      (data.po_number ? `PO Number: *${data.po_number}*\n` : '') +
      `Deal Value: *₹${Number(totalValue).toLocaleString('en-IN')}*\n` +
      `Stage: *Closed Won 🎉*\n\n` +
      `Logged to KRA 1 Sales Achievement & synced live to Zoho Bigin! ✅`;

  } catch (err) {
    console.error('Sales Image Agent Error:', err.message);
    return `⚠️ Could not extract PO image details: ${err.message}`;
  }
}

module.exports = { processSalesMessage, processSalesImage };
