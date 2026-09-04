import {
  ChatbotTool,
  CallerContext,
  getSubordinateSalespersons,
  isManagerRole,
  isSalespersonRole,
} from './chatbot-tool.interface';

export const getReorderQueueTool: ChatbotTool = {
  name: 'get_reorder_queue',
  description:
    'Retrieves recurring customer order predictions and reorder queue, scoped strictly by assigned salesperson and team hierarchy.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
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
    const rawPhone = callerContext.phone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);

    if (isSalespersonRole(callerContext.role)) {
      if (cleanPhone) {
        query = query.ilike('assigned_salesperson_phone', `%${cleanPhone}%`);
      } else {
        return { data: [], rowCount: 0 };
      }
    } else if (isManagerRole(callerContext.role)) {
      const { phoneSuffixes } = await getSubordinateSalespersons(
        callerContext,
        supabaseAdmin,
      );

      if (phoneSuffixes.length === 0) {
        return { data: [], rowCount: 0 };
      }

      const orConditions = phoneSuffixes.map(
        (p) => `assigned_salesperson_phone.ilike.%${p}%`,
      );
      query = query.or(orConditions.join(','));
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
