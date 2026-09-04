import {
  ChatbotTool,
  CallerContext,
  getSubordinateSalespersons,
  isManagerRole,
  isSalespersonRole,
} from './chatbot-tool.interface';

export const getMyOpenDealsTool: ChatbotTool = {
  name: 'get_my_open_deals',
  description:
    'Fetches deals (negotiations, quotations, review, won, or lost) scoped strictly by caller role. Always returns total pipeline values, exact stage-by-stage counts and values (including total won deal value), and human-readable Inquiry IDs matching the UI (#INQ-XXXXXX).',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_my_open_deals',
    description:
      'Retrieves deals for the authenticated user based on role scope. Always returns pipeline value sums, stage-by-stage totals (e.g. won deals total value), and human-readable Inquiry IDs (INQ-XXXXXX). Valid stage_filter values: "all", "won", "quoted", "negotiation", "review", "qualified", "lost".',
    parameters: {
      type: 'OBJECT',
      properties: {
        stage_filter: {
          type: 'STRING',
          description:
            'Optional filter by deal stage. Valid values: "all", "won", "quoted", "negotiation", "review", "qualified", "lost". Default is "all".',
        },
        customer_name: {
          type: 'STRING',
          description: 'Optional search filter for customer or company name.',
        },
        mode: {
          type: 'STRING',
          description:
            'Query mode: "list" (default, returns records with summary), "summary" (returns only pipeline sums and stage breakdown).',
        },
        limit: {
          type: 'INTEGER',
          description:
            'Maximum number of deals to return in list (default: 20, max: 100).',
        },
      },
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    let rawStage = (args?.stage_filter || '').toLowerCase().trim();
    const searchCustomer = (args?.customer_name || '').trim().toLowerCase();
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
    }

    let query = supabaseAdmin
      .from('deals')
      .select(
        'id, customer_name, customer_phone, customer_gst, customer_address, payment_terms, total_amount, stage, status, po_number, created_at, salesperson_phone, employee_id, deal_items(sku_text, quantity, unit, rate, amount)',
      )
      .order('created_at', { ascending: false });

    // 1. Role-based scoping (Layer 1 enforcement)
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
              stage_breakdown: {},
              won_deals_total_value: 0,
            },
            deals: [],
          },
          rowCount: 0,
        };
      }

      query = query.or(conditions.join(','));
    }
    // Admin role receives no filtering (unfiltered view)

    const { data, error } = await query;
    if (error) {
      throw new Error(`get_my_open_deals error: ${error.message}`);
    }

    const allDeals = data || [];

    // 2. Compute Global Summary Statistics across all scoped deals
    const stageSummary: Record<string, { count: number; total_value: number }> =
      {};
    let totalPipelineVal = 0;
    let wonTotalVal = 0;
    let wonCount = 0;
    let lostCount = 0;

    const formattedDeals = allDeals.map((d: any) => {
      const st = (d.stage || 'new_inquiry').toLowerCase().trim();
      const amount = Number(d.total_amount) || 0;

      if (!stageSummary[st]) {
        stageSummary[st] = { count: 0, total_value: 0 };
      }
      stageSummary[st].count++;
      stageSummary[st].total_value += amount;

      totalPipelineVal += amount;
      if (st === 'won') {
        wonTotalVal += amount;
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
        payment_terms: d.payment_terms || null,
        total_amount: amount,
        stage: d.stage || 'new_inquiry',
        status: d.status || 'review',
        po_number: d.po_number || null,
        created_at: d.created_at,
        salesperson_phone: d.salesperson_phone || '',
        deal_items: d.deal_items || [],
      };
    });

    // 3. Filter by stage if requested
    let filteredDeals = formattedDeals;

    if (rawStage && rawStage !== 'all') {
      filteredDeals = filteredDeals.filter((d) =>
        d.stage.toLowerCase().includes(rawStage),
      );
    } else if (!rawStage) {
      // Default view when no stage is specified: exclude lost deals
      filteredDeals = filteredDeals.filter((d) => d.stage !== 'lost');
    }

    // Filter by customer name search
    if (searchCustomer) {
      filteredDeals = filteredDeals.filter((d) =>
        d.customer_name.toLowerCase().includes(searchCustomer),
      );
    }

    const filteredTotalVal = filteredDeals.reduce(
      (sum, d) => sum + d.total_amount,
      0,
    );

    const summary = {
      total_deals_count: allDeals.length,
      total_pipeline_value: totalPipelineVal,
      stage_breakdown: stageSummary,
      won_deals_total_value: wonTotalVal,
      filtered_deals_count: filteredDeals.length,
      filtered_deals_total_value: filteredTotalVal,
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
