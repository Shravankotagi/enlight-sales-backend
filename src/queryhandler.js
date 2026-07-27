const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Detect if message is a query or an inquiry
function isQuery(text) {
  const queryKeywords = [
    // Sales queries
    'my sales', 'meri sales', 'kitni sales', 'sales this month',
    'is mahine', 'this month', 'last month', 'pichle mahine',
    // Deal queries  
    'pending', 'pending deals', 'open deals', 'meri deals',
    'my deals', 'deals this week', 'is hafte',
    // Customer queries
    'customers', 'customer list', 'which customers', 'kaun se customer',
    'not ordered', 'order nahi', 'inactive customers',
    // Payment queries
    'payment', 'outstanding', 'overdue', 'due payment',
    'pending payment', 'baaki payment',
    // KRA queries
    'kra', 'my kra', 'performance', 'target', 'achievement',
    // Inquiry queries
    'my inquiries', 'meri inquiries', 'pending inquiries',
    'review queue', 'kitni inquiries',
    // General
    'report', 'summary', 'status', 'show me', 'batao',
    'kitna', 'how many', 'total', 'count'
  ];

  const lowerText = text.toLowerCase();
  return queryKeywords.some(keyword => lowerText.includes(keyword));
}

// Get current month date range
function getMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    monthName: now.toLocaleString('en-IN', { month: 'long' }),
    year: now.getFullYear()
  };
}

// Get current week date range
function getWeekRange() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Format number as Indian currency
function formatINR(amount) {
  if (!amount) return '₹0';
  return '₹' + Number(amount).toLocaleString('en-IN');
}

// QUERY HANDLERS

async function getSalesThisMonth(senderPhone) {
  try {
    const supabase = getSupabase();
    const { start, end, monthName, year } = getMonthRange();

    const { data: deals, error } = await supabase
      .from('deals')
      .select('*, deal_items(*)')
      .eq('customer_phone', senderPhone)
      .in('stage', ['won', 'new_inquiry', 'quoted', 'negotiation'])
      .gte('created_at', start)
      .lte('created_at', end);

    if (error) throw error;

    // Also get all deals for this month regardless of phone
    // (during testing, use all deals)
    const { data: allDeals } = await supabase
      .from('deals')
      .select('*, deal_items(*)')
      .gte('created_at', start)
      .lte('created_at', end);

    const totalDeals = allDeals?.length || 0;
    const wonDeals = allDeals?.filter(d => d.stage === 'won').length || 0;
    const totalAmount = allDeals?.reduce((sum, d) => sum + (d.total_amount || 0), 0) || 0;
    const totalItems = allDeals?.reduce((sum, d) => sum + (d.deal_items?.length || 0), 0) || 0;

    return `📊 *Sales Summary — ${monthName} ${year}*\n\n` +
      `📋 Total Deals: ${totalDeals}\n` +
      `✅ Won: ${wonDeals}\n` +
      `📦 Total Line Items: ${totalItems}\n` +
      `💰 Total Value: ${formatINR(totalAmount)}\n\n` +
      `_Data from Enlight Sales OS_`;
  } catch (error) {
    console.error('getSalesThisMonth error:', error);
    return '❌ Could not fetch sales data. Please try again.';
  }
}

async function getPendingDeals(senderPhone) {
  try {
    const supabase = getSupabase();

    const { data: deals, error } = await supabase
      .from('deals')
      .select('*')
      .not('stage', 'in', '("won","lost")')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    if (!deals || deals.length === 0) {
      return '✅ No pending deals right now!';
    }

    const dealList = deals.map((d, i) => 
      `${i + 1}. ${d.customer_name || 'Unknown'}\n` +
      `   Stage: ${d.stage} | ${d.inquiry_type}\n` +
      `   ${d.total_amount ? formatINR(d.total_amount) : 'Amount TBD'}`
    ).join('\n\n');

    return `📋 *Pending Deals (${deals.length})*\n\n${dealList}\n\n_Showing latest 10_`;
  } catch (error) {
    console.error('getPendingDeals error:', error);
    return '❌ Could not fetch pending deals.';
  }
}

async function getPendingInquiries() {
  try {
    const supabase = getSupabase();

    const { data: inquiries, error } = await supabase
      .from('inquiries')
      .select('*')
      .eq('status', 'review')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    if (!inquiries || inquiries.length === 0) {
      return '✅ No inquiries pending review!';
    }

    const list = inquiries.map((inq, i) =>
      `${i + 1}. ${inq.sender_name || inq.sender_phone}\n` +
      `   "${inq.raw_text?.substring(0, 50)}..."\n` +
      `   Confidence: ${Math.round((inq.overall_confidence || 0) * 100)}%`
    ).join('\n\n');

    return `⚠️ *Inquiries Needing Review (${inquiries.length})*\n\n${list}`;
  } catch (error) {
    console.error('getPendingInquiries error:', error);
    return '❌ Could not fetch inquiries.';
  }
}

