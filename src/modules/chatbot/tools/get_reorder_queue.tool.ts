import { ChatbotTool, CallerContext } from './chatbot-tool.interface';

export const getReorderQueueTool: ChatbotTool = {
  name: 'get_reorder_queue',
  description:
    'Retrieves recurring customer order predictions and reorder queue, scoped strictly by assigned salesperson and team hierarchy.',
  roles: ['salesperson', 'manager', 'admin'],
  declaration: {
    name: 'get_reorder_queue',
    description:
      'Retrieves list of recurring customers due for reorder based on their historical order frequency.',
    parameters: {
      type: 'OBJECT',
      properties: {
        max_results: {
          type: 'NUMBER',
          description:
            'Optional maximum number of records to return (default 10)',
        },
      },
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    let query = supabaseAdmin
      .from('recurring_customers')
      .select(
        'id, customer_name, customer_phone, customer_address, assigned_salesperson_phone, last_order_date, avg_order_frequency_days, is_active, notes',
      )
      .eq('is_active', true)
      .order('last_order_date', { ascending: true });

    // Scoping per role
    if (callerContext.role === 'salesperson') {
      const phone = callerContext.phone;
      if (phone) {
        query = query.eq('assigned_salesperson_phone', phone);
      }
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
        query = query.in('assigned_salesperson_phone', allowedPhones);
      }
    }
    // Admin receives all active recurring customers

    const limit = args?.max_results || 10;
    query = query.limit(limit);

    const { data, error } = await query;
    if (error) {
      throw new Error(`get_reorder_queue error: ${error.message}`);
    }

    const reorderList = data || [];
    return {
      data: reorderList,
      rowCount: reorderList.length,
    };
  },
};
