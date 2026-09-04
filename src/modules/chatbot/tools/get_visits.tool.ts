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

export const getVisitsTool: ChatbotTool = {
  name: 'get_visits',
  description:
    'Retrieves customer site visit logs, meeting outcomes, remarks, and follow-up actions from customer_visits (KRA 9). Returns summary counts by outcome (positive, neutral, negative), today visits, top visited customers, and itemized records. Scoped strictly by caller role.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_visits',
    description:
      'Retrieves customer site visits and field visit reports. Can filter by customer name, outcome (positive/neutral/negative), or date range (today, this_week, this_month). Scoped by caller role.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: {
          type: 'STRING',
          description:
            'Optional filter by customer or company name (e.g. "Supreme Steel", "Tata").',
        },
        outcome: {
          type: 'STRING',
          description:
            'Optional filter by meeting outcome. Valid values: "all", "positive", "neutral", "negative". Default is "all".',
        },
        date_range: {
          type: 'STRING',
          description:
            'Optional date filter. Valid values: "today", "yesterday", "this_week", "this_month", "all", or specific ISO date.',
        },
        mode: {
          type: 'STRING',
          description:
            'Query mode. Valid values: "list" (default, returns records with summary), "summary" (returns only counts and statistics).',
        },
        limit: {
          type: 'INTEGER',
          description:
            'Maximum number of visits to return in list mode (default: 20, max: 100).',
        },
      },
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    const searchCustomer = (args?.customer_name || '').trim().toLowerCase();
    const rawOutcome = (args?.outcome || '').toLowerCase().trim();
    const dateRange = args?.date_range;
    const mode = (args?.mode || 'list').toLowerCase().trim();
    const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 100);

    let query = supabaseAdmin
      .from('customer_visits')
      .select('*')
      .order('visited_at', { ascending: false });

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
              total_visits: 0,
              filtered_visits_count: 0,
              message: 'Access denied. Caller identity could not be verified.',
            },
            visits: [],
          },
          rowCount: 0,
        };
      }
    } else if (isManagerRole(callerContext.role)) {
      const { phoneSuffixes, employeeIds } = await getSubordinateSalespersons(
        callerContext,
        supabaseAdmin,
      );

      const orConditions: string[] = [];
      phoneSuffixes.forEach((p) => {
        orConditions.push(`salesperson_phone.ilike.%${p}%`);
      });
      employeeIds.forEach((id) => {
        orConditions.push(`employee_id.eq.${id}`);
      });

      if (orConditions.length === 0) {
        return {
          data: {
            summary: {
              total_visits: 0,
              visits_today: 0,
              by_outcome: { positive: 0, neutral: 0, negative: 0 },
              top_visited_customers: [],
            },
            visits: [],
          },
          rowCount: 0,
        };
      }

      query = query.or(orConditions.join(','));
    }
    // Admin role receives unfiltered data

    // 2. Date filtering
    const { from, to } = parseDateFilter(dateRange);
    if (from) {
      query = query.gte('visited_at', from.toISOString());
    }
    if (to) {
      query = query.lte('visited_at', to.toISOString());
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`get_visits error: ${error.message}`);
    }

    const rawList = data || [];

    // Fetch employee names to map salesperson_phone -> name
    const { data: employees } = await supabaseAdmin
      .from('employees')
      .select('name, phone');

    const empMap = new Map<string, string>();
    (employees || []).forEach((e: any) => {
      if (e.phone) {
        const clean = e.phone.replace(/\D/g, '').slice(-10);
        if (clean) empMap.set(clean, e.name);
      }
    });

    // 3. Compute Summary Aggregations
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let visitsTodayCount = 0;
    const outcomeCounts: Record<string, number> = {
      positive: 0,
      neutral: 0,
      negative: 0,
    };
    const customerVisitCounts: Record<string, number> = {};

    const formattedList = rawList.map((v: any) => {
      const vDate = new Date(v.visited_at || v.created_at);
      if (vDate >= startOfToday) {
        visitsTodayCount++;
      }

      const out = (v.outcome || 'neutral').toLowerCase().trim();
      if (outcomeCounts[out] !== undefined) {
        outcomeCounts[out]++;
      } else {
        outcomeCounts[out] = 1;
      }

      const cName = v.customer_name || 'Unnamed Customer';
      customerVisitCounts[cName] = (customerVisitCounts[cName] || 0) + 1;

      const rawPhone = v.salesperson_phone || '';
      const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
      const repName =
        empMap.get(cleanPhone) || v.salesperson_name || 'Assigned Rep';

      return {
        id: v.id,
        customer_name: cName,
        person_met: v.person_met || null,
        contact_phone: v.contact_phone || v.contact_no || null,
        location: v.location || v.customer_address || null,
        outcome: out,
        visited_at: v.visited_at || v.created_at,
        remarks: v.remarks || v.raw_remarks || null,
        material_requirement: v.material_requirement || v.requirement || null,
        follow_up_action:
          v.follow_up_action || v.follow_up || v.followup || null,
        salesperson_name: repName,
        salesperson_phone: v.salesperson_phone || '',
      };
    });

    // 4. Filtering
    let filteredList = formattedList;

    if (rawOutcome && rawOutcome !== 'all') {
      filteredList = filteredList.filter((v: any) =>
        v.outcome.includes(rawOutcome),
      );
    }

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
              total_visits: 0,
              filtered_visits_count: 0,
              message: access.message,
            },
            visits: [],
          },
          rowCount: 0,
        };
      }

      filteredList = filteredList.filter((v: any) =>
        v.customer_name.toLowerCase().includes(searchCustomer),
      );
    }

    const topCustomers = Object.entries(customerVisitCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([customer, count]) => ({ customer, visits_count: count }));

    const summary = {
      total_visits: rawList.length,
      filtered_visits_count: filteredList.length,
      visits_today: visitsTodayCount,
      by_outcome: outcomeCounts,
      top_visited_customers: topCustomers,
    };

    if (mode === 'summary' || mode === 'count') {
      return {
        data: { summary },
        rowCount: filteredList.length,
      };
    }

    const paginatedVisits = filteredList.slice(0, limit);

    return {
      data: {
        summary,
        visits: paginatedVisits,
      },
      rowCount: paginatedVisits.length,
    };
  },
};