async function getDealsThisWeek() {
  try {
    const supabase = getSupabase();
    const { start, end } = getWeekRange();

    const { data: deals, error } = await supabase
      .from('deals')
      .select('*, deal_items(*)')
      .gte('created_at', start)
      .lte('created_at', end)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!deals || deals.length === 0) {
      return '📋 No deals logged this week yet.';
    }

    const totalAmount = deals.reduce((sum, d) => sum + (d.total_amount || 0), 0);
    const list = deals.map((d, i) =>
      `${i + 1}. ${d.customer_name || 'Unknown'} — ${d.inquiry_type}\n` +
      `   ${d.deal_items?.length || 0} items | ${formatINR(d.total_amount)}`
    ).join('\n\n');

    return `📊 *This Week's Deals (${deals.length})*\n\n${list}\n\n` +
      `💰 *Total: ${formatINR(totalAmount)}*`;
  } catch (error) {
    console.error('getDealsThisWeek error:', error);
    return '❌ Could not fetch this week deals.';
  }
}

async function getKRAStatus(senderPhone) {
  try {
    const supabase = getSupabase();
    const { start, end, monthName, year } = getMonthRange();

    // Get all deals this month
    const { data: deals } = await supabase
      .from('deals')
      .select('*, deal_items(*)')
      .gte('created_at', start)
      .lte('created_at', end);

    // Get all inquiries this month
    const { data: inquiries } = await supabase
      .from('inquiries')
      .select('*')
      .gte('created_at', start)
      .lte('created_at', end);

    const totalDeals = deals?.length || 0;
    const wonDeals = deals?.filter(d => d.stage === 'won').length || 0;
    const lostDeals = deals?.filter(d => d.stage === 'lost').length || 0;
    const totalInquiries = inquiries?.length || 0;
    const conversionRate = totalInquiries > 0 
      ? Math.round((wonDeals / totalInquiries) * 100) 
      : 0;
    const totalAmount = deals?.reduce((sum, d) => 
      sum + (d.total_amount || 0), 0) || 0;
    const newCustomers = deals?.filter(d => 
      d.customer_name && d.inquiry_type === 'purchase_order'
    ).length || 0;

    return `🎯 *KRA Status — ${monthName} ${year}*\n\n` +
      `📋 KRA 1 — Sales Achievement\n` +
      `   Deals: ${totalDeals} | Value: ${formatINR(totalAmount)}\n\n` +
      `👥 KRA 2 — New Customers\n` +
      `   POs received: ${newCustomers} (target: 3)\n\n` +
      `🔄 KRA 4 — Enquiry Conversion\n` +
      `   Inquiries: ${totalInquiries} | Won: ${wonDeals}\n` +
      `   Rate: ${conversionRate}% (target: 70-80%)\n\n` +
      `📊 KRA 6 — CRM Compliance\n` +
      `   Logged today via WhatsApp bot ✅\n\n` +
      `_Full KRA report available from Sales Lead_`;
  } catch (error) {
    console.error('getKRAStatus error:', error);
    return '❌ Could not fetch KRA status.';
  }
}

// Main query router
async function handleQuery(text, senderPhone) {
  const lower = text.toLowerCase();

  // Sales this month
  if (lower.includes('sales') || lower.includes('is mahine') || 
      lower.includes('this month') || lower.includes('monthly')) {
    return await getSalesThisMonth(senderPhone);
  }

  // This week
  if (lower.includes('this week') || lower.includes('is hafte') || 
      lower.includes('week')) {
    return await getDealsThisWeek();
  }

  // Pending deals
  if (lower.includes('pending') && 
      (lower.includes('deal') || lower.includes('order'))) {
    return await getPendingDeals(senderPhone);
  }

  // Pending inquiries / review queue
  if (lower.includes('pending') || lower.includes('review') || 
      lower.includes('inquir')) {
    return await getPendingInquiries();
  }

  // KRA status
  if (lower.includes('kra') || lower.includes('target') || 
      lower.includes('performance') || lower.includes('achievement')) {
    return await getKRAStatus(senderPhone);
  }

  // Default: sales summary
  return await getSalesThisMonth(senderPhone);
}

module.exports = { isQuery, handleQuery };
