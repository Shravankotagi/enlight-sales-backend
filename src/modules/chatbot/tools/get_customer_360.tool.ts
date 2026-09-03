import {
  ChatbotTool,
  CallerContext,
  getSubordinateSalespersons,
  isManagerRole,
  isSalespersonRole,
} from './chatbot-tool.interface';

export const getCustomer360Tool: ChatbotTool = {
  name: 'get_customer_360',
  description:
    'Retrieves comprehensive Customer 360 overview for a specific customer, OR lists total customer counts and the customer directory when customer_name is omitted. Scoped by caller role.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_customer_360',
    description:
      'Retrieves Customer 360 profile for a specific customer, OR returns total customer count and customer directory when customer_name is omitted. Scoped by caller role.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: {
          type: 'STRING',
          description:
            'Optional name of customer or company (e.g. "Supreme Steel" or "Mehta"). Omit to retrieve total customer count and customer directory.',
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
    const rawPhone = callerContext.phone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
    const empId = callerContext.employeeId;
    const limit = Math.min(Math.max(Number(args?.limit) || 50, 1), 100);

    // If customer_name is omitted, return total customer count and customer directory
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
        }
      } else if (isManagerRole(callerContext.role)) {
        const { phoneSuffixes } = await getSubordinateSalespersons(
          callerContext,
          supabaseAdmin,
        );

        if (phoneSuffixes.length === 0) {
          return {
            data: {
              summary: { total_customers: 0, active_customers: 0 },
              customers: [],
            },
            rowCount: 0,
          };
        }

        const orConditions = phoneSuffixes.map(
          (p) => `assigned_salesperson_phone.ilike.%${p}%`,
        );
        dirQuery = dirQuery.or(orConditions.join(','));
      }

      const { data, count, error } = await dirQuery.limit(limit);
      if (error) {
        throw new Error(`get_customer_360 error: ${error.message}`);
      }

      const custList = data || [];
      const activeCount = custList.filter(
        (c: any) => c.is_active !== false,
      ).length;

      return {
        data: {
          summary: {
            total_customers:
              count !== null && count !== undefined ? count : custList.length,
            active_customers: activeCount,
          },
          customers: custList.map((c: any) => ({
            customer_name: c.customer_name,
            customer_phone: c.customer_phone || '',
            contact_person: c.contact_person || '',
            assigned_salesperson_phone: c.assigned_salesperson_phone || '',
            is_active: c.is_active !== false,
            last_order_date: c.last_order_date || null,
          })),
        },
        rowCount: custList.length,
      };
    }

    // 1. Fetch customer profile from recurring_customers
    let customerQuery = supabaseAdmin
      .from('recurring_customers')
      .select('*')
      .ilike('customer_name', `%${customerName}%`);

    if (isSalespersonRole(callerContext.role)) {
      if (cleanPhone) {
        customerQuery = customerQuery.ilike(
          'assigned_salesperson_phone',
          `%${cleanPhone}%`,
        );
      }
    } else if (isManagerRole(callerContext.role)) {
      const { phoneSuffixes } = await getSubordinateSalespersons(
        callerContext,
        supabaseAdmin,
      );

      if (phoneSuffixes.length === 0) {
        return {
          data: {
            customer_name: customerName,
            message: `No records found for "${customerName}". You currently have no salespersons assigned to your team.`,
          },
          rowCount: 0,
        };
      }

      const orConditions = phoneSuffixes.map(
        (p) => `assigned_salesperson_phone.ilike.%${p}%`,
      );
      customerQuery = customerQuery.or(orConditions.join(','));
    }

    const { data: customerProfiles } = await customerQuery;
    const profile =
      customerProfiles && customerProfiles.length > 0
        ? customerProfiles[0]
        : null;

    // 2. Fetch customer's deals scoped by role
    let dealsQuery = supabaseAdmin
      .from('deals')
      .select(
        'id, stage, total_amount, customer_name, customer_phone, customer_gst, customer_address, delivery_location, payment_terms, po_number, po_date, created_at, deal_items(*)',
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
      const { employeeIds, phoneSuffixes } = await getSubordinateSalespersons(
        callerContext,
        supabaseAdmin,
      );

      const orClauses: string[] = [];
      phoneSuffixes.forEach((p) => {
        orClauses.push(`salesperson_phone.ilike.%${p}%`);
      });
      employeeIds.forEach((id) => {
        orClauses.push(`employee_id.eq.${id}`);
      });

      if (orClauses.length > 0) {
        dealsQuery = dealsQuery.or(orClauses.join(','));
      }
    }

    const { data: deals } = await dealsQuery;

    // 3. Fetch payment tracking for this customer
    let paymentsQuery = supabaseAdmin
      .from('payment_tracking')
      .select('*')
      .ilike('customer_name', `%${customerName}%`);

    if (isSalespersonRole(callerContext.role)) {
      if (cleanPhone) {
        paymentsQuery = paymentsQuery.ilike(
          'salesperson_phone',
          `%${cleanPhone}%`,
        );
      }
    } else if (isManagerRole(callerContext.role)) {
      const { phoneSuffixes } = await getSubordinateSalespersons(
        callerContext,
        supabaseAdmin,
      );

      if (phoneSuffixes.length > 0) {
        const orConditions = phoneSuffixes.map(
          (p) => `salesperson_phone.ilike.%${p}%`,
        );
        paymentsQuery = paymentsQuery.or(orConditions.join(','));
      }
    }

    const { data: payments } = await paymentsQuery;

    // Consolidate contact details from recurring_customers or deals
    const latestDealWithPhone = deals?.find((d: any) => d.customer_phone);
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

    const formattedDeals = (deals || []).map((d: any) => ({
      ...d,
      deal_id: 'DEAL-' + d.id.substring(0, 6).toUpperCase(),
      deal_uuid: d.id,
    }));

    const rowCount =
      (profile ? 1 : 0) +
      formattedDeals.length +
      (payments ? payments.length : 0);

    return {
      data: {
        customer_name: customerName,
        contact_info: {
          phone: resolvedPhone,
          gst: resolvedGst,
          address: resolvedAddress,
        },
        profile: profile || {
          customer_name: customerName,
          phone: resolvedPhone,
          gst_number: resolvedGst,
          address: resolvedAddress,
        },
        deals: formattedDeals,
        payments: payments || [],
      },
      rowCount,
    };
  },
};
