import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

@Injectable()
export class KraService {
  private readonly logger = new Logger(KraService.name);

  constructor(private supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  private getMonthRange(month?: number, year?: number) {
    const now = new Date();
    const m = month !== undefined ? month : now.getMonth();
    const y = year !== undefined ? year : now.getFullYear();
    const start = new Date(y, m, 1).toISOString();
    const end = new Date(y, m + 1, 0, 23, 59, 59).toISOString();
    return { start, end };
  }

  async getDashboard(salespersonPhone?: string, month?: number, year?: number) {
    try {
      const { start, end } = this.getMonthRange(month, year);

      let dealsQuery = this.supabase
        .from('deals')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end);
      let inquiriesQuery = this.supabase
        .from('inquiries')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end);
      let kraLogsQuery = this.supabase
        .from('kra_logs')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end);
      let visitsQuery = this.supabase
        .from('customer_visits')
        .select('*')
        .gte('visited_at', start)
        .lte('visited_at', end);
      let complaintsQuery = this.supabase
        .from('complaints')
        .select('*')
        .gte('reported_at', start)
        .lte('reported_at', end);
      let paymentsQuery = this.supabase
        .from('payment_tracking')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end);
      let recurringQuery = this.supabase
        .from('recurring_customers')
        .select('*')
        .eq('is_active', true);
      let followupsQuery = this.supabase
        .from('followup_tasks')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end);

      if (salespersonPhone) {
        // filter queries by salesperson phone if relevant
        dealsQuery = dealsQuery.eq('salesperson_phone', salespersonPhone);
        inquiriesQuery = inquiriesQuery.eq(
          'salesperson_phone',
          salespersonPhone,
        );
        kraLogsQuery = kraLogsQuery.eq('salesperson_phone', salespersonPhone);
        visitsQuery = visitsQuery.eq('salesperson_phone', salespersonPhone);
        complaintsQuery = complaintsQuery.eq('reported_by', salespersonPhone);
        paymentsQuery = paymentsQuery.eq('salesperson_phone', salespersonPhone);
        recurringQuery = recurringQuery.eq(
          'assigned_salesperson_phone',
          salespersonPhone,
        );
        followupsQuery = followupsQuery.eq(
          'salesperson_phone',
          salespersonPhone,
        );
      }

      const [
        dealsResult,
        inquiriesResult,
        kraLogsResult,
        visitsResult,
        complaintsResult,
        paymentsResult,
        recurringResult,
        followupsResult,
      ] = await Promise.all([
        dealsQuery,
        inquiriesQuery,
        kraLogsQuery,
        visitsQuery,
        complaintsQuery,
        paymentsQuery,
        recurringQuery,
        followupsQuery,
      ]);

      const deals = dealsResult.data || [];
      const inquiries = inquiriesResult.data || [];
      const kraLogs = kraLogsResult.data || [];
      const visits = visitsResult.data || [];
      const complaints = complaintsResult.data || [];
      const payments = paymentsResult.data || [];
      const recurring = recurringResult.data || [];
      const followups = followupsResult.data || [];

      const wonDeals = deals.filter((d) => d.stage === 'won');
      const totalValue = deals.reduce(
        (sum, d) => sum + (d.total_amount || 0),
        0,
      );
      const pendingPayments = payments.filter((p) => p.status === 'pending');
      const collectedPayments = payments.filter(
        (p) => p.status === 'collected',
      );
      const resolvedComplaints = complaints.filter(
        (c) => c.status === 'resolved',
      );
      const withinTarget = resolvedComplaints.filter(
        (c) => (c.resolution_time_hrs || 0) <= 48,
      );

      return {
        month: start,
        kra1: {
          label: 'Sales Achievement',
          deals_count: deals.length,
          won_count: wonDeals.length,
          total_value: totalValue,
          status: deals.length > 0 ? 'on_track' : 'at_risk',
        },
        kra2: {
          label: 'New Customer Acquisition',
          count: kraLogs.filter(
            (l) => l.kra_number === 2 && l.kra_type === 'new_customer',
          ).length,
          target: 3,
          status:
            kraLogs.filter((l) => l.kra_number === 2).length >= 3
              ? 'achieved'
              : 'in_progress',
        },
        kra3: {
          label: 'Customer Retention',
          recurring_total: recurring.length,
          followups_sent: followups.filter(
            (f) => f.task_type === 'kra3_retention',
          ).length,
          followups_resolved: followups.filter((f) => f.status === 'resolved')
            .length,
          status: 'tracked',
        },
        kra4: {
          label: 'Enquiry Conversion',
          total_inquiries: inquiries.length,
          won_deals: wonDeals.length,
          conversion_rate:
            inquiries.length > 0
              ? Math.round((wonDeals.length / inquiries.length) * 100)
              : 0,
          target_rate: 70,
          status:
            inquiries.length > 0 && wonDeals.length / inquiries.length >= 0.7
              ? 'achieved'
              : 'in_progress',
        },
        kra5: {
          label: 'Payment Collection',
          pending_count: pendingPayments.length,
          collected_count: collectedPayments.length,
          total_outstanding: pendingPayments.reduce(
            (sum, p) => sum + (p.outstanding || 0),
            0,
          ),
          status: pendingPayments.length === 0 ? 'achieved' : 'in_progress',
        },
        kra6: {
          label: 'CRM Compliance',
          logged_via_bot: deals.length + inquiries.length,
          status: 'tracked',
        },
        kra7: {
          label: 'Zero Rejection',
          rejections: kraLogs.filter((l) => l.kra_number === 7).length,
          status:
            kraLogs.filter((l) => l.kra_number === 7).length === 0
              ? 'achieved'
              : 'at_risk',
        },
        kra8: {
          label: 'Complaint Resolution',
          total: complaints.length,
          resolved: resolvedComplaints.length,
          within_48h: withinTarget.length,
          avg_resolution_hrs:
            resolvedComplaints.length > 0
              ? Math.round(
                  resolvedComplaints.reduce(
                    (sum, c) => sum + (c.resolution_time_hrs || 0),
                    0,
                  ) / resolvedComplaints.length,
                )
              : 0,
          status:
            complaints.length === 0 ||
            withinTarget.length === resolvedComplaints.length
              ? 'achieved'
              : 'in_progress',
        },
        kra9: {
          label: 'Customer Visits',
          total_visits: visits.length,
          target_monthly: 40,
          unique_days: new Set(
            visits.map((v) => new Date(v.visited_at).toDateString()),
          ).size,
          status: visits.length >= 40 ? 'achieved' : 'in_progress',
        },
      };
    } catch (error) {
      this.logger.error('Error in getDashboard:', error);
      throw error;
    }
  }

  async getLogs(kraNumber?: number, salespersonPhone?: string) {
    try {
      let query = this.supabase
        .from('kra_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (kraNumber) query = query.eq('kra_number', kraNumber);
      if (salespersonPhone) {
        query = query.eq('salesperson_phone', salespersonPhone);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (error) {
      this.logger.error('Error in getLogs:', error);
      throw error;
    }
  }
}
