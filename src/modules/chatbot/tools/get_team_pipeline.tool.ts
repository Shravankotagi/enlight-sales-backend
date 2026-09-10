import {
  ChatbotTool,
  getSubordinateSalespersons,
  isManagerRole,
} from './chatbot-tool.interface';

export const getTeamPipelineTool: ChatbotTool = {
  name: 'get_team_pipeline',
  description:
    'Retrieves team-wide sales pipeline summary and sales rep conversion rankings (which rep converts the most inquiries/deals into orders). Scoped strictly by caller role.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_team_pipeline',
    description:
      'Retrieves team-wide sales pipeline summary and sales rep conversion rankings (which sales rep converts the most inquiries into orders). Scoped strictly by caller role.',
    parameters: {
      type: 'OBJECT',
      properties: {
        stage_filter: {
          type: 'STRING',
          description:
            'Optional filter by deal stage (e.g. "new_inquiry", "quote_sent", "negotiation", "won")',
        },
        mode: {
          type: 'STRING',
          description:
            'Optional query mode: "pipeline_summary" (default) or "rep_conversion" / "salesperson_leaderboard" (ranks sales reps by inquiries/deals converted to orders).',
        },
      },
      required: [],
    },
  },
  async execute(args, callerContext, supabaseAdmin) {
    let query = supabaseAdmin
      .from('deals')
      .select(
        'id, inquiry_id, customer_name, customer_phone, total_amount, stage, status, po_number, salesperson_phone, employee_id, created_at',
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
    // Admin and Salesperson see leaderboard across company deals

    if (args?.stage_filter) {
      query = query.eq('stage', args.stage_filter);
    }

    const { data: deals, error } = await query.order('created_at', {
      ascending: false,
    });

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

    // Rep conversion aggregation
    const { data: emps } = await supabaseAdmin
      .from('employees')
      .select('id, name, phone, role');

    const empMap = new Map<string, string>();
    (emps || []).forEach((e: any) => {
      const clean = (e.phone || '').replace(/\D/g, '').slice(-10);
      if (clean) empMap.set(clean, e.name);
    });

    const repStatsMap = new Map<string, any>();
    rows.forEach((d: any) => {
      const clean = (d.salesperson_phone || '').replace(/\D/g, '').slice(-10);
      if (!clean) return;
      if (!repStatsMap.has(clean)) {
        repStatsMap.set(clean, {
          salesperson_name: empMap.get(clean) || 'Sales Rep',
          salesperson_phone: clean,
          total_deals: 0,
          won_deals: 0,
          won_value: 0,
        });
      }
      const r = repStatsMap.get(clean);
      r.total_deals++;
      const isWon =
        (d.stage || '').toLowerCase() === 'won' ||
        (d.stage || '').toLowerCase() === 'order' ||
        Boolean(d.po_number);
      if (isWon) {
        r.won_deals++;
        r.won_value += Number(d.total_amount || 0);
      }
    });

    const leaderboard = Array.from(repStatsMap.values())
      .map((r: any) => ({
        ...r,
        win_rate_percent:
          r.total_deals > 0
            ? `${((r.won_deals / r.total_deals) * 100).toFixed(1)}%`
            : '0%',
      }))
      .sort((a, b) => b.won_deals - a.won_deals);

    const topRep = leaderboard[0] || null;

    return {
      data: {
        total_deals_count: rows.length,
        grand_total_pipeline_value: grandTotalValue,
        stage_breakdown: summaryByStage,
        top_converter: topRep,
        rep_conversion_leaderboard: leaderboard,
        deals: rows.slice(0, 20).map((d: any) => {
          const rawId = d.inquiry_id || d.id || '';
          return {
            ...d,
            inquiry_id: `#INQ-${rawId.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
            full_id: rawId,
          };
        }),
      },
      rowCount: rows.length,
    };
  },
};
