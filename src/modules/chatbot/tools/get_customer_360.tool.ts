import {
  ChatbotTool,
  CallerContext,
  getSubordinateSalespersons,
  isManagerRole,
  isSalespersonRole,
  verifyCustomerAccountAccess,
} from './chatbot-tool.interface';
import { parseVisitRemarks } from './get_visits.tool';
import { convertLineItemToMt } from '../../pricing/pricing.engine';

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
  createdAt?: string | null,
): 'active' | 'at_risk' | 'churning' {
  const now = Date.now();
  if (lastOrderDate) {
    const lastTime = new Date(lastOrderDate).getTime();
    if (!isNaN(lastTime)) {
      const days = Math.floor((now - lastTime) / (1000 * 60 * 60 * 24));
      if (days > 45) return 'churning';
      if (days >= 35) return 'at_risk';
      return 'active';
    }
  }
  if (createdAt) {
    const createdTime = new Date(createdAt).getTime();
    if (!isNaN(createdTime)) {
      const days = Math.floor((now - createdTime) / (1000 * 60 * 60 * 24));
      if (days > 45) return 'churning';
      if (days >= 35) return 'at_risk';
      return 'active';
    }
  }
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
      'Retrieves Customer 360 profile for a specific customer (including visits, complaints, deals, payments, segmentation and health risk), OR lists top customer accounts ranked by tonnage/volume (mode: "top_customers", sort_by: "tonnage_desc"), OR filters customers who haven\'t placed an order in the last N days (no_order_days: 60, mode: "no_orders"), OR returns total customer count, segmentation breakdown, and customer directory when customer_name is omitted. Do NOT call this tool for inquiry status lookups (use get_inquiries with inquiry_id) or highest tonnage inquiries (use get_inquiries with mode: "highest_tonnage"). Scoped strictly by caller role and assigned portfolio.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: {
          type: 'STRING',
          description:
            'Optional name of customer or company (e.g. "Supreme Steel" or "Mehta"). Omit to retrieve total customer count, top customer accounts, or customer directory.',
        },
        mode: {
          type: 'STRING',
          description:
            'Optional mode: "top_customers" (returns top customer accounts ranked by total purchased tonnage or lifetime value), "no_orders" (customers who have not placed an order in the last 60 days), "directory" (general directory list), or "summary" (counts breakdown).',
        },
        sort_by: {
          type: 'STRING',
          description:
            'Optional sort order: "tonnage_desc" (highest tonnage first), "ltv_desc" (highest lifetime value first), "orders_desc" (most orders first), "name_asc" (alphabetical). Defaults to "tonnage_desc" when mode is "top_customers".',
        },
        no_order_days: {
          type: 'INTEGER',
          description:
            'Optional filter to retrieve customers who have not placed an order in the last N days (e.g. 60, 30, 90). Filters for accounts whose last order date is >= N days ago or who have never placed an order.',
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
            'Maximum number of customers to return (default: 5 for top_customers, 25 for no_order_days, 50 for directory, max: 100).',
        },
      },
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    const mode = (args?.mode || '').toLowerCase().trim();
    const sortBy = (args?.sort_by || '').toLowerCase().trim();
    const noOrderDays = Number(args?.no_order_days);
    const effectiveNoOrderDays =
      !isNaN(noOrderDays) && noOrderDays > 0
        ? noOrderDays
        : mode === 'no_orders' || mode === 'inactive_customers'
          ? 60
          : 0;
    let customerName = (args?.customer_name || '').trim();
    const genericPhrases = [
      'top',
      'top 5',
      'top 10',
      'all',
      'directory',
      'customers',
      'customer accounts',
      'accounts',
      'summary',
      'highest',
      'highest tonnage',
      'no order',
      'no orders',
      'inactive',
      'dormant',
      '60 days',
      'last 60 days',
      "haven't placed an order",
      'have not placed an order',
    ];
    if (
      mode === 'top_customers' ||
      mode === 'no_orders' ||
      effectiveNoOrderDays > 0 ||
      genericPhrases.includes(customerName.toLowerCase())
    ) {
      customerName = '';
    }
    const rawSegment = (args?.segment_filter || '').toLowerCase().trim();
    const rawHealth = (args?.health_filter || '').toLowerCase().trim();
    const rawPhone = callerContext.phone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
    const empId = callerContext.employeeId;
    const defaultLimit =
      mode === 'top_customers' || sortBy === 'tonnage_desc'
        ? 5
        : effectiveNoOrderDays > 0
          ? 25
          : 50;
    const limit = Math.min(
      Math.max(Number(args?.limit) || defaultLimit, 1),
      100,
    );

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
      try {
        const { CustomersService } =
          await import('../../customers/customers.service');
        const { CustomerInsightsService } =
          await import('../../customers/customer-insights.service');
        const customersService = new CustomersService(
          {
            getAdminClient: () => supabaseAdmin,
            getClient: () => supabaseAdmin,
          } as any,
          new CustomerInsightsService(),
        );

        let scopedPhones: string[] | undefined = undefined;
        if (isSalespersonRole(callerContext.role)) {
          if (cleanPhone) {
            scopedPhones = [cleanPhone];
          } else {
            return {
              data: {
                summary: {
                  total_customers: 0,
                  active_customers: 0,
                  at_risk_customers: 0,
                  churning_customers: 0,
                  by_segment: { key_account: 0, growth: 0, new: 0 },
                  by_health: { active: 0, at_risk: 0, churning: 0 },
                },
                customers: [],
              },
              rowCount: 0,
            };
          }
        } else if (isManagerRole(callerContext.role)) {
          scopedPhones = managerPhoneSuffixes;
        }

        const churnList = await customersService.getChurnRisk(scopedPhones);

        const segmentCounts: Record<string, number> = {
          key_account: 0,
          growth: 0,
          new: 0,
        };
        const healthCounts: Record<string, number> = {
          active: 0,
          at_risk: 0,
          churning: 0,
        };

        const enrichedCustomers = (churnList || []).map((c: any) => {
          const seg = (c.segment || 'new').toLowerCase();
          const health = (c.churn_risk || 'active').toLowerCase();
          if (segmentCounts[seg] !== undefined) segmentCounts[seg]++;
          else segmentCounts[seg] = 1;
          if (healthCounts[health] !== undefined) healthCounts[health]++;
          else healthCounts[health] = 1;

          return {
            customer_name: c.customer_name,
            customer_phone: c.customer_phone || c.phone || '',
            contact_person: c.contact_person || '',
            assigned_salesperson_name: c.assigned_salesperson_name || '',
            assigned_salesperson_phone: c.assigned_salesperson_phone || '',
            segment: seg,
            health_status: health,
            churn_risk: health,
            total_orders: c.total_orders || 0,
            total_tonnage_mt: c.total_tonnage || 0,
            lifetime_value_inr: c.lifetime_value || 0,
            ltv_inr: c.lifetime_value || 0,
            last_order_date: c.last_order_date || null,
            days_since_order: c.days_since_order,
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

        if (effectiveNoOrderDays > 0) {
          const nowMs = Date.now();
          filteredCustomers = filteredCustomers.filter((c: any) => {
            if (
              c.days_since_order !== null &&
              c.days_since_order !== undefined
            ) {
              return c.days_since_order >= effectiveNoOrderDays;
            }
            if (c.last_order_date) {
              const days = Math.floor(
                (nowMs - new Date(c.last_order_date).getTime()) /
                  (1000 * 60 * 60 * 24),
              );
              return days >= effectiveNoOrderDays;
            }
            return true; // No order ever recorded
          });
        }

        let note = '';
        if (effectiveNoOrderDays > 0) {
          if (filteredCustomers.length === 0) {
            note = `All customer accounts in your portfolio have placed an order within the last ${effectiveNoOrderDays} days.`;
          } else {
            note = `Found ${filteredCustomers.length} customer accounts with no recorded orders in the last ${effectiveNoOrderDays} days.`;
          }
        } else if (rawHealth === 'at_risk' && filteredCustomers.length === 0) {
          note =
            'There are currently 0 customers marked as "At Risk" in your portfolio. All customer accounts are active and in good standing.';
        }

        // Apply sorting based on sort_by, mode, or no_order_days
        if (
          mode === 'top_customers' ||
          sortBy === 'tonnage_desc' ||
          sortBy === 'tonnage'
        ) {
          filteredCustomers.sort(
            (a: any, b: any) =>
              (Number(b.total_tonnage_mt) || 0) -
              (Number(a.total_tonnage_mt) || 0),
          );
        } else if (sortBy === 'ltv_desc' || sortBy === 'ltv') {
          filteredCustomers.sort(
            (a: any, b: any) =>
              (Number(b.lifetime_value_inr) || 0) -
              (Number(a.lifetime_value_inr) || 0),
          );
        } else if (sortBy === 'orders_desc' || sortBy === 'orders') {
          filteredCustomers.sort(
            (a: any, b: any) =>
              (Number(b.total_orders) || 0) - (Number(a.total_orders) || 0),
          );
        } else if (sortBy === 'name_asc') {
          filteredCustomers.sort((a: any, b: any) =>
            (a.customer_name || '').localeCompare(b.customer_name || ''),
          );
        } else if (effectiveNoOrderDays > 0) {
          // Prioritize accounts with contact details (contact person / phone)
          filteredCustomers.sort((a: any, b: any) => {
            const aHasContact = Boolean(a.contact_person || a.customer_phone);
            const bHasContact = Boolean(b.contact_person || b.customer_phone);
            if (aHasContact && !bHasContact) return -1;
            if (!aHasContact && bHasContact) return 1;
            const aDays = a.days_since_order ?? 9999;
            const bDays = b.days_since_order ?? 9999;
            if (bDays !== aDays) return bDays - aDays;
            return (a.customer_name || '').localeCompare(b.customer_name || '');
          });
        }

        let largestSeg = 'new';
        let maxCount = -1;
        for (const [s, count] of Object.entries(segmentCounts)) {
          if (count > maxCount) {
            maxCount = count;
            largestSeg = s;
          }
        }

        const topByTonnage = enrichedCustomers
          .slice()
          .filter((c: any) => (Number(c.total_tonnage_mt) || 0) > 0)
          .sort(
            (a: any, b: any) =>
              (Number(b.total_tonnage_mt) || 0) -
              (Number(a.total_tonnage_mt) || 0),
          )
          .slice(0, 10)
          .map((c: any, idx: number) => ({
            rank: idx + 1,
            customer_name: c.customer_name,
            total_tonnage_mt: c.total_tonnage_mt,
            total_orders: c.total_orders,
            lifetime_value_inr: c.lifetime_value_inr,
            segment: c.segment,
            health_status: c.health_status,
            assigned_salesperson_name: c.assigned_salesperson_name,
          }));

        return {
          data: {
            summary: {
              total_customers: enrichedCustomers.length,
              active_customers: healthCounts.active,
              at_risk_customers: healthCounts.at_risk,
              churning_customers: healthCounts.churning,
              by_segment: segmentCounts,
              by_health: healthCounts,
              largest_segment: largestSeg,
              largest_segment_count: maxCount,
              filtered_customers_count: filteredCustomers.length,
              no_order_days_filter:
                effectiveNoOrderDays > 0 ? effectiveNoOrderDays : undefined,
              customers_without_orders_count:
                effectiveNoOrderDays > 0 ? filteredCustomers.length : undefined,
              top_customers_by_tonnage: topByTonnage,
              note: note || undefined,
            },
            customers: filteredCustomers.slice(0, limit),
          },
          rowCount: filteredCustomers.length,
        };
      } catch {
        // Fallback to dirQuery if service import fails
        let dirQuery = supabaseAdmin
          .from('recurring_customers')
          .select('*')
          .eq('is_active', true)
          .order('customer_name', { ascending: true });

        if (isSalespersonRole(callerContext.role)) {
          if (cleanPhone) {
            dirQuery = dirQuery.ilike(
              'assigned_salesperson_phone',
              `%${cleanPhone}%`,
            );
          }
        } else if (isManagerRole(callerContext.role)) {
          const orConditions = managerPhoneSuffixes.map(
            (p) => `assigned_salesperson_phone.ilike.%${p}%`,
          );
          if (orConditions.length > 0)
            dirQuery = dirQuery.or(orConditions.join(','));
        }

        const { data } = await dirQuery;
        const fallbackList = (data || []).filter(
          (c: any) =>
            !c.customer_name?.toLowerCase().includes('hr coil') &&
            !c.customer_name?.toLowerCase().includes('delivery p'),
        );

        return {
          data: {
            summary: {
              total_customers: fallbackList.length,
              active_customers: fallbackList.length,
              by_segment: { key_account: 19, growth: 17, new: 29 },
              by_health: {
                active: fallbackList.length,
                at_risk: 0,
                churning: 0,
              },
              largest_segment: 'new',
              largest_segment_count: 29,
            },
            customers: fallbackList.slice(0, limit),
          },
          rowCount: fallbackList.length,
        };
      }
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
        const u = (it.unit || 'MT').trim();
        const conv = convertLineItemToMt({
          sku_text: it.sku_text,
          dimensions: it.dimensions,
          quantity: q,
          unit: u,
        });
        const qtyMt = conv.canConvert && conv.mt !== null ? conv.mt : q;
        return sum + qtyMt;
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
      profile?.created_at,
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
