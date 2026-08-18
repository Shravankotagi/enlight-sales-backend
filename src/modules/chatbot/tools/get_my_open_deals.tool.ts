import {
  ChatbotTool,
  CallerContext,
  getSubordinateSalespersons,
} from './chatbot-tool.interface';

export const getMyOpenDealsTool: ChatbotTool = {
  name: 'get_my_open_deals',
  description:
    'Fetches deals (negotiations, quotations, review, won, or lost) scoped strictly by the authenticated caller role and team hierarchy.',
  roles: ['salesperson', 'manager', 'admin'],
  declaration: {
    name: 'get_my_open_deals',
    description:
      'Retrieves deals for the authenticated user based on assigned role scope. Valid stage_filter values: "review", "quoted", "negotiation", "won", "lost".',
    parameters: {
      type: 'OBJECT',
      properties: {
        stage_filter: {
          type: 'STRING',
          description:
            'Optional filter by deal stage. Valid values: "review", "quoted", "negotiation", "won", "lost".',
        },
      },
    },
  },
  async execute(args: any, callerContext: CallerContext, supabaseAdmin: any) {
    let rawStage = (args?.stage_filter || '').toLowerCase().trim();

    // Map common user terms to exact DB stages
    if (
      rawStage === 'quote_sent' ||
      rawStage === 'quotation' ||
      rawStage === 'quotes'
    ) {
      rawStage = 'quoted';
    } else if (
      rawStage === 'new_inquiry' ||
      rawStage === 'inquiry' ||
      rawStage === 'inquiries'
    ) {
      rawStage = 'review';
    } else if (rawStage === 'negotiating') {
      rawStage = 'negotiation';
    }

    let query = supabaseAdmin
      .from('deals')
      .select(
        'id, customer_name, customer_phone, customer_gst, customer_address, payment_terms, total_amount, stage, status, po_number, created_at, salesperson_phone, employee_id, deal_items(sku_text, quantity, unit, rate, amount)',
      )
      .order('created_at', { ascending: false });

    // Exclude lost deals by default unless stage_filter explicitly requests 'lost'
    if (rawStage !== 'lost' && !rawStage) {
      query = query.neq('stage', 'lost');
    }

    // 1. Role-based scoping (Layer 1 enforcement)
    if (callerContext.role === 'salesperson') {
      const rawPhone = callerContext.phone || '';
      const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
      const empId = callerContext.employeeId;

      if (cleanPhone && empId) {
        query = query.or(
          `salesperson_phone.ilike.%${cleanPhone}%,employee_id.eq.${empId}`,
        );
      } else if (cleanPhone) {
        query = query.ilike('salesperson_phone', `%${cleanPhone}%`);
      } else if (empId) {
        query = query.eq('employee_id', empId);
      }
    } else if (callerContext.role === 'manager') {
      const { employeeIds, phoneSuffixes } = await getSubordinateSalespersons(
        callerContext,
        supabaseAdmin,
      );

      const conditions: string[] = [];
      phoneSuffixes.forEach((p) => {
        conditions.push(`salesperson_phone.ilike.%${p}%`);
      });
      employeeIds.forEach((id) => {
        conditions.push(`employee_id.eq.${id}`);
      });

      if (conditions.length > 0) {
        query = query.or(conditions.join(','));
      }
    }
    // Admin role receives no filtering (unfiltered view)

    // Apply stage filter case-insensitively
    if (rawStage) {
      query = query.ilike('stage', `%${rawStage}%`);
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
