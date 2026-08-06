const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function getMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(
    now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59
  );
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    monthName: now.toLocaleString('en-IN', { month: 'long' }),
    year: now.getFullYear()
  };
}

function formatINR(amount) {
  if (!amount) return '₹0';
  return '₹' + Number(amount).toLocaleString('en-IN');
}

async function generateFullKRAReport(senderPhone, customMonthRange = null) {
  const supabase = getSupabase();
  const { start, end, monthName, year } = customMonthRange || getMonthRange();
  const now = new Date();

  try {
    // Fetch all data in parallel
    const [
      dealsResult,
      inquiriesResult,
      kraLogsResult,
      visitsResult,
      complaintsResult,
      paymentsResult,
      recurringResult
    ] = await Promise.all([
      supabase.from('deals').select('*, deal_items(*)')
        .eq('salesperson_phone', senderPhone)
        .neq('inquiry_type', 'unknown')
        .gte('created_at', start).lte('created_at', end),
      supabase.from('inquiries').select('*')
        .eq('salesperson_phone', senderPhone)
        .gte('created_at', start).lte('created_at', end),
      supabase.from('kra_logs').select('*')
        .eq('salesperson_phone', senderPhone)
        .gte('created_at', start).lte('created_at', end),
      supabase.from('customer_visits').select('*')
        .eq('salesperson_phone', senderPhone)
        .gte('visited_at', start).lte('visited_at', end),
      supabase.from('complaints').select('*')
        .eq('reported_by', senderPhone)
        .gte('reported_at', start).lte('reported_at', end),
      supabase.from('payment_tracking').select('*')
        .eq('salesperson_phone', senderPhone)
        .gte('created_at', start).lte('created_at', end),
      supabase.from('recurring_customers').select('*')
        .eq('assigned_salesperson_phone', senderPhone)
        .eq('is_active', true)
    ]);

    const deals = dealsResult.data || [];
    const inquiries = inquiriesResult.data || [];
    const kraLogs = kraLogsResult.data || [];
    const visits = visitsResult.data || [];
    const complaints = complaintsResult.data || [];
    const payments = paymentsResult.data || [];
    const recurring = recurringResult.data || [];

    // KRA 1 - Sales Achievement
    const totalDeals = deals.length;
    const wonDealsList = deals.filter(d => d.stage === 'won');
    const wonDeals = wonDealsList.length;
    const totalValue = wonDealsList.reduce(
      (sum, d) => sum + (d.total_amount || 0), 0
    );

    // KRA 2 - New Customer Acquisition
    const newCustomers = kraLogs.filter(
      l => l.kra_number === 2 && l.kra_type === 'new_customer'
    ).length;

    // KRA 3 - Customer Retention
    const recurringWithOrder = deals.filter(d =>
      recurring.some(r =>
        r.customer_name?.toLowerCase()
          .includes(d.customer_name?.toLowerCase() || '')
      )
    ).length;
    const retentionRate = recurring.length > 0
      ? Math.round((recurringWithOrder / recurring.length) * 100)
      : 0;

    // KRA 4 - Enquiry Conversion (accurate: use kra_logs inquiry_received vs won deals)
    // Using kra_logs prevents double-counting when same customer sends multiple messages
    const kra4InquiryLogs = kraLogs.filter(
      l => l.kra_number === 4 && l.kra_type === 'inquiry_received'
    );
    const totalInquiries = kra4InquiryLogs.length || inquiries.length; // fallback to raw inquiries
    const conversionRate = totalInquiries > 0
      ? Math.round((wonDeals / totalInquiries) * 100)
      : 0;

    // KRA 5 - Payment Collection
    const pendingPayments = payments.filter(
      p => p.status === 'pending'
    );
    const collectedPayments = payments.filter(
      p => p.status === 'collected'
    );
    const overduePayments = pendingPayments.filter(
      p => p.due_date && new Date(p.due_date) < now
    );
    const totalOutstanding = pendingPayments.reduce(
      (sum, p) => sum + (p.outstanding || 0), 0
    );

    // KRA 6 - CRM Compliance (accurate: count distinct days with ANY kra_log OR deal/inquiry activity)
    const workingDays = 26;
    const activityDates = new Set([
      ...kraLogs.map(l => new Date(l.created_at).toDateString()),
      ...deals.map(d => new Date(d.created_at).toDateString()),
      ...inquiries.map(i => new Date(i.created_at).toDateString()),
    ]);
    const daysWithActivity = activityDates.size;
    const crmCompliance = Math.min(
      100, Math.round((daysWithActivity / workingDays) * 100)
    );

    // KRA 7 - Zero Rejection
    const rejections = kraLogs.filter(
      l => l.kra_number === 7
    ).length;

    // KRA 8 - Complaint Resolution
    const totalComplaints = complaints.length;
    const resolvedComplaints = complaints.filter(
      c => c.status === 'resolved'
    );
    const withinTarget = resolvedComplaints.filter(
      c => (c.resolution_time_hrs || 0) <= 48
    ).length;
    const avgResolutionTime = resolvedComplaints.length > 0
      ? Math.round(
          resolvedComplaints.reduce(
            (sum, c) => sum + (c.resolution_time_hrs || 0), 0
          ) / resolvedComplaints.length
        )
      : 0;

    // KRA 9 - Customer Visits
    const totalVisits = visits.length;
    const visitDays = new Set(
      visits.map(v => new Date(v.visited_at).toDateString())
    ).size;
    const weeksInMonth = 4;
    const targetVisits = weeksInMonth * 10;
    const targetDays = weeksInMonth * 3;

    // Build report
    const report =
      `📊 *MONTHLY KRA REPORT*\n` +
      `${monthName} ${year}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +

      `*KRA 1 - Sales Achievement*\n` +
      `Deals: ${totalDeals} | Won: ${wonDeals}\n` +
      `Value: ${formatINR(totalValue)}\n` +
      `${totalValue > 0 ? '✅' : '⚠️'} ` +
      `${totalValue > 0 ? 'Sales logged' : 'No sales yet'}\n\n` +

      `*KRA 2 - New Customers*\n` +
      `Acquired: ${newCustomers}/3\n` +
      `${newCustomers >= 3 ? '✅ Target met!' : `⚠️ ${3 - newCustomers} more needed`}\n\n` +

      `*KRA 3 - Customer Retention*\n` +
      `Recurring customers: ${recurring.length}\n` +
      `Ordered this month: ${recurringWithOrder}\n` +
      `${retentionRate >= 80 ? '✅' : '⚠️'} Retention: ${retentionRate}%\n\n` +

      `*KRA 4 - Enquiry Conversion*\n` +
      `Inquiries: ${totalInquiries} | Won: ${wonDeals}\n` +
      `${conversionRate >= 70 ? '✅' : '⚠️'} Rate: ${conversionRate}%` +
      ` (target: 70-80%)\n\n` +

      `*KRA 5 - Payment Collection*\n` +
      `Collected: ${collectedPayments.length}\n` +
      `Pending: ${pendingPayments.length}\n` +
      `🔴 Overdue: ${overduePayments.length}\n` +
      `Outstanding: ${formatINR(totalOutstanding)}\n\n` +

      `*KRA 6 - CRM Compliance*\n` +
      `Active days: ${daysWithActivity}/${workingDays}\n` +
      `${crmCompliance >= 90 ? '✅' : '⚠️'} Compliance: ${crmCompliance}%\n\n` +

      `*KRA 7 - Zero Rejection*\n` +
      `${rejections === 0 ? '✅ Zero rejections!' : `⚠️ ${rejections} rejection(s) logged`}\n\n` +

      `*KRA 8 - Complaint Resolution*\n` +
      `Total: ${totalComplaints} | Resolved: ${resolvedComplaints.length}\n` +
      `Within 48h: ${withinTarget}/${resolvedComplaints.length}\n` +
      `${avgResolutionTime > 0 ? `Avg: ${avgResolutionTime}h\n` : ''}` +
      `${totalComplaints === 0 || withinTarget === resolvedComplaints.length ? '✅' : '⚠️'} ` +
      `${totalComplaints === 0 ? 'No complaints!' : 'Resolution tracked'}\n\n` +

      `*KRA 9 - Customer Visits*\n` +
      `Visits: ${totalVisits}/${targetVisits}\n` +
      `Field days: ${visitDays}/${targetDays}\n` +
      `${totalVisits >= targetVisits ? '✅' : '⚠️'} ` +
      `${totalVisits >= targetVisits ? 'Visit target met!' : `${targetVisits - totalVisits} more visits needed`}\n\n` +

      `━━━━━━━━━━━━━━━━━━━━\n` +
      `_Generated by Enlight Sales OS_`;

    return report;
  } catch (error) {
    console.error('generateFullKRAReport error:', error.message);
    return '❌ Could not generate KRA report. Please try again.';
  }
}

module.exports = { generateFullKRAReport };
