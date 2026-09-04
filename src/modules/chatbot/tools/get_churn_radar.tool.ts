import {
  ChatbotTool,
  getSubordinateSalespersons,
  isManagerRole,
  isSalespersonRole,
} from './chatbot-tool.interface';

export const getChurnRadarTool: ChatbotTool = {
  name: 'get_churn_radar',
  description:
    'Identifies customer accounts at risk of churn based on order frequency, days since last order, and payment delays.',
  roles: ['salesperson', 'manager', 'sales_manager', 'admin'],
  declaration: {
    name: 'get_churn_radar',
    description:
      'Identifies customer accounts at risk of churn based on order frequency, days since last order, and payment delays.',
    parameters: {
      type: 'OBJECT',
      properties: {
        risk_level: {
          type: 'STRING',
          description:
            'Optional filter by risk level: "high", "medium", or "low"',
        },
      },
      required: [],
    },
  },
  async execute(args, callerContext, supabaseAdmin) {
    let query = supabaseAdmin.from('recurring_customers').select('*');

    // Scoping Layer
    const rawPhone = callerContext.phone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);

    if (isSalespersonRole(callerContext.role)) {
      if (cleanPhone) {
        query = query.ilike('assigned_salesperson_phone', `%${cleanPhone}%`);
      } else {
        return {
          data: {
            total_accounts_assessed: 0,
            high_risk_count: 0,
            medium_risk_count: 0,
            churn_radar_accounts: [],
          },
          rowCount: 0,
        };
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
    // Admin sees all customers

    const { data: customers, error } = await query.limit(100);

    if (error) {
      throw new Error(`Failed to fetch churn radar accounts: ${error.message}`);
    }

    const now = new Date();

    // Calculate churn risk score per customer
    const atRiskAccounts = (customers || []).map((c: any) => {
      const lastOrder = c.last_order_date ? new Date(c.last_order_date) : null;
      const daysSinceLastOrder = lastOrder
        ? Math.floor(
            (now.getTime() - lastOrder.getTime()) / (1000 * 60 * 60 * 24),
          )
        : 999;
      const avgFreq = c.average_order_frequency_days || 30;

      let riskScore = 'low';
      if (daysSinceLastOrder > avgFreq * 2) {
        riskScore = 'high';
      } else if (daysSinceLastOrder > avgFreq * 1.3) {
        riskScore = 'medium';
      }

      return {
        customer_name: c.customer_name || 'Unnamed Customer',
        contact_person: c.contact_person || 'N/A',
        phone: c.phone || c.assigned_salesperson_phone,
        email: c.email || '',
        last_order_date: c.last_order_date || 'N/A',
        days_overdue_reorder: Math.max(0, daysSinceLastOrder - avgFreq),
        avg_cycle_days: avgFreq,
        risk_level: riskScore,
      };
    });

    let filtered = atRiskAccounts;
    if (args?.risk_level) {
      filtered = atRiskAccounts.filter(
        (a: any) =>
          a.risk_level.toLowerCase() === args.risk_level.toLowerCase(),
      );
    } else {
      // Return medium and high risk accounts by default (or all if < 5)
      filtered = atRiskAccounts.filter((a: any) => a.risk_level !== 'low');
      if (filtered.length === 0) filtered = atRiskAccounts;
    }

    filtered.sort(
      (a: any, b: any) => b.days_overdue_reorder - a.days_overdue_reorder,
    );

    return {
      data: {
        total_accounts_assessed: customers?.length || 0,
        high_risk_count: atRiskAccounts.filter(
          (a: any) => a.risk_level === 'high',
        ).length,
        medium_risk_count: atRiskAccounts.filter(
          (a: any) => a.risk_level === 'medium',
        ).length,
        churn_radar_accounts: filtered.slice(0, 15),
      },
      rowCount: filtered.length,
    };
  },
};
