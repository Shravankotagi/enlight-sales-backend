import {
  ChatbotTool,
  CallerContext,
  getSubordinateSalespersons,
  isManagerRole,
  isSalespersonRole,
  verifyCustomerAccountAccess,
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

export const getMyOpenDealsTool: ChatbotTool = {
  name: 'get_my_open_deals',
  description:
    'Fetches deals and confirmed orders (negotiations, quotations, review, won orders, or lost deals) scoped strictly by caller role. Always returns total pipeline values, won orders total value, total tonnage in Metric Tons (MT), exact stage-by-stage counts, and human-readable Inquiry/Deal IDs matching the UI (#INQ-XXXXXX / #DEAL-XXXXXX). Can filter by stage (e.g. stage_filter="won" for orders), date range, PO number, and delivery location.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_my_open_deals',
    description:
      'Retrieves deals and orders for the authenticated user based on role scope. Can filter by stage (use stage_filter="won" for confirmed orders), customer name, date range (today, this_week, this_month), PO number, or delivery location. Always returns total order value, won deal total value, volume in MT, and human-readable Inquiry/Deal IDs (INQ-XXXXXX / DEAL-XXXXXX). Valid stage_filter values: "all", "won", "quoted", "negotiation", "review", "qualified", "lost".',
    parameters: {
      type: 'OBJECT',
      properties: {
        stage_filter: {
          type: 'STRING',
          description:
            'Optional filter by deal stage. Valid values: "all", "won" (use for Orders), "quoted", "negotiation", "review", "qualified", "lost". Default is "all".',
        },
        customer_name: {
          type: 'STRING',
          description: 'Optional search filter for customer or company name.',
        },
        date_range: {
          type: 'STRING',
          description:
            'Optional date filter: "today", "yesterday", "this_week", "this_month", "all", or specific ISO date.',
        },
        po_number: {
          type: 'STRING',
          description:
            'Optional filter or search by customer Purchase Order (PO) number (e.g. "PO-8821", "PO-104").',
        },
        delivery_location: {
          type: 'STRING',
          description:
            'Optional filter by delivery destination or city (e.g. "Pune", "Chakan", "Mumbai").',
        },
        mode: {
          type: 'STRING',
          description:
            'Query mode: "list" (default, returns records with summary), "summary" (returns only pipeline sums, tonnage, and stage breakdown).',
        },
        limit: {
          type: 'INTEGER',
          description:
            'Maximum number of deals/orders to return in list (default: 20, max: 100).',
        },
      },
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    let rawStage = (args?.stage_filter || '').toLowerCase().trim();
    const searchCustomer = (args?.customer_name || '').trim().toLowerCase();
    const searchPo = (args?.po_number || '').trim().toLowerCase();
    const searchLocation = (args?.delivery_location || '').trim().toLowerCase();
    const dateRange = args?.date_range;
    const mode = (args?.mode || 'list').toLowerCase().trim();
    const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 100);

    // Map common user terms to exact DB stages
    if (
      rawStage === 'quote_sent' ||
      rawStage === 'quotation' ||
      rawStage === 'quotes'
    ) {
      rawStage = 'quoted';
    } else if (
      rawStage === 'new_inquiry' ||
      rawStage === 'inquiry' ||
      rawStage === 'inquiries'
    ) {
      rawStage = 'new_inquiry';
    } else if (rawStage === 'negotiating') {
      rawStage = 'negotiation';
    } else if (rawStage === 'orders' || rawStage === 'order') {
      rawStage = 'won';
    }

    let query = supabaseAdmin
      .from('deals')
      .select(
        'id, customer_name, customer_phone, customer_gst, customer_address, delivery_location, payment_terms, total_amount, stage, status, po_number, po_date, created_at, salesperson_phone, employee_id, deal_items(sku_text, dimensions, quantity, unit, rate, amount)',
      )
      .order('created_at', { ascending: false });

    // 1. Role-based scoping (Layer 1 enforcement - Fail-Closed)
    if (isSalespersonRole(callerContext.role)) {
      const rawPhone = callerContext.phone || '';
      const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
      const empId = callerContext.employeeId;

      if (cleanPhone && empId) {
        query = query.or(
          `salesperson_phone.ilike.%${cleanPhone}%,employee_id.eq.${empId}`,
        );
      } else if (cleanPhone) {
        query = query.ilike('salesperson_phone', `%${cleanPhone}%`);
      } else if (empId) {
        query = query.eq('employee_id', empId);
      } else {
        return {
          data: {
            notFound: true,
            summary: {
              total_deals_count: 0,
              total_pipeline_value: 0,
              total_tonnage_mt: 0,
              won_orders_count: 0,
              won_deals_total_value: 0,
              won_orders_tonnage_mt: 0,
              stage_breakdown: {},
              message: 'Access denied. Caller identity could not be verified.',
            },
            deals: [],
          },
          rowCount: 0,
        };
      }
    } else if (isManagerRole(callerContext.role)) {
      const { employeeIds, phoneSuffixes } = await getSubordinateSalespersons(
        callerContext,
        supabaseAdmin,
      );

      const conditions: string[] = [];
      phoneSuffixes.forEach((p) => {
        conditions.push(`salesperson_phone.ilike.%${p}%`);
      });
      employeeIds.forEach((id) => {
        conditions.push(`employee_id.eq.${id}`);
      });

      if (conditions.length === 0) {
        return {
          data: {
            summary: {
              total_deals_count: 0,
              total_pipeline_value: 0,
              total_tonnage_mt: 0,
              won_orders_count: 0,
              won_deals_total_value: 0,
              won_orders_tonnage_mt: 0,
              stage_breakdown: {},
            },
            deals: [],
          },
          rowCount: 0,
        };
      }

      query = query.or(conditions.join(','));
    }
    // Admin role receives no filtering (unfiltered view)

    // 2. Date filtering
    const { from, to } = parseDateFilter(dateRange);
    if (from) {
      query = query.gte('created_at', from.toISOString());
    }
    if (to) {
      query = query.lte('created_at', to.toISOString());
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`get_my_open_deals error: ${error.message}`);
    }

    const allDeals = data || [];

    // 3. Compute Global Summary Statistics & Tonnage across all scoped deals
    const stageSummary: Record<
      string,
      { count: number; total_value: number; tonnage_mt: number }
    > = {};
    let totalPipelineVal = 0;
    let totalPipelineTonnage = 0;
    let wonTotalVal = 0;
    let wonTotalTonnage = 0;
    let wonCount = 0;
    let lostCount = 0;

    const formattedDeals = allDeals.map((d: any) => {
      const st = (d.stage || 'new_inquiry').toLowerCase().trim();
      const amount = Number(d.total_amount) || 0;

      // Compute item-level tonnage in Metric Tons (MT)
      const items = d.deal_items || [];
      const dealTonnageMt = items.reduce((tSum: number, item: any) => {
        const q = Number(item.quantity) || 0;
        const u = (item.unit || 'MT').toLowerCase().trim();
        if (u === 'kg' || u === 'kgs') return tSum + q / 1000;
        return tSum + q;
      }, 0);

      const roundedTonnage = Math.round(dealTonnageMt * 1000) / 1000;

      if (!stageSummary[st]) {
        stageSummary[st] = { count: 0, total_value: 0, tonnage_mt: 0 };
      }
      stageSummary[st].count++;
      stageSummary[st].total_value += amount;
      stageSummary[st].tonnage_mt =
        Math.round((stageSummary[st].tonnage_mt + roundedTonnage) * 1000) /
        1000;

      totalPipelineVal += amount;
      totalPipelineTonnage += roundedTonnage;

      if (st === 'won') {
        wonTotalVal += amount;
        wonTotalTonnage += roundedTonnage;
        wonCount++;
      } else if (st === 'lost') {
        lostCount++;
      }

      const cleanNum = d.deal_number
        ? d.deal_number.replace(/^#?(?:DEAL|INQ)-?/i, '')
        : d.id.substring(0, 6).toUpperCase();
      const humanDealId = 'INQ-' + cleanNum;

      return {
        deal_id: humanDealId,
        inquiry_id: humanDealId,
        deal_uuid: d.id,
        customer_name: d.customer_name || 'Unknown Customer',
        customer_phone: d.customer_phone || '',
        customer_gst: d.customer_gst || null,
        customer_address: d.customer_address || null,
        delivery_location: d.delivery_location || null,
        payment_terms: d.payment_terms || null,
        total_amount: amount,
        tonnage_mt: roundedTonnage,
        stage: d.stage || 'new_inquiry',
        status: d.status || 'review',
        po_number: d.po_number || null,
        po_date: d.po_date || null,
        created_at: d.created_at,
        salesperson_phone: d.salesperson_phone || '',
        deal_items: items,
      };
    });

    // 4. Filter by stage if requested
    let filteredDeals = formattedDeals;

    if (rawStage && rawStage !== 'all') {
      filteredDeals = filteredDeals.filter((d: any) =>
        d.stage.toLowerCase().includes(rawStage),
      );
    } else if (!rawStage) {
      // Default view when no stage is specified: exclude lost deals
      filteredDeals = filteredDeals.filter((d: any) => d.stage !== 'lost');
    }

    // Filter by customer name search
    if (searchCustomer) {
      const access = await verifyCustomerAccountAccess(
        args.customer_name,
        callerContext,
        supabaseAdmin,
      );
      if (!access.allowed) {
        return {
          data: {
            notFound: true,
            summary: {
              total_deals_count: 0,
              total_pipeline_value: 0,
              total_tonnage_mt: 0,
              won_orders_count: 0,
              won_deals_total_value: 0,
              won_orders_tonnage_mt: 0,
              stage_breakdown: {},
              filtered_deals_count: 0,
              filtered_deals_total_value: 0,
              filtered_deals_tonnage_mt: 0,
              conversion_metrics: {
                total_deals: 0,
                won_deals: 0,
                lost_deals: 0,
                win_rate_percent: 0,
              },
              message: access.message,
            },
            deals: [],
          },
          rowCount: 0,
        };
      }

      filteredDeals = filteredDeals.filter((d: any) =>
        d.customer_name.toLowerCase().includes(searchCustomer),
      );
    }

    // Filter by PO number search
    if (searchPo) {
      filteredDeals = filteredDeals.filter(
        (d: any) => d.po_number && d.po_number.toLowerCase().includes(searchPo),
      );
    }

    // Filter by delivery location search
    if (searchLocation) {
      filteredDeals = filteredDeals.filter(
        (d: any) =>
          (d.delivery_location &&
            d.delivery_location.toLowerCase().includes(searchLocation)) ||
          (d.customer_address &&
            d.customer_address.toLowerCase().includes(searchLocation)),
      );
    }

    const filteredTotalVal = filteredDeals.reduce(
      (sum: number, d: any) => sum + d.total_amount,
      0,
    );

    const filteredTotalTonnage =
      Math.round(
        filteredDeals.reduce((sum: number, d: any) => sum + d.tonnage_mt, 0) *
          1000,
      ) / 1000;

    const summary = {
      total_deals_count: allDeals.length,
      total_pipeline_value: totalPipelineVal,
      total_pipeline_tonnage_mt: Math.round(totalPipelineTonnage * 1000) / 1000,
      stage_breakdown: stageSummary,
      won_orders_count: wonCount,
      won_deals_total_value: wonTotalVal,
      won_orders_tonnage_mt: Math.round(wonTotalTonnage * 1000) / 1000,
      filtered_deals_count: filteredDeals.length,
      filtered_deals_total_value: filteredTotalVal,
      filtered_deals_tonnage_mt: filteredTotalTonnage,
      conversion_metrics: {
        total_deals: allDeals.length,
        won_deals: wonCount,
        lost_deals: lostCount,
        win_rate_percent:
          allDeals.length > 0
            ? Number(((wonCount / allDeals.length) * 100).toFixed(1))
            : 0,
      },
    };

    if (mode === 'summary' || mode === 'count') {
      return {
        data: { summary },
        rowCount: filteredDeals.length,
      };
    }

    const paginatedDeals = filteredDeals.slice(0, limit);

    return {
      data: {
        summary,
        deals: paginatedDeals,
      },
      rowCount: paginatedDeals.length,
    };
  },
};
