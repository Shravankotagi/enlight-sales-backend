const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase } = require('../supabase');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const COMPLAINT_AGENT_PROMPT = `
You are the Specialized Quality & Complaint AI Agent (KRA 7 & KRA 8) for Enlight Metals.
Your job is to parse quality complaints, material rejection reports, or complaint resolution updates.

The salesperson message may be informal, in Hinglish, or missing expected keywords.
Understand the meaning and context — do not look for specific words.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no prose, no markdown, no backticks):
{
  "action": "report|resolve",
  "customer_name": "<customer/company name, else null>",
  "complaint_type": "quality|delivery|billing|specification|other",
  "description": "<details/remarks, else null>",
  "confidence": <float 0.0 to 1.0>
}

Rules — understand meaning, not keywords:
- "action": "report" if message indicates a new problem, quality issue, material return, or rejection.
- "action": "resolve" if message indicates a complaint was fixed, settled, resolved, or accepted now.

Return ONLY the JSON object.
`;

async function processComplaintMessage(text, senderPhone) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent(COMPLAINT_AGENT_PROMPT + '\n\nSalesperson message:\n' + text);
    const rawText = result.response.text().trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);

    if (!data.customer_name) {
      return `⚠️ *Quality Agent Verification Needed*\n\nPlease specify the *Customer/Company Name* associated with this complaint update.`;
    }

    const customerName = data.customer_name.trim();

    if (data.action === 'resolve') {
      // Find open complaint for this customer
      const { data: openComplaints } = await supabase
        .from('complaints')
        .select('*')
        .ilike('customer_name', `%${customerName}%`)
        .eq('status', 'open')
        .order('reported_at', { ascending: false })
        .limit(1);

      let resolutionTimeHrs = 24; // default SLA compliant
      if (openComplaints && openComplaints.length > 0) {
        const reportedAt = new Date(openComplaints[0].reported_at);
        const resolvedAt = new Date();
        resolutionTimeHrs = Math.max(1, Math.round((resolvedAt.getTime() - reportedAt.getTime()) / (1000 * 60 * 60)));

        await supabase
          .from('complaints')
          .update({
            status: 'resolved',
            resolved_at: resolvedAt.toISOString(),
            resolution_time_hrs: resolutionTimeHrs,
          })
          .eq('id', openComplaints[0].id);
      } else {
        // Create resolved complaint
        await supabase.from('complaints').insert({
          customer_name: customerName,
          reported_by: senderPhone,
          complaint_type: data.complaint_type || 'quality',
          description: data.description || 'Resolved complaint',
          status: 'resolved',
          reported_at: new Date().toISOString(),
          resolved_at: new Date().toISOString(),
          resolution_time_hrs: 24,
        });
      }

      // Log to KRA 8
      await supabase.from('kra_logs').insert({
        salesperson_phone: senderPhone,
        kra_number: 8,
        kra_type: 'complaint_resolved',
        customer_name: customerName,
        description: `Complaint Resolved for ${customerName} (${resolutionTimeHrs}h resolution time)`,
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
      });

      const isSlaCompliant = resolutionTimeHrs <= 48;

      return `✅ *KRA 8 - Complaint Resolved!*\n\n` +
        `Customer: *${customerName}*\n` +
        `Resolution Time: *${resolutionTimeHrs} Hours*\n` +
        `SLA Target: *${isSlaCompliant ? 'Within 48h Target (Achieved) 🎯' : 'Exceeded 48h SLA'}*\n\n` +
        `Updated KRA 8 Complaint Resolution Dashboard! ✅`;

    } else {
      // Check assigned salesperson for this customer in recurring_customers
      const { data: customerRecord } = await supabase
        .from('recurring_customers')
        .select('assigned_salesperson_phone, customer_name')
        .ilike('customer_name', `%${customerName}%`)
        .limit(1);

      const targetSalespersonPhone =
        (customerRecord && customerRecord[0] && customerRecord[0].assigned_salesperson_phone) ||
        senderPhone;

      // Report New Complaint (KRA 7)
      await supabase.from('complaints').insert({
        customer_name: customerName,
        reported_by: targetSalespersonPhone,
        complaint_type: data.complaint_type || 'quality',
        description: data.description || text,
        status: 'open',
        reported_at: new Date().toISOString(),
      });

      await supabase.from('kra_logs').insert({
        salesperson_phone: targetSalespersonPhone,
        kra_number: 7,
        kra_type: 'quality_complaint',
        customer_name: customerName,
        description: `Complaint Logged: ${customerName} - ${data.description || 'Quality issue'}`,
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
      });

      // Send Instant WhatsApp Alert to the assigned Salesperson if sender is the client
      if (targetSalespersonPhone && targetSalespersonPhone !== senderPhone) {
        try {
          const { sendTextMessage } = require('../whatsapp');
          await sendTextMessage(
            targetSalespersonPhone,
            `🚨 *URGENT CUSTOMER COMPLAINT ALERT!*\n\n` +
            `Client: *${customerName}*\n` +
            `Type: *${(data.complaint_type || 'quality').toUpperCase()}*\n` +
            `Issue: ${data.description || text}\n` +
            `SLA Target: *48 Hours Resolution ⏱️*\n\n` +
            `Please contact the client immediately to resolve this issue and reply *"Resolved ${customerName} complaint"* when done!`
          );
        } catch (alertError) {
          console.error('Failed to send complaint alert to salesperson:', alertError.message);
        }
      }

      return `🚨 *KRA 7 - Quality Complaint Logged*\n\n` +
        `Customer: *${customerName}*\n` +
        `Type: *${(data.complaint_type || 'quality').toUpperCase()}*\n` +
        `Assigned Salesperson: *+${targetSalespersonPhone}*\n` +
        `Status: *Open (48-Hour Resolution Clock Started ⏱️)*\n\n` +
        `Automated alert sent to the assigned salesperson!`;
    }

  } catch (error) {
    console.error('Complaint Agent Error:', error.message);
    return `⚠️ Could not process complaint update: ${error.message}`;
  }
}

module.exports = { processComplaintMessage };
