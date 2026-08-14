import { ChatbotTool, CallerContext } from './chatbot-tool.interface';

export const getMyOpenDealsTool: ChatbotTool = {
  name: 'get_my_open_deals',
  description:
    'Fetches active open deals (negotiations, quotations, inquiries, POs) scoped strictly by the authenticated caller role and team hierarchy.',
  roles: ['salesperson', 'manager', 'admin'],
  declaration: {
    name: 'get_my_open_deals',
    description:
      'Retrieves current active open deals for the authenticated user based on their assigned role scope.',
    parameters: {
      type: 'OBJECT',
      properties: {
        stage_filter: {
          type: 'STRING',
          description:
            'Optional filter by deal stage (e.g. "new_inquiry", "quote_sent", "won")',
        },
      },
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    let query = supabaseAdmin
      .from('deals')
      .select(
        'id, customer_name, customer_phone, total_amount, stage, status, po_number, created_at, salesperson_phone, employee_id, deal_items(sku_text, quantity, unit, rate, amount)',
      )
      .neq('stage', 'lost')
      .order('created_at', { ascending: false });

    // 1. Role-based scoping (Layer 1 enforcement)
    if (callerContext.role === 'salesperson') {
      const phone = callerContext.phone;
      const empId = callerContext.employeeId;
      if (phone && empId) {
        query = query.or(
          `salesperson_phone.eq.${phone},employee_id.eq.${empId}`,
        );
      } else if (phone) {
        query = query.eq('salesperson_phone', phone);
      } else if (empId) {
        query = query.eq('employee_id', empId);
      }
    } else if (callerContext.role === 'manager') {
      // Fetch subordinate employee phones/ids
      const empId = callerContext.employeeId;
      const allowedPhones: string[] = callerContext.phone
        ? [callerContext.phone]
        : [];
      const allowedEmpIds: string[] = empId ? [empId] : [];

      if (empId) {
        const { data: subEmployees } = await supabaseAdmin
          .from('employees')
          .select('id, employee_id, phone')
          .eq('reports_to_employee_id', empId);

        if (subEmployees && subEmployees.length > 0) {
          subEmployees.forEach((e: any) => {
            if (e.phone) allowedPhones.push(e.phone);
            if (e.employee_id) allowedEmpIds.push(e.employee_id);
            if (e.id) allowedEmpIds.push(e.id);
          });
        }
      }

      if (allowedPhones.length > 0 || allowedEmpIds.length > 0) {
        const conditions: string[] = [];
        if (allowedPhones.length > 0)
          conditions.push(`salesperson_phone.in.(${allowedPhones.join(',')})`);
        if (allowedEmpIds.length > 0)
          conditions.push(`employee_id.in.(${allowedEmpIds.join(',')})`);
        query = query.or(conditions.join(','));
      }
    }
    // Admin role receives no filtering (unfiltered view)

    // Optional stage filter
    if (args && args.stage_filter) {
      query = query.eq('stage', args.stage_filter);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`get_my_open_deals error: ${error.message}`);
    }

    const dealsList = data || [];
    return {
      data: dealsList,
      rowCount: dealsList.length,
    };
  },
};
