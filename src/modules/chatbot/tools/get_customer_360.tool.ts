import {
  ChatbotTool,
  CallerContext,
  getSubordinateSalespersons,
  isManagerRole,
  isSalespersonRole,
  verifyCustomerAccountAccess,
} from './chatbot-tool.interface';
import { parseVisitRemarks } from './get_visits.tool';

function deriveCustomerSegment(
  totalTonnage: number,
  ltv: number,
  totalOrders: number,
  inquiriesCount: number = 0,
  visitsCount: number = 0,
): 'key_account' | 'growth' | 'new' {
  // Key Account: Bulk Volume (>=100 MT or >=50L) OR Consistent Core (>=4 orders and (>=20L or >=30 MT))
  if (
    totalTonnage >= 100 ||
    ltv >= 5000000 ||
    (totalOrders >= 4 && (ltv >= 2000000 || totalTonnage >= 30))
  ) {
    return 'key_account';
  }
  // Growth: >=2 orders, or >=5L LTV, or >=10 MT, or LTV >= 15L, or totalTonnage >= 25 MT, or (>=1 order and (ltv >= 500000 || totalTonnage >= 10 || inquiriesCount >= 3 || visitsCount >= 2))
  if (
    (totalOrders >= 2 && (ltv >= 500000 || totalTonnage >= 10)) ||
    totalTonnage >= 25 ||
    ltv >= 1500000 ||
    (totalOrders >= 1 &&
      (ltv >= 500000 ||
        totalTonnage >= 10 ||
        inquiriesCount >= 3 ||
        visitsCount >= 2))
  ) {
    return 'growth';
  }
  return 'new';
}

function deriveHealthRisk(
  lastOrderDate?: string | null,
): 'active' | 'at_risk' | 'churning' {
  if (!lastOrderDate) return 'at_risk';
  const lastTime = new Date(lastOrderDate).getTime();
  if (isNaN(lastTime)) return 'at_risk';
  const days = Math.floor((Date.now() - lastTime) / (1000 * 60 * 60 * 24));
  if (days > 45) return 'churning';
  if (days >= 35) return 'at_risk';
  return 'active';
}

