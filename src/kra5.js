const { createClient } = require('@supabase/supabase-js');
const { sendTextMessage } = require('./whatsapp');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Parse payment terms to days
// Examples: "30 days", "45 Days", "30", "net 30", "PDC 30 days"
function parsePaymentTermsDays(paymentTerms) {
  if (!paymentTerms) return 30; // default 30 days
  const match = paymentTerms.match(/\d+/);
  return match ? parseInt(match[0]) : 30;
}

// Calculate due date from deal
function calculateDueDate(deal) {
  const creditDays = parsePaymentTermsDays(deal.payment_terms);
  const baseDate = new Date(deal.created_at);
  const dueDate = new Date(baseDate);
  dueDate.setDate(baseDate.getDate() + creditDays);
  return dueDate;
}

// Check if message is payment update
function isPaymentUpdate(text) {
  const upper = text.toUpperCase().trim();
  return upper.startsWith('PAID ') || 
         upper.startsWith('FOLLOWEDUP ') ||
         upper.startsWith('PAYMENT ') ||
         upper.startsWith('COLLECTED ');
}

// Get all pending payment deals
async function getPendingPayments() {
  const supabase = getSupabase();
  try {
    const { data: deals, error } = await supabase
      .from('deals')
      .select('*')
      .not('payment_terms', 'is', null)
      .not('stage', 'in', '("lost")')
      .not('status', 'eq', 'payment_collected')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return deals || [];
  } catch (error) {
    console.error('getPendingPayments error:', error.message);
    return [];
  }
}

