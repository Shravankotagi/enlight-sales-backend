import { ChatbotTool, CallerContext } from './chatbot-tool.interface';

export const getCustomer360Tool: ChatbotTool = {
  name: 'get_customer_360',
  description:
    'Retrieves comprehensive Customer 360 overview (profile details, active deals, past orders, payment status) for a specific customer, scoped by caller role.',
  roles: ['salesperson', 'manager', 'admin'],
  declaration: {
    name: 'get_customer_360',
    description:
      'Fetches Customer 360 information including profile, recent deals, and payment tracking for a specified customer.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customer_name: {
          type: 'STRING',
          description:
            'Name of the customer or company (e.g. "Supreme Steel" or "Mehta")',
        },
      },
      required: ['customer_name'],
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    const customerName = (args?.customer_name || '').trim();
    if (!customerName) {
      return { data: { message: 'Customer name is required' }, rowCount: 0 };
    }

    const rawPhone = callerContext.phone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
    const empId = callerContext.employeeId;

    // 1. Fetch customer profile from recurring_customers
    let customerQuery = supabaseAdmin
      .from('recurring_customers')
      .select('*')
      .ilike('customer_name', `%${customerName}%`);

    if (callerContext.role === 'salesperson') {
      if (cleanPhone) {
        customerQuery = customerQuery.ilike(
          'assigned_salesperson_phone',
          `%${cleanPhone}%`,
        );
      }
    } else if (callerContext.role === 'manager' && callerContext.employeeId) {
      const { data: subEmployees } = await supabaseAdmin
        .from('employees')
        .select('phone')
        .eq('reports_to_employee_id', callerContext.employeeId);

      const allowedPhones: string[] = [];
      if (cleanPhone) allowedPhones.push(cleanPhone);
      if (subEmployees) {
        subEmployees.forEach((e: any) => {
          if (e.phone) {
            const pClean = e.phone.replace(/\D/g, '').slice(-10);
            if (pClean && !allowedPhones.includes(pClean))
              allowedPhones.push(pClean);
          }
        });
      }
      if (allowedPhones.length > 0) {
        const orConditions = allowedPhones.map(
          (p) => `assigned_salesperson_phone.ilike.%${p}%`,
        );
        customerQuery = customerQuery.or(orConditions.join(','));
      }
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

    if (callerContext.role === 'salesperson') {
      if (cleanPhone && empId) {
        dealsQuery = dealsQuery.or(
          `salesperson_phone.ilike.%${cleanPhone}%,employee_id.eq.${empId}`,
        );
      } else if (cleanPhone) {
        dealsQuery = dealsQuery.ilike('salesperson_phone', `%${cleanPhone}%`);
      } else if (empId) {
        dealsQuery = dealsQuery.eq('employee_id', empId);
      }
    } else if (callerContext.role === 'manager' && callerContext.employeeId) {
      const { data: subEmployees } = await supabaseAdmin
        .from('employees')
        .select('id, employee_id, phone')
        .eq('reports_to_employee_id', callerContext.employeeId);

      const allowedPhoneSuffixes: string[] = cleanPhone ? [cleanPhone] : [];
      const allowedEmpIds: string[] = empId ? [empId] : [];

      if (subEmployees && subEmployees.length > 0) {
        subEmployees.forEach((e: any) => {
          if (e.phone) {
            const pClean = e.phone.replace(/\D/g, '').slice(-10);
            if (pClean) allowedPhoneSuffixes.push(pClean);
          }
          if (e.employee_id) allowedEmpIds.push(e.employee_id);
          if (e.id) allowedEmpIds.push(e.id);
        });
      }

      const orClauses: string[] = [];
      allowedPhoneSuffixes.forEach((p) => {
        orClauses.push(`salesperson_phone.ilike.%${p}%`);
      });
      allowedEmpIds.forEach((id) => {
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

    if (callerContext.role === 'salesperson') {
      if (cleanPhone) {
        paymentsQuery = paymentsQuery.ilike(
          'salesperson_phone',
          `%${cleanPhone}%`,
        );
      }
    } else if (callerContext.role === 'manager' && callerContext.employeeId) {
      const { data: subEmployees } = await supabaseAdmin
        .from('employees')
        .select('phone')
        .eq('reports_to_employee_id', callerContext.employeeId);

      const allowedPhones: string[] = cleanPhone ? [cleanPhone] : [];
      if (subEmployees) {
        subEmployees.forEach((e: any) => {
          if (e.phone) {
            const pClean = e.phone.replace(/\D/g, '').slice(-10);
            if (pClean && !allowedPhones.includes(pClean))
              allowedPhones.push(pClean);
          }
        });
      }
      if (allowedPhones.length > 0) {
        const orConditions = allowedPhones.map(
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
      profile?.contact_phone ||
      latestDealWithPhone?.customer_phone ||
      null;
    const resolvedGst =
      profile?.gst_number || latestDealWithPhone?.customer_gst || null;
    const resolvedAddress =
      profile?.address ||
      latestDealWithPhone?.customer_address ||
      latestDealWithPhone?.delivery_location ||
      null;

    const rowCount =
      (profile ? 1 : 0) +
      (deals ? deals.length : 0) +
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
        deals: deals || [],
        payments: payments || [],
      },
      rowCount,
    };
  },
};
