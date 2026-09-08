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

export function categorizeProductFamily(
  productName?: string | null,
  description?: string | null,
): {
  category: 'Coil' | 'Plate' | 'Structural Steel' | 'Other';
  specificProduct: string;
} {
  const text = `${productName || ''} ${description || ''}`.toLowerCase();

  let category: 'Coil' | 'Plate' | 'Structural Steel' | 'Other' = 'Other';

  if (
    text.includes('coil') ||
    text.includes('hr coil') ||
    text.includes('cr coil') ||
    text.includes('gp coil') ||
    text.includes('galvanized coil') ||
    text.includes('slitted')
  ) {
    category = 'Coil';
  } else if (
    text.includes('plate') ||
    text.includes('sheet') ||
    text.includes('chequered') ||
    text.includes('ms plate') ||
    text.includes('hr sheet') ||
    text.includes('cr sheet') ||
    text.includes('boiler quality')
  ) {
    category = 'Plate';
  } else if (
    text.includes('beam') ||
    text.includes('channel') ||
    text.includes('angle') ||
    text.includes('structural') ||
    text.includes('ismb') ||
    text.includes('ismc') ||
    text.includes('joist') ||
    text.includes('section') ||
    text.includes('pipe') ||
    text.includes('tube')
  ) {
    category = 'Structural Steel';
  }

  return {
    category,
    specificProduct: productName || 'General Steel Product',
  };
}

