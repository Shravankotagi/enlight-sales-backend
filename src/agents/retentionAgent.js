/**
 * KRA 3 - Customer Retention & Follow-up Agent
 *
 * DESIGN PRINCIPLES:
 * - Each follow-up on a customer is logged to KRA 3 (one per follow-up is correct — this tracks activity).
 * - followup_tasks table is used to track open follow-ups per customer.
 * - If a followup_task already exists for a customer, update it (don't create duplicate tasks).
 * - If reorder expected → mark task with high priority.
 * - If customer churned (won't order) → close task, mark customer inactive.
 * - Last contact date updated on recurring_customers so churn alerts can fire.
 *
 * EDGE CASES HANDLED:
 * 1.  Normal follow-up logged → KRA 3 log + update followup_tasks
 * 2.  Reorder expected → sets task status to 'reorder_expected'
 * 3.  Customer won't reorder (churn signal) → marks customer inactive, closes task
 * 4.  Missing customer name → ask for clarification
 * 5.  Customer not in recurring_customers → create minimal record so they appear in dashboard
 * 6.  Duplicate follow-up task → update existing task (increment follow_up_count), don't create new
 * 7.  Last contact date always updated in recurring_customers
 * 8.  Hinglish/casual messages → AI handles semantic parsing
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { supabase } = require('../supabase');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const RETENTION_AGENT_PROMPT = `
You are the Specialized Customer Retention AI Agent (KRA 3) for Enlight Metals.
Your job is to parse customer follow-up reports, re-order inquiries, or client check-in notes.

The salesperson message may be informal, in Hinglish, or missing expected keywords.
Understand the meaning and context — do not look for specific words.

Input message can be English, Hindi, or Hinglish.

Extract into ONLY a JSON object (no prose, no markdown, no backticks):
{
  "customer_name": "<customer/company name, else null>",
  "followup_summary": "<brief 1-line summary of the discussion or check-in, else null>",
  "reorder_expected": <true if customer indicated they will order soon, else false>,
  "is_churned": <true if customer clearly said they won't order anymore or are switching, else false>,
  "confidence": <float 0.0 to 1.0>
}

Rules:
- "reorder_expected": true if customer said "will order next week", "interested in reorder", "planning to buy", etc.
- "is_churned": true ONLY if customer clearly indicated they are done / switching supplier / no more orders.
- Never set both reorder_expected and is_churned to true at the same time.

Return ONLY the JSON object.
`;

/**
 * Find existing followup task for a customer to avoid duplicate tasks.
 */
async function getExistingFollowupTask(customerName, senderPhone) {
  const { data } = await supabase
    .from('followup_tasks')
    .select('*')
    .ilike('customer_name', `%${customerName}%`)
    .eq('salesperson_phone', senderPhone)
    .not('status', 'in', '("resolved","closed")')
    .order('created_at', { ascending: false })
    .limit(1);

  if (data && data.length > 0) return data[0];
  return null;
}

/**
 * Ensure customer exists in recurring_customers (upsert minimal record).
 */
async function ensureCustomerExists(customerName, senderPhone) {
  const { data: existing } = await supabase
    .from('recurring_customers')
    .select('id')
    .ilike('customer_name', `%${customerName}%`)
    .limit(1);

  if (existing && existing.length > 0) {
    // Update last contact date
    await supabase
      .from('recurring_customers')
      .update({
        updated_at: new Date().toISOString(),
        assigned_salesperson_phone: senderPhone,
      })
      .eq('id', existing[0].id);
    return existing[0].id;
  } else {
    // Create minimal record so this customer appears in the retention dashboard
    const { data: newRec } = await supabase
      .from('recurring_customers')
      .insert({
        customer_name:              customerName,
        assigned_salesperson_phone: senderPhone,
        is_active:                  true,
        avg_order_frequency_days:   30,
      })
      .select('id')
      .single();
    return newRec ? newRec.id : null;
  }
}

