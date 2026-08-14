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

    // 1. Fetch customer profile from recurring_customers
    let customerQuery = supabaseAdmin
      .from('recurring_customers')
      .select('*')
      .ilike('customer_name', `%${customerName}%`);

    if (callerContext.role === 'salesperson') {
      const phone = callerContext.phone;
      if (phone)
        customerQuery = customerQuery.eq('assigned_salesperson_phone', phone);
    } else if (callerContext.role === 'manager' && callerContext.employeeId) {
      const { data: subEmployees } = await supabaseAdmin
        .from('employees')
        .select('phone')
        .eq('reports_to_employee_id', callerContext.employeeId);

      const allowedPhones: string[] = callerContext.phone
        ? [callerContext.phone]
        : [];
      if (subEmployees) {
        subEmployees.forEach(
          (e: any) => e.phone && allowedPhones.push(e.phone),
        );
      }
      if (allowedPhones.length > 0) {
        customerQuery = customerQuery.in(
          'assigned_salesperson_phone',
          allowedPhones,
        );
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
        'id, stage, total_amount, po_number, po_date, created_at, deal_items(*)',
      )
      .ilike('customer_name', `%${customerName}%`)
      .order('created_at', { ascending: false });

    if (callerContext.role === 'salesperson') {
      const phone = callerContext.phone;
      const empId = callerContext.employeeId;
      if (phone && empId)
        dealsQuery = dealsQuery.or(
          `salesperson_phone.eq.${phone},employee_id.eq.${empId}`,
        );
      else if (phone) dealsQuery = dealsQuery.eq('salesperson_phone', phone);
      else if (empId) dealsQuery = dealsQuery.eq('employee_id', empId);
    }

    const { data: deals } = await dealsQuery;

    // 3. Fetch payment tracking for this customer
    let paymentsQuery = supabaseAdmin
      .from('payment_tracking')
      .select('*')
      .ilike('customer_name', `%${customerName}%`);

    if (callerContext.role === 'salesperson' && callerContext.phone) {
      paymentsQuery = paymentsQuery.eq(
        'salesperson_phone',
        callerContext.phone,
      );
    }

    const { data: payments } = await paymentsQuery;

    const rowCount =
      (profile ? 1 : 0) +
      (deals ? deals.length : 0) +
      (payments ? payments.length : 0);

    return {
      data: {
        customer_name: customerName,
        profile: profile || 'No master customer profile found',
        deals: deals || [],
        payments: payments || [],
      },
      rowCount,
    };
  },
};