export const getCustomer360Tool: ChatbotTool = {
  name: 'get_customer_360',
  description:
    'Retrieves comprehensive Customer 360 overview for a specific customer (profile, pipeline deals, payments, site visits, complaints, customer segment, and health status), OR lists total customer counts and the customer directory when customer_name is omitted. Scoped strictly by caller role and assigned portfolio.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_customer_360',
    description:
      'Retrieves Customer 360 profile for a specific customer (including visits, complaints, deals, payments, segmentation and health risk), OR returns total customer count, segmentation breakdown, and customer directory when customer_name is omitted. Scoped strictly by caller role and assigned portfolio.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: {
          type: 'STRING',
          description:
            'Optional name of customer or company (e.g. "Supreme Steel" or "Mehta"). Omit to retrieve total customer count and customer directory.',
        },
        segment_filter: {
          type: 'STRING',
          description:
            'Optional filter by segment in directory mode: "all", "key_account", "growth", "new".',
        },
        health_filter: {
          type: 'STRING',
          description:
            'Optional filter by health risk in directory mode: "all", "active", "at_risk", "churning".',
        },
        limit: {
          type: 'INTEGER',
          description:
            'Maximum number of customers to return in directory list (default: 50, max: 100).',
        },
      },
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    const customerName = (args?.customer_name || '').trim();
    const rawSegment = (args?.segment_filter || '').toLowerCase().trim();
    const rawHealth = (args?.health_filter || '').toLowerCase().trim();
    const rawPhone = callerContext.phone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
    const empId = callerContext.employeeId;
    const limit = Math.min(Math.max(Number(args?.limit) || 50, 1), 100);

    // ─── Layer 1 RBAC Identity Verification (Fail-Closed) ───────────────────
    let managerPhoneSuffixes: string[] = [];
    let managerEmployeeIds: string[] = [];

    if (isSalespersonRole(callerContext.role)) {
      if (!cleanPhone && !empId) {
        return {
          data: {
            notFound: true,
            customer_name: customerName,
            message: 'Access denied. Caller identity could not be verified.',
          },
          rowCount: 0,
        };
      }
    } else if (isManagerRole(callerContext.role)) {
      const sub = await getSubordinateSalespersons(
        callerContext,
        supabaseAdmin,
      );
      managerPhoneSuffixes = sub.phoneSuffixes;
      managerEmployeeIds = sub.employeeIds;

      if (
        managerPhoneSuffixes.length === 0 &&
        managerEmployeeIds.length === 0
      ) {
        return {
          data: {
            notFound: true,
            customer_name: customerName,
            message: customerName
              ? `You do not have any company like "${customerName}" in your assigned accounts.`
              : 'You currently have no salespersons assigned to your team.',
          },
          rowCount: 0,
        };
      }
    }

    // ─── Case 1: Directory Mode (customer_name is omitted) ─────────────────
    if (!customerName) {
      let dirQuery = supabaseAdmin
        .from('recurring_customers')
        .select('*', { count: 'exact' })
        .order('customer_name', { ascending: true });

      if (isSalespersonRole(callerContext.role)) {
        if (cleanPhone) {
          dirQuery = dirQuery.ilike(
            'assigned_salesperson_phone',
            `%${cleanPhone}%`,
          );
        } else {
          return {
            data: {
              summary: {
                total_customers: 0,
                active_customers: 0,
                by_segment: { key_account: 0, growth: 0, new: 0 },
                by_health: { active: 0, at_risk: 0, churning: 0 },
              },
              customers: [],
            },
            rowCount: 0,
          };
        }
      } else if (isManagerRole(callerContext.role)) {
        const orConditions = managerPhoneSuffixes.map(
          (p) => `assigned_salesperson_phone.ilike.%${p}%`,
        );
        dirQuery = dirQuery.or(orConditions.join(','));
      }

      const { data, count, error } = await dirQuery.limit(limit);
      if (error) {
        throw new Error(`get_customer_360 error: ${error.message}`);
      }

      const custList = data || [];

      // Fetch caller's scoped deals, visits, and inquiries to compute accurate segments & activity
      let dealsQuery = supabaseAdmin
        .from('deals')
        .select(
          'customer_name, stage, total_amount, deal_items(quantity, unit, amount)',
        );
      let visitsQuery = supabaseAdmin
        .from('customer_visits')
        .select('customer_name, remarks');
      let inqsQuery = supabaseAdmin.from('inquiries').select('sender_name');

      if (isSalespersonRole(callerContext.role)) {
        dealsQuery = dealsQuery.ilike('salesperson_phone', `%${cleanPhone}%`);
        visitsQuery = visitsQuery.ilike('salesperson_phone', `%${cleanPhone}%`);
        inqsQuery = inqsQuery.ilike('salesperson_phone', `%${cleanPhone}%`);
      } else if (isManagerRole(callerContext.role)) {
        const orConditions = managerPhoneSuffixes.map(
          (p) => `salesperson_phone.ilike.%${p}%`,
        );
        if (orConditions.length > 0) {
          dealsQuery = dealsQuery.or(orConditions.join(','));
          visitsQuery = visitsQuery.or(orConditions.join(','));
          inqsQuery = inqsQuery.or(orConditions.join(','));
        }
      }

      const [{ data: allDeals }, { data: allVisits }, { data: allInqs }] =
        await Promise.all([dealsQuery, visitsQuery, inqsQuery]);

      const dealsMap = new Map<string, any[]>();
      (allDeals || []).forEach((d: any) => {
        const name = (d.customer_name || '').toLowerCase().trim();
        if (!dealsMap.has(name)) dealsMap.set(name, []);
        dealsMap.get(name)!.push(d);
      });

      const visitsMap = new Map<string, number>();
      (allVisits || []).forEach((v: any) => {
        const name = (v.customer_name || '').toLowerCase().trim();
        visitsMap.set(name, (visitsMap.get(name) || 0) + 1);
      });

      const inqsMap = new Map<string, number>();
      (allInqs || []).forEach((i: any) => {
        const name = (i.sender_name || '').toLowerCase().trim();
        inqsMap.set(name, (inqsMap.get(name) || 0) + 1);
      });

      const segmentCounts = { key_account: 0, growth: 0, new: 0 };
      const healthCounts = { active: 0, at_risk: 0, churning: 0 };

      const enrichedCustomers = custList.map((c: any) => {
        const cName = (c.customer_name || '').toLowerCase().trim();
        const cDeals = dealsMap.get(cName) || [];
        const wonDeals = cDeals.filter(
          (d: any) => (d.stage || '').toLowerCase() === 'won',
        );
        const vCount = visitsMap.get(cName) || 0;
        const iCount = inqsMap.get(cName) || 0;

        let wonTonnage = 0;
        let wonLtv = 0;
        wonDeals.forEach((d: any) => {
          wonLtv += Number(d.total_amount) || 0;
          const items = d.deal_items || [];
          const tonnage = items.reduce((sum: number, it: any) => {
            const q = Number(it.quantity) || 0;
            const u = (it.unit || 'MT').toLowerCase().trim();
            if (u === 'kg' || u === 'kgs') return sum + q / 1000;
            return sum + q;
          }, 0);
          wonTonnage += tonnage;
        });

        const effectiveTonnage = wonTonnage || Number(c.total_tonnage || 0);
        const effectiveLtv = wonLtv || Number(c.lifetime_value || 0);
        const effectiveOrders = wonDeals.length || Number(c.total_orders || 0);

        const explicitSegment = (c.segment || '').toLowerCase().trim();
        const segment: 'key_account' | 'growth' | 'new' = [
          'key_account',
          'growth',
          'new',
        ].includes(explicitSegment)
          ? (explicitSegment as 'key_account' | 'growth' | 'new')
          : deriveCustomerSegment(
              effectiveTonnage,
              effectiveLtv,
              effectiveOrders,
              iCount,
              vCount,
            );

        const health = deriveHealthRisk(
          c.last_order_date || wonDeals[0]?.created_at || null,
        );

        segmentCounts[segment]++;
        healthCounts[health]++;

        return {
          customer_name: c.customer_name,
          customer_phone: c.customer_phone || c.phone || '',
          contact_person: c.contact_person || '',
          assigned_salesperson_phone: c.assigned_salesperson_phone || '',
          segment,
          health_status: health,
          total_orders: effectiveOrders,
          total_tonnage_mt: Math.round(effectiveTonnage * 1000) / 1000,
          lifetime_value_inr: effectiveLtv,
          ltv_inr: effectiveLtv,
          last_order_date: c.last_order_date || wonDeals[0]?.created_at || null,
          is_active: c.is_active !== false,
        };
      });

      let filteredCustomers = enrichedCustomers;
      if (rawSegment && rawSegment !== 'all') {
        filteredCustomers = filteredCustomers.filter(
          (c: any) => c.segment === rawSegment,
        );
      }
      if (rawHealth && rawHealth !== 'all') {
        filteredCustomers = filteredCustomers.filter(
          (c: any) => c.health_status === rawHealth,
        );
      }

      return {
        data: {
          summary: {
            total_customers:
              count !== null && count !== undefined ? count : custList.length,
            active_customers: healthCounts.active,
            by_segment: segmentCounts,
            by_health: healthCounts,
            filtered_customers_count: filteredCustomers.length,
          },
          customers: filteredCustomers,
        },
        rowCount: filteredCustomers.length,
      };
    }

    // ─── Case 2: Specific Customer 360 Detail Mode ─────────────────────────
    const access = await verifyCustomerAccountAccess(
      customerName,
      callerContext,
      supabaseAdmin,
    );
    if (!access.allowed) {
      return {
        data: {
          notFound: true,
          customer_name: customerName,
          message: access.message,
        },
        rowCount: 0,
      };
    }

    // 1. Fetch Customer Profile from recurring_customers (Strictly Scoped)
    let customerQuery = supabaseAdmin
      .from('recurring_customers')
      .select('*')
      .ilike('customer_name', `%${customerName}%`);

    if (isSalespersonRole(callerContext.role)) {
      customerQuery = customerQuery.ilike(
        'assigned_salesperson_phone',
        `%${cleanPhone}%`,
      );
    } else if (isManagerRole(callerContext.role)) {
      const orConditions = managerPhoneSuffixes.map(
        (p) => `assigned_salesperson_phone.ilike.%${p}%`,
      );
      customerQuery = customerQuery.or(orConditions.join(','));
    }

    const { data: customerProfiles } = await customerQuery;
    const profile =
      customerProfiles && customerProfiles.length > 0
        ? customerProfiles.find(
            (p: any) =>
              p.customer_name.toLowerCase().trim() ===
              customerName.toLowerCase(),
          ) || customerProfiles[0]
        : null;

    // 2. Fetch Customer Deals (Strictly Scoped)
    let dealsQuery = supabaseAdmin
      .from('deals')
      .select(
        'id, stage, total_amount, customer_name, customer_phone, customer_gst, customer_address, delivery_location, payment_terms, po_number, po_date, created_at, salesperson_phone, employee_id, deal_items(*)',
      )
      .ilike('customer_name', `%${customerName}%`)
      .order('created_at', { ascending: false });

    if (isSalespersonRole(callerContext.role)) {
      if (cleanPhone && empId) {
        dealsQuery = dealsQuery.or(
          `salesperson_phone.ilike.%${cleanPhone}%,employee_id.eq.${empId}`,
        );
      } else if (cleanPhone) {
        dealsQuery = dealsQuery.ilike('salesperson_phone', `%${cleanPhone}%`);
      } else if (empId) {
        dealsQuery = dealsQuery.eq('employee_id', empId);
      }
    } else if (isManagerRole(callerContext.role)) {
      const orClauses: string[] = [];
      managerPhoneSuffixes.forEach((p) => {
        orClauses.push(`salesperson_phone.ilike.%${p}%`);
      });
      managerEmployeeIds.forEach((id) => {
        orClauses.push(`employee_id.eq.${id}`);
      });
      if (orClauses.length > 0) {
        dealsQuery = dealsQuery.or(orClauses.join(','));
      }
    }

    const { data: dealsData } = await dealsQuery;
    let deals = dealsData || [];

    // Filter deals to match exact requested name if exact deals exist
    const exactDeals = deals.filter(
      (d: any) =>
        d.customer_name &&
        d.customer_name.toLowerCase().trim() === customerName.toLowerCase(),
    );
    if (exactDeals.length > 0) {
      deals = exactDeals;
    }

    // 3. Fetch Customer Visits (Strictly Scoped)
    let visitsQuery = supabaseAdmin
      .from('customer_visits')
      .select(
        'id, customer_name, visited_at, outcome, remarks, material_requirement, follow_up_action, person_met, customer_address, salesperson_phone, employee_id',
      )
      .ilike('customer_name', `%${customerName}%`)
      .order('visited_at', { ascending: false })
      .limit(10);

    if (isSalespersonRole(callerContext.role)) {
      visitsQuery = visitsQuery.ilike('salesperson_phone', `%${cleanPhone}%`);
    } else if (isManagerRole(callerContext.role)) {
      const orConditions = managerPhoneSuffixes.map(
        (p) => `salesperson_phone.ilike.%${p}%`,
      );
      visitsQuery = visitsQuery.or(orConditions.join(','));
    }

    const { data: visitsData } = await visitsQuery;
    let visits = visitsData || [];
    const exactVisits = visits.filter(
      (v: any) =>
        v.customer_name &&
        v.customer_name.toLowerCase().trim() === customerName.toLowerCase(),
    );
    if (exactVisits.length > 0) {
      visits = exactVisits;
    }

    // 4. Fetch Customer Complaints (Strictly Scoped - using reported_by)
    let complaintsQuery = supabaseAdmin
      .from('complaints')
      .select(
        'id, customer_name, complaint_type, status, affected_product, description, corrective_action, resolution_notes, reported_at, resolved_at, reported_by, employee_id',
      )
      .ilike('customer_name', `%${customerName}%`)
      .order('created_at', { ascending: false })
      .limit(10);

    if (isSalespersonRole(callerContext.role)) {
      if (cleanPhone && empId) {
        complaintsQuery = complaintsQuery.or(
          `reported_by.ilike.%${cleanPhone}%,employee_id.eq.${empId}`,
        );
      } else if (cleanPhone) {
        complaintsQuery = complaintsQuery.ilike(
          'reported_by',
          `%${cleanPhone}%`,
        );
      } else if (empId) {
        complaintsQuery = complaintsQuery.eq('employee_id', empId);
      }
    } else if (isManagerRole(callerContext.role)) {
      const conditions: string[] = [];
      managerPhoneSuffixes.forEach((p) => {
        conditions.push(`reported_by.ilike.%${p}%`);
      });
      managerEmployeeIds.forEach((id) => {
        conditions.push(`employee_id.eq.${id}`);
      });
      if (conditions.length > 0) {
        complaintsQuery = complaintsQuery.or(conditions.join(','));
      }
    }

    const { data: complaintsData } = await complaintsQuery;
    let complaints = complaintsData || [];
    const exactComplaints = complaints.filter(
      (c: any) =>
        c.customer_name &&
        c.customer_name.toLowerCase().trim() === customerName.toLowerCase(),
    );
    if (exactComplaints.length > 0) {
      complaints = exactComplaints;
    }

    // 5. Fetch Payments (Strictly Scoped)
    let paymentsQuery = supabaseAdmin
      .from('payment_tracking')
      .select('*')
      .ilike('customer_name', `%${customerName}%`);

    if (isSalespersonRole(callerContext.role)) {
      paymentsQuery = paymentsQuery.ilike(
        'salesperson_phone',
        `%${cleanPhone}%`,
      );
    } else if (isManagerRole(callerContext.role)) {
      const orConditions = managerPhoneSuffixes.map(
        (p) => `salesperson_phone.ilike.%${p}%`,
      );
      paymentsQuery = paymentsQuery.or(orConditions.join(','));
    }

    const { data: paymentsData } = await paymentsQuery;
    const payments = paymentsData || [];

    // ─── Fail-Closed Verification on Authorized Data ────────────────────────
    // If the caller has no profile, no deals, no visits, no complaints, and no payments for this customer:
    if (
      !profile &&
      deals.length === 0 &&
      visits.length === 0 &&
      complaints.length === 0 &&
      payments.length === 0
    ) {
      return {
        data: {
          notFound: true,
          customer_name: customerName,
          message: `You do not have any company like "${customerName}" in your assigned accounts.`,
        },
        rowCount: 0,
      };
    }

    // Consolidate contact details from verified records
    const latestDealWithPhone = deals.find((d: any) => d.customer_phone);
    const resolvedPhone =
      profile?.phone ||
      profile?.customer_phone ||
      profile?.contact_phone ||
      latestDealWithPhone?.customer_phone ||
      null;
    const resolvedGst =
      profile?.gst_number ||
      profile?.customer_gst ||
      latestDealWithPhone?.customer_gst ||
      null;
    const resolvedAddress =
      profile?.address ||
      profile?.customer_address ||
      latestDealWithPhone?.customer_address ||
      latestDealWithPhone?.delivery_location ||
      null;

    let lifetimeTonnageMt = 0;
    let wonOrdersCount = 0;
    let lifetimeWonValue = 0;

    const formattedDeals = deals.map((d: any) => {
      const isWon = (d.stage || '').toLowerCase() === 'won';
      const items = d.deal_items || [];
      const dealTonnage = items.reduce((sum: number, it: any) => {
        const q = Number(it.quantity) || 0;
        const u = (it.unit || 'MT').toLowerCase().trim();
        if (u === 'kg' || u === 'kgs') return sum + q / 1000;
        return sum + q;
      }, 0);

      if (isWon) {
        wonOrdersCount++;
        lifetimeWonValue += Number(d.total_amount) || 0;
        lifetimeTonnageMt += dealTonnage;
      }

      return {
        ...d,
        deal_id: 'DEAL-' + d.id.substring(0, 6).toUpperCase(),
        deal_uuid: d.id,
        tonnage_mt: Math.round(dealTonnage * 1000) / 1000,
      };
    });

    const totalTonnageRounded = Math.round(lifetimeTonnageMt * 1000) / 1000;
    const segment = deriveCustomerSegment(
      totalTonnageRounded,
      lifetimeWonValue,
      wonOrdersCount,
      0,
      visits.length,
    );
    const healthStatus = deriveHealthRisk(
      profile?.last_order_date || deals[0]?.created_at,
    );

    const openComplaintsCount = complaints.filter(
      (c: any) => c.status !== 'resolved',
    ).length;

    const formattedVisits = visits.map((v: any) => {
      const parsed = parseVisitRemarks(v.remarks);
      return {
        ...v,
        visit_date: v.visited_at ? v.visited_at.split('T')[0] : null,
        outcome: parsed.outcome,
        follow_up_action: parsed.follow_up_action,
        requires_follow_up: parsed.requires_follow_up,
        material_requirement: parsed.material_requirement,
        location: parsed.location || v.location,
        interests: parsed.interests,
        remarks: parsed.clean_remarks || v.remarks,
      };
    });

    const rowCount =
      (profile ? 1 : 0) +
      formattedDeals.length +
      payments.length +
      formattedVisits.length +
      complaints.length;

    return {
      data: {
        customer_name:
          profile?.customer_name || deals[0]?.customer_name || customerName,
        segment,
        health_status: healthStatus,
        contact_info: {
          phone: resolvedPhone,
          gst: resolvedGst,
          address: resolvedAddress,
        },
        profile: profile || {
          customer_name: deals[0]?.customer_name || customerName,
          phone: resolvedPhone,
          gst_number: resolvedGst,
          address: resolvedAddress,
        },
        metrics: {
          total_orders: wonOrdersCount,
          lifetime_value_inr: lifetimeWonValue,
          lifetime_tonnage_mt: totalTonnageRounded,
          total_visits: formattedVisits.length,
          last_visit_date: formattedVisits[0]?.visited_at || null,
          total_complaints: complaints.length,
          open_complaints: openComplaintsCount,
        },
        visits_summary: {
          total_logged: formattedVisits.length,
          recent_visits: formattedVisits.slice(0, 5),
        },
        complaints_summary: {
          total_reported: complaints.length,
          open_count: openComplaintsCount,
          recent_complaints: complaints.slice(0, 5),
        },
        deals: formattedDeals,
        payments: payments,
      },
      rowCount,
    };
  },
};
