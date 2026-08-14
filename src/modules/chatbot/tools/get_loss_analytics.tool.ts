import { ChatbotTool } from './chatbot-tool.interface';

export const getLossAnalyticsTool: ChatbotTool = {
  name: 'get_loss_analytics',
  description:
    'Analyzes lost deals, common loss reasons, total lost revenue, and lost deal trends. Available ONLY to sales managers and admins.',
  roles: ['manager', 'admin'],
  declaration: {
    name: 'get_loss_analytics',
    description:
      'Analyzes lost deals, common loss reasons, total lost revenue, and lost deal trends. Available ONLY to sales managers and admins.',
    parameters: {
      type: 'OBJECT',
      properties: {
        timeframe_days: {
          type: 'NUMBER',
          description:
            'Optional timeframe in days to analyze lost deals (e.g. 30, 90, 180). Default: 90.',
        },
      },
      required: [],
    },
  },
  async execute(args, callerContext, supabaseAdmin) {
    // Layer 1 Application-level role check
    if (!['manager', 'admin'].includes(callerContext.role)) {
      throw new Error(
        `Role '${callerContext.role}' is not authorized to use tool 'get_loss_analytics'`,
      );
    }

    let query = supabaseAdmin
      .from('deals')
      .select(
        'id, customer_name, customer_phone, total_amount, stage, status, salesperson_phone, employee_id, created_at',
      )
      .eq('stage', 'lost');

    // Scoping Layer
    if (callerContext.role === 'manager') {
      if (!callerContext.employeeId) {
        return {
          data: [],
          rowCount: 0,
          message: 'Manager employee ID not found',
        };
      }

      const { data: subEmps } = await supabaseAdmin
        .from('employees')
        .select('id, employee_id, phone')
        .eq('reports_to_employee_id', callerContext.employeeId);

      const subPhones = (subEmps || []).map((e) => e.phone).filter(Boolean);
      const subEmpIds = (subEmps || [])
        .map((e) => e.employee_id || e.id)
        .filter(Boolean);

      const allowedPhones = [...subPhones, callerContext.phone].filter(Boolean);
      const allowedEmpIds = [...subEmpIds, callerContext.employeeId].filter(
        Boolean,
      );

      const orClauses: string[] = [];
      if (allowedPhones.length > 0) {
        orClauses.push(
          `salesperson_phone.in.(${allowedPhones.map((p) => `"${p}"`).join(',')})`,
        );
      }
      if (allowedEmpIds.length > 0) {
        orClauses.push(
          `employee_id.in.(${allowedEmpIds.map((id) => `"${id}"`).join(',')})`,
        );
      }

      if (orClauses.length > 0) {
        query = query.or(orClauses.join(','));
      }
    }
    // Admin sees all lost deals

    const { data: deals, error } = await query
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      throw new Error(`Failed to fetch loss analytics: ${error.message}`);
    }

    const rows = deals || [];
    let totalLostValue = 0;
    const lossReasonBreakdown: Record<
      string,
      { count: number; lost_value: number }
    > = {};

    for (const d of rows) {
      const val = parseFloat(d.total_amount) || 0;
      totalLostValue += val;

      const reason = d.status || 'Pricing / Competitor Win';
      if (!lossReasonBreakdown[reason]) {
        lossReasonBreakdown[reason] = { count: 0, lost_value: 0 };
      }
      lossReasonBreakdown[reason].count += 1;
      lossReasonBreakdown[reason].lost_value += val;
    }

    return {
      data: {
        total_lost_deals_count: rows.length,
        total_lost_revenue_usd: totalLostValue,
        loss_reasons_breakdown: lossReasonBreakdown,
        recent_lost_deals: rows.slice(0, 15),
      },
      rowCount: rows.length,
    };
  },
};
