const { createClient } = require('@supabase/supabase-js');
const { getPaymentSummary } = require('./kra5');
const { getComplaintSummary } = require('./kra8');
const { generateFullKRAReport } = require('./kraReport');
const { getNewCustomerSummary } = require('./kra2');
const { handleConversationalQuery } = require('./agents/assistantAgent');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Detect if message is a query or an inquiry
function isQuery(text) {
  const lowerText = text.toLowerCase();

  // If it looks like a steel order/inquiry (e.g. contains quantity and units or pricing request), it is NOT a dashboard query!
  const hasInquiryPatterns = 
    /\b\d+\s*(mt|kg|ton|pcs|sheet|coil|bar|flat|plate|mm|mtr)\b/i.test(lowerText) || 
    lowerText.includes('rate is') || 
    lowerText.includes('price is') ||
    lowerText.includes('target rate') ||
    /\b\d+\s*x\s*\d+/i.test(lowerText);
    
  if (hasInquiryPatterns) {
    return false;
  }

  const queryKeywords = [
    // Sales queries
    'my sales', 'meri sales', 'kitni sales', 'sales this month',
    'is mahine', 'this month', 'last month', 'pichle mahine',
    // Deal queries  
    'pending deals', 'open deals', 'meri deals',
    'my deals', 'deals this week', 'is hafte',
    // Customer queries
    'customer list', 'which customers', 'kaun se customer',
    'not ordered', 'order nahi', 'inactive customers',
    // Payment queries
    'outstanding', 'overdue', 'due payment',
    'pending payment', 'baaki payment',
    // KRA queries
    'my kra', 'performance report', 'target achievements',
    // Inquiry queries
    'my inquiries', 'meri inquiries', 'pending inquiries',
    'review queue', 'kitni inquiries',
    // General / Command phrases
    'monthly report', 'sales report', 'status report', 'show me sales',
    'my reports', 'my report', 'all reports', 'show reports', 'report card',
    'report', 'reports', 'dashboard', 'login', 'link', 'website', 'portal', 'url',
    // General conversational & date/pricing query triggers
    'date', 'time', 'today', 'aaj', 'din', 'tarikh', 'time kya', 'price', 'prices',
    'rate', 'rates', 'cost', 'bhav', 'what is', 'tell me', 'help', 'how to', 'bot',
    'assistant', 'hello', 'hi', 'hey', 'namaste', 'joke', 'who are you', 'kaise ho'
  ];

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

function getMonthRangeFromQuery(text) {
  if (!text) return getMonthRange();
  const lower = text.toLowerCase();
  const months = [
    { name: 'january', aliases: ['january', 'jan', 'januari'] },
    { name: 'february', aliases: ['february', 'feb', 'februari'] },
    { name: 'march', aliases: ['march', 'mar', 'murch'] },
    { name: 'april', aliases: ['april', 'apr'] },
    { name: 'may', aliases: ['may'] },
    { name: 'june', aliases: ['june', 'jun'] },
    { name: 'july', aliases: ['july', 'jul'] },
    { name: 'august', aliases: ['august', 'aug'] },
    { name: 'september', aliases: ['september', 'sep', 'sept'] },
    { name: 'october', aliases: ['october', 'oct'] },
    { name: 'november', aliases: ['november', 'nov'] },
    { name: 'december', aliases: ['december', 'dec'] }
  ];

  const now = new Date();
  let targetMonth = now.getMonth();
  let targetYear = now.getFullYear();

  for (let idx = 0; idx < months.length; idx++) {
    const m = months[idx];
    if (m.aliases.some(alias => lower.includes(alias))) {
      targetMonth = idx;
      break;
    }
  }

  const start = new Date(targetYear, targetMonth, 1);
  const end = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    monthName: start.toLocaleString('en-IN', { month: 'long' }),
    year: targetYear
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

async function getSalesThisMonth(senderPhone, text = '') {
  try {
    const supabase = getSupabase();
    const { start, end, monthName, year } = getMonthRangeFromQuery(text);

    const { data: deals, error } = await supabase
      .from('deals')
      .select('*, deal_items(*)')
      .eq('salesperson_phone', senderPhone)
      .gte('created_at', start)
      .lte('created_at', end);

    if (error) throw error;

    const totalDeals = deals?.length || 0;
    const wonDeals = deals?.filter(d => d.stage === 'won').length || 0;
    const totalAmount = deals?.reduce((sum, d) => sum + (Number(d.total_amount) || 0), 0) || 0;
    const totalItems = deals?.reduce((sum, d) => sum + (d.deal_items?.length || 0), 0) || 0;

    return `📊 *Sales Summary - ${monthName} ${year}*\n\n` +
      `📋 Total Created Deals: ${totalDeals}\n` +
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
      `${i + 1}. ${d.customer_name || 'Unknown'} - ${d.inquiry_type}\n` +
      `   ${d.deal_items?.length || 0} items | ${formatINR(d.total_amount)}`
    ).join('\n\n');

    return `📊 *This Week's Deals (${deals.length})*\n\n${list}\n\n` +
      `💰 *Total: ${formatINR(totalAmount)}*`;
  } catch (error) {
    console.error('getDealsThisWeek error:', error);
    return '❌ Could not fetch this week deals.';
  }
}

async function getKRAStatus(senderPhone, text = '') {
  try {
    const supabase = getSupabase();
    const { start, end, monthName, year } = getMonthRangeFromQuery(text);

    // Get all deals this month for this salesperson
    const { data: deals } = await supabase
      .from('deals')
      .select('*, deal_items(*)')
      .eq('salesperson_phone', senderPhone)
      .gte('created_at', start)
      .lte('created_at', end);

    // Get all inquiries this month for this salesperson
    const { data: inquiries } = await supabase
      .from('inquiries')
      .select('*')
      .eq('salesperson_phone', senderPhone)
      .gte('created_at', start)
      .lte('created_at', end);

    const resolvedMonth = new Date(start).getMonth() + 1;
    const resolvedYear  = new Date(start).getFullYear();

    // Get KRA logs this month for KRA 2 (New Customers)
    const { data: kra2Logs } = await supabase
      .from('kra_logs')
      .select('id')
      .eq('salesperson_phone', senderPhone)
      .eq('kra_number', 2)
      .eq('kra_type', 'new_customer')
      .eq('month', resolvedMonth)
      .eq('year', resolvedYear);

    const totalDeals = deals?.length || 0;
    const wonDeals = deals?.filter(d => d.stage === 'won') || [];
    const wonCount = wonDeals.length;
    const wonValue = wonDeals.reduce((sum, d) => sum + (Number(d.total_amount) || 0), 0);

    const totalInquiries = inquiries?.length || 0;
    const conversionRate = totalInquiries > 0 
      ? Math.round((wonCount / totalInquiries) * 100) 
      : 0;

    const newCustomersCount = kra2Logs?.length || 0;

    return `🎯 *KRA Status - ${monthName} ${year}*\n\n` +
      `📋 *KRA 1 - Sales Achievement*\n` +
      `   Won Deals: ${wonCount} | Value: ${formatINR(wonValue)} (Total Created: ${totalDeals})\n\n` +
      `👥 *KRA 2 - New Customers*\n` +
      `   POs received: ${newCustomersCount} (target: 3)\n\n` +
      `🔄 *KRA 4 - Enquiry Conversion*\n` +
      `   Inquiries: ${totalInquiries} | Won: ${wonCount}\n` +
      `   Rate: ${conversionRate}% (target: 70-80%)\n\n` +
      `📊 *KRA 6 - CRM Compliance*\n` +
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

  // Check for other salesperson names to prevent unauthorized cross-queries
  try {
    const supabase = getSupabase();
    const { data: otherEmployees } = await supabase
      .from('employees')
      .select('name')
      .neq('phone', senderPhone);

    if (otherEmployees && otherEmployees.length > 0) {
      for (const emp of otherEmployees) {
        if (emp.name) {
          const empNameLower = emp.name.toLowerCase().trim();
          const parts = empNameLower.split(/\s+/);
          const isMatch = lower.includes(empNameLower) || 
            parts.some(part => part.length > 3 && lower.includes(part));

          if (isMatch) {
            return `⚠️ *Access Denied*\n\nYou are not authorized to view the performance or KRA details of other salespeople. You can only query your own performance reports.`;
          }
        }
      }
    }
  } catch (err) {
    console.error('Cross-query check error:', err.message);
  }

  // --- SEMANTIC ROUTING USING GEMINI CLASSIFIER (Resolves typos like 'performace') ---
  try {
    const { classifyQueryType } = require('./gemini');
    const classification = await classifyQueryType(text);

    if (classification && classification.confidence >= 0.70) {
      switch (classification.category) {
        case 'dashboard_link': {
          const dashboardUrl = process.env.DASHBOARD_URL || 'https://enlight-sales-frontend.vercel.app';
          return `🔗 *Enlight Sales OS Portal*\n\n` +
            `You can access the web dashboard here:\n` +
            `👉 ${dashboardUrl}\n\n` +
            `🔑 *Login instructions*:\n` +
            `1. Enter your registered WhatsApp number.\n` +
            `2. Request and verify the OTP sent to your phone.\n` +
            `3. Keep track of your deals, rate sheets, and KRA dashboards in real-time!`;
        }

        case 'sales_summary':
          return await getSalesThisMonth(senderPhone, text);

        case 'kra_status':
          return await getKRAStatus(senderPhone, text);

        case 'visit_summary':
          return await getVisitSummary(senderPhone, text);

        case 'payment_summary':
          return await getPaymentSummary(senderPhone);

        case 'complaint_summary':
          return await getComplaintSummary(senderPhone);

        case 'full_report':
          return await generateFullKRAReport(senderPhone, getMonthRangeFromQuery(text));

        case 'deals_this_week':
          return await getDealsThisWeek();

        case 'pending_deals':
          return await getPendingDeals(senderPhone);

        case 'pending_inquiries':
          return await getPendingInquiries();

        case 'new_customers_summary':
          return await getNewCustomerSummary(senderPhone);
      }
    }
  } catch (err) {
    console.error('Semantic router error:', err.message);
  }

  // Dashboard Link / Login request
  const isLinkRequest = 
    lower.includes('link') || 
    lower.includes('login') || 
    lower.includes('website') || 
    lower.includes('portal') || 
    lower.includes('url') || 
    lower.includes('open dashboard') ||
    lower.includes('dashboard link');
    
  if (isLinkRequest) {
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://enlight-sales-frontend.vercel.app';
    return `🔗 *Enlight Sales OS Portal*\n\n` +
      `You can access the web dashboard here:\n` +
      `👉 ${dashboardUrl}\n\n` +
      `🔑 *Login instructions*:\n` +
      `1. Enter your registered WhatsApp number.\n` +
      `2. Request and verify the OTP sent to your phone.\n` +
      `3. Keep track of your deals, rate sheets, and KRA dashboards in real-time!`;
  }

  // KRA status or Performance (checked first to avoid matching 'sales' in 'salesperson performance')
  if (lower.includes('kra') || lower.includes('target') || 
      lower.includes('performance') || lower.includes('achievement') ||
      lower.includes('dashboard') || lower.includes('status') || lower.includes('summary')) {
    return await getKRAStatus(senderPhone, text);
  }

  // Sales this month
  if (lower.includes('sales') || lower.includes('is mahine') || 
      lower.includes('this month') || lower.includes('monthly')) {
    return await getSalesThisMonth(senderPhone, text);
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

  // KRA 9 - Visit summary
  if (lower.includes('visit') || lower.includes('visits') ||
      lower.includes('customer visit') || lower.includes('kra 9')) {
    return await getVisitSummary(senderPhone, text);
  }

  // KRA 5 - Payment summary
  if (lower.includes('payment') || lower.includes('outstanding') ||
      lower.includes('overdue') || lower.includes('baaki') ||
      lower.includes('due') || lower.includes('collection')) {
    return await getPaymentSummary(senderPhone);
  }

  // KRA 8 - Complaint summary
  if (lower.includes('complaint') || lower.includes('complain') ||
      lower.includes('shikayat') || lower.includes('kra 8')) {
    return await getComplaintSummary(senderPhone);
  }

  // Full monthly report
  if (lower.includes('monthly report') || 
      lower.includes('full report') ||
      lower.includes('mahine ki report') ||
      lower.includes('kra report') ||
      lower.includes('monthly kra') ||
      lower.includes('my reports') ||
      lower.includes('my report') ||
      lower.includes('all reports') ||
      lower.includes('show reports') ||
      lower.includes('report card') ||
      lower === 'report' ||
      lower === 'reports' ||
      lower.includes('all my reports')) {
    return await generateFullKRAReport(senderPhone, getMonthRangeFromQuery(text));
  }

  // KRA 2 new customers
  if (lower.includes('new customer') || 
      lower.includes('naya customer') ||
      lower.includes('kra 2')) {
    return await getNewCustomerSummary(senderPhone);
  }



  // Default: Conversational Gemini Assistant (handles dates, time, rates, general queries)
  return await handleConversationalQuery(text, senderPhone);
}

async function getVisitSummary(senderPhone, text = '') {
  try {
    const supabase = getSupabase();
    const { start, end, monthName, year } = getMonthRangeFromQuery(text);

    const { data: visits } = await supabase
      .from('customer_visits')
      .select('*')
      .eq('salesperson_phone', senderPhone)
      .gte('visited_at', start)
      .lte('visited_at', end)
      .order('visited_at', { ascending: false });

    if (!visits || visits.length === 0) {
      return `📊 *KRA 9 - ${monthName} ${year}*\n\nNo visits logged this month yet.\n\nLog a visit:\n"visited ABC Fabricators today, met Rahul, discussed pricing"`;
    }

    const visitList = visits.slice(0, 5).map((v, i) =>
      `${i + 1}. ${v.customer_name || 'Unknown'} - ${new Date(v.visited_at).toLocaleDateString('en-IN')}`
    ).join('\n');

    return `📊 *KRA 9 - ${monthName} ${year}*\n\n` +
      `Total visits: ${visits.length}\n\n` +
      `Recent visits:\n${visitList}\n\n` +
      `_Target: 10 visits/week, 3 field days/week_`;
  } catch (error) {
    console.error('getVisitSummary error:', error);
    return '❌ Could not fetch visit summary.';
  }
}

module.exports = { isQuery, handleQuery, getVisitSummary };
