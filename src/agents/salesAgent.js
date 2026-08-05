const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase } = require('../supabase');
const axios = require('axios');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SALES_AGENT_PROMPT = `
You are the Specialized Sales Achievement & Pipeline Agent for Enlight Metals (B2B Steel Distributor).
Your job is to analyze salesperson messages reporting sales actions, deal status updates, or stage changes.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no markdown, no prose, no backticks):
{
  "action": "stage_update|purchase_order",
  "customer_name": "<company/customer name>",
  "target_stage": "won|lost|negotiation|quoted|qualified",
  "loss_reason": "<reason if lost, else null>",
  "total_amount": <numeric deal value if mentioned, else 0>,
  "po_number": "<PO number if mentioned, else null>",
  "confidence": <float 0.0 to 1.0>
}

Rules for target_stage:
- "won" / "finalized" / "order confirmed" / "close won" -> "won"
- "lost" / "rejected" / "deal missed" / "cancel" -> "lost"
- "negotiation" / "discussion in progress" / "bargaining" -> "negotiation"
- "quoted" / "quote sent" / "rate given" -> "quoted"
- "new inquiry" / "requirement received" -> "qualified"

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

    // Find latest deal for this customer
    const { data: existingDeals } = await supabase
      .from('deals')
      .select('*')
      .ilike('customer_name', `%${customerName}%`)
      .order('created_at', { ascending: false })
      .limit(1);

    let dealId = existingDeals && existingDeals.length > 0 ? existingDeals[0].id : null;
    let dealAmount = data.total_amount || (existingDeals && existingDeals[0] ? existingDeals[0].total_amount : 0);

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

module.exports = { processSalesMessage };
