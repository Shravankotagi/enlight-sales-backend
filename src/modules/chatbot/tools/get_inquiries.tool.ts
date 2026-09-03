import {
  ChatbotTool,
  CallerContext,
  getSubordinateSalespersons,
  isManagerRole,
  isSalespersonRole,
} from './chatbot-tool.interface';

function parseDateFilter(dateFilter?: string): { from?: Date; to?: Date } {
  if (!dateFilter || dateFilter === 'all') return {};
  const now = new Date();
  const lower = dateFilter.toLowerCase().trim();

  if (lower === 'today') {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    return { from: startOfToday };
  }
  if (lower === 'yesterday') {
    const startOfYesterday = new Date(now);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(now);
    endOfYesterday.setDate(endOfYesterday.getDate() - 1);
    endOfYesterday.setHours(23, 59, 59, 999);
    return { from: startOfYesterday, to: endOfYesterday };
  }
  if (lower === 'this_week' || lower === 'week') {
    const startOfWeek = new Date(now);
    startOfWeek.setDate(startOfWeek.getDate() - 7);
    startOfWeek.setHours(0, 0, 0, 0);
    return { from: startOfWeek };
  }
  if (lower === 'this_month' || lower === 'month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: startOfMonth };
  }
  const parsed = new Date(dateFilter);
  if (!isNaN(parsed.getTime())) {
    const start = new Date(parsed);
    start.setHours(0, 0, 0, 0);
    const end = new Date(parsed);
    end.setHours(23, 59, 59, 999);
    return { from: start, to: end };
  }
  return {};
}

