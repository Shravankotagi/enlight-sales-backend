import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  private getMonthRange(month?: number, year?: number) {
    const now = new Date();
    const m = month !== undefined ? month : now.getMonth();
    const y = year || now.getFullYear();
    const start = new Date(Date.UTC(y, m, 1, 0, 0, 0)).toISOString();
    const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)).toISOString();
    const monthName = new Date(Date.UTC(y, m, 1)).toLocaleString('en-IN', {
      month: 'long',
      timeZone: 'UTC',
    });
    return { start, end, monthName, year: y, month: m };
  }

  // Monthly sales report
  async getMonthlySalesReport(
    month?: number,
    year?: number,
    salespersonPhone?: string,
    from?: string,
    to?: string,
  ) {
    try {
      let start: string;
      let end: string;
      let monthName = '';
      let y = year || new Date().getFullYear();

      if (from && to) {
        start = new Date(from).toISOString();
        end = new Date(
          to.includes('T') ? to : to + 'T23:59:59.999Z',
        ).toISOString();
        monthName = 'Selected Range';
      } else {
        const range = this.getMonthRange(month, year);
        start = range.start;
        end = range.end;
        monthName = range.monthName;
        y = range.year;
      }

      let dealsQuery = this.supabase
        .from('deals')
        .select('*')
        .neq('inquiry_type', 'unknown')
        .gte('created_at', start)
        .lte('created_at', end);
      let inquiriesQuery = this.supabase
        .from('inquiries')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end);

      if (salespersonPhone) {
        const cleanDigits = salespersonPhone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;
        dealsQuery = dealsQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12}`,
        );
        inquiriesQuery = inquiriesQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12},sender_phone.eq.${p10},sender_phone.eq.${p12}`,
        );
      }

      const [dealsResult, inquiriesResult] = await Promise.all([
        dealsQuery,
        inquiriesQuery,
      ]);

      if (dealsResult.error) throw dealsResult.error;
      if (inquiriesResult.error) throw inquiriesResult.error;

      const deals = dealsResult.data || [];
      const inquiries = inquiriesResult.data || [];

      const wonDeals = deals.filter((d) => d.stage === 'won');
      const lostDeals = deals.filter((d) => d.stage === 'lost');
      const pendingDeals = deals.filter(
        (d) => !['won', 'lost'].includes(d.stage),
      );

      const totalValue = wonDeals.reduce(
        (sum, d) => sum + (d.total_amount || 0),
        0,
      );
      const wonValue = totalValue; // wonValue matches totalValue now

      // Group deals by customer (only count won deals for sales revenue value)
      const byCustomer = wonDeals.reduce(
        (acc, deal) => {
          const name = deal.customer_name || 'Unknown';
          if (!acc[name]) {
            acc[name] = { customer: name, deals: 0, value: 0 };
          }
          acc[name].deals++;
          acc[name].value += deal.total_amount || 0;
          return acc;
        },
        {} as Record<string, any>,
      );

      // Group by inquiry type (only count won deals for product type revenue breakdown)
      const byType = wonDeals.reduce(
        (acc, deal) => {
          const type = deal.inquiry_type || 'unknown';
          if (!acc[type]) acc[type] = { type, count: 0, value: 0 };
          acc[type].count++;
          acc[type].value += deal.total_amount || 0;
          return acc;
        },
        {} as Record<string, any>,
      );

      // Lost reason analysis
      const lostReasons = lostDeals.reduce(
        (acc, deal) => {
          const reason = deal.lost_reason || 'unknown';
          acc[reason] = (acc[reason] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      return {
        period: { month: monthName, year: y, start, end },
        summary: {
          total_deals: deals.length,
          won: wonDeals.length,
          lost: lostDeals.length,
          pending: pendingDeals.length,
          total_value: totalValue,
          won_value: wonValue,
          conversion_rate:
            deals.length > 0
              ? Math.round((wonDeals.length / deals.length) * 100)
              : inquiries.length > 0
                ? Math.round((wonDeals.length / inquiries.length) * 100)
                : 0,
          total_inquiries: inquiries.length,
        },
        by_customer: Object.values(byCustomer).sort(
          (a: any, b: any) => b.value - a.value,
        ),
        by_type: Object.values(byType),
        lost_reasons: lostReasons,
      };
    } catch (error) {
      this.logger.error('Error in getMonthlySalesReport:', error);
      throw error;
    }
  }

  // Salesperson performance report
  async getSalespersonReport(
    month?: number,
    year?: number,
    from?: string,
    to?: string,
  ) {
    try {
      let start: string;
      let end: string;
      let monthName = '';
      let y = year || new Date().getFullYear();

      if (from && to) {
        start = new Date(from).toISOString();
        end = new Date(
          to.includes('T') ? to : to + 'T23:59:59.999Z',
        ).toISOString();
        monthName = 'Selected Range';
      } else {
        const range = this.getMonthRange(month, year);
        start = range.start;
        end = range.end;
        monthName = range.monthName;
        y = range.year;
      }

      const [
        dealsResult,
        visitsResult,
        complaintsResult,
        kraLogsResult,
        paymentsResult,
      ] = await Promise.all([
        this.supabase
          .from('deals')
          .select('*')
          .neq('inquiry_type', 'unknown')
          .gte('created_at', start)
          .lte('created_at', end),
        this.supabase
          .from('customer_visits')
          .select('*')
          .gte('visited_at', start)
          .lte('visited_at', end),
        this.supabase
          .from('complaints')
          .select('*')
          .gte('reported_at', start)
          .lte('reported_at', end),
        this.supabase
          .from('kra_logs')
          .select('*')
          .gte('created_at', start)
          .lte('created_at', end),
        this.supabase
          .from('payment_tracking')
          .select('*')
          .gte('created_at', start)
          .lte('created_at', end),
      ]);

      if (dealsResult.error) throw dealsResult.error;
      if (visitsResult.error) throw visitsResult.error;
      if (complaintsResult.error) throw complaintsResult.error;
      if (kraLogsResult.error) throw kraLogsResult.error;
      if (paymentsResult.error) throw paymentsResult.error;

      const deals = dealsResult.data || [];
      const visits = visitsResult.data || [];
      const complaints = complaintsResult.data || [];
      const kraLogs = kraLogsResult.data || [];
      const payments = paymentsResult.data || [];

      // Fetch all employees from database
      const { data: employees } = await this.supabase
        .from('employees')
        .select('name, phone, role');

      const allEmployees = employees || [];
      const employeeMap = allEmployees.reduce(
        (acc: any, emp: any) => {
          acc[emp.phone] = emp.name;
          return acc;
        },
        {} as Record<string, string>,
      );

      // Get all salesperson phones from employees table (role === 'salesperson')
      const salespersonEmployees = allEmployees.filter(
        (emp) => emp.phone && emp.role === 'salesperson',
      );

      const phones = new Set<string>(
        [
          ...salespersonEmployees.map((e) => e.phone),
          ...visits.map((v) => v.salesperson_phone),
          ...kraLogs.map((k) => k.salesperson_phone),
          ...deals.map((d) => d.salesperson_phone),
        ].filter(Boolean),
      );

      const salespersonReports = Array.from(phones).map((phone) => {
        const spDeals = deals.filter((d) => d.salesperson_phone === phone);
        const spVisits = visits.filter((v) => v.salesperson_phone === phone);
        const spKraLogs = kraLogs.filter((k) => k.salesperson_phone === phone);
        const spPayments = payments.filter(
          (p) => p.salesperson_phone === phone,
        );

        const spComplaints = complaints.filter((c) => c.reported_by === phone);

        const wonDeals = spDeals.filter((d) => d.stage === 'won');
        const totalValue = wonDeals.reduce(
          (sum, d) => sum + (d.total_amount || 0),
          0,
        );
        const newCustomers = spKraLogs.filter(
          (k) => k.kra_number === 2 && k.kra_type === 'new_customer',
        ).length;
        const collectedPayments = spPayments.filter(
          (p) => p.status === 'collected',
        );

        return {
          salesperson_phone: phone,
          name: employeeMap[phone] || 'Unknown',
          deals: {
            total: spDeals.length,
            won: wonDeals.length,
            total_value: totalValue,
          },

          visits: {
            total: spVisits.length,
            target: 40,
            achievement_pct: Math.round((spVisits.length / 40) * 100),
          },
          new_customers: {
            count: newCustomers,
            target: 3,
          },
          payments: {
            collected: collectedPayments.length,
            total_collected_value: collectedPayments.reduce(
              (sum, p) => sum + (p.invoice_amount || 0),
              0,
            ),
          },
          complaints: {
            total: spComplaints.length,
            resolved: spComplaints.filter((c) => c.status === 'resolved')
              .length,
          },
          kra_score: Math.round(
            Math.min(spDeals.length / 5, 1) * 20 +
              Math.min(spVisits.length / 40, 1) * 20 +
              Math.min(newCustomers / 3, 1) * 20 +
              Math.min(collectedPayments.length / 5, 1) * 20 +
              (spComplaints.length === 0
                ? 1
                : spComplaints.filter((c) => c.status === 'resolved').length /
                  spComplaints.length) *
                20,
          ),
        };
      });

      return {
        period: { month: monthName, year: y },
        salespersons: salespersonReports.sort(
          (a, b) => b.kra_score - a.kra_score,
        ),
      };
    } catch (error) {
      this.logger.error('Error in getSalespersonReport:', error);
      throw error;
    }
  }

  async getFunnelReport(
    month?: number,
    year?: number,
    salespersonPhone?: string,
    from?: string,
    to?: string,
  ) {
    try {
      let start: string;
      let end: string;
      let monthName = '';
      let y = year || new Date().getFullYear();

      if (from && to) {
        start = new Date(from).toISOString();
        end = new Date(
          to.includes('T') ? to : to + 'T23:59:59.999Z',
        ).toISOString();
        monthName = 'Selected Range';
      } else {
        const range = this.getMonthRange(month, year);
        start = range.start;
        end = range.end;
        monthName = range.monthName;
        y = range.year;
      }

      const dealsQuery = this.supabase
        .from('deals')
        .select('*')
        .neq('inquiry_type', 'unknown')
        .or(
          `and(created_at.gte.${start},created_at.lte.${end}),and(stage.eq.won,won_at.gte.${start},won_at.lte.${end})`,
        );

      const { data: deals } = await dealsQuery;
      const safeDeals = deals || [];

      const stages = [
        { key: 'new_deals', label: 'New Deals' },
        { key: 'qualified', label: 'Qualified' },
        { key: 'quoted', label: 'Quoted' },
        { key: 'negotiation', label: 'Negotiation' },
        { key: 'won', label: 'Won' },
        { key: 'lost', label: 'Lost' },
      ];

      const funnel = stages.map(({ key, label }) => {
        const stageDeals = safeDeals.filter((d) => {
          if (key === 'new_deals') {
            return (
              d.stage === 'new_inquiry' ||
              d.stage === 'new_deals' ||
              d.stage === 'new' ||
              d.stage === 'inquiry'
            );
          }
          return d.stage === key;
        });
        const count = stageDeals.length;
        return {
          stage: key,
          label,
          count,
          value: stageDeals.reduce(
            (sum, d) => sum + (Number(d.total_amount) || 0),
            0,
          ),
        };
      });

      const maxCount = Math.max(...funnel.map((f) => f.count), 1);
      const wonCount = funnel.find((f) => f.stage === 'won')?.count || 0;
      const totalBase = safeDeals.length;

      const overallWinRate =
        totalBase > 0 ? Math.round((wonCount / totalBase) * 100) : 0;

      return {
        period: { month: monthName, year: y },
        funnel,
        max_count: maxCount,
        overall_win_rate: overallWinRate,
      };
    } catch (error) {
      this.logger.error('Error in getFunnelReport:', error);
      throw error;
    }
  }

  async getSkuReport(
    month?: number,
    year?: number,
    salespersonPhone?: string,
    from?: string,
    to?: string,
  ) {
    try {
      let start: string;
      let end: string;
      let monthName = '';
      let y = year || new Date().getFullYear();

      if (from && to) {
        start = new Date(from).toISOString();
        end = new Date(
          to.includes('T') ? to : to + 'T23:59:59.999Z',
        ).toISOString();
        monthName = 'Selected Range';
      } else {
        const range = this.getMonthRange(month, year);
        start = range.start;
        end = range.end;
        monthName = range.monthName;
        y = range.year;
      }

      let itemsQuery = this.supabase
        .from('deal_items')
        .select(
          '*, deals!inner(created_at, won_at, stage, salesperson_phone, inquiry_type)',
        )
        .neq('deals.inquiry_type', 'unknown')
        .eq('deals.stage', 'won');

      if (salespersonPhone) {
        const cleanDigits = salespersonPhone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;
        itemsQuery = itemsQuery.or(
          `deals.salesperson_phone.eq.${p10},deals.salesperson_phone.eq.${p12}`,
        );
      }

      const { data: items, error } = await itemsQuery;

      if (error) throw error;

      const validItems = (items || []).filter((item: any) => {
        const d = item.deals;
        if (!d) return false;
        const dealDate = d.won_at || d.created_at;
        return dealDate >= start && dealDate <= end;
      });

      const bysku = validItems.reduce(
        (acc, item) => {
          const sku = item.sku_text || 'Unknown';
          if (!acc[sku]) {
            acc[sku] = {
              sku_text: sku,
              grade: item.grade,
              total_quantity: 0,
              total_value: 0,
              deal_count: 0,
              unit: item.unit,
            };
          }
          acc[sku].total_quantity += item.quantity || 0;
          acc[sku].total_value += item.amount || 0;
          acc[sku].deal_count++;
          return acc;
        },
        {} as Record<string, any>,
      );

      return {
        period: { month: monthName, year: y },
        skus: Object.values(bysku).sort(
          (a: any, b: any) => b.total_value - a.total_value,
        ),
      };
    } catch (error) {
      this.logger.error('Error in getSkuReport:', error);
      throw error;
    }
  }
}