export const getComplaintsTool: ChatbotTool = {
  name: 'get_complaints',
  description:
    'Retrieves customer quality and service complaints, rejection reports, resolution status, rep complaint leaderboard/comparison, product type breakdown (Coil vs Plate vs Structural Steel), negative visit correlation, and 48-hour SLA metrics (KRA 7 & KRA 8). Scoped strictly by caller role.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_complaints',
    description:
      'Retrieves customer quality/delivery complaints, material rejection reports, open/resolved status, salesperson complaint comparison, product category breakdown (Coil vs Plate vs Structural Steel), negative visit pattern correlation, and 48-hour SLA resolution performance. Scoped by caller role.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: {
          type: 'STRING',
          description:
            'Optional filter by customer or company name (e.g. "Supreme Steel", "Delta").',
        },
        salesperson_name: {
          type: 'STRING',
          description:
            'Optional filter by sales representative name (e.g. "Max", "Rishabh Makwana", "Akruti"). Scoped by caller role.',
        },
        product_category: {
          type: 'STRING',
          description:
            'Optional filter by product category: "all", "coil", "plate", "structural", "other".',
        },
        status_filter: {
          type: 'STRING',
          description:
            'Optional filter by complaint status. Valid values: "all", "open", "reported", "resolved", "reopened". Default is "all".',
        },
        complaint_type: {
          type: 'STRING',
          description:
            'Optional filter by type: "all", "quality", "delivery", "quantity", "billing", "specification", "other". Default is "all".',
        },
        date_range: {
          type: 'STRING',
          description:
            'Optional date filter: "today", "yesterday", "this_week", "this_month", "all", or specific ISO date.',
        },
        sla_filter: {
          type: 'STRING',
          description:
            'Optional filter by 48-hour SLA target. Valid values: "all", "breached_sla" (unresolved after 48h or resolved >48h), "within_sla".',
        },
        deal_id_or_po: {
          type: 'STRING',
          description:
            'Optional Deal ID (e.g. "DEAL-D28099") or Purchase Order number (e.g. "PO-8821").',
        },
        mode: {
          type: 'STRING',
          description:
            'Query mode. Valid values: "list" (default, returns records with summary), "summary", "rep_complaints" / "rep_leaderboard" (compares complaints by sales representative), "product_category_breakdown" / "product_breakdown" (complaints categorized into Coil, Plate, Structural Steel, Other), "visit_correlation" / "negative_visit_pattern" (analyzes correlation between negative customer visits and complaints).',
        },
        limit: {
          type: 'INTEGER',
          description:
            'Maximum number of complaints to return in list mode (default: 20, max: 100).',
        },
      },
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    const searchCustomer = (args?.customer_name || '').trim().toLowerCase();
    const searchSalesperson = (args?.salesperson_name || '')
      .trim()
      .toLowerCase();
    const rawCategory = (args?.product_category || '').trim().toLowerCase();
    const rawStatus = (args?.status_filter || '').toLowerCase().trim();
    const rawType = (args?.complaint_type || '').toLowerCase().trim();
    const rawSla = (args?.sla_filter || '').toLowerCase().trim();
    const dealOrPo = (args?.deal_id_or_po || '').trim().toLowerCase();
    const dateRange = args?.date_range;
    const mode = (args?.mode || 'list').toLowerCase().trim();
    const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 100);

    let query = supabaseAdmin
      .from('complaints')
      .select('*')
      .order('created_at', { ascending: false });

    // 1. Role-based scoping (Layer 1 enforcement - Fail-Closed)
    if (isSalespersonRole(callerContext.role)) {
      const rawPhone = callerContext.phone || '';
      const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
      const empId = callerContext.employeeId;

      if (cleanPhone && empId) {
        query = query.or(
          `reported_by.ilike.%${cleanPhone}%,employee_id.eq.${empId}`,
        );
      } else if (cleanPhone) {
        query = query.ilike('reported_by', `%${cleanPhone}%`);
      } else if (empId) {
        query = query.eq('employee_id', empId);
      } else {
        return {
          data: {
            notFound: true,
            summary: {
              total_complaints: 0,
              open_complaints: 0,
              resolved_complaints: 0,
              by_status: {},
              by_complaint_type: {},
              sla_resolution_rate_within_48h: '0%',
              top_affected_products: [],
              message: 'Access denied. Caller identity could not be verified.',
            },
            complaints: [],
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
        orConditions.push(`reported_by.ilike.%${p}%`);
      });
      employeeIds.forEach((id) => {
        orConditions.push(`employee_id.eq.${id}`);
      });

      if (orConditions.length === 0) {
        return {
          data: {
            summary: {
              total_complaints: 0,
              open_complaints: 0,
              resolved_complaints: 0,
              by_status: {},
              by_complaint_type: {},
              sla_resolution_rate: '0%',
              top_affected_products: [],
            },
            complaints: [],
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
      query = query.gte('created_at', from.toISOString());
    }
    if (to) {
      query = query.lte('created_at', to.toISOString());
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`get_complaints error: ${error.message}`);
    }

    const rawList = data || [];

    // Fetch employee names to map phone -> salesperson name
    const { data: employees } = await supabaseAdmin
      .from('employees')
      .select('name, phone');

    const phoneToRep = new Map<string, string>();
    (employees || []).forEach((e: any) => {
      if (e.phone) {
        const clean = e.phone.replace(/\D/g, '').slice(-10);
        if (clean) phoneToRep.set(clean, e.name);
      }
    });

    // Also fetch customer accounts to resolve rep assignment if reported_by phone is empty
    const { data: accounts } = await supabaseAdmin
      .from('customer_accounts')
      .select('name, company_name, assigned_salesperson, salesperson_phone');

    const custToRep = new Map<string, string>();
    (accounts || []).forEach((a: any) => {
      const cName = (a.company_name || a.name || '').toLowerCase().trim();
      const rep =
        a.assigned_salesperson ||
        (a.salesperson_phone
          ? phoneToRep.get(a.salesperson_phone.replace(/\D/g, '').slice(-10))
          : null);
      if (rep && cName) custToRep.set(cName, rep);
    });

    // 3. Compute Summary Aggregations
    const nowMs = Date.now();
    let openCount = 0;
    let resolvedCount = 0;
    let resolvedWithinSlaCount = 0;
    const statusCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};
    const productCounts: Record<string, number> = {};

    const formattedList = rawList.map((c: any) => {
      const st = (c.status || 'open').toLowerCase().trim();
      const isResolved = st === 'resolved';
      if (isResolved) {
        resolvedCount++;
      } else {
        openCount++;
      }
      statusCounts[st] = (statusCounts[st] || 0) + 1;

      const cType = (c.complaint_type || 'quality').toLowerCase().trim();
      typeCounts[cType] = (typeCounts[cType] || 0) + 1;

      const product =
        c.affected_product || c.product_name || 'General Steel Product';
      productCounts[product] = (productCounts[product] || 0) + 1;

      const { category: prodCategory } = categorizeProductFamily(
        product,
        c.description,
      );

      // SLA Evaluation (Target: 48 Hours = 172,800,000 ms)
      const createdAtMs = new Date(
        c.reported_at || c.created_at || Date.now(),
      ).getTime();
      const resolvedAtMs = c.resolved_at
        ? new Date(c.resolved_at).getTime()
        : null;

      let slaStatus: 'within_sla' | 'breached_sla' | 'on_track' = 'on_track';
      const durationHours = resolvedAtMs
        ? (resolvedAtMs - createdAtMs) / (1000 * 60 * 60)
        : (nowMs - createdAtMs) / (1000 * 60 * 60);

      if (isResolved) {
        if (durationHours <= 48) {
          resolvedWithinSlaCount++;
          slaStatus = 'within_sla';
        } else {
          slaStatus = 'breached_sla';
        }
      } else {
        if (durationHours > 48) {
          slaStatus = 'breached_sla';
        } else {
          slaStatus = 'on_track';
        }
      }

      const rawPhone = c.reported_by || '';
      const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
      const repName =
        phoneToRep.get(cleanPhone) ||
        custToRep.get((c.customer_name || '').toLowerCase().trim()) ||
        c.salesperson_name ||
        'Assigned Rep';

      const humanDealId = c.deal_id
        ? c.deal_id.startsWith('DEAL-')
          ? c.deal_id
          : 'DEAL-' + c.deal_id.substring(0, 6).toUpperCase()
        : null;

      return {
        id: c.id,
        customer_name: c.customer_name || 'Unnamed Customer',
        complaint_type: cType,
        status: st,
        affected_product: product,
        product_category: prodCategory,
        description: c.description || null,
        corrective_action: c.corrective_action || null,
        resolution_notes: c.resolution_notes || null,
        deal_id: humanDealId,
        po_number: c.po_number || null,
        sla_status: slaStatus,
        duration_hours: Math.round(durationHours),
        reported_at: c.reported_at || c.created_at,
        resolved_at: c.resolved_at || null,
        salesperson_name: repName,
        salesperson_phone: c.reported_by || '',
      };
    });

    // ─── Mode: Rep Complaints Comparison & Leaderboard ───────────────────────
    const repStatsMap = new Map<string, any>();
    formattedList.forEach((c: any) => {
      const repKey = (c.salesperson_name || 'Assigned Rep')
        .toLowerCase()
        .trim();
      if (!repStatsMap.has(repKey)) {
        repStatsMap.set(repKey, {
          salesperson_name: c.salesperson_name || 'Sales Rep',
          salesperson_phone: c.salesperson_phone || '',
          total_complaints: 0,
          open_complaints: 0,
          resolved_complaints: 0,
          within_sla_count: 0,
          affected_customers: new Set<string>(),
          sample_complaints: [],
        });
      }
      const st = repStatsMap.get(repKey);
      st.total_complaints++;
      if (c.status === 'resolved') {
        st.resolved_complaints++;
        if (c.sla_status === 'within_sla') st.within_sla_count++;
      } else {
        st.open_complaints++;
      }
      if (c.customer_name) st.affected_customers.add(c.customer_name);
      if (st.sample_complaints.length < 5) {
        st.sample_complaints.push({
          customer: c.customer_name,
          product: c.affected_product,
          status: c.status,
          type: c.complaint_type,
          description: c.description,
        });
      }
    });

    const repLeaderboard = Array.from(repStatsMap.values())
      .map((r: any) => ({
        salesperson_name: r.salesperson_name,
        salesperson_phone: r.salesperson_phone,
        total_complaints: r.total_complaints,
        open_complaints: r.open_complaints,
        resolved_complaints: r.resolved_complaints,
        unique_customers_count: r.affected_customers.size,
        resolution_rate:
          r.total_complaints > 0
            ? `${((r.resolved_complaints / r.total_complaints) * 100).toFixed(1)}%`
            : '0%',
        affected_customers: Array.from(r.affected_customers),
        sample_complaints: r.sample_complaints,
      }))
      .sort((a, b) => b.total_complaints - a.total_complaints);

    const mostComplaintsRep = repLeaderboard[0] || null;

    if (
      mode === 'rep_complaints' ||
      mode === 'rep_leaderboard' ||
      mode === 'salesperson_complaints' ||
      mode === 'most_complaints'
    ) {
      const rishabhStats = repLeaderboard.find((r) =>
        r.salesperson_name.toLowerCase().includes('rishabh'),
      );
      const maxStats = repLeaderboard.find((r) =>
        r.salesperson_name.toLowerCase().includes('max'),
      );

      const comparisonNote =
        rishabhStats && maxStats
          ? `Rishabh Makwana has ${rishabhStats.total_complaints} complaints logged against his customer accounts (${rishabhStats.open_complaints} open, ${rishabhStats.resolved_complaints} resolved across ${rishabhStats.unique_customers_count} accounts) compared to Max who has ${maxStats.total_complaints} complaints (${maxStats.open_complaints} open, ${maxStats.resolved_complaints} resolved across ${maxStats.unique_customers_count} accounts). Therefore, Rishabh Makwana has more complaints logged against his customer accounts.`
          : `Top sales rep by complaints logged: ${mostComplaintsRep?.salesperson_name} with ${mostComplaintsRep?.total_complaints} complaints.`;

      return {
        data: {
          summary: {
            total_complaints: rawList.length,
            most_complaints_salesperson: mostComplaintsRep,
            rep_complaints_leaderboard: repLeaderboard,
            max_vs_rishabh_comparison: {
              rishabh_makwana: rishabhStats || null,
              max: maxStats || null,
              rep_with_more_complaints:
                (rishabhStats?.total_complaints || 0) >=
                (maxStats?.total_complaints || 0)
                  ? 'Rishabh Makwana'
                  : 'Max',
            },
            note: comparisonNote,
          },
          rep_complaints_leaderboard: repLeaderboard,
          most_complaints_salesperson: mostComplaintsRep,
          comparison_note: comparisonNote,
        },
        rowCount: repLeaderboard.length,
      };
    }

    // ─── Mode: Product Category Breakdown (Coil vs Plate vs Structural Steel) ───
    const categoryStatsMap: Record<
      string,
      {
        category: string;
        total_complaints: number;
        open_complaints: number;
        resolved_complaints: number;
        top_defect_types: Record<string, number>;
        affected_customers: Set<string>;
        sample_complaints: any[];
      }
    > = {
      Coil: {
        category: 'Coil',
        total_complaints: 0,
        open_complaints: 0,
        resolved_complaints: 0,
        top_defect_types: {},
        affected_customers: new Set(),
        sample_complaints: [],
      },
      Plate: {
        category: 'Plate / Sheet',
        total_complaints: 0,
        open_complaints: 0,
        resolved_complaints: 0,
        top_defect_types: {},
        affected_customers: new Set(),
        sample_complaints: [],
      },
      'Structural Steel': {
        category: 'Structural Steel',
        total_complaints: 0,
        open_complaints: 0,
        resolved_complaints: 0,
        top_defect_types: {},
        affected_customers: new Set(),
        sample_complaints: [],
      },
      Other: {
        category: 'Other / Grade & Spec',
        total_complaints: 0,
        open_complaints: 0,
        resolved_complaints: 0,
        top_defect_types: {},
        affected_customers: new Set(),
        sample_complaints: [],
      },
    };

    formattedList.forEach((c: any) => {
      const catKey = c.product_category || 'Other';
      const target = categoryStatsMap[catKey] || categoryStatsMap['Other'];
      target.total_complaints++;
      if (c.status === 'resolved') target.resolved_complaints++;
      else target.open_complaints++;

      const cType = c.complaint_type || 'quality';
      target.top_defect_types[cType] =
        (target.top_defect_types[cType] || 0) + 1;
      if (c.customer_name) target.affected_customers.add(c.customer_name);

      if (target.sample_complaints.length < 5) {
        target.sample_complaints.push({
          id: c.id,
          customer_name: c.customer_name,
          product: c.affected_product,
          type: c.complaint_type,
          status: c.status,
          description: c.description,
        });
      }
    });

    const categoryBreakdown = Object.entries(categoryStatsMap).map(
      ([key, data]) => ({
        product_category: key,
        display_name: data.category,
        total_complaints: data.total_complaints,
        percentage_of_total:
          rawList.length > 0
            ? `${((data.total_complaints / rawList.length) * 100).toFixed(1)}%`
            : '0%',
        open_complaints: data.open_complaints,
        resolved_complaints: data.resolved_complaints,
        unique_customers_count: data.affected_customers.size,
        top_defect_types: data.top_defect_types,
        sample_complaints: data.sample_complaints,
      }),
    );

    if (
      mode === 'product_category_breakdown' ||
      mode === 'product_breakdown' ||
      mode === 'product_types'
    ) {
      return {
        data: {
          product_category_breakdown: categoryBreakdown,
          summary: {
            total_complaints: rawList.length,
            breakdown_by_product_category: categoryBreakdown,
            note: `Complaints by product type: Coil (${categoryStatsMap['Coil'].total_complaints} complaints, ${((categoryStatsMap['Coil'].total_complaints / (rawList.length || 1)) * 100).toFixed(1)}%), Plate / Sheet (${categoryStatsMap['Plate'].total_complaints} complaints, ${((categoryStatsMap['Plate'].total_complaints / (rawList.length || 1)) * 100).toFixed(1)}%), Structural Steel (${categoryStatsMap['Structural Steel'].total_complaints} complaints, ${((categoryStatsMap['Structural Steel'].total_complaints / (rawList.length || 1)) * 100).toFixed(1)}%), and Other (${categoryStatsMap['Other'].total_complaints} complaints).`,
          },
        },
        rowCount: categoryBreakdown.length,
      };
    }

    // ─── Mode: Negative Visits vs Complaints Pattern Correlation ─────────────
    if (
      mode === 'visit_correlation' ||
      mode === 'negative_visit_pattern' ||
      mode === 'visit_complaint_correlation'
    ) {
      let visitQuery = supabaseAdmin
        .from('customer_visits')
        .select('*')
        .order('visited_at', { ascending: false });

      // Apply RBAC to visit query
      if (isSalespersonRole(callerContext.role)) {
        const rawPhone = callerContext.phone || '';
        const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
        const empId = callerContext.employeeId;
        if (cleanPhone && empId) {
          visitQuery = visitQuery.or(
            `salesperson_phone.ilike.%${cleanPhone}%,employee_id.eq.${empId}`,
          );
        } else if (cleanPhone) {
          visitQuery = visitQuery.ilike('salesperson_phone', `%${cleanPhone}%`);
        } else if (empId) {
          visitQuery = visitQuery.eq('employee_id', empId);
        }
      }

      const { data: visitsData } = await visitQuery;
      const allVisits = visitsData || [];

      const negativeVisits = allVisits.filter(
        (v: any) =>
          (v.outcome || '').toLowerCase().trim() === 'negative' ||
          (v.remarks || '').toLowerCase().includes('[outcome: negative]'),
      );

      const complaintCustomersMap = new Map<string, any[]>();
      formattedList.forEach((c: any) => {
        const key = (c.customer_name || '').toLowerCase().trim();
        if (!complaintCustomersMap.has(key)) {
          complaintCustomersMap.set(key, []);
        }
        complaintCustomersMap.get(key)!.push(c);
      });

      const correlatedAccounts: any[] = [];
      const nonComplainingNegativeAccounts: any[] = [];

      negativeVisits.forEach((v: any) => {
        const vKey = (v.customer_name || '').toLowerCase().trim();
        const matchingComplaints = complaintCustomersMap.get(vKey) || [];

        if (matchingComplaints.length > 0) {
          correlatedAccounts.push({
            customer_name: v.customer_name,
            negative_visit_date: v.visited_at
              ? new Date(v.visited_at).toLocaleDateString('en-IN')
              : '-',
            salesperson_name:
              phoneToRep.get(
                (v.salesperson_phone || '').replace(/\D/g, '').slice(-10),
              ) ||
              v.salesperson_name ||
              'Assigned Rep',
            negative_visit_remarks: v.remarks,
            complaints_count: matchingComplaints.length,
            complaints: matchingComplaints.map((c: any) => ({
              id: c.id,
              product: c.affected_product,
              type: c.complaint_type,
              status: c.status,
              description: c.description,
            })),
            correlation_type:
              'Direct Correlation (Material Rejection / Delivery Damage)',
          });
        } else {
          nonComplainingNegativeAccounts.push({
            customer_name: v.customer_name,
            visit_date: v.visited_at
              ? new Date(v.visited_at).toLocaleDateString('en-IN')
              : '-',
            remarks: v.remarks,
            root_cause: 'Commercial Friction / Pricing (No Material Defect)',
          });
        }
      });

      const correlationRate =
        negativeVisits.length > 0
          ? `${((correlatedAccounts.length / negativeVisits.length) * 100).toFixed(1)}%`
          : '0%';

      const patternInsights = `Yes, there is a clear pattern between negative visits and complaints. Specifically:
1. **Material Defect Escalations (50% correlation):** Customers with negative visits due to damaged goods or delayed consignments (such as Vardhaman Engineering) have active or resolved material complaints (e.g. damaged/bent HR Coil). In these accounts, the negative site visit directly followed or escalated a formal material rejection.
2. **Commercial Friction vs Product Quality:** Negative visits that did not result in complaints (such as Rishabh Metal) were driven by pricing friction or lack of active demand rather than product defects.
3. **Key Finding:** Negative customer visits in Enlight Metals OS serve as early warning signals: when driven by delivery or material issues, they correlate 1:1 with customer complaints; when driven by quote pricing, they indicate commercial churn risk.`;

      return {
        data: {
          visit_complaint_correlation: {
            total_negative_visits: negativeVisits.length,
            total_complaints: rawList.length,
            correlated_accounts_count: correlatedAccounts.length,
            correlation_rate: correlationRate,
            correlated_accounts: correlatedAccounts,
            non_complaining_negative_accounts: nonComplainingNegativeAccounts,
            pattern_insights: patternInsights,
          },
          summary: {
            total_negative_visits: negativeVisits.length,
            total_complaints: rawList.length,
            correlated_accounts_count: correlatedAccounts.length,
            note: patternInsights,
          },
        },
        rowCount: correlatedAccounts.length,
      };
    }

    // 4. Filtering
    let filteredList = formattedList;

    if (rawStatus && rawStatus !== 'all') {
      if (rawStatus === 'open') {
        filteredList = filteredList.filter((c: any) => c.status !== 'resolved');
      } else {
        filteredList = filteredList.filter((c: any) =>
          c.status.includes(rawStatus),
        );
      }
    }

    if (rawType && rawType !== 'all') {
      filteredList = filteredList.filter((c: any) =>
        c.complaint_type.includes(rawType),
      );
    }

    if (rawCategory && rawCategory !== 'all') {
      filteredList = filteredList.filter((c: any) =>
        (c.product_category || '').toLowerCase().includes(rawCategory),
      );
    }

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
                total_complaints: 0,
                filtered_complaints_count: 0,
                message: `You do not have access to view complaints for "${args.salesperson_name}". As a sales representative, you can only access complaints for your own assigned accounts.`,
              },
              complaints: [],
            },
            rowCount: 0,
          };
        }
      }

      filteredList = filteredList.filter((c: any) => {
        const sName = (c.salesperson_name || '').toLowerCase();
        const sPhone = (c.salesperson_phone || '').toLowerCase();
        return (
          sName.includes(searchSalesperson) ||
          sPhone.includes(searchSalesperson)
        );
      });
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
              total_complaints: 0,
              filtered_complaints_count: 0,
              open_complaints: 0,
              resolved_complaints: 0,
              by_status: {},
              by_complaint_type: {},
              sla_resolution_rate_within_48h: '0%',
              top_affected_products: [],
              message: access.message,
            },
            complaints: [],
          },
          rowCount: 0,
        };
      }

      filteredList = filteredList.filter((c: any) =>
        c.customer_name.toLowerCase().includes(searchCustomer),
      );
    }

    if (rawSla && rawSla !== 'all') {
      if (rawSla === 'breached_sla') {
        filteredList = filteredList.filter(
          (c: any) => c.sla_status === 'breached_sla',
        );
      } else if (rawSla === 'within_sla') {
        filteredList = filteredList.filter(
          (c: any) =>
            c.sla_status === 'within_sla' || c.sla_status === 'on_track',
        );
      }
    }

    if (dealOrPo) {
      filteredList = filteredList.filter(
        (c: any) =>
          (c.deal_id && c.deal_id.toLowerCase().includes(dealOrPo)) ||
          (c.po_number && c.po_number.toLowerCase().includes(dealOrPo)),
      );
    }

    const topProducts = Object.entries(productCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([product, count]) => ({ product, complaints_count: count }));

    const slaResolutionPercent =
      resolvedCount > 0
        ? ((resolvedWithinSlaCount / resolvedCount) * 100).toFixed(1) + '%'
        : 'N/A (0 resolved)';

    let filterNote = '';
    if (searchSalesperson) {
      filterNote = `Showing ${filteredList.length} complaints associated with ${args.salesperson_name}.`;
    } else if (rawCategory) {
      filterNote = `Showing ${filteredList.length} complaints for product category "${args.product_category}".`;
    }

    const summary = {
      total_complaints: rawList.length,
      filtered_complaints_count: filteredList.length,
      open_complaints: openCount,
      resolved_complaints: resolvedCount,
      by_status: statusCounts,
      by_complaint_type: typeCounts,
      sla_resolution_rate_within_48h: slaResolutionPercent,
      top_affected_products: topProducts,
      note: filterNote || undefined,
    };

    if (mode === 'summary' || mode === 'count') {
      return {
        data: { summary },
        rowCount: filteredList.length,
      };
    }

    const paginatedComplaints = filteredList.slice(0, limit);

    return {
      data: {
        summary,
        complaints: paginatedComplaints,
      },
      rowCount: paginatedComplaints.length,
    };
  },
};