export const getInquiriesTool: ChatbotTool = {
  name: 'get_inquiries',
  description:
    'Fetches customer inquiries, raw WhatsApp messages, and linked deal outcomes. Always returns total inquiry counts, stage breakdown (won, lost, quoted, review), top customers by frequency, and itemized records. Scoped strictly by caller role.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_inquiries',
    description:
      'Retrieves incoming customer inquiries, raw WhatsApp messages, and resulting deal status from the inquiries table. Always returns exact total counts, status/stage breakdown (won, lost, quoted, review), top customers, and itemized records. Scoped by caller role.',
    parameters: {
      type: 'OBJECT',
      properties: {
        status_filter: {
          type: 'STRING',
          description:
            'Optional filter by inquiry status or deal outcome. Valid values: "all", "won", "lost", "quoted", "negotiation", "review", "confirmed", "pending". Default is "all".',
        },
        date_range: {
          type: 'STRING',
          description:
            'Optional date filter. Valid values: "today", "yesterday", "this_week", "this_month", "all", or specific ISO date.',
        },
        customer_name_search: {
          type: 'STRING',
          description: 'Optional search term for customer or company name.',
        },
        mode: {
          type: 'STRING',
          description:
            'Query mode. Valid values: "list" (default, returns records with summary), "count" (returns only counts and statistics), "top_customers" (returns customer inquiry frequency ranking).',
        },
        limit: {
          type: 'INTEGER',
          description:
            'Maximum number of inquiries to return in list mode (default: 20, max: 100).',
        },
        recent_only: {
          type: 'BOOLEAN',
          description: 'If true, returns only the top 5 most recent inquiries.',
        },
      },
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    const rawStatus = (args?.status_filter || args?.stage_filter || '')
      .toLowerCase()
      .trim();
    const limit = args?.recent_only
      ? 5
      : Math.min(Math.max(Number(args?.limit) || 20, 1), 100);
    const searchName = (args?.customer_name_search || '').trim().toLowerCase();
    const dateRange = args?.date_range;
    const mode = (args?.mode || 'list').toLowerCase().trim();

    // 1. Build Base Query with PostgREST join on deals & deal_items
    // Notice: inquiries table does NOT have customer_name or customer_phone as top-level columns.
    // They are resolved from deals, ai_extraction_json, or sender_name.
    let query = supabaseAdmin
      .from('inquiries')
      .select(
        'id, sender_name, sender_phone, raw_text, inquiry_type, status, source_channel, overall_confidence, ai_extraction_json, created_at, salesperson_phone, employee_id, deals(id, stage, status, customer_name, customer_phone, deal_items(sku_text, dimensions, quantity, unit, rate, amount))',
      )
      .order('created_at', { ascending: false });

    // 2. Role-based scoping (Layer 1 enforcement)
    if (isSalespersonRole(callerContext.role)) {
      const rawPhone = callerContext.phone || '';
      const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
      const empId = callerContext.employeeId;
      const orParts: string[] = [];

      if (cleanPhone) {
        orParts.push(
          `salesperson_phone.ilike.%${cleanPhone}%`,
          `sender_phone.ilike.%${cleanPhone}%`,
        );
      }
      if (empId) {
        orParts.push(`employee_id.eq.${empId}`);
      }

      if (orParts.length > 0) {
        query = query.or(orParts.join(','));
      }
    } else if (isManagerRole(callerContext.role)) {
      const { phoneSuffixes, employeeIds } = await getSubordinateSalespersons(
        callerContext,
        supabaseAdmin,
      );

      const orParts: string[] = [];
      phoneSuffixes.forEach((p) => {
        orParts.push(
          `salesperson_phone.ilike.%${p}%`,
          `sender_phone.ilike.%${p}%`,
        );
      });
      employeeIds.forEach((id) => {
        orParts.push(`employee_id.eq.${id}`);
      });

      if (orParts.length === 0) {
        return {
          summary: {
            total_inquiries: 0,
            inquiries_today: 0,
            by_inquiry_status: {},
            by_deal_stage: {},
            top_customers: [],
          },
          data: [],
          rowCount: 0,
        };
      }

      query = query.or(orParts.join(','));
    }
    // Admin role receives unfiltered data

    // 3. Date filtering
    const { from, to } = parseDateFilter(dateRange);
    if (from) {
      query = query.gte('created_at', from.toISOString());
    }
    if (to) {
      query = query.lte('created_at', to.toISOString());
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`get_inquiries error: ${error.message}`);
    }

    const rawList = data || [];

    // 4. Compute Global Aggregation Summary across all scoped inquiries
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let inquiriesTodayCount = 0;
    const inquiryStatusCounts: Record<string, number> = {};
    const dealStageCounts: Record<string, number> = {};
    const customerCountMap: Record<string, number> = {};

    const formattedList = rawList.map((inq: any) => {
      const deal =
        Array.isArray(inq.deals) && inq.deals.length > 0
          ? inq.deals[0]
          : inq.deals || null;
      const aiJson = (inq.ai_extraction_json as any) || {};

      // Resolve customer name accurately
      const resolvedCustomerName =
        deal?.customer_name ||
        aiJson.companyName ||
        aiJson.customer_name ||
        aiJson.customer?.name ||
        inq.sender_name ||
        'Customer Inquiry';

      const resolvedCustomerPhone =
        deal?.customer_phone ||
        aiJson.customerPhone ||
        aiJson.customer_phone ||
        aiJson.customer?.phone ||
        inq.sender_phone ||
        '';

      const dealStage =
        deal?.stage ||
        (inq.status === 'confirmed' ? 'qualified' : 'new_inquiry');
      const inquiryStatus = inq.status || 'review';

      // Update aggregation counts
      const inqDate = new Date(inq.created_at);
      if (inqDate >= startOfToday) {
        inquiriesTodayCount++;
      }

      inquiryStatusCounts[inquiryStatus] =
        (inquiryStatusCounts[inquiryStatus] || 0) + 1;
      dealStageCounts[dealStage] = (dealStageCounts[dealStage] || 0) + 1;

      if (resolvedCustomerName && resolvedCustomerName !== 'Customer Inquiry') {
        customerCountMap[resolvedCustomerName] =
          (customerCountMap[resolvedCustomerName] || 0) + 1;
      }

      // Resolve line items: prefer deal_items if present, otherwise ai extraction items
      const rawDealItems = deal?.deal_items;
      const rawAiItems =
        aiJson.line_items || aiJson.lineItems || aiJson.items || [];

      let formattedItems: any[] = [];
      if (Array.isArray(rawDealItems) && rawDealItems.length > 0) {
        formattedItems = rawDealItems.map((di: any) => ({
          description: di.sku_text || 'Material',
          specs: di.dimensions || null,
          quantity_mt: Number(di.quantity) || 0,
          unit: di.unit || 'MT',
          rate_per_mt: Number(di.rate) || 0,
          amount: Number(di.amount) || 0,
        }));
      } else if (Array.isArray(rawAiItems) && rawAiItems.length > 0) {
        formattedItems = rawAiItems.map((li: any) => ({
          description:
            li.sku_text || li.description || li.product || 'Material',
          specs: li.dimensions || li.specs || null,
          quantity_mt: Number(li.quantity) || Number(li.quantity_tons) || 0,
          unit: li.unit || 'MT',
          rate_per_mt: Number(li.rate) || 0,
          amount: Number(li.amount) || 0,
        }));
      }

      const humanDealId = deal?.id
        ? 'DEAL-' + deal.id.substring(0, 6).toUpperCase()
        : inq.id
          ? 'DEAL-' + inq.id.substring(0, 6).toUpperCase()
          : null;

      return {
        inquiry_id: inq.id,
        deal_id: humanDealId,
        deal_uuid: deal?.id || null,
        deal_status: dealStage,
        inquiry_status: inquiryStatus,
        customer_name: resolvedCustomerName,
        customer_phone: resolvedCustomerPhone,
        salesperson_phone: inq.salesperson_phone || inq.sender_phone || '',
        source_channel: inq.source_channel || 'whatsapp',
        received_at: inq.created_at,
        extracted_line_items: formattedItems,
        delivery_location:
          aiJson.delivery_location ||
          aiJson.deliveryLocation ||
          deal?.delivery_location ||
          null,
        payment_terms:
          aiJson.payment_terms ||
          aiJson.paymentTerms ||
          deal?.payment_terms ||
          null,
        original_whatsapp_message: inq.raw_text || '',
      };
    });

    // Top customers ranked by count
    const topCustomers = Object.entries(customerCountMap)
      .map(([name, count]) => ({ customer_name: name, inquiry_count: count }))
      .sort((a, b) => b.inquiry_count - a.inquiry_count);

    // Customers with more than 1 inquiry
    const customersWithMultipleInquiries = topCustomers.filter(
      (c) => c.inquiry_count > 1,
    );

    // Customers with active inquiries
    const activeCustomersMap: Record<string, number> = {};
    formattedList.forEach((inq) => {
      if (
        inq.deal_status !== 'lost' &&
        inq.inquiry_status !== 'lost' &&
        inq.customer_name !== 'Customer Inquiry'
      ) {
        activeCustomersMap[inq.customer_name] =
          (activeCustomersMap[inq.customer_name] || 0) + 1;
      }
    });

    const activeCustomers = Object.entries(activeCustomersMap)
      .map(([name, count]) => ({
        customer_name: name,
        active_inquiries_count: count,
      }))
      .sort((a, b) => b.active_inquiries_count - a.active_inquiries_count);

    const wonCount = dealStageCounts['won'] || 0;
    const lostCount =
      dealStageCounts['lost'] || inquiryStatusCounts['lost'] || 0;
    const totalInquiriesCount = rawList.length;
    const conversionRatePercent =
      totalInquiriesCount > 0
        ? Number(((wonCount / totalInquiriesCount) * 100).toFixed(1))
        : 0;

    const summary = {
      total_inquiries: totalInquiriesCount,
      inquiries_today: inquiriesTodayCount,
      by_inquiry_status: inquiryStatusCounts,
      by_deal_stage: dealStageCounts,
      top_customers: topCustomers.slice(0, 10),
      customers_with_multiple_inquiries: customersWithMultipleInquiries,
      active_customers: activeCustomers,
      conversion_metrics: {
        total_inquiries: totalInquiriesCount,
        won_inquiries: wonCount,
        lost_inquiries: lostCount,
        active_inquiries: totalInquiriesCount - wonCount - lostCount,
        inquiry_to_won_conversion_rate: `${conversionRatePercent}%`,
        inquiry_conversion_percent: conversionRatePercent,
        closed_win_rate:
          wonCount + lostCount > 0
            ? `${((wonCount / (wonCount + lostCount)) * 100).toFixed(1)}%`
            : '0%',
      },
    };

    // 5. Apply filters for list mode
    let filteredList = formattedList;

    // Filter by customer name search (checks customer_name, original message, phone)
    if (searchName) {
      filteredList = filteredList.filter(
        (i) =>
          i.customer_name.toLowerCase().includes(searchName) ||
          i.customer_phone.includes(searchName) ||
          i.original_whatsapp_message.toLowerCase().includes(searchName),
      );
    }

    // Filter by status or stage
    if (rawStatus && rawStatus !== 'all') {
      filteredList = filteredList.filter((i) => {
        const dStage = i.deal_status.toLowerCase();
        const iStatus = i.inquiry_status.toLowerCase();

        if (rawStatus === 'active') {
          return dStage !== 'lost' && iStatus !== 'lost';
        }
        if (rawStatus === 'won') {
          return dStage === 'won' || iStatus === 'order_created';
        }
        if (rawStatus === 'lost') {
          return dStage === 'lost' || iStatus === 'lost';
        }
        if (rawStatus === 'quoted') {
          return dStage === 'quoted' || iStatus === 'quoted';
        }
        if (rawStatus === 'negotiation') {
          return dStage === 'negotiation' || iStatus === 'negotiation';
        }
        if (
          rawStatus === 'pending' ||
          rawStatus === 'review' ||
          rawStatus === 'new'
        ) {
          return (
            iStatus === 'review' ||
            iStatus === 'pending' ||
            iStatus === 'auto_created' ||
            dStage === 'new_inquiry'
          );
        }
        if (rawStatus === 'confirmed' || rawStatus === 'processed') {
          return (
            iStatus === 'confirmed' ||
            iStatus === 'processed' ||
            dStage === 'qualified'
          );
        }
        return dStage.includes(rawStatus) || iStatus.includes(rawStatus);
      });
    }

    // 6. Return response based on requested mode
    if (mode === 'count' || mode === 'summary') {
      return {
        data: {
          summary,
          filtered_count: filteredList.length,
        },
        rowCount: filteredList.length,
      };
    }

    if (mode === 'top_customers') {
      return {
        data: {
          top_customers: topCustomers.slice(0, 10),
          customers_with_multiple_inquiries: customersWithMultipleInquiries,
          total_inquiries: rawList.length,
        },
        rowCount: topCustomers.length,
      };
    }

    if (mode === 'active_customers') {
      return {
        data: {
          active_customers: activeCustomers,
          total_active_customers: activeCustomers.length,
        },
        rowCount: activeCustomers.length,
      };
    }

    // When customer search is requested (e.g. inquiry history for a customer), allow returning all matching entries up to 100
    const effectiveLimit = searchName ? Math.max(limit, 50) : limit;
    const paginatedList = filteredList.slice(0, effectiveLimit);

    return {
      data: {
        summary,
        filtered_count: filteredList.length,
        inquiries: paginatedList,
      },
      rowCount: paginatedList.length,
    };
  },
};
