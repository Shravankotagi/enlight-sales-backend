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
        .or(
          `and(created_at.gte.${start},created_at.lte.${end}),and(stage.eq.won,won_at.gte.${start},won_at.lte.${end})`,
        );
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

      const dealsCreatedThisMonth = deals.filter(
        (d) => d.created_at >= start && d.created_at <= end,
      );
      const wonDeals = deals.filter(
        (d) => d.stage === 'won' && d.won_at >= start && d.won_at <= end,
      );
      const totalValue = wonDeals.reduce(
        (sum, d) => sum + (d.total_amount || 0),
        0,
      );
      const pendingPayments = payments.filter((p) => p.status === 'pending');
      const collectedPayments = payments.filter(
        (p) => p.status === 'collected',
      );
      const reportedThisMonth = complaints.filter(
        (c) => c.reported_at >= start && c.reported_at <= end,
      );
      // Resolved = complaints that were REPORTED this month AND have been resolved
      // (does NOT count old month complaints resolved this month — those belong to prev month KRA)
      const resolvedComplaints = reportedThisMonth.filter(
        (c) => c.status === 'resolved',
      );
      const withinTarget = resolvedComplaints.filter(
        (c) => (c.resolution_time_hrs || 0) <= 48,
      );

      return {
        month: start,
        kra1: {
          label: 'Sales Achievement',
          deals_count: dealsCreatedThisMonth.length,
          won_count: wonDeals.length,
          total_value: totalValue,
          status: dealsCreatedThisMonth.length > 0 ? 'on_track' : 'at_risk',
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
          followups_sent: Math.max(
            followups.filter((f) => f.task_type === 'kra3_retention').length,
            kraLogs.filter((l) => l.kra_number === 3).length,
          ),
          followups_resolved: kraLogs.filter((l) => l.kra_number === 3).length,
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
          total: reportedThisMonth.length,
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
            reportedThisMonth.length === 0 ||
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

  async getActionQueue(
    salespersonPhone: string,
    isAdmin: boolean,
    month?: number,
    year?: number,
  ) {
    const supabase = this.supabase;
    const now = new Date();

    const targetYear = year !== undefined ? year : now.getFullYear();
    const targetMonth = month !== undefined ? month : now.getMonth();

    const monthStart = new Date(targetYear, targetMonth, 1).toISOString();
    const monthEnd = new Date(
      targetYear,
      targetMonth + 1,
      0,
      23,
      59,
      59,
      999,
    ).toISOString();
    const actions: any[] = [];

    // 1. Inquiries needing review
    try {
      let inquiryQuery = supabase
        .from('inquiries')
        .select('id, sender_name, raw_text, created_at')
        .eq('status', 'review')
        .gte('created_at', monthStart)
        .lte('created_at', monthEnd);

      if (!isAdmin) {
        inquiryQuery = inquiryQuery.eq('salesperson_phone', salespersonPhone);
      }

      const { data: reviewInquiries } = await inquiryQuery
        .order('created_at', { ascending: false })
        .limit(5);

      if (reviewInquiries?.length > 0) {
        actions.push({
          type: 'review_queue',
          priority: 'high',
          title: `${reviewInquiries.length} inquiries need review`,
          subtitle: 'Low confidence AI extractions',
          count: reviewInquiries.length,
          link: '/inquiries',
          color: 'orange',
        });
      }
    } catch {}

    // 2. Deals stale for 7+ days
    try {
      const sevenDaysAgo = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000,
      ).toISOString();
      let staleQuery = supabase
        .from('deals')
        .select('id, customer_name, stage, created_at')
        .not('stage', 'in', '("won","lost")')
        .lte('created_at', sevenDaysAgo)
        .gte('created_at', monthStart)
        .lte('created_at', monthEnd)
        .order('created_at', { ascending: true })
        .limit(10);

      if (!isAdmin) {
        staleQuery = staleQuery.eq('salesperson_phone', salespersonPhone);
      }

      const { data: staleDeals } = await staleQuery;
      if (staleDeals?.length > 0) {
        actions.push({
          type: 'stale_deals',
          priority: 'high',
          title: `${staleDeals.length} deals stale 7+ days`,
          subtitle:
            (staleDeals[0]?.customer_name || 'Multiple customers') +
            ' and others',
          count: staleDeals.length,
          link: '/',
          color: 'red',
        });
      }
    } catch {}

    // 3. Pending follow-up tasks
    try {
      let followupsQuery = supabase
        .from('followup_tasks')
        .select('id, customer_name, due_date, task_type')
        .eq('status', 'pending')
        .gte('due_date', monthStart)
        .lte('due_date', monthEnd);

      if (!isAdmin) {
        followupsQuery = followupsQuery.eq(
          'salesperson_phone',
          salespersonPhone,
        );
      }

      const { data: followups } = await followupsQuery
        .order('due_date', { ascending: true })
        .limit(5);

      if (followups?.length > 0) {
        actions.push({
          type: 'followups_due',
          priority: 'medium',
          title: `${followups.length} follow-ups due`,
          subtitle: (followups[0]?.customer_name || 'Multiple') + ' and others',
          count: followups.length,
          link: '/customers',
          color: 'yellow',
        });
      }
    } catch {}

    // 4. KRA 9 - weekly visit check (only for current month/year)
    if (targetMonth === now.getMonth() && targetYear === now.getFullYear()) {
      try {
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);

        let visitQuery = supabase
          .from('customer_visits')
          .select('id')
          .gte('visited_at', weekStart.toISOString());

        if (!isAdmin) {
          visitQuery = visitQuery.eq('salesperson_phone', salespersonPhone);
        }

        const { data: weekVisits } = await visitQuery;
        const visitCount = weekVisits?.length || 0;

        if (visitCount < 10) {
          actions.push({
            type: 'visit_target',
            priority: 'medium',
            title: `${visitCount}/10 visits this week`,
            subtitle: `${10 - visitCount} more needed for KRA 9`,
            count: 10 - visitCount,
            link: '/kra',
            color: 'blue',
          });
        }
      } catch {}
    }

    // 5. Pending complaints past 24h
    try {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      let complaintsQuery = supabase
        .from('complaints')
        .select('id, customer_name, complaint_type')
        .eq('status', 'pending')
        .lte('reported_at', dayAgo)
        .gte('reported_at', monthStart)
        .lte('reported_at', monthEnd);

      if (!isAdmin) {
        complaintsQuery = complaintsQuery.eq('reported_by', salespersonPhone);
      }

      const { data: oldComplaints } = await complaintsQuery.limit(5);

      if (oldComplaints?.length > 0) {
        actions.push({
          type: 'complaints_pending',
          priority: 'high',
          title: `${oldComplaints.length} complaints unresolved 24h+`,
          subtitle:
            (oldComplaints[0]?.customer_name || '') +
            ' - ' +
            (oldComplaints[0]?.complaint_type || ''),
          count: oldComplaints.length,
          link: '/inquiries',
          color: 'red',
        });
      }
    } catch {}

    // 6. Monthly KRA 1 progress
    try {
      let dealsQuery = supabase
        .from('deals')
        .select('total_amount, stage')
        .gte('created_at', monthStart)
        .lte('created_at', monthEnd);

      if (!isAdmin) {
        dealsQuery = dealsQuery.eq('salesperson_phone', salespersonPhone);
      }

      const { data: monthDeals } = await dealsQuery;
      const monthValue =
        monthDeals?.reduce((sum, d) => sum + (d.total_amount || 0), 0) || 0;
      const wonDeals = monthDeals?.filter((d) => d.stage === 'won').length || 0;

      actions.push({
        type: 'monthly_progress',
        priority: 'low',
        title: `${monthDeals?.length || 0} deals this month`,
        subtitle: `${wonDeals} won · ₹${Number(monthValue).toLocaleString('en-IN')} value`,
        count: monthDeals?.length || 0,
        link: '/reports',
        color: 'green',
      });
    } catch {}

    const priorityOrder: Record<string, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    return {
      actions: actions.sort(
        (a, b) =>
          (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2),
      ),
      generated_at: now.toISOString(),
    };
  }
}