async function processRetentionMessage(text, senderPhone) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const result = await model.generateContent(RETENTION_AGENT_PROMPT + '\n\nSalesperson message:\n' + text);
    const rawText = result.response.text().trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(cleaned);

    // Edge Case 4: Missing customer name
    if (!data.customer_name) {
      return `⚠️ *Retention Agent — Customer Name Missing*\n\nPlease specify the *Customer/Company Name* for this follow-up update.\nExample: _"Called Mehta Industries, they are planning a reorder next month"_`;
    }

    const customerName      = data.customer_name.trim();

    // Verify and get official customer name from salesperson's registered customers
    const { verifyAndGetCustomerName } = require('../supabase');
    const officialCustomerName = await verifyAndGetCustomerName(customerName, senderPhone);

    if (!officialCustomerName) {
      return `⚠️ *Client Not Found in your Customer List*\n\n` +
        `Client *"${customerName}"* is not registered under your salesperson account.\n\n` +
        `Please onboard this customer first under *KRA 2 (Customer Onboarding)* before logging follow-up updates.\n\n` +
        `*Example to onboard customer:*\n` +
        `_"New customer ${customerName} owner Mr. Kapoor location Mumbai phone 9876543210 gst 27AAAAA1111A1Z1"_\n\n` +
        `Once added, you can resend this follow-up update.`;
    }

    const finalCustomerName = officialCustomerName;
    const followupSummary   = data.followup_summary  || 'Routine check-in';
    const reorderExpected   = !!data.reorder_expected;
    const isChurned         = !!data.is_churned && !reorderExpected; // safety: never both true

    // Edge Case 5: Ensure customer exists in recurring_customers
    await ensureCustomerExists(finalCustomerName, senderPhone);

    // Edge Case 3: Churn signal → mark customer inactive
    if (isChurned) {
      await supabase
        .from('recurring_customers')
        .update({
          is_active:  false,
          updated_at: new Date().toISOString(),
        })
        .ilike('customer_name', `%${finalCustomerName}%`);

      // Close any open followup tasks for this customer
      await supabase
        .from('followup_tasks')
        .update({
          status:       'closed',
          resolved_at:  new Date().toISOString(),
          resolution_notes: `Customer indicated no further orders. Marked inactive. — ${followupSummary}`,
        })
        .ilike('customer_name', `%${finalCustomerName}%`)
        .eq('salesperson_phone', senderPhone)
        .not('status', 'in', '("resolved","closed")');

      // Log KRA 3 for churn detection
      await supabase.from('kra_logs').insert({
        salesperson_phone: senderPhone,
        kra_number:        3,
        kra_type:          'customer_churned',
        customer_name:     finalCustomerName,
        description:       `Churn Detected: ${finalCustomerName} — ${followupSummary}`,
        month: new Date().getMonth() + 1,
        year:  new Date().getFullYear(),
      });

      return `⚠️ *KRA 3 - Churn Signal Logged*\n\n` +
        `Customer: *${finalCustomerName}*\n` +
        `Status: *Marked Inactive — No Further Orders Expected*\n` +
        (followupSummary ? `Note: ${followupSummary}\n` : '') +
        `\nCustomer flagged in Retention Dashboard. 📉`;
    }

    // Edge Case 6: Update existing followup_task or create new one
    const existingTask = await getExistingFollowupTask(finalCustomerName, senderPhone);

    const taskStatus = reorderExpected ? 'reorder_expected' : 'pending';

    if (existingTask) {
      // Update existing task: increment follow-up count
      await supabase
        .from('followup_tasks')
        .update({
          status:           taskStatus,
          resolution_notes: followupSummary,
          follow_up_count:  (Number(existingTask.follow_up_count) || 0) + 1,
        })
        .eq('id', existingTask.id);
    } else {
      // Create new followup task
      await supabase.from('followup_tasks').insert({
        task_type:         reorderExpected ? 'reorder_followup' : 'retention_followup',
        customer_name:     finalCustomerName,
        salesperson_phone: senderPhone,
        status:            taskStatus,
        resolution_notes:  followupSummary,
        follow_up_count:   1,
        due_date:          reorderExpected
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // due in 7 days
          : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // Edge Case 1: Log to KRA 3 — every follow-up activity is counted (this is correct behaviour)
    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number:        3,
      kra_type:          'customer_retention',
      customer_name:     finalCustomerName,
      description:       `Follow-up: ${finalCustomerName} — ${followupSummary}`,
      month: new Date().getMonth() + 1,
      year:  new Date().getFullYear(),
    });

    // Count this month's follow-ups
    const { data: monthlyLogs } = await supabase
      .from('kra_logs')
      .select('id')
      .eq('salesperson_phone', senderPhone)
      .eq('kra_number', 3)
      .eq('kra_type', 'customer_retention')
      .eq('month', new Date().getMonth() + 1)
      .eq('year', new Date().getFullYear());

    const followupCount = monthlyLogs ? monthlyLogs.length : 1;

    return `🔄 *KRA 3 - Customer Retention Follow-up Logged!*\n\n` +
      `Customer: *${finalCustomerName}*\n` +
      (followupSummary !== 'Routine check-in' ? `Summary: *${followupSummary}*\n` : '') +
      (reorderExpected
        ? `Status: *Re-order Expected Soon 📦 — Follow-up task set for 7 days*\n`
        : `Status: *Follow-up Noted ✅*\n`) +
      `Monthly Follow-ups: *${followupCount} logged this month*\n\n` +
      `Updated KRA 3 Customer Retention Dashboard! ✅`;

  } catch (error) {
    console.error('Retention Agent Error:', error.message);
    return `⚠️ Could not process retention update: ${error.message}`;
  }
}

module.exports = { processRetentionMessage };