// Check payments and send alerts
async function checkPayments() {
  const supabase = getSupabase();
  try {
    console.log('Running KRA 5 payment check...');

    const deals = await getPendingPayments();
    const now = new Date();

    console.log(`Checking ${deals.length} deals for payment status...`);

    for (const deal of deals) {
      if (!deal.customer_name) continue;

      const dueDate = calculateDueDate(deal);
      const daysUntilDue = Math.floor(
        (dueDate - now) / (1000 * 60 * 60 * 24)
      );

      // Check existing payment tracking record
      const { data: existing } = await Promise.resolve(
        supabase
          .from('payment_tracking')
          .select('*')
          .eq('deal_id', deal.id)
          .single()
      ).catch(() => ({ data: null }));

      if (existing?.status === 'collected') continue;

      // Alert conditions:
      // Due tomorrow (1 day)
      // Due today (0 days)
      // Overdue (negative days): -1, -3, -7
      const shouldAlert = 
        daysUntilDue === 1 ||
        daysUntilDue === 0 ||
        daysUntilDue === -1 ||
        daysUntilDue === -3 ||
        daysUntilDue === -7;

      if (!shouldAlert) continue;

      // Check if already alerted today
      if (existing?.last_reminder_at) {
        const lastReminder = new Date(existing.last_reminder_at);
        const hoursSince = (now - lastReminder) / (1000 * 60 * 60);
        if (hoursSince < 20) {
          console.log(`Already alerted for deal ${deal.id} today`);
          continue;
        }
      }

      // Get salesperson phone
      const salespersonPhone = deal.customer_phone || 
        process.env.SALES_LEAD_PHONE;

      if (!salespersonPhone) continue;

      // Build alert message
      const message = buildPaymentAlert(deal, dueDate, daysUntilDue);

      // Send alert
      await sendTextMessage(salespersonPhone, message);
      console.log(`Payment alert sent for ${deal.customer_name} to ${salespersonPhone}`);

      // Upsert payment tracking record
      if (existing) {
        await supabase
          .from('payment_tracking')
          .update({
            last_reminder_at: now.toISOString(),
            due_date: dueDate.toISOString().split('T')[0]
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('payment_tracking')
          .insert({
            deal_id: deal.id,
            customer_name: deal.customer_name,
            invoice_amount: deal.total_amount,
            credit_period_days: parsePaymentTermsDays(deal.payment_terms),
            due_date: dueDate.toISOString().split('T')[0],
            outstanding: deal.total_amount,
            salesperson_phone: salespersonPhone,
            status: 'pending',
            last_reminder_at: now.toISOString()
          });
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    console.log('KRA 5 payment check complete');
  } catch (error) {
    console.error('checkPayments error:', error.message);
  }
}

function buildPaymentAlert(deal, dueDate, daysUntilDue) {
  const dueDateStr = dueDate.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric'
  });

  const formatAmount = (amt) => amt 
    ? '₹' + Number(amt).toLocaleString('en-IN') 
    : 'Amount TBD';

  let urgencyLine = '';
  let emoji = '';

  if (daysUntilDue > 0) {
    emoji = '💰';
    urgencyLine = `Due in ${daysUntilDue} day${daysUntilDue > 1 ? 's' : ''}`;
  } else if (daysUntilDue === 0) {
    emoji = '⚠️';
    urgencyLine = 'Due TODAY';
  } else {
    emoji = '🔴';
    urgencyLine = `OVERDUE by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) > 1 ? 's' : ''}`;
  }

  const customerShort = deal.customer_name.split(' ')[0].toUpperCase();

  return `${emoji} *KRA 5 — Payment Alert*\n\n` +
    `🏢 ${deal.customer_name}\n` +
    `💵 Amount: ${formatAmount(deal.total_amount)}\n` +
    `📋 Terms: ${deal.payment_terms || '30 days'}\n` +
    `📅 Due: ${dueDateStr}\n` +
    `⏰ ${urgencyLine}\n` +
    (deal.po_number ? `📄 PO: ${deal.po_number}\n` : '') +
    `\nPlease follow up and reply:\n` +
    `✅ *PAID ${customerShort} [amount received]*\n` +
    `📞 *FOLLOWEDUP ${customerShort} [outcome]*\n` +
    `🔄 *COLLECTED ${customerShort} [amount]*`;
}

// Handle payment update reply from salesperson
async function handlePaymentUpdate(text, senderPhone) {
  const supabase = getSupabase();
  try {
    const upper = text.toUpperCase().trim();
    const parts = text.trim().split(' ');
    const action = parts[0].toUpperCase();
    const customerKeyword = parts[1] || '';
    const details = parts.slice(2).join(' ') || '';

    // Find matching payment tracking record
    const { data: payments } = await supabase
      .from('payment_tracking')
      .select('*, deals(*)')
      .ilike('customer_name', `%${customerKeyword}%`)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);

    const payment = payments?.[0];

    if (!payment) {
      console.log(`No active pending payment tracking record found for customer keyword: ${customerKeyword}`);
      return `⚠️ *Payment Update Declined*\n\nCould not find an active pending payment tracking record matching *"${customerKeyword}"*.\n\nPlease check the dashboard to verify the customer name or if the payment has already been marked as collected.`;
    }

    const isPaid = action === 'PAID' || action === 'COLLECTED';

    // Update payment tracking
    await supabase
      .from('payment_tracking')
      .update({
        status: isPaid ? 'collected' : 'follow_up_done',
        paid_date: isPaid ? new Date().toISOString().split('T')[0] : null,
        outstanding: isPaid ? 0 : payment.outstanding
      })
      .eq('id', payment.id);

    // If paid, update deal status too
    if (isPaid) {
      await supabase
        .from('deals')
        .update({ status: 'payment_collected' })
        .eq('id', payment.deal_id);
    }

    // Log to KRA 5
    await supabase.from('kra_logs').insert({
      salesperson_phone: senderPhone,
      kra_number: 5,
      kra_type: isPaid ? 'payment_collected' : 'payment_followup',
      description: `${action} ${customerKeyword}: ${details}`,
      customer_name: payment.customer_name,
      value: isPaid ? (payment.invoice_amount || 0) : 0,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear()
    });

    const emoji = isPaid ? '✅' : '📞';
    const actionText = isPaid ? 'Payment collected' : 'Follow-up logged';

    return `${emoji} *KRA 5 Updated*\n\n` +
      `Action: ${actionText}\n` +
      `Customer: ${payment?.customer_name || customerKeyword}\n` +
      (details ? `Details: ${details}\n` : '') +
      (isPaid ? `\n💰 Payment marked as collected ✅` : 
                `\n📞 Follow-up logged. Next reminder in 2 days.`) +
      `\n\nLogged to KRA 5 ✅`;
  } catch (error) {
    console.error('handlePaymentUpdate error:', error.message);
    return '❌ Could not update payment status. Please try again.';
  }
}

// Get payment summary for query
async function getPaymentSummary(senderPhone) {
  const supabase = getSupabase();
  try {
    const { data: payments } = await supabase
      .from('payment_tracking')
      .select('*')
      .order('due_date', { ascending: true });

    if (!payments || payments.length === 0) {
      return '✅ No pending payments tracked.';
    }

    const pending = payments.filter(p => p.status === 'pending');
    const collected = payments.filter(p => p.status === 'collected');
    const now = new Date();

    const overdue = pending.filter(p => 
      p.due_date && new Date(p.due_date) < now
    );
    const upcoming = pending.filter(p => 
      p.due_date && new Date(p.due_date) >= now
    );

    const totalOutstanding = pending.reduce(
      (sum, p) => sum + (p.outstanding || 0), 0
    );

    let msg = `💰 *KRA 5 — Payment Status*\n\n`;

    if (overdue.length > 0) {
      msg += `🔴 *Overdue (${overdue.length}):*\n`;
      overdue.slice(0, 3).forEach(p => {
        const days = Math.floor(
          (now - new Date(p.due_date)) / (1000 * 60 * 60 * 24)
        );
        msg += `• ${p.customer_name} — ₹${Number(p.outstanding || 0).toLocaleString('en-IN')} (${days}d overdue)\n`;
      });
      msg += '\n';
    }

    if (upcoming.length > 0) {
      msg += `⚠️ *Due Soon (${upcoming.length}):*\n`;
      upcoming.slice(0, 3).forEach(p => {
        const days = Math.floor(
          (new Date(p.due_date) - now) / (1000 * 60 * 60 * 24)
        );
        msg += `• ${p.customer_name} — ₹${Number(p.outstanding || 0).toLocaleString('en-IN')} (in ${days}d)\n`;
      });
      msg += '\n';
    }

    msg += `✅ Collected this month: ${collected.length}\n`;
    msg += `💵 Total outstanding: ₹${Number(totalOutstanding).toLocaleString('en-IN')}`;

    return msg;
  } catch (error) {
    console.error('getPaymentSummary error:', error.message);
    return '❌ Could not fetch payment status.';
  }
}

module.exports = {
  checkPayments,
  handlePaymentUpdate,
  isPaymentUpdate,
  getPaymentSummary
};
