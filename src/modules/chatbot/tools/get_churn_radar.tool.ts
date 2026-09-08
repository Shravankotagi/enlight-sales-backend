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
    const rawPhone = callerContext.phone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);

    let scopedPhones: string[] | undefined = undefined;
    if (isSalespersonRole(callerContext.role)) {
      if (cleanPhone) {
        scopedPhones = [cleanPhone];
      } else {
        return {
          data: {
            total_accounts_assessed: 0,
            high_risk_count: 0,
            medium_risk_count: 0,
            churn_radar_accounts: [],
            note: 'No assigned accounts found for this salesperson.',
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
        return {
          data: {
            total_accounts_assessed: 0,
            high_risk_count: 0,
            medium_risk_count: 0,
            churn_radar_accounts: [],
            note: 'No subordinate salespersons found for this manager.',
          },
          rowCount: 0,
        };
      }
      scopedPhones = phoneSuffixes;
    }

    try {
      const { CustomersService } =
        await import('../../customers/customers.service');
      const { CustomerInsightsService } =
        await import('../../customers/customer-insights.service');
      const customersService = new CustomersService(
        {
          getAdminClient: () => supabaseAdmin,
          getClient: () => supabaseAdmin,
        } as any,
        new CustomerInsightsService(),
      );

      const churnList = await customersService.getChurnRisk(scopedPhones);
      const assessed = churnList || [];

      const accounts = assessed.map((c: any) => {
        const risk = (c.churn_risk || 'active').toLowerCase();
        let riskLevel = 'low';
        if (risk === 'churning') riskLevel = 'high';
        else if (risk === 'at_risk') riskLevel = 'medium';

        return {
          customer_name: c.customer_name || 'Unnamed Customer',
          contact_person: c.contact_person || 'N/A',
          phone: c.customer_phone || c.phone || c.assigned_salesperson_phone,
          email: c.email || '',
          last_order_date: c.last_order_date || 'N/A',
          days_since_order: c.days_since_order,
          days_overdue_reorder: Math.max(
            0,
            (c.days_since_order || 0) - (c.avg_order_frequency_days || 30),
          ),
          avg_cycle_days: c.avg_order_frequency_days || 30,
          risk_level: riskLevel,
          segment: c.segment || 'new',
        };
      });

      const highRisk = accounts.filter((a: any) => a.risk_level === 'high');
      const medRisk = accounts.filter((a: any) => a.risk_level === 'medium');

      let filtered = accounts;
      if (args?.risk_level) {
        filtered = accounts.filter(
          (a: any) =>
            a.risk_level.toLowerCase() === args.risk_level.toLowerCase(),
        );
      } else {
        filtered = accounts.filter((a: any) => a.risk_level !== 'low');
        if (filtered.length === 0) filtered = [];
      }

      let note = '';
      if (highRisk.length === 0 && medRisk.length === 0) {
        note =
          'There are currently 0 accounts marked as At Risk or High Risk. All customer accounts are active and in good standing.';
      }

      return {
        data: {
          total_accounts_assessed: accounts.length,
          high_risk_count: highRisk.length,
          medium_risk_count: medRisk.length,
          churn_radar_accounts: filtered.slice(0, 15),
          note: note || undefined,
        },
        rowCount: filtered.length,
      };
    } catch {
      return {
        data: {
          total_accounts_assessed: 0,
          high_risk_count: 0,
          medium_risk_count: 0,
          churn_radar_accounts: [],
          note: 'Error assessing churn radar accounts.',
        },
        rowCount: 0,
      };
    }
  },
};
