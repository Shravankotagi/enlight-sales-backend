import {
  ChatbotTool,
  CallerContext,
  getSubordinateSalespersons,
  isManagerRole,
  isSalespersonRole,
  verifyCustomerAccountAccess,
} from './chatbot-tool.interface';
import { parseDateFilter } from './date-filter.util';
import { convertLineItemToMt } from '../../pricing/pricing.engine';

export const getMyOpenDealsTool: ChatbotTool = {
  name: 'get_my_open_deals',
  description:
    'Fetches deals, confirmed orders, and delivered tonnage trends over time (e.g. monthly delivered volume trend for the last 6 months, 12 months, or custom period) scoped strictly by caller role. Always returns total pipeline values, won orders total value, total tonnage in Metric Tons (MT), exact stage-by-stage counts, monthly trend arrays, and human-readable Inquiry/Deal IDs matching the UI (#INQ-XXXXXX / #DEAL-XXXXXX). Can filter by stage (e.g. stage_filter="won" for orders), mode (use mode="tonnage_trend" or "monthly_trend"), date range, PO number, and delivery location.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_my_open_deals',
    description:
      'Retrieves deals, orders, and delivered tonnage trends over time for the authenticated user based on role scope. Can filter by stage (use stage_filter="won" for confirmed orders), customer name, date range (today, this_week, this_month, last_3_months, last_6_months, last_12_months, all), PO number, or delivery location. When asked about delivered tonnage trends, monthly volume over time, or order trends, set stage_filter="won" and mode="tonnage_trend". Always returns total order value, won deal total value, volume in MT, and human-readable Inquiry/Deal IDs (INQ-XXXXXX / DEAL-XXXXXX). Valid stage_filter values: "all", "won", "quoted", "negotiation", "review", "qualified", "lost".',
    parameters: {
      type: 'OBJECT',
      properties: {
        deal_id: {
          type: 'STRING',
          description:
            'Optional specific Inquiry ID or Deal ID (e.g. "#INQ-XXXXXX", "#DEAL-XXXXXX", or UUID) to fetch a single deal/order directly.',
        },
        stage_filter: {
          type: 'STRING',
          description:
            'Optional filter by deal stage. Valid values: "all", "won" (use for Orders / Delivered Tonnage), "quoted", "negotiation", "review", "qualified", "lost". Default is "all".',
        },
        customer_name: {
          type: 'STRING',
          description: 'Optional search filter for customer or company name.',
        },
        sort_by: {
          type: 'STRING',
          description:
            'Optional sorting: "date_desc" (default), "tonnage_desc" (highest tonnage first), "value_desc".',
        },
        date_range: {
          type: 'STRING',
          description:
            'Optional date filter: "today", "yesterday", "this_week", "this_month", "last_3_months", "last_6_months", "last_12_months", "this_year", "all", or specific ISO date.',
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
            'Query mode: "list" (default, returns records with summary), "summary" (returns pipeline sums, tonnage, and stage breakdown), "month_comparison" or "tonnage_comparison" (compares this month vs last month delivered tonnage MT, orders, and revenue), "tonnage_trend" or "monthly_trend" (computes month-by-month delivered tonnage in MT, orders count, revenue, and trend analysis over the last 6 or specified months).',
        },
        months_count: {
          type: 'INTEGER',
          description:
            'Number of months for trend analysis (default: 6, max: 24; set to 2 for month-over-month comparison). Only applicable when mode="tonnage_trend", "monthly_trend", or "month_comparison".',
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
    const rawDealId = (args?.deal_id || args?.inquiry_id || '').trim();
    const cleanDealId = rawDealId
      .replace(/^[#]?(?:INQ|DEAL)-?/i, '')
      .toLowerCase();
    const sortBy = (args?.sort_by || '').toLowerCase().trim();
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
    } else if (
      rawStage === 'orders' ||
      rawStage === 'order' ||
      rawStage === 'converted' ||
      rawStage === 'converted_to_orders'
    ) {
      rawStage = 'won';
    } else if (rawStage === 'not_converted' || rawStage === 'unconverted') {
      rawStage = 'lost';
    }

    let query = supabaseAdmin
      .from('deals')
      .select(
        'id, inquiry_id, customer_name, customer_phone, customer_gst, customer_address, delivery_location, payment_terms, total_amount, stage, status, po_number, po_date, won_at, created_at, salesperson_phone, employee_id, deal_items(sku_text, dimensions, quantity, unit, rate, amount)',
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
    const isComparisonMode =
      mode === 'month_comparison' ||
      mode === 'monthly_comparison' ||
      mode === 'mom_comparison' ||
      mode === 'tonnage_comparison' ||
      dateRange === 'last_2_months' ||
      Number(args?.months_count) === 2;

    const isTrendMode =
      isComparisonMode ||
      mode === 'tonnage_trend' ||
      mode === 'monthly_trend' ||
      mode === 'trend' ||
      dateRange === 'last_6_months' ||
      dateRange === 'last_3_months' ||
      dateRange === 'last_12_months';

    const effectiveDateRange =
      isComparisonMode && !dateRange
        ? 'last_2_months'
        : isTrendMode && !dateRange
          ? 'last_6_months'
          : dateRange;
    const { from, to } = parseDateFilter(effectiveDateRange);

    if (isTrendMode && from) {
      const fromDateOnly = from.toISOString().split('T')[0];
      query = query.or(
        `created_at.gte.${from.toISOString()},won_at.gte.${from.toISOString()},po_date.gte.${fromDateOnly}`,
      );
    } else {
      if (from) {
        query = query.gte('created_at', from.toISOString());
      }
      if (to) {
        query = query.lte('created_at', to.toISOString());
      }
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
        const u = (item.unit || 'MT').trim();
        const conv = convertLineItemToMt({
          sku_text: item.sku_text,
          dimensions: item.dimensions,
          quantity: q,
          unit: u,
        });
        const qtyMt = conv.canConvert && conv.mt !== null ? conv.mt : q;
        return tSum + qtyMt;
      }, 0);

      const roundedTonnage = Math.round(dealTonnageMt * 1000) / 1000;

      if (!stageSummary[st]) {
        stageSummary[st] = { count: 0, total_value: 0, tonnage_mt: 0 };
      }
      stageSummary[st].count += 1;
      stageSummary[st].total_value += amount;
      stageSummary[st].tonnage_mt =
        Math.round((stageSummary[st].tonnage_mt + roundedTonnage) * 1000) /
        1000;

      const isWon = st === 'won';
      const isLost = st === 'lost';

      if (!isLost) {
        totalPipelineVal += amount;
        totalPipelineTonnage += roundedTonnage;
      }

      if (isWon) {
        wonCount++;
        wonTotalVal += amount;
        wonTotalTonnage += roundedTonnage;
      } else if (isLost) {
        lostCount++;
      }

      const rawDealUuid = d.id || '';
      const rawInquiryUuid = d.inquiry_id || '';
      const shortIdSuffix = (
        rawInquiryUuid.replace(/-/g, '') ||
        rawDealUuid.replace(/-/g, '') ||
        '000000'
      )
        .substring(0, 6)
        .toUpperCase();

      return {
        id: d.id,
        deal_id: `#INQ-${shortIdSuffix}`,
        deal_number: `DEAL-${shortIdSuffix}`,
        customer_name: d.customer_name,
        customer_phone: d.customer_phone,
        customer_gst: d.customer_gst,
        customer_address: d.customer_address,
        delivery_location: d.delivery_location,
        payment_terms: d.payment_terms,
        total_amount: amount,
        tonnage_mt: roundedTonnage,
        stage: st,
        status: d.status || 'review',
        po_number: d.po_number || null,
        po_date: d.po_date || null,
        won_at: d.won_at || null,
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

    // Filter by specific Inquiry / Deal ID (#INQ-XXXXXX, #DEAL-XXXXXX, or UUID)
    if (cleanDealId) {
      filteredDeals = filteredDeals.filter((d: any) => {
        const idClean = (d.id || '').toLowerCase();
        const dealIdClean = (d.deal_id || '').toLowerCase();
        const dealNumClean = (d.deal_number || '').toLowerCase();
        return (
          idClean.includes(cleanDealId) ||
          dealIdClean.includes(cleanDealId) ||
          dealNumClean.includes(cleanDealId)
        );
      });
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

    // Sort deals
    if (sortBy === 'tonnage_desc') {
      filteredDeals.sort((a: any, b: any) => b.tonnage_mt - a.tonnage_mt);
    } else if (sortBy === 'value_desc') {
      filteredDeals.sort((a: any, b: any) => b.total_amount - a.total_amount);
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

    if (isTrendMode) {
      const numMonths = Math.min(
        Math.max(
          Number(args?.months_count) ||
            (isComparisonMode || effectiveDateRange === 'last_2_months'
              ? 2
              : effectiveDateRange === 'last_3_months'
                ? 3
                : effectiveDateRange === 'last_12_months' ||
                    effectiveDateRange === 'this_year'
                  ? 12
                  : 6),
          1,
        ),
        24,
      );
      const now = new Date();

      // Build chronologically ordered month slots from (now - numMonths + 1) to now
      const monthSlots: Array<{
        month_key: string;
        month_label: string;
        month_name: string;
        year: number;
        month_num: number;
        delivered_tonnage_mt: number;
        orders_count: number;
        total_revenue: number;
        customers_map: Record<
          string,
          {
            customer_name: string;
            tonnage_mt: number;
            orders_count: number;
            revenue: number;
          }
        >;
      }> = [];

      for (let i = numMonths - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const key = `${y}-${String(m).padStart(2, '0')}`;
        const label = d.toLocaleString('en-IN', {
          month: 'short',
          year: 'numeric',
        });
        const name = d.toLocaleString('en-IN', { month: 'long' });
        monthSlots.push({
          month_key: key,
          month_label: label,
          month_name: name,
          year: y,
          month_num: m,
          delivered_tonnage_mt: 0,
          orders_count: 0,
          total_revenue: 0,
          customers_map: {},
        });
      }

      // Populate slots using won orders (delivered volume)
      const targetWonDeals = formattedDeals.filter(
        (d: any) =>
          d.stage === 'won' ||
          d.stage === 'order' ||
          Boolean(d.po_number) ||
          d.inquiry_type === 'purchase_order',
      );

      targetWonDeals.forEach((deal: any) => {
        const dtStr = deal.won_at || deal.po_date || deal.created_at;
        if (!dtStr) return;
        const dealDate = new Date(dtStr);
        if (isNaN(dealDate.getTime())) return;
        const dealKey = `${dealDate.getFullYear()}-${String(
          dealDate.getMonth() + 1,
        ).padStart(2, '0')}`;

        const slot = monthSlots.find((s) => s.month_key === dealKey);
        if (slot) {
          const tMt = Number(deal.tonnage_mt) || 0;
          const amt = Number(deal.total_amount) || 0;
          slot.delivered_tonnage_mt =
            Math.round((slot.delivered_tonnage_mt + tMt) * 1000) / 1000;
          slot.orders_count += 1;
          slot.total_revenue += amt;

          const cName = deal.customer_name || 'Unknown Customer';
          if (!slot.customers_map[cName]) {
            slot.customers_map[cName] = {
              customer_name: cName,
              tonnage_mt: 0,
              orders_count: 0,
              revenue: 0,
            };
          }
          slot.customers_map[cName].tonnage_mt =
            Math.round((slot.customers_map[cName].tonnage_mt + tMt) * 1000) /
            1000;
          slot.customers_map[cName].orders_count += 1;
          slot.customers_map[cName].revenue += amt;
        }
      });

      // Top customer accounts across the entire evaluated trend period
      const overallCustomerMap: Record<
        string,
        {
          customer_name: string;
          total_tonnage_mt: number;
          orders_count: number;
          total_revenue: number;
        }
      > = {};
      monthSlots.forEach((s) => {
        Object.values(s.customers_map).forEach((c) => {
          if (!overallCustomerMap[c.customer_name]) {
            overallCustomerMap[c.customer_name] = {
              customer_name: c.customer_name,
              total_tonnage_mt: 0,
              orders_count: 0,
              total_revenue: 0,
            };
          }
          overallCustomerMap[c.customer_name].total_tonnage_mt =
            Math.round(
              (overallCustomerMap[c.customer_name].total_tonnage_mt +
                c.tonnage_mt) *
                1000,
            ) / 1000;
          overallCustomerMap[c.customer_name].orders_count += c.orders_count;
          overallCustomerMap[c.customer_name].total_revenue += c.revenue;
        });
      });

      const topCustomers = Object.values(overallCustomerMap)
        .sort((a, b) => b.total_tonnage_mt - a.total_tonnage_mt)
        .slice(0, 10);

      // Clean monthly slots for assistant consumption
      const cleanMonthlyTrend = monthSlots.map((s) => {
        const topMonthCusts = Object.values(s.customers_map)
          .sort((a, b) => b.tonnage_mt - a.tonnage_mt)
          .slice(0, 3)
          .map((c) => ({
            customer: c.customer_name,
            tonnage_mt: c.tonnage_mt,
          }));

        return {
          month_key: s.month_key,
          month: s.month_label,
          month_name: s.month_name,
          year: s.year,
          delivered_tonnage_mt: s.delivered_tonnage_mt,
          orders_count: s.orders_count,
          total_revenue: s.total_revenue,
          top_customers: topMonthCusts,
        };
      });

      const totalDeliveredTonnage =
        Math.round(
          cleanMonthlyTrend.reduce(
            (sum, m) => sum + m.delivered_tonnage_mt,
            0,
          ) * 1000,
        ) / 1000;
      const totalDeliveredOrders = cleanMonthlyTrend.reduce(
        (sum, m) => sum + m.orders_count,
        0,
      );
      const totalDeliveredRev = cleanMonthlyTrend.reduce(
        (sum, m) => sum + m.total_revenue,
        0,
      );
      const avgMonthlyTonnage =
        numMonths > 0
          ? Math.round((totalDeliveredTonnage / numMonths) * 100) / 100
          : 0;

      let peakMonth = cleanMonthlyTrend[0];
      let lowestMonth = cleanMonthlyTrend[0];
      cleanMonthlyTrend.forEach((m) => {
        if (m.delivered_tonnage_mt > peakMonth.delivered_tonnage_mt)
          peakMonth = m;
        if (m.delivered_tonnage_mt < lowestMonth.delivered_tonnage_mt)
          lowestMonth = m;
      });

      const trendPeriodLabel = `${cleanMonthlyTrend[0].month} to ${
        cleanMonthlyTrend[cleanMonthlyTrend.length - 1].month
      }`;

      const trendSummary = {
        period: trendPeriodLabel,
        months_evaluated: numMonths,
        total_delivered_tonnage_mt: totalDeliveredTonnage,
        total_delivered_orders_count: totalDeliveredOrders,
        total_delivered_revenue: totalDeliveredRev,
        average_monthly_tonnage_mt: avgMonthlyTonnage,
        peak_month: {
          month: peakMonth.month,
          delivered_tonnage_mt: peakMonth.delivered_tonnage_mt,
          orders_count: peakMonth.orders_count,
        },
        lowest_month: {
          month: lowestMonth.month,
          delivered_tonnage_mt: lowestMonth.delivered_tonnage_mt,
          orders_count: lowestMonth.orders_count,
        },
        current_month_mtd: cleanMonthlyTrend[cleanMonthlyTrend.length - 1],
      };

      // Construct dedicated comparison object for MoM analysis
      const thisMonth = cleanMonthlyTrend[cleanMonthlyTrend.length - 1];
      const lastMonth =
        cleanMonthlyTrend.length >= 2
          ? cleanMonthlyTrend[cleanMonthlyTrend.length - 2]
          : cleanMonthlyTrend[0];
      const diffTonnage =
        Math.round(
          (thisMonth.delivered_tonnage_mt - lastMonth.delivered_tonnage_mt) *
            1000,
        ) / 1000;
      const diffOrders = thisMonth.orders_count - lastMonth.orders_count;
      const diffRev = thisMonth.total_revenue - lastMonth.total_revenue;
      const pctChange =
        lastMonth.delivered_tonnage_mt > 0
          ? `${(((thisMonth.delivered_tonnage_mt - lastMonth.delivered_tonnage_mt) / lastMonth.delivered_tonnage_mt) * 100).toFixed(1)}%`
          : thisMonth.delivered_tonnage_mt > 0
            ? '+100%'
            : '0.0%';

      const comparison = {
        this_month: {
          month: thisMonth.month,
          month_name: thisMonth.month_name,
          status: 'In Progress (Month-to-Date)',
          delivered_tonnage_mt: thisMonth.delivered_tonnage_mt,
          orders_count: thisMonth.orders_count,
          total_revenue: thisMonth.total_revenue,
          top_customers: thisMonth.top_customers,
        },
        last_month: {
          month: lastMonth.month,
          month_name: lastMonth.month_name,
          status: 'Closed (Full Month)',
          delivered_tonnage_mt: lastMonth.delivered_tonnage_mt,
          orders_count: lastMonth.orders_count,
          total_revenue: lastMonth.total_revenue,
          top_customers: lastMonth.top_customers,
        },
        difference_tonnage_mt: diffTonnage,
        difference_orders_count: diffOrders,
        difference_revenue: diffRev,
        percentage_change_tonnage: pctChange,
        insights: `${thisMonth.month} is currently active with ${thisMonth.delivered_tonnage_mt} MT delivered across ${thisMonth.orders_count} orders MTD (Revenue: ₹${thisMonth.total_revenue.toLocaleString('en-IN')}), compared to ${lastMonth.delivered_tonnage_mt} MT across ${lastMonth.orders_count} orders in ${lastMonth.month}. Net difference: ${diffTonnage >= 0 ? '+' : ''}${diffTonnage} MT (${pctChange}).`,
      };

      return {
        data: {
          summary: {
            ...summary,
            trend_summary: trendSummary,
          },
          comparison,
          monthly_trend: cleanMonthlyTrend,
          top_delivered_customers: topCustomers,
          deals: filteredDeals.slice(0, limit),
        },
        rowCount: cleanMonthlyTrend.length,
      };
    }

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
