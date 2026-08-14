import { ChatbotTool } from './chatbot-tool.interface';

export const getTeamPipelineTool: ChatbotTool = {
  name: 'get_team_pipeline',
  description:
    'Retrieves team-wide sales pipeline summary aggregated by salesperson and deal stage. Available ONLY to sales managers and admins.',
  roles: ['manager', 'admin'],
  declaration: {
    name: 'get_team_pipeline',
    description:
      'Retrieves team-wide sales pipeline summary aggregated by salesperson and deal stage. Available ONLY to sales managers and admins.',
    parameters: {
      type: 'OBJECT',
      properties: {
        stage_filter: {
          type: 'STRING',
          description:
            'Optional filter by deal stage (e.g. "new_inquiry", "quote_sent", "negotiation", "won")',
        },
      },
      required: [],
    },
  },
  async execute(args, callerContext, supabaseAdmin) {
    // Layer 1 Application-level role check
    if (!['manager', 'admin'].includes(callerContext.role)) {
      throw new Error(
        `Role '${callerContext.role}' is not authorized to use tool 'get_team_pipeline'`,
      );
    }

    let query = supabaseAdmin
      .from('deals')
      .select(
        'id, customer_name, customer_phone, total_amount, stage, status, salesperson_phone, employee_id, created_at',
      );

    // Scoping Layer
    if (callerContext.role === 'manager') {
      if (!callerContext.employeeId) {
        return {
          data: [],
          rowCount: 0,
          message: 'Manager employee ID not found',
        };
      }

      // Fetch subordinate employees reporting to manager
      const { data: subEmps } = await supabaseAdmin
        .from('employees')
        .select('id, employee_id, phone, name')
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
    // Admin sees all deals across company

    if (args?.stage_filter) {
      query = query.eq('stage', args.stage_filter);
    }

    const { data: deals, error } = await query
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(`Failed to fetch team pipeline: ${error.message}`);
    }

    const rows = deals || [];

    // Aggregate summary statistics
    const summaryByStage: Record<
      string,
      { count: number; total_value: number }
    > = {};
    let grandTotalValue = 0;

    for (const d of rows) {
      const stage = d.stage || 'unknown';
      const val = parseFloat(d.total_amount) || 0;
      grandTotalValue += val;

      if (!summaryByStage[stage]) {
        summaryByStage[stage] = { count: 0, total_value: 0 };
      }
      summaryByStage[stage].count += 1;
      summaryByStage[stage].total_value += val;
    }

    return {
      data: {
        total_deals_count: rows.length,
        grand_total_pipeline_value: grandTotalValue,
        stage_breakdown: summaryByStage,
        deals: rows.slice(0, 20),
      },
      rowCount: rows.length,
    };
  },
};
