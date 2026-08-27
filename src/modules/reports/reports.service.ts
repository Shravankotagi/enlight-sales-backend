import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { phoneInList } from '../employees/employees.service';

function buildMultiFieldOrFilter(
  salespersonPhones?: string[] | string,
  fieldNames: string[] = ['salesperson_phone'],
): string | null {
  if (!salespersonPhones) return null;
  const list = Array.isArray(salespersonPhones)
    ? salespersonPhones
    : [salespersonPhones];
  const parts: string[] = [];
  for (const phone of list) {
    if (!phone) continue;
    const clean = phone.replace(/\D/g, '');
    const p10 = clean.slice(-10);
    const p12 = '91' + p10;
    for (const field of fieldNames) {
      parts.push(`${field}.eq.${p10}`, `${field}.eq.${p12}`);
    }
  }
  return parts.length > 0 ? parts.join(',') : null;
}

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
    salespersonPhone?: string[] | string,
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

      if (Array.isArray(salespersonPhone) && salespersonPhone.length === 0) {
        return {
          period: { month: monthName, year: y },
          summary: {
            total_revenue: 0,
            won_revenue: 0,
            pipeline_value: 0,
            total_value: 0,
            won_value: 0,
            won: 0,
            deals_won: 0,
            deals_lost: 0,
            deals_pending: 0,
            total_deals: 0,
            conversion_rate: 0,
            total_inquiries: 0,
          },
          by_customer: [],
          by_type: [],
          lost_reasons: {},
        };
      }

      const fromDateOnly = start.split('T')[0];
      const toDateOnly = end.split('T')[0];

      let dealsQuery = this.supabase
        .from('deals')
        .select('*')
        .or(
          `and(won_at.gte.${start},won_at.lte.${end}),` +
            `and(po_date.gte.${fromDateOnly},po_date.lte.${toDateOnly}),` +
            `and(created_at.gte.${start},created_at.lte.${end})`,
        );
      let inquiriesQuery = this.supabase
        .from('inquiries')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end);

      if (salespersonPhone) {
        const dealsOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (dealsOr) dealsQuery = dealsQuery.or(dealsOr);

        const inqOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (inqOr) inquiriesQuery = inquiriesQuery.or(inqOr);
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

      const pipelineValue = pendingDeals.reduce(
        (sum, d) => sum + (d.total_amount || 0),
        0,
      );
      const wonValue = wonDeals.reduce(
        (sum, d) => sum + (d.total_amount || 0),
        0,
      );
      const totalValue = wonValue; // wonValue matches totalValue now

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

      // Group by inquiry type (only count won deals for sales revenue value)
      const byType = wonDeals.reduce(
        (acc, deal) => {
          const type = deal.inquiry_type || 'other';
          if (!acc[type]) {
            acc[type] = { type, count: 0, value: 0 };
          }
          acc[type].count++;
          acc[type].value += deal.total_amount || 0;
          return acc;
        },
        {} as Record<string, any>,
      );

      // Lost reasons
      const lostReasons = lostDeals.reduce(
        (acc, deal) => {
          const reason = deal.lost_reason || 'Not Specified';
          if (!acc[reason]) {
            acc[reason] = 0;
          }
          acc[reason]++;
          return acc;
        },
        {} as Record<string, number>,
      );

      return {
        period: { month: monthName, year: y },
        summary: {
          total_revenue: totalValue,
          won_revenue: wonValue,
          pipeline_value: pipelineValue,
          total_value: pipelineValue > 0 ? pipelineValue : totalValue,
          won_value: wonValue,
          won: wonDeals.length,
          deals_won: wonDeals.length,
          deals_lost: lostDeals.length,
          deals_pending: pendingDeals.length,
          total_deals: inquiries.length > 0 ? inquiries.length : deals.length,
          conversion_rate:
            inquiries.length > 0
              ? Math.round((wonDeals.length / inquiries.length) * 100)
              : deals.length > 0
                ? Math.round((wonDeals.length / deals.length) * 100)
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
    allowedPhones?: string[],
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

      let phones = new Set<string>(
        [
          ...salespersonEmployees.map((e) => e.phone),
          ...visits.map((v) => v.salesperson_phone),
          ...kraLogs.map((k) => k.salesperson_phone),
          ...deals.map((d) => d.salesperson_phone),
        ].filter(Boolean),
      );

      // If allowedPhones is specified (e.g. for Sales Manager), scope strictly
      if (allowedPhones) {
        if (allowedPhones.length === 0) return [];
        phones = new Set(
          Array.from(phones).filter((p) => phoneInList(p, allowedPhones)),
        );
      }

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
        // Performance Scoring formula (0 - 100 points, clean whole integer):
        // 1. Deals volume & wins (up to 40 pts): 4 pts per won deal + pipeline volume bonus
        const wonDealsScore = Math.min(40, wonDeals.length * 4);
        // 2. Visits target (up to 30 pts): target is 40 visits per month
        const visitsScore = Math.min(
          30,
          Math.round((spVisits.length / 40) * 30),
        );
        // 3. New customer acquisition (up to 15 pts): target is 3 new customers
        const newCustomersScore = Math.min(
          15,
          Math.round((newCustomers / 3) * 15),
        );
        // 4. Payment collections (up to 15 pts): 5 pts per collected payment
        const paymentsScore = Math.min(
          15,
          Math.round(collectedPayments.length * 5),
        );
        // 5. Deductions for unresolved complaints (10 pts per unresolved complaint)
        const unresolvedComplaints = spComplaints.filter(
          (c) => c.status !== 'resolved',
        ).length;
        const complaintsPenalty = Math.min(20, unresolvedComplaints * 10);

        const totalKraScore = Math.max(
          0,
          Math.min(
            100,
            Math.round(
              wonDealsScore +
                visitsScore +
                newCustomersScore +
                paymentsScore -
                complaintsPenalty,
            ),
          ),
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
          kra_score: totalKraScore,
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
    salespersonPhone?: string[] | string,
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

      if (Array.isArray(salespersonPhone) && salespersonPhone.length === 0) {
        const stages = [
          { key: 'new_deals', label: 'New Deals' },
          { key: 'qualified', label: 'Qualified' },
          { key: 'quoted', label: 'Quoted' },
          { key: 'negotiation', label: 'Negotiation' },
          { key: 'won', label: 'Won' },
          { key: 'lost', label: 'Lost' },
        ];
        return {
          period: { month: monthName, year: y },
          funnel: stages.map(({ key, label }) => ({
            stage: key,
            label,
            count: 0,
            value: 0,
          })),
          max_count: 0,
          overall_win_rate: 0,
        };
      }

      let dealsQuery = this.supabase
        .from('deals')
        .select('*')
        .neq('inquiry_type', 'unknown')
        .or(
          `and(created_at.gte.${start},created_at.lte.${end}),and(stage.eq.won,won_at.gte.${start},won_at.lte.${end})`,
        );

      if (salespersonPhone) {
        const orFilter = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (orFilter) dealsQuery = dealsQuery.or(orFilter);
      }

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
    salespersonPhone?: string[] | string,
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

      if (Array.isArray(salespersonPhone) && salespersonPhone.length === 0) {
        return {
          period: { month: monthName, year: y },
          skus: [],
        };
      }

      const fromDateOnly = start.split('T')[0];
      const toDateOnly = end.split('T')[0];

      let dealsQuery = this.supabase
        .from('deals')
        .select(
          'id, created_at, won_at, stage, salesperson_phone, inquiry_type, po_date',
        )
        .neq('inquiry_type', 'unknown')
        .eq('stage', 'won')
        .or(
          `and(won_at.gte.${start},won_at.lte.${end}),` +
            `and(po_date.gte.${fromDateOnly},po_date.lte.${toDateOnly}),` +
            `and(won_at.is.null,created_at.gte.${start},created_at.lte.${end})`,
        );

      if (salespersonPhone) {
        const orFilter = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (orFilter) dealsQuery = dealsQuery.or(orFilter);
      }

      const { data: wonDeals, error: dealsErr } = await dealsQuery;
      if (dealsErr) throw dealsErr;

      const dealIds = (wonDeals || []).map((d: any) => d.id);
      if (dealIds.length === 0) {
        return {
          period: { month: monthName, year: y },
          skus: [],
        };
      }

      const { data: items, error: itemsErr } = await this.supabase
        .from('deal_items')
        .select('*')
        .in('deal_id', dealIds);

      if (itemsErr) throw itemsErr;

      const bysku = (items || []).reduce(
        (acc, item) => {
          const sku = item.sku_text || 'Unknown';
          if (!acc[sku]) {
            acc[sku] = {
              sku_text: sku,
              grade: item.grade,
              dimensions: item.dimensions || '',
              total_quantity: 0,
              total_value: 0,
              deal_count: 0,
              unit: item.unit || 'MT',
            };
          }
          acc[sku].total_quantity += Number(item.quantity) || 0;
          acc[sku].total_value += Number(item.amount) || 0;
          acc[sku].deal_count++;
          if (!acc[sku].dimensions && item.dimensions) {
            acc[sku].dimensions = item.dimensions;
          }
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

  /**
   * Consolidated high-speed overview report.
   * Executes database fetches in a single parallel batch and computes all sections in one pass.
   */
  async getOverviewReport(
    month?: number,
    year?: number,
    salespersonPhone?: string | string[],
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

      if (Array.isArray(salespersonPhone) && salespersonPhone.length === 0) {
        return {
          period: { month: monthName, year: y },
          summary: {
            total_revenue: 0,
            won_revenue: 0,
            pipeline_value: 0,
            total_value: 0,
            won_value: 0,
            won: 0,
            deals_won: 0,
            deals_lost: 0,
            deals_pending: 0,
            total_deals: 0,
            conversion_rate: 0,
            total_inquiries: 0,
          },
          funnel: [
            { stage: 'new_deals', label: 'New Deals', count: 0, value: 0 },
            { stage: 'qualified', label: 'Qualified', count: 0, value: 0 },
            { stage: 'quoted', label: 'Quoted', count: 0, value: 0 },
            { stage: 'negotiation', label: 'Negotiation', count: 0, value: 0 },
            { stage: 'won', label: 'Won', count: 0, value: 0 },
            { stage: 'lost', label: 'Lost', count: 0, value: 0 },
          ],
          by_customer: [],
          by_type: [],
          lost_reasons: {},
          skus: [],
          orders: [],
        };
      }

      const fromDateOnly = start.split('T')[0];
      const toDateOnly = end.split('T')[0];

      // 1. Query all deals in period with nested deal_items
      let dealsQuery = this.supabase
        .from('deals')
        .select('*, deal_items(*)')
        .or(
          `and(won_at.gte.${start},won_at.lte.${end}),` +
            `and(po_date.gte.${fromDateOnly},po_date.lte.${toDateOnly}),` +
            `and(created_at.gte.${start},created_at.lte.${end})`,
        );

      // 2. Query all inquiries in period
      let inquiriesQuery = this.supabase
        .from('inquiries')
        .select('id, created_at, salesperson_phone')
        .gte('created_at', start)
        .lte('created_at', end);

      if (salespersonPhone) {
        const dealsOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (dealsOr) dealsQuery = dealsQuery.or(dealsOr);

        const inqOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (inqOr) inquiriesQuery = inquiriesQuery.or(inqOr);
      }

      // Execute queries in parallel in ONE batch
      const [dealsResult, inquiriesResult] = await Promise.all([
        dealsQuery,
        inquiriesQuery,
      ]);

      if (dealsResult.error) throw dealsResult.error;
      if (inquiriesResult.error) throw inquiriesResult.error;

      const deals = dealsResult.data || [];
      const inquiries = inquiriesResult.data || [];

      const wonDeals = deals.filter((d: any) => d.stage === 'won');
      const lostDeals = deals.filter((d: any) => d.stage === 'lost');
      const pendingDeals = deals.filter(
        (d: any) => !['won', 'lost'].includes(d.stage),
      );

      const pipelineValue = pendingDeals.reduce(
        (sum: number, d: any) => sum + (Number(d.total_amount) || 0),
        0,
      );
      const wonValue = wonDeals.reduce(
        (sum: number, d: any) => sum + (Number(d.total_amount) || 0),
        0,
      );
      const totalValue = wonValue;

      // Group deals by customer
      const byCustomer = wonDeals.reduce(
        (acc: any, deal: any) => {
          const name = deal.customer_name || 'Unknown';
          if (!acc[name]) {
            acc[name] = { customer: name, deals: 0, value: 0 };
          }
          acc[name].deals++;
          acc[name].value += Number(deal.total_amount) || 0;
          return acc;
        },
        {} as Record<string, any>,
      );

      // Group by inquiry/product type
      const byType = deals.reduce(
        (acc: any, deal: any) => {
          const type = deal.inquiry_type || 'other';
          if (!acc[type]) {
            acc[type] = { type, count: 0, value: 0 };
          }
          acc[type].count++;
          acc[type].value += Number(deal.total_amount) || 0;
          return acc;
        },
        {} as Record<string, any>,
      );

      // Lost reasons
      const lostReasons = lostDeals.reduce(
        (acc: any, deal: any) => {
          const reason = deal.lost_reason || 'Not Specified';
          if (!acc[reason]) {
            acc[reason] = 0;
          }
          acc[reason]++;
          return acc;
        },
        {} as Record<string, number>,
      );

      // Funnel stages
      const stages = [
        { key: 'new_deals', label: 'New Deals' },
        { key: 'qualified', label: 'Qualified' },
        { key: 'quoted', label: 'Quoted' },
        { key: 'negotiation', label: 'Negotiation' },
        { key: 'won', label: 'Won' },
        { key: 'lost', label: 'Lost' },
      ];

      const funnel = stages.map(({ key, label }) => {
        const stageDeals = deals.filter((d: any) => {
          if (key === 'new_deals') {
            return (
              d.stage === 'new_deals' ||
              d.stage === 'new' ||
              d.stage === 'lead' ||
              !d.stage
            );
          }
          return d.stage === key;
        });
        const stageCount = stageDeals.length;
        const stageValue = stageDeals.reduce(
          (sum: number, d: any) => sum + (Number(d.total_amount) || 0),
          0,
        );
        return {
          stage: key,
          label,
          count: stageCount,
          value: stageValue,
        };
      });

      // SKU Breakdown from won deal items
      const wonDealItems = wonDeals.flatMap((d: any) => d.deal_items || []);
      const bysku = wonDealItems.reduce(
        (acc: any, item: any) => {
          const sku = item.sku_text || 'Unknown';
          if (!acc[sku]) {
            acc[sku] = {
              sku_text: sku,
              grade: item.grade,
              dimensions: item.dimensions || '',
              total_quantity: 0,
              total_value: 0,
              deal_count: 0,
              unit: item.unit || 'MT',
            };
          }
          acc[sku].total_quantity += Number(item.quantity) || 0;
          acc[sku].total_value += Number(item.amount) || 0;
          acc[sku].deal_count++;
          if (!acc[sku].dimensions && item.dimensions) {
            acc[sku].dimensions = item.dimensions;
          }
          return acc;
        },
        {} as Record<string, any>,
      );

      const totalDealsCount =
        inquiries.length > 0 ? inquiries.length : deals.length;
      const conversionRate =
        totalDealsCount > 0
          ? Math.round((wonDeals.length / totalDealsCount) * 100)
          : 0;

      return {
        period: { month: monthName, year: y },
        summary: {
          total_revenue: totalValue,
          won_revenue: wonValue,
          pipeline_value: pipelineValue,
          total_value: pipelineValue > 0 ? pipelineValue : totalValue,
          won_value: wonValue,
          won: wonDeals.length,
          deals_won: wonDeals.length,
          deals_lost: lostDeals.length,
          deals_pending: pendingDeals.length,
          total_deals: totalDealsCount,
          conversion_rate: conversionRate,
          total_inquiries: inquiries.length,
        },
        funnel,
        by_customer: Object.values(byCustomer).sort(
          (a: any, b: any) => b.value - a.value,
        ),
        by_type: Object.values(byType),
        lost_reasons: lostReasons,
        skus: Object.values(bysku).sort(
          (a: any, b: any) => b.total_value - a.total_value,
        ),
        orders: wonDeals,
        inquiries_count: totalDealsCount,
      };
    } catch (error) {
      this.logger.error('Error in getOverviewReport:', error);
      throw error;
    }
  }
}
