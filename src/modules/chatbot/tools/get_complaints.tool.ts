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

export const getComplaintsTool: ChatbotTool = {
  name: 'get_complaints',
  description:
    'Retrieves customer quality and service complaints, rejection reports, resolution status, and 48-hour SLA metrics (KRA 7 & KRA 8). Returns summary of open vs resolved, SLA compliance rate, complaint types breakdown, affected products, and itemized records. Scoped strictly by caller role.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_complaints',
    description:
      'Retrieves customer quality/delivery complaints, material rejection reports, open/resolved status, and 48-hour SLA resolution performance. Scoped by caller role.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: {
          type: 'STRING',
          description:
            'Optional filter by customer or company name (e.g. "Supreme Steel", "Delta").',
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
            'Query mode. Valid values: "list" (default, returns records with summary), "summary" (returns only counts and statistics).',
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

    const empMap = new Map<string, string>();
    (employees || []).forEach((e: any) => {
      if (e.phone) {
        const clean = e.phone.replace(/\D/g, '').slice(-10);
        if (clean) empMap.set(clean, e.name);
      }
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
        empMap.get(cleanPhone) || c.salesperson_name || 'Assigned Rep';

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

    const summary = {
      total_complaints: rawList.length,
      filtered_complaints_count: filteredList.length,
      open_complaints: openCount,
      resolved_complaints: resolvedCount,
      by_status: statusCounts,
      by_complaint_type: typeCounts,
      sla_resolution_rate_within_48h: slaResolutionPercent,
      top_affected_products: topProducts,
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
