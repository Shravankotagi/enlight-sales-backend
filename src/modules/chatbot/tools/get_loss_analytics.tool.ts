import { ChatbotTool } from './chatbot-tool.interface';

export const getLossAnalyticsTool: ChatbotTool = {
  name: 'get_loss_analytics',
  description:
    'Analyzes lost deals, common loss reasons, total lost revenue, and lost deal trends scoped to caller permissions.',
  roles: ['salesperson', 'manager', 'admin'],
  declaration: {
    name: 'get_loss_analytics',
    description:
      'Analyzes lost deals, common loss reasons, total lost revenue, and lost deal trends.',
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
    // Application-level role check
    if (!['salesperson', 'manager', 'admin'].includes(callerContext.role)) {
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
      const empId = callerContext.employeeId;
      const rawPhone = callerContext.phone || '';
      const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);

      const allowedPhoneSuffixes: string[] = cleanPhone ? [cleanPhone] : [];
      const allowedEmpIds: string[] = empId ? [empId] : [];

      if (empId) {
        const { data: subEmps } = await supabaseAdmin
          .from('employees')
          .select('id, employee_id, phone')
          .eq('reports_to_employee_id', empId);

        if (subEmps && subEmps.length > 0) {
          subEmps.forEach((e: any) => {
            if (e.phone) {
              const pClean = e.phone.replace(/\D/g, '').slice(-10);
              if (pClean) allowedPhoneSuffixes.push(pClean);
            }
            if (e.employee_id) allowedEmpIds.push(e.employee_id);
            if (e.id) allowedEmpIds.push(e.id);
          });
        }
      }

      const orClauses: string[] = [];
      allowedPhoneSuffixes.forEach((p) => {
        orClauses.push(`salesperson_phone.ilike.%${p}%`);
      });
      allowedEmpIds.forEach((id) => {
        orClauses.push(`employee_id.eq.${id}`);
      });

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
