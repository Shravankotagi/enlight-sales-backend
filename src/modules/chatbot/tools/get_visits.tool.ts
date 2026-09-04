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

export function parseVisitRemarks(remarks?: string | null): {
  outcome: 'positive' | 'neutral' | 'negative';
  follow_up_action: string | null;
  requires_follow_up: boolean;
  material_requirement: string | null;
  location: string | null;
  interests: string | null;
  clean_remarks: string;
} {
  if (!remarks) {
    return {
      outcome: 'neutral',
      follow_up_action: null,
      requires_follow_up: false,
      material_requirement: null,
      location: null,
      interests: null,
      clean_remarks: '',
    };
  }

  // 1. Parse Outcome tag [Outcome: Positive | Neutral | Negative]
  let outcome: 'positive' | 'neutral' | 'negative' = 'neutral';
  const outcomeMatch = remarks.match(/\[Outcome:\s*([^\]]+)\]/i);
  if (outcomeMatch) {
    const rawOut = outcomeMatch[1].toLowerCase().trim();
    if (
      rawOut === 'positive' ||
      rawOut === 'negative' ||
      rawOut === 'neutral'
    ) {
      outcome = rawOut;
    }
  }

  // 2. Parse Follow-up Action tag [FollowUp: ...]
  let follow_up_action: string | null = null;
  let requires_follow_up = false;
  const followUpMatch = remarks.match(/\[FollowUp:\s*([^\]]+)\]/i);
  if (followUpMatch) {
    const text = followUpMatch[1].trim();
    if (
      text &&
      !text.toLowerCase().startsWith('no remarks') &&
      !text.toLowerCase().startsWith('rer') &&
      text.toLowerCase() !== 'none'
    ) {
      follow_up_action = text;
      requires_follow_up = true;
    }
  }

  // 3. Parse Material Requirement tag [Requirement: ...]
  let material_requirement: string | null = null;
  const reqMatch = remarks.match(/\[Requirement:\s*([^\]]+)\]/i);
  if (reqMatch) {
    material_requirement = reqMatch[1].trim();
  }

  // 4. Parse Location tag [Location: ...]
  let location: string | null = null;
  const locMatch = remarks.match(/\[Location:\s*([^\]]+)\]/i);
  if (locMatch) {
    location = locMatch[1].trim();
  }

  // 5. Parse Interests tag [Interests: ...]
  let interests: string | null = null;
  const intMatch = remarks.match(/\[Interests:\s*([^\]]+)\]/i);
  if (intMatch) {
    interests = intMatch[1].trim();
  }

  // 6. Clean Remarks by removing metadata bracket tags
  const clean_remarks = remarks
    .replace(
      /\[(?:Outcome|Location|FollowUp|Requirement|Interests):[^\]]*\]\s*/gi,
      '',
    )
    .trim();

  return {
    outcome,
    follow_up_action,
    requires_follow_up,
    material_requirement,
    location,
    interests,
    clean_remarks,
  };
}

export const getVisitsTool: ChatbotTool = {
  name: 'get_visits',
  description:
    'Retrieves customer site visit logs, meeting outcomes (positive, neutral, negative), remarks, and follow-up actions from customer_visits (KRA 9). Can filter by outcome (positive/neutral/negative), requires_follow_up (true/false for visits requiring follow-up), customer name, or date range. Scoped strictly by caller role.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_visits',
    description:
      'Retrieves customer site visits and field visit reports. Can filter by customer name, outcome (positive/neutral/negative), requires_follow_up (true for visits needing follow-up actions), or date range (today, this_week, this_month). Scoped by caller role.',
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
        requires_follow_up: {
          type: 'BOOLEAN',
          description:
            'Optional filter. When true, returns only visits that require follow-up actions or remarks.',
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

    const requiresFollowUp =
      args?.requires_follow_up === true ||
      args?.follow_up === true ||
      args?.follow_up_only === true;

    // 3. Compute Summary Aggregations
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let visitsTodayCount = 0;
    let followUpCount = 0;
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

      const parsed = parseVisitRemarks(v.remarks);
      const out =
        v.outcome &&
        ['positive', 'neutral', 'negative'].includes(
          v.outcome.toLowerCase().trim(),
        )
          ? v.outcome.toLowerCase().trim()
          : parsed.outcome;

      if (outcomeCounts[out] !== undefined) {
        outcomeCounts[out]++;
      } else {
        outcomeCounts[out] = 1;
      }

      const followUpAction =
        v.follow_up_action || v.follow_up || parsed.follow_up_action;
      const needsFollowUp =
        parsed.requires_follow_up || Boolean(v.follow_up_action || v.follow_up);
      if (needsFollowUp) {
        followUpCount++;
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
        location: v.location || v.customer_address || parsed.location || null,
        outcome: out,
        visited_at: v.visited_at || v.created_at,
        remarks: parsed.clean_remarks || v.remarks || null,
        material_requirement:
          v.material_requirement ||
          v.requirement ||
          parsed.material_requirement ||
          null,
        follow_up_action: followUpAction,
        requires_follow_up: needsFollowUp,
        salesperson_name: repName,
        salesperson_phone: v.salesperson_phone || '',
      };
    });

    // 4. Filtering
    let filteredList = formattedList;

    if (rawOutcome && rawOutcome !== 'all') {
      filteredList = filteredList.filter((v: any) =>
        v.outcome.toLowerCase().includes(rawOutcome),
      );
    }

    if (requiresFollowUp) {
      filteredList = filteredList.filter((v: any) => v.requires_follow_up);
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
              visits_requiring_follow_up: 0,
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
      visits_requiring_follow_up: followUpCount,
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
