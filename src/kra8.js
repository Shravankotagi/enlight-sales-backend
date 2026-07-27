const { createClient } = require('@supabase/supabase-js');
const { sendTextMessage } = require('./whatsapp');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Detect if message is a complaint report
function isComplaintReport(text) {
  const complaintKeywords = [
    'complaint', 'complain', 'issue', 'problem',
    'quality issue', 'wrong material', 'wrong quantity',
    'delivery problem', 'billing issue', 'reject', 'rejection',
    'customer unhappy', 'customer angry', 'not satisfied',
    'shikayat', 'problem aaya', 'issue aaya', 'galat material',
    'galat quantity', 'delivery late', 'damage', 'damaged',
    'short delivery', 'excess billing', 'rate issue',
    'size wrong', 'grade wrong', 'material reject'
  ];
  const lower = text.toLowerCase();
  return complaintKeywords.some(k => lower.includes(k));
}

// Detect if message is complaint resolution
function isComplaintResolution(text) {
  const upper = text.toUpperCase().trim();
  return upper.startsWith('RESOLVED ') ||
         upper.startsWith('CLOSED ') ||
         upper.startsWith('FIXED ') ||
         upper === 'RESOLVED' ||
         upper === 'CLOSED';
}

// Extract complaint details using Gemini
async function extractComplaintDetails(text) {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });

    const prompt = `
Extract complaint details from this salesperson message.
Return ONLY a JSON object, no markdown, no backticks:

{
  "customer_name": "",
  "complaint_type": "",
  "description": "",
  "severity": ""
}

Rules:
- customer_name: company name if mentioned, else null
- complaint_type: one of 
  "quality|quantity|billing|delivery|size|grade|damage|other"
- description: brief description of the complaint
- severity: one of "low|medium|high|critical"
  critical = customer threatening to cancel/leave
  high = material rejected or returned
  medium = issue reported, needs resolution
  low = minor concern
- Return ONLY the JSON object

Message: "${text}"
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const raw = response.text().trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    return JSON.parse(raw);
  } catch (error) {
    console.error('extractComplaintDetails error:', error.message);
    return {
      customer_name: null,
      complaint_type: 'other',
      description: text,
      severity: 'medium'
    };
  }
}

// Save complaint to database
async function saveComplaint(details, senderPhone) {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('complaints')
      .insert({
        customer_name: details.customer_name,
        complaint_type: details.complaint_type,
        description: details.description,
        reported_by: senderPhone,
        reported_at: new Date().toISOString(),
        status: 'pending',
        escalated: false
      })
      .select()
      .single();

    if (error) throw error;
    console.log('Complaint saved:', data.id);
    return data;
  } catch (error) {
    console.error('saveComplaint error:', error.message);
    return null;
  }
}

// Build complaint confirmation message
function buildComplaintConfirmation(details, complaint) {
  const shortId = complaint?.id?.substring(0, 8) || 'N/A';
  const severityEmoji = {
    'low': '🟡',
    'medium': '🟠', 
    'high': '🔴',
    'critical': '🚨'
  }[details.severity] || '🟠';

  const typeEmoji = {
    'quality': '🔍',
    'quantity': '📦',
    'billing': '💰',
    'delivery': '🚚',
    'size': '📏',
    'grade': '⚗️',
    'damage': '💔',
    'other': '❓'
  }[details.complaint_type] || '❓';

  return `${severityEmoji} *Complaint Logged — KRA 8*\n\n` +
    `🏢 Customer: ${details.customer_name || 'Not specified'}\n` +
    `${typeEmoji} Type: ${details.complaint_type}\n` +
    `📝 Description: ${details.description}\n` +
    `⚡ Severity: ${details.severity}\n` +
    `🔖 Ref: ${shortId}\n\n` +
    `⏰ *48-hour resolution timer started*\n\n` +
    `You will receive reminders at:\n` +
    `• 24 hours — if still open\n` +
    `• 48 hours — escalation to Sales Lead\n\n` +
    `To close: Reply *RESOLVED ${details.customer_name?.split(' ')[0]?.toUpperCase() || 'COMPLAINT'} [resolution details]*`;
}

// Check pending complaints and send reminders/escalations
async function checkComplaints() {
  const supabase = getSupabase();
  try {
    console.log('Running KRA 8 complaint check...');

    const { data: complaints, error } = await supabase
      .from('complaints')
      .select('*')
      .eq('status', 'pending')
      .order('reported_at', { ascending: true });

    if (error) throw error;
    if (!complaints || complaints.length === 0) {
      console.log('No pending complaints');
      return;
    }

    console.log(`Checking ${complaints.length} pending complaints...`);
    const now = new Date();

    for (const complaint of complaints) {
      const reportedAt = new Date(complaint.reported_at);
      const hoursElapsed = (now - reportedAt) / (1000 * 60 * 60);

      const salespersonPhone = complaint.reported_by;
      if (!salespersonPhone) continue;

      // 48+ hours — escalate to Sales Lead
      if (hoursElapsed >= 48 && !complaint.escalated) {
        await supabase
          .from('complaints')
          .update({ escalated: true })
          .eq('id', complaint.id);

        // Notify salesperson
        const salespersonMsg =
          `🚨 *KRA 8 — Complaint Escalated*\n\n` +
          `Complaint ref: ${complaint.id.substring(0, 8)}\n` +
          `Customer: ${complaint.customer_name || 'Unknown'}\n` +
          `Type: ${complaint.complaint_type}\n` +
          `Hours open: ${Math.round(hoursElapsed)}h\n\n` +
          `⚠️ This has been escalated to Sales Lead.\n` +
          `Please resolve immediately and reply:\n` +
          `*RESOLVED ${complaint.customer_name?.split(' ')[0]?.toUpperCase() || 'COMPLAINT'} [resolution]*`;

        await sendTextMessage(salespersonPhone, salespersonMsg);

        // Notify Sales Lead
        const salesLeadPhone = process.env.SALES_LEAD_PHONE;
        if (salesLeadPhone && salesLeadPhone !== salespersonPhone) {
          const leadMsg =
            `🚨 *KRA 8 Escalation Alert*\n\n` +
            `Unresolved complaint after 48 hours:\n\n` +
            `Customer: ${complaint.customer_name || 'Unknown'}\n` +
            `Type: ${complaint.complaint_type}\n` +
            `Description: ${complaint.description}\n` +
            `Reported: ${new Date(complaint.reported_at).toLocaleString('en-IN')}\n` +
            `Hours open: ${Math.round(hoursElapsed)}h\n\n` +
            `Please follow up with the salesperson.`;
          await sendTextMessage(salesLeadPhone, leadMsg);
        }

        console.log(`Complaint ${complaint.id} escalated`);

      // 24 hours — send reminder
      } else if (hoursElapsed >= 24 && hoursElapsed < 48) {
        const reminderMsg =
          `⚠️ *KRA 8 — Complaint Reminder*\n\n` +
          `Complaint open for ${Math.round(hoursElapsed)} hours:\n\n` +
          `Customer: ${complaint.customer_name || 'Unknown'}\n` +
          `Type: ${complaint.complaint_type}\n` +
          `Description: ${complaint.description}\n\n` +
          `⏰ ${Math.round(48 - hoursElapsed)} hours until escalation\n\n` +
          `Resolve and reply:\n` +
          `*RESOLVED ${complaint.customer_name?.split(' ')[0]?.toUpperCase() || 'COMPLAINT'} [resolution]*`;

        await sendTextMessage(salespersonPhone, reminderMsg);
        console.log(`24h reminder sent for complaint ${complaint.id}`);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    console.log('KRA 8 check complete');
  } catch (error) {
    console.error('checkComplaints error:', error.message);
  }
}

// Handle complaint log from webhook
async function handleComplaintLog(text, senderPhone) {
  try {
    console.log('Complaint detected:', text);

    const details = await extractComplaintDetails(text);
    console.log('Complaint details:', JSON.stringify(details, null, 2));

    const complaint = await saveComplaint(details, senderPhone);

    // Log to KRA 8
    const supabase = getSupabase();
    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number: 8,
      kra_type: 'complaint_logged',
      description: `${details.complaint_type} complaint: ${details.description}`,
      customer_name: details.customer_name,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear()
    });

    return buildComplaintConfirmation(details, complaint);
  } catch (error) {
    console.error('handleComplaintLog error:', error.message);
    return '❌ Could not log complaint. Please try again.';
  }
}

// Handle complaint resolution reply
async function handleComplaintResolution(text, senderPhone) {
  const supabase = getSupabase();
  try {
    const parts = text.trim().split(' ');
    const customerKeyword = parts[1] || '';
    const resolution = parts.slice(2).join(' ') || 'Resolved';

    // Find matching open complaint
    const { data: complaints } = await supabase
      .from('complaints')
      .select('*')
      .eq('reported_by', senderPhone)
      .eq('status', 'pending')
      .ilike('customer_name', `%${customerKeyword}%`)
      .order('reported_at', { ascending: false })
      .limit(1);

    const complaint = complaints?.[0];

    if (complaint) {
      const reportedAt = new Date(complaint.reported_at);
      const resolvedAt = new Date();
      const resolutionHrs = Math.round(
        (resolvedAt - reportedAt) / (1000 * 60 * 60)
      );

      await supabase
        .from('complaints')
        .update({
          status: 'resolved',
          resolved_at: resolvedAt.toISOString(),
          resolution_time_hrs: resolutionHrs
        })
        .eq('id', complaint.id);

      // Log to KRA 8
      await supabase.from('kra_logs').insert({
        salesperson_phone: senderPhone,
        kra_number: 8,
        kra_type: 'complaint_resolved',
        description: `Resolved in ${resolutionHrs}h: ${resolution}`,
        customer_name: complaint.customer_name,
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear()
      });

      const withinTarget = resolutionHrs <= 48;
      return `✅ *KRA 8 — Complaint Resolved*\n\n` +
        `Customer: ${complaint.customer_name || customerKeyword}\n` +
        `Resolution: ${resolution}\n` +
        `Time taken: ${resolutionHrs} hours\n` +
        `${withinTarget ? '✅ Within 48-hour target!' : '⚠️ Exceeded 48-hour target'}\n\n` +
        `Logged to KRA 8 ✅`;
    }

    // No matching complaint found — still log it
    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number: 8,
      kra_type: 'complaint_resolved',
      description: `Resolved: ${resolution}`,
      customer_name: customerKeyword,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear()
    });

    return `✅ *KRA 8 — Resolution Logged*\n\n` +
      `Customer: ${customerKeyword}\n` +
      `Resolution: ${resolution}\n\n` +
      `Logged to KRA 8 ✅`;
  } catch (error) {
    console.error('handleComplaintResolution error:', error.message);
    return '❌ Could not log resolution. Please try again.';
  }
}

// Get complaint summary for query
async function getComplaintSummary(senderPhone) {
  const supabase = getSupabase();
  try {
    const now = new Date();
    const monthStart = new Date(
      now.getFullYear(), now.getMonth(), 1
    ).toISOString();

    const { data: complaints } = await supabase
      .from('complaints')
      .select('*')
      .gte('reported_at', monthStart)
      .order('reported_at', { ascending: false });

    if (!complaints || complaints.length === 0) {
      return '✅ No complaints logged this month!';
    }

    const pending = complaints.filter(c => c.status === 'pending');
    const resolved = complaints.filter(c => c.status === 'resolved');
    const escalated = complaints.filter(c => c.escalated);

    const avgResolutionTime = resolved.length > 0
      ? Math.round(
          resolved.reduce((sum, c) => sum + (c.resolution_time_hrs || 0), 0) 
          / resolved.length
        )
      : null;

    let msg = `📊 *KRA 8 — Complaint Summary*\n\n` +
      `Total this month: ${complaints.length}\n` +
      `✅ Resolved: ${resolved.length}\n` +
      `⏳ Pending: ${pending.length}\n` +
      `🚨 Escalated: ${escalated.length}\n`;

    if (avgResolutionTime !== null) {
      msg += `⏱️ Avg resolution: ${avgResolutionTime}h\n`;
      msg += `${avgResolutionTime <= 48 ? '✅ Within KRA target' : '⚠️ Above 48h target'}\n`;
    }

    if (pending.length > 0) {
      msg += `\n*Open complaints:*\n`;
      pending.slice(0, 3).forEach(c => {
        const hrs = Math.round(
          (now - new Date(c.reported_at)) / (1000 * 60 * 60)
        );
        msg += `• ${c.customer_name || 'Unknown'} — ${c.complaint_type} (${hrs}h open)\n`;
      });
    }

    return msg;
  } catch (error) {
    console.error('getComplaintSummary error:', error.message);
    return '❌ Could not fetch complaint summary.';
  }
}

module.exports = {
  isComplaintReport,
  isComplaintResolution,
  handleComplaintLog,
  handleComplaintResolution,
  checkComplaints,
  getComplaintSummary
};
