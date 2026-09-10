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
  if (lower === 'last_week') {
    const endOfLastWeek = new Date(now);
    endOfLastWeek.setDate(endOfLastWeek.getDate() - 7);
    endOfLastWeek.setHours(23, 59, 59, 999);
    const startOfLastWeek = new Date(now);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 14);
    startOfLastWeek.setHours(0, 0, 0, 0);
    return { from: startOfLastWeek, to: endOfLastWeek };
  }
  if (lower === 'this_month' || lower === 'month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: startOfMonth };
  }
  if (lower === 'last_month') {
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59,
      999,
    );
    return { from: startOfLastMonth, to: endOfLastMonth };
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
  outcome: 'positive' | 'neutral' | 'negative' | null;
  follow_up_action: string | null;
  requires_follow_up: boolean;
  material_requirement: string | null;
  location: string | null;
  interests: string | null;
  clean_remarks: string;
} {
  if (!remarks) {
    return {
      outcome: null,
      follow_up_action: null,
      requires_follow_up: false,
      material_requirement: null,
      location: null,
      interests: null,
      clean_remarks: '',
    };
  }

  // 1. Parse Outcome tag [Outcome: Positive | Neutral | Negative]
  let outcome: 'positive' | 'neutral' | 'negative' | null = null;
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
  if (!outcome) {
    const lowerRem = remarks.toLowerCase();
    if (
      /\b(?:negative|bad|rejected|rejection|unsuccessful|declined|not\s+(?:at\s+all\s+)?inter(?:e)?sted|uninterested|no\s+interest|not\s+buying|not\s+interested|no\s+(?:immediate\s+)?need|no\s+requirement|refused|unfavorable|dissatisfied|cancelled|lost)\b/i.test(
        lowerRem,
      ) ||
      /\b(?:nahi\s+chahiye|interest\s+nahi|mana\s+kar\s+diya|reject\s+hua)\b/i.test(
        lowerRem,
      )
    ) {
      outcome = 'negative';
    } else if (
      /\b(?:positive|went\s+well|good|great|successful|favorable|interested|keen|promising|order\s+confirmed|deal\s+done)\b/i.test(
        lowerRem,
      ) &&
      !/\b(?:not\s+|no\s+|nahi\s+)(?:positive|good|great|interested|keen|promising)\b/i.test(
        lowerRem,
      )
    ) {
      outcome = 'positive';
    } else if (
      /\b(?:neutral|routine|okay|ok|normal|general\s+visit|courtesy\s+visit|check-?in|introductory|introduction)\b/i.test(
        lowerRem,
      )
    ) {
      outcome = 'neutral';
    }
  }

  // 2. Parse Follow-up Action tag [FollowUp: ...] or [Follow-up: ...]
  let follow_up_action: string | null = null;
  let requires_follow_up = false;
  const followUpMatch = remarks.match(/\[Follow-?Up:\s*([^\]]+)\]/i);
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

  // 3. Parse Material Requirement tag [Requirement: ...] or [Material Requirements: ...]
  let material_requirement: string | null = null;
  const reqMatch = remarks.match(
    /\[(?:Material )?Requirements?:\s*([^\]]+)\]/i,
  );
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
      /\[(?:Outcome|Location|Follow-?Up|(?:Material )?Requirements?|Interests):[^\]]*\]\s*/gi,
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
    'READ-ONLY search tool: Retrieves past customer site visit logs, meeting outcomes (positive, neutral, negative), remarks, follow-up actions, salesperson visit leaderboard, week-over-week comparison, location filtering, missing fields filtering, and duplicate visits grouping from customer_visits (KRA 9). Scoped strictly by caller role. NEVER use to log or report a new visit!',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_visits',
    description:
      'READ-ONLY QUERY TOOL: Searches and lists past customer site visits and field visit reports. Use ONLY when the user asks to see, view, search, count, or list past visits (e.g. "Show my visits", "List visits in Mumbai", "How many visits did I do?"). NEVER call this tool when the user is reporting or logging a visit that took place (e.g. "Met [Name]...", "Visited [Company]...") — for reporting visits, call log_customer_visit instead.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: {
          type: 'STRING',
          description:
            'Optional filter by customer or company name (e.g. "Supreme Steel", "Tata").',
        },
        salesperson_name: {
          type: 'STRING',
          description:
            'Optional filter by sales representative name or phone (e.g. "Rishabh Makwana", "Max", "Akruti"). Scoped by caller role.',
        },
        location: {
          type: 'STRING',
          description:
            'Optional filter by visit city, region, or plant address (e.g. "Nashik", "Bhiwandi", "Pune", "Taloja", "Mumbai").',
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
        missing_field: {
          type: 'STRING',
          description:
            'Optional filter for incomplete visit logs: "location" (visits missing city/location) or "contact_person" (visits missing person met or contact phone).',
        },
        missing_location: {
          type: 'BOOLEAN',
          description:
            'Optional filter. When true, returns only visits where location was not recorded.',
        },
        missing_contact_person: {
          type: 'BOOLEAN',
          description:
            'Optional filter. When true, returns only visits where the contact person / person met was not recorded.',
        },
        date_range: {
          type: 'STRING',
          description:
            'Optional date filter. Valid values: "today", "yesterday", "this_week", "last_week", "this_month", "last_month", "all", or specific ISO date.',
        },
        mode: {
          type: 'STRING',
          description:
            'Query mode. Valid values: "list" (default), "summary", "rep_leaderboard" / "salesperson_leaderboard" (ranks reps by visits logged), "week_comparison" / "week_over_week" (this week vs last week comparative), "duplicates" / "duplicate_visits" (detects same-day visits to same customer).',
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
    const searchSalesperson = (args?.salesperson_name || '')
      .trim()
      .toLowerCase();
    const searchLocation = (args?.location || '').trim().toLowerCase();
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
    let missingLocationCount = 0;
    let missingContactPersonCount = 0;

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
      const rawOut =
        v.outcome &&
        ['positive', 'neutral', 'negative'].includes(
          v.outcome.toLowerCase().trim(),
        )
          ? v.outcome.toLowerCase().trim()
          : parsed.outcome;
      const out = rawOut || null;

      if (out && outcomeCounts[out] !== undefined) {
        outcomeCounts[out]++;
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

      const resolvedLoc =
        v.location || v.customer_address || parsed.location || null;
      if (!resolvedLoc) {
        missingLocationCount++;
      }

      const resolvedPerson = v.person_met || null;
      const resolvedContactPhone = v.contact_phone || v.contact_no || null;
      if (!resolvedPerson && !resolvedContactPhone) {
        missingContactPersonCount++;
      }

      return {
        id: v.id,
        customer_name: cName,
        person_met: resolvedPerson,
        contact_phone: resolvedContactPhone,
        location: resolvedLoc,
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

    // ─── Mode: Rep Leaderboard / Salesperson Rankings ───────────────────────
    const repStatsMap = new Map<string, any>();
    formattedList.forEach((v: any) => {
      const repKey = (v.salesperson_name || 'Assigned Rep')
        .toLowerCase()
        .trim();
      if (!repStatsMap.has(repKey)) {
        repStatsMap.set(repKey, {
          salesperson_name: v.salesperson_name || 'Sales Rep',
          salesperson_phone: v.salesperson_phone || '',
          total_visits: 0,
          positive_visits: 0,
          neutral_visits: 0,
          negative_visits: 0,
          requires_follow_up_count: 0,
          visited_customers: new Set<string>(),
        });
      }
      const st = repStatsMap.get(repKey);
      if (!st.salesperson_phone && v.salesperson_phone) {
        st.salesperson_phone = v.salesperson_phone;
      }
      st.total_visits++;
      if (v.outcome === 'positive') st.positive_visits++;
      else if (v.outcome === 'neutral') st.neutral_visits++;
      else if (v.outcome === 'negative') st.negative_visits++;

      if (v.requires_follow_up) st.requires_follow_up_count++;
      if (v.customer_name) st.visited_customers.add(v.customer_name);
    });

    const repLeaderboard = Array.from(repStatsMap.values())
      .map((r: any) => ({
        salesperson_name: r.salesperson_name,
        salesperson_phone: r.salesperson_phone,
        total_visits: r.total_visits,
        positive_visits: r.positive_visits,
        neutral_visits: r.neutral_visits,
        negative_visits: r.negative_visits,
        requires_follow_up_count: r.requires_follow_up_count,
        unique_customers_visited: r.visited_customers.size,
        positive_rate_percent:
          r.total_visits > 0
            ? `${((r.positive_visits / r.total_visits) * 100).toFixed(1)}%`
            : '0%',
      }))
      .sort((a, b) => b.total_visits - a.total_visits);

    const topRep = repLeaderboard[0] || null;

    if (
      mode === 'rep_leaderboard' ||
      mode === 'salesperson_leaderboard' ||
      mode === 'most_visits' ||
      mode === 'rep_ranking'
    ) {
      return {
        data: {
          summary: {
            total_visits: rawList.length,
            rep_visit_leaderboard: repLeaderboard,
            top_salesperson: topRep,
          },
          rep_visit_leaderboard: repLeaderboard,
          top_salesperson: topRep,
        },
        rowCount: repLeaderboard.length,
      };
    }

    // ─── Mode: Week-over-Week Comparison ───────────────────────────────────
    if (
      mode === 'week_comparison' ||
      mode === 'week_over_week' ||
      mode === 'weekly_comparison'
    ) {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);

      const thisWeekVisits = formattedList.filter((v: any) => {
        const d = new Date(v.visited_at);
        return d >= sevenDaysAgo && d <= now;
      });

      const lastWeekVisits = formattedList.filter((v: any) => {
        const d = new Date(v.visited_at);
        return d >= fourteenDaysAgo && d < sevenDaysAgo;
      });

      const countOutcomes = (list: any[]) => ({
        positive: list.filter((v) => v.outcome === 'positive').length,
        neutral: list.filter((v) => v.outcome === 'neutral').length,
        negative: list.filter((v) => v.outcome === 'negative').length,
        requires_follow_up: list.filter((v) => v.requires_follow_up).length,
      });

      const thisWeekOutcomes = countOutcomes(thisWeekVisits);
      const lastWeekOutcomes = countOutcomes(lastWeekVisits);

      const diff = thisWeekVisits.length - lastWeekVisits.length;
      const pctChange =
        lastWeekVisits.length > 0
          ? `${(((thisWeekVisits.length - lastWeekVisits.length) / lastWeekVisits.length) * 100).toFixed(1)}%`
          : 'N/A';

      const comparison = {
        this_week: {
          period: 'This Week (Last 7 Days)',
          total_visits: thisWeekVisits.length,
          daily_average: `${(thisWeekVisits.length / 7).toFixed(1)} visits/day`,
          outcomes: thisWeekOutcomes,
          sample_visits: thisWeekVisits.slice(0, 5),
        },
        last_week: {
          period: 'Last Week (Days 8-14)',
          total_visits: lastWeekVisits.length,
          daily_average: `${(lastWeekVisits.length / 7).toFixed(1)} visits/day`,
          outcomes: lastWeekOutcomes,
          sample_visits: lastWeekVisits.slice(0, 5),
        },
        difference: diff,
        percentage_change: pctChange,
        insights: `There have been ${thisWeekVisits.length} visits logged this week (~${(thisWeekVisits.length / 7).toFixed(1)} visits/day) compared to ${lastWeekVisits.length} visits logged last week (~${(lastWeekVisits.length / 7).toFixed(1)} visits/day). ${thisWeekOutcomes.positive} visits this week had a positive outcome and ${thisWeekOutcomes.requires_follow_up} require follow-up actions.`,
      };

      return {
        data: {
          comparison,
          summary: {
            total_visits: rawList.length,
            this_week_visits: thisWeekVisits.length,
            last_week_visits: lastWeekVisits.length,
            note: comparison.insights,
          },
        },
        rowCount: 2,
      };
    }

    // ─── Mode: Duplicate Visits Grouping ───────────────────────────────────
    if (mode === 'duplicates' || mode === 'duplicate_visits') {
      const groupsMap = new Map<string, any[]>();
      formattedList.forEach((v: any) => {
        const vDate = v.visited_at
          ? new Date(v.visited_at).toISOString().split('T')[0]
          : 'unknown_date';
        const key = `${v.customer_name.toLowerCase().trim()}::${vDate}`;
        if (!groupsMap.has(key)) {
          groupsMap.set(key, []);
        }
        groupsMap.get(key)!.push(v);
      });

      const duplicateGroups: any[] = [];
      let totalDuplicateVisitsCount = 0;

      for (const vList of groupsMap.values()) {
        if (vList.length > 1) {
          totalDuplicateVisitsCount += vList.length;
          const vDateStr = vList[0].visited_at
            ? new Date(vList[0].visited_at).toLocaleDateString('en-IN')
            : '-';
          duplicateGroups.push({
            customer_name: vList[0].customer_name,
            visit_date: vDateStr,
            duplicate_count: vList.length,
            salesperson_name: Array.from(
              new Set(vList.map((x) => x.salesperson_name)),
            ).join(', '),
            salesperson_phone: vList[0].salesperson_phone,
            sample_remarks: vList
              .map((x, i) => `Visit ${i + 1}: "${x.remarks || 'No remarks'}"`)
              .join(' | '),
            visit_ids: vList.map((x) => x.id),
          });
        }
      }

      duplicateGroups.sort((a, b) => b.duplicate_count - a.duplicate_count);

      return {
        data: {
          duplicate_visits_groups: duplicateGroups,
          total_duplicate_groups: duplicateGroups.length,
          total_duplicate_visits: totalDuplicateVisitsCount,
          summary: {
            total_visits: rawList.length,
            total_duplicate_groups: duplicateGroups.length,
            total_duplicate_visits: totalDuplicateVisitsCount,
            note: `Found ${duplicateGroups.length} customer instances where multiple visits (${totalDuplicateVisitsCount} total duplicate visit logs) occurred on the same calendar day.`,
          },
        },
        rowCount: duplicateGroups.length,
      };
    }

    // 4. Filtering
    let filteredList = formattedList;

    if (rawOutcome && rawOutcome !== 'all') {
      filteredList = filteredList.filter((v: any) => v.outcome === rawOutcome);
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

    // Salesperson filter & RBAC verification
    if (searchSalesperson) {
      if (isSalespersonRole(callerContext.role)) {
        const callerName = (callerContext.name || '').toLowerCase().trim();
        if (
          callerName &&
          !callerName.includes(searchSalesperson) &&
          !searchSalesperson.includes(callerName)
        ) {
          return {
            data: {
              notFound: true,
              summary: {
                total_visits: 0,
                filtered_visits_count: 0,
                message: `You do not have access to view visit logs for "${args.salesperson_name}". As a sales representative, you can only access visits for your own assigned accounts.`,
              },
              visits: [],
            },
            rowCount: 0,
          };
        }
      }

      filteredList = filteredList.filter((v: any) => {
        const sName = (v.salesperson_name || '').toLowerCase();
        const sPhone = (v.salesperson_phone || '').toLowerCase();
        return (
          sName.includes(searchSalesperson) ||
          sPhone.includes(searchSalesperson)
        );
      });
    }

    // Location filter
    if (searchLocation) {
      filteredList = filteredList.filter((v: any) => {
        const loc = (v.location || '').toLowerCase();
        const rem = (v.remarks || '').toLowerCase();
        return loc.includes(searchLocation) || rem.includes(searchLocation);
      });
    }

    // Missing location filter
    const filterMissingLocation =
      args?.missing_location === true ||
      args?.missing_field === 'location' ||
      args?.without_location === true;
    if (filterMissingLocation) {
      filteredList = filteredList.filter((v: any) => {
        return (
          !v.location && !(v.remarks || '').toLowerCase().includes('[location:')
        );
      });
    }

    // Missing contact person filter
    const filterMissingContact =
      args?.missing_contact_person === true ||
      args?.missing_field === 'contact_person' ||
      args?.missing_contact === true;
    if (filterMissingContact) {
      filteredList = filteredList.filter((v: any) => {
        return !v.person_met && !v.contact_phone;
      });
    }

    const topCustomers = Object.entries(customerVisitCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([customer, count]) => ({ customer, visits_count: count }));

    let filterNote = '';
    if (filterMissingLocation) {
      filterNote = `Showing ${filteredList.length} visits where location/city was not recorded.`;
    } else if (filterMissingContact) {
      filterNote = `Showing ${filteredList.length} visits where the contact person / person met was not recorded.`;
    } else if (searchLocation) {
      filterNote = `Showing ${filteredList.length} visits located in ${args.location}.`;
    } else if (searchSalesperson) {
      filterNote = `Showing ${filteredList.length} visits handled by ${args.salesperson_name}.`;
    }

    const summary = {
      total_visits: rawList.length,
      filtered_visits_count: filteredList.length,
      visits_today: visitsTodayCount,
      visits_requiring_follow_up: followUpCount,
      visits_missing_location_count: missingLocationCount,
      visits_missing_contact_person_count: missingContactPersonCount,
      by_outcome: outcomeCounts,
      top_visited_customers: topCustomers,
      top_salesperson: topRep,
      multiple_visits_for_customer: Boolean(
        searchCustomer && filteredList.length > 1,
      ),
      customer_visits_breakdown:
        searchCustomer && filteredList.length > 1
          ? filteredList
              .map(
                (v, i) =>
                  `${i + 1}. Date: ${v.visited_at ? new Date(v.visited_at).toLocaleDateString('en-IN') : 'N/A'}, Outcome: ${v.outcome || 'Not recorded'}, Contact: ${v.person_met || 'Not recorded'}`,
              )
              .join(' | ')
          : undefined,
      note: filterNote || undefined,
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
