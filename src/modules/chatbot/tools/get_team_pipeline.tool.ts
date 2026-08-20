import {
  ChatbotTool,
  getSubordinateSalespersons,
  isManagerRole,
  isAdminRole,
} from './chatbot-tool.interface';

export const getTeamPipelineTool: ChatbotTool = {
  name: 'get_team_pipeline',
  description:
    'Retrieves team-wide sales pipeline summary aggregated by salesperson and deal stage. Available ONLY to sales managers and admins.',
  roles: ['manager', 'sales_manager', 'admin'],
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
    if (
      !isManagerRole(callerContext.role) &&
      !isAdminRole(callerContext.role)
    ) {
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
    if (isManagerRole(callerContext.role)) {
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

      if (orClauses.length === 0) {
        return {
          data: {
            total_deals_count: 0,
            grand_total_pipeline_value: 0,
            stage_breakdown: {},
            deals: [],
          },
          rowCount: 0,
        };
      }

      query = query.or(orClauses.join(','));
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
