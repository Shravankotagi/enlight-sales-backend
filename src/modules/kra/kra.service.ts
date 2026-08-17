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
    const start = new Date(Date.UTC(y, m, 1, 0, 0, 0)).toISOString();
    const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)).toISOString();
    return { start, end };
  }

  async getDashboard(
    salespersonPhone?: string,
    month?: number,
    year?: number,
    from?: string,
    to?: string,
  ) {
    try {
      let start: string;
      let end: string;

      if (from && to) {
        start = new Date(from).toISOString();
        end = new Date(
          to.includes('T') ? to : to + 'T23:59:59.999Z',
        ).toISOString();
      } else {
        const range = this.getMonthRange(month, year);
        start = range.start;
        end = range.end;
      }

      let dealsQuery = this.supabase.from('deals').select('*');
      let inquiriesQuery = this.supabase
        .from('inquiries')
        .select('id, status, created_at, salesperson_phone, sender_phone')
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
      let paymentsQuery = this.supabase.from('payment_tracking').select('*');
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
        const cleanDigits = salespersonPhone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;

        dealsQuery = dealsQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12},customer_phone.eq.${p10},customer_phone.eq.${p12}`,
        );
        inquiriesQuery = inquiriesQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12},sender_phone.eq.${p10},sender_phone.eq.${p12}`,
        );
        kraLogsQuery = kraLogsQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12}`,
        );
        visitsQuery = visitsQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12}`,
        );
        complaintsQuery = complaintsQuery.or(
          `reported_by.eq.${p10},reported_by.eq.${p12}`,
        );
        paymentsQuery = paymentsQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12}`,
        );
        followupsQuery = followupsQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12}`,
        );
        recurringQuery = recurringQuery.or(
          `assigned_salesperson_phone.eq.${p10},assigned_salesperson_phone.eq.${p12}`,
        );
      }

      dealsQuery = dealsQuery.or(
        `and(created_at.gte.${start},created_at.lte.${end}),and(stage.eq.won,won_at.gte.${start},won_at.lte.${end})`,
      );

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
      const wonDeals = deals.filter((d) => {
        if (d.stage !== 'won') return false;
        const dealDate = d.won_at || d.created_at;
        return dealDate >= start && dealDate <= end;
      });
      const lostDeals = deals.filter((d) => {
        if (d.stage !== 'lost') return false;
        const dealDate = d.created_at;
        return dealDate >= start && dealDate <= end;
      });

      const totalValue = wonDeals.reduce((sum, d) => {
        if (d.total_amount && Number(d.total_amount) > 0) {
          return sum + Number(d.total_amount);
        }
        // Fallback: check if kra_logs or payment_tracking has value for this customer
        const customerLogs = kraLogs.filter(
          (l) =>
            l.customer_name &&
            d.customer_name &&
            (d.customer_name
              .toLowerCase()
              .includes(l.customer_name.toLowerCase()) ||
              l.customer_name
                .toLowerCase()
                .includes(d.customer_name.toLowerCase())),
        );
        const logVal = customerLogs.reduce(
          (maxVal, l) => Math.max(maxVal, Number(l.value) || 0),
          0,
        );
        if (logVal > 0) return sum + logVal;

        const customerPayments = payments.filter(
          (p) =>
            p.customer_name &&
            d.customer_name &&
            (d.customer_name
              .toLowerCase()
              .includes(p.customer_name.toLowerCase()) ||
              p.customer_name
                .toLowerCase()
                .includes(d.customer_name.toLowerCase())),
        );
        const paymentVal = customerPayments.reduce(
          (pSum, p) => pSum + (Number(p.invoice_amount) || 0),
          0,
        );
        if (paymentVal > 0) return sum + paymentVal;

        return sum;
      }, 0);

      const pendingPayments = payments.filter(
        (p) => p.status === 'pending' || p.status === 'partial',
      );
      const collectedAmount = payments.reduce(
        (sum, p) => sum + (Number(p.collected_amount) || 0),
        0,
      );
      const collectedCount = payments.filter(
        (p) => (Number(p.collected_amount) || 0) > 0,
      ).length;

      const totalOutstanding = pendingPayments.reduce(
        (sum, p) =>
          sum +
          (p.outstanding !== null && p.outstanding !== undefined
            ? Number(p.outstanding)
            : Number(p.invoice_amount || 0)),
        0,
      );

      const reportedThisMonth = complaints.filter(
        (c) => c.reported_at >= start && c.reported_at <= end,
      );
      const resolvedComplaints = reportedThisMonth.filter(
        (c) => c.status === 'resolved',
      );
      const withinTarget = resolvedComplaints.filter(
        (c) => (c.resolution_time_hrs || 0) <= 48,
      );

      const totalDealsCount = dealsCreatedThisMonth.length;
      const wonDealsCount = wonDeals.length;
      const conversionRate =
        totalDealsCount > 0
          ? Math.round((wonDealsCount / totalDealsCount) * 100)
          : 0;

      return {
        month: start,
        kra1: {
          label: 'Sales Achievement',
          deals_count: dealsCreatedThisMonth.length,
          won_count: wonDeals.length,
          lost_count: lostDeals.length,
          total_value: totalValue,
          won_value: totalValue,
          status: dealsCreatedThisMonth.length > 0 ? 'on_track' : 'at_risk',
        },
        kra2: {
          label: 'New Customer Acquisition',
          count: new Set(
            kraLogs
              .filter(
                (l) => l.kra_number === 2 && l.kra_type === 'new_customer',
              )
              .map((l) => (l.customer_name || '').toLowerCase().trim()),
          ).size,
          target: 3,
          status:
            new Set(
              kraLogs
                .filter(
                  (l) => l.kra_number === 2 && l.kra_type === 'new_customer',
                )
                .map((l) => (l.customer_name || '').toLowerCase().trim()),
            ).size >= 3
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
          total_inquiries: totalDealsCount,
          won_deals: wonDealsCount,
          conversion_rate: conversionRate,
          target_rate: 70,
          status: conversionRate >= 70 ? 'achieved' : 'in_progress',
        },
        kra5: {
          label: 'Payment Collection',
          pending_count: pendingPayments.length,
          collected_count: collectedCount,
          collected_amount: collectedAmount,
          total_outstanding: totalOutstanding,
          status: pendingPayments.length === 0 ? 'achieved' : 'in_progress',
        },
        kra6: {
          label: 'CRM Compliance',
          // Count distinct days with ANY bot activity (deals, inquiries, or any kra_log)
          active_days: new Set([
            ...kraLogs.map((l) => new Date(l.created_at).toDateString()),
            ...deals.map((d) => new Date(d.created_at).toDateString()),
            ...inquiries.map((i) => new Date(i.created_at).toDateString()),
          ]).size,
          logged_via_bot: deals.length + inquiries.length + kraLogs.length,
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
        const cleanDigits = salespersonPhone.replace(/\D/g, '');
        const last10 = cleanDigits.slice(-10);
        query = query.or(
          `salesperson_phone.eq.${salespersonPhone},salesperson_phone.eq.91${last10},salesperson_phone.eq.${last10}`,
        );
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
        .in('status', ['review', 'needs_review', 'pending', 'auto_created'])
        .gte('created_at', monthStart)
        .lte('created_at', monthEnd);

      if (!isAdmin) {
        inquiryQuery = inquiryQuery.or(
          `salesperson_phone.eq.${salespersonPhone},sender_phone.eq.${salespersonPhone}`,
        );
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

      if (!isAdmin && salespersonPhone) {
        const cleanDigits = salespersonPhone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;
        staleQuery = staleQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12},customer_phone.eq.${p10},customer_phone.eq.${p12}`,
        );
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
      const wonDealsList = monthDeals?.filter((d) => d.stage === 'won') || [];
      const wonValue = wonDealsList.reduce(
        (sum, d) => sum + (d.total_amount || 0),
        0,
      );

      actions.push({
        type: 'monthly_progress',
        priority: 'low',
        title: `${monthDeals?.length || 0} deals this month`,
        subtitle: `${wonDealsList.length} won · ₹${Number(wonValue).toLocaleString('en-IN')} value`,
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

  async getSheets(
    salespersonPhone?: string,
    month?: number,
    year?: number,
    from?: string,
    to?: string,
  ) {
    try {
      let start: string;
      let end: string;

      if (from && to) {
        start = new Date(from).toISOString();
        end = new Date(
          to.includes('T') ? to : to + 'T23:59:59.999Z',
        ).toISOString();
      } else {
        const range = this.getMonthRange(month, year);
        start = range.start;
        end = range.end;
      }

      let dealsQuery = this.supabase
        .from('deals')
        .select('*, deal_items(*)')
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

      let paymentsQuery = this.supabase.from('payment_tracking').select('*');

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

      let followupsQuery = this.supabase
        .from('followup_tasks')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end);

      if (salespersonPhone) {
        const cleanDigits = salespersonPhone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;

        dealsQuery = dealsQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12},salesperson_phone.is.null`,
        );
        inquiriesQuery = inquiriesQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12},sender_phone.eq.${p10},sender_phone.eq.${p12}`,
        );
        kraLogsQuery = kraLogsQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12}`,
        );
        paymentsQuery = paymentsQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12}`,
        );
        visitsQuery = visitsQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12}`,
        );
        complaintsQuery = complaintsQuery.or(
          `reported_by.eq.${p10},reported_by.eq.${p12}`,
        );
        followupsQuery = followupsQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12}`,
        );
      }

      // Also fetch recurring_customers to get real contact_person/industry for KRA 2
      let customersQuery = this.supabase
        .from('recurring_customers')
        .select(
          'customer_name, contact_person, industry, notes, customer_address, customer_phone, created_at',
        );
      if (salespersonPhone) {
        const cleanDigits = salespersonPhone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;
        customersQuery = customersQuery.or(
          `assigned_salesperson_phone.eq.${p10},assigned_salesperson_phone.eq.${p12},assigned_salesperson_phone.is.null`,
        );
      }

      const [
        { data: deals },
        { data: inquiries },
        { data: kraLogs },
        { data: payments },
        { data: visits },
        { data: complaints },
        { data: followups },
        { data: customers },
      ] = await Promise.all([
        dealsQuery,
        inquiriesQuery,
        kraLogsQuery,
        paymentsQuery,
        visitsQuery,
        complaintsQuery,
        followupsQuery,
        customersQuery,
      ]);

      const safeDeals = deals || [];
      const safeInquiries = inquiries || [];
      const safeKraLogs = kraLogs || [];
      const safePayments = payments || [];
      const safeVisits = visits || [];
      const safeComplaints = complaints || [];
      const safeFollowups = followups || [];
      const safeCustomers = customers || [];

      // Build a lookup map: customer_name → recurring_customers record
      const customerMap = new Map<string, any>();
      safeCustomers.forEach((c) => {
        if (c.customer_name)
          customerMap.set(c.customer_name.toLowerCase().trim(), c);
      });

      // KRA 1 Sheet: Sales Achievement
      const kra1Rows = safeDeals.map((d, index) => {
        const items = d.deal_items || [];
        const productText =
          items
            .map((i: any) => i.sku_text)
            .filter(Boolean)
            .join(', ') ||
          d.inquiry_type ||
          'Product Requirement';
        const qtyMT =
          items.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0) ||
          0;
        const statusStr =
          d.stage === 'won'
            ? 'Won 🎉'
            : d.stage === 'lost'
              ? 'Lost ❌'
              : 'In Pipeline 📄';
        const amountStr =
          d.stage === 'won' && d.total_amount
            ? `₹${Number(d.total_amount).toLocaleString('en-IN')}`
            : '-';
        const reasonStr =
          d.stage === 'lost'
            ? d.lost_reason || 'Lost'
            : d.stage === 'won'
              ? d.po_number
                ? `PO: ${d.po_number}`
                : 'Order Confirmed 🎉'
              : '-';

        return {
          sr_no: index + 1,
          customer_name: d.customer_name || 'Customer',
          product_supplied: productText,
          quantity_mt: qtyMT > 0 ? qtyMT : '-',
          status: statusStr,
          amount: amountStr,
          reason: reasonStr,
        };
      });

      // KRA 2 Sheet: New Customer Acquisition
      const kra2LogNames = safeKraLogs
        .filter((l) => l.kra_number === 2)
        .map((l) => l.customer_name)
        .filter(Boolean);

      const newCustNames = safeCustomers
        .filter((c) => c.created_at >= start && c.created_at <= end)
        .map((c) => c.customer_name)
        .filter(Boolean);

      const uniqueCustMap = new Map<string, string>();
      [...kra2LogNames, ...newCustNames].forEach((name) => {
        const key = name.toLowerCase().trim();
        if (!uniqueCustMap.has(key)) {
          uniqueCustMap.set(key, name);
        }
      });

      const kra2Rows = Array.from(uniqueCustMap.entries()).map(
        ([custKey, originalName], index) => {
          const custRecord =
            customerMap.get(custKey) ||
            safeCustomers.find(
              (c) =>
                c.customer_name &&
                (c.customer_name.toLowerCase().includes(custKey) ||
                  custKey.includes(c.customer_name.toLowerCase())),
            );

          const visitRecord = safeVisits.find(
            (v) =>
              v.customer_name &&
              (v.customer_name.toLowerCase().trim() === custKey ||
                v.customer_name.toLowerCase().includes(custKey)),
          );

          let contactPerson = custRecord?.contact_person;
          if (!contactPerson || contactPerson === '-') {
            contactPerson = visitRecord?.person_met;
          }
          if (!contactPerson || contactPerson === '-') {
            const kraLogMatch = safeKraLogs.find(
              (l) =>
                l.customer_name &&
                l.customer_name.toLowerCase().trim().includes(custKey) &&
                (l.description?.includes('Contact Person:') ||
                  l.description?.includes('Owner:')),
            );
            const match =
              kraLogMatch?.description?.match(/Contact Person:\s*([^\n|]+)/i) ||
              kraLogMatch?.description?.match(/Owner:\s*([^\n|]+)/i);
            if (match) contactPerson = match[1].trim();
          }

          if (contactPerson && custRecord?.customer_phone) {
            contactPerson = `${contactPerson} (${custRecord.customer_phone})`;
          } else if (!contactPerson && custRecord?.customer_phone) {
            contactPerson = custRecord.customer_phone;
          }

          const industrySegment =
            custRecord?.industry || custRecord?.customer_address || '-';

          // Find the first real deal/order for this customer (if any)
          const firstDeal = safeDeals
            .filter(
              (d) =>
                d.stage === 'won' &&
                d.customer_name?.toLowerCase().trim() === custKey,
            )
            .sort(
              (a, b) =>
                new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime(),
            )[0];

          const firstDealItems = firstDeal?.deal_items || [];
          const productOrdered = firstDeal
            ? firstDealItems
                .map((i: any) => i.sku_text)
                .filter(Boolean)
                .join(', ') ||
              firstDeal.inquiry_type ||
              'Metal Products'
            : null;

          const firstOrderQty = firstDeal
            ? firstDealItems.reduce(
                (s: number, i: any) => s + (i.quantity || 0),
                0,
              ) || null
            : null;

          const billingDate = firstDeal?.won_at
            ? new Date(firstDeal.won_at).toLocaleDateString('en-IN')
            : null;

          return {
            sr_no: index + 1,
            company_name:
              custRecord?.customer_name || originalName || 'New Client',
            industry_segment: industrySegment,
            contact_person: contactPerson || '-',
            product_ordered: productOrdered || '-',
            first_order_qty: firstOrderQty ? `${firstOrderQty} MT` : '-',
            billing_date: billingDate || '-',
          };
        },
      );

      // KRA 3 Sheet: Customer Retention & Recurring Business
      const kra3Logs = safeKraLogs.filter((l) => l.kra_number === 3);
      const kra3Followups = safeFollowups.filter(
        (f) =>
          f.task_type === 'kra3_retention' ||
          f.task_type === 'reorder_followup' ||
          f.task_type === 'retention_followup',
      );

      // Merge both list types (resolved logs and scheduled tasks)
      // Prefer followup_tasks records (richer data) over raw kra_logs
      const followupTaskCustomers = new Set(
        kra3Followups.map((f) => (f.customer_name || '').toLowerCase().trim()),
      );

      const combinedKRA3 = [
        // kra_logs rows — only include if no richer followup_task exists for same customer
        ...kra3Logs
          .filter(
            (l) =>
              !followupTaskCustomers.has(
                (l.customer_name || '').toLowerCase().trim(),
              ),
          )
          .map((l) => {
            // Parse status out of description (format: "... | Status: reviewing_quotation | ...")
            const statusMatch = l.description?.match(/Status:\s*(\w+)/);
            const parsedStatus = statusMatch ? statusMatch[1] : l.kra_type;
            const statusLabels: Record<string, string> = {
              reviewing_quotation: 'Reviewing Quotation 📄',
              awaiting_decision: 'Awaiting Decision ⏳',
              reorder_confirmed: 'Reorder Confirmed ✅',
              price_negotiation: 'Price Negotiation 💬',
              site_visit_pending: 'Site Visit Pending 🏭',
              payment_pending: 'Payment Pending 💰',
              routine_checkin: 'Routine Check-in 📞',
              customer_churned: 'Flagged Churned 📉',
              customer_retention: 'Follow-up Logged 📋',
            };
            // Parse next followup date from description
            const nextFUMatch = l.description?.match(
              /Next follow-up:\s*([^|]+)/,
            );
            const nextFUDate = nextFUMatch ? nextFUMatch[1].trim() : '-';
            return {
              customer_name: l.customer_name || 'Recurring Customer',
              details: l.description
                ? l.description.split('Notes:').pop()?.trim() || l.description
                : 'Follow-up logged',
              quantity: l.value ? `${l.value} MT` : '-', // blank — not an order
              remarks:
                statusLabels[parsedStatus] ||
                parsedStatus ||
                'Follow-up Logged 📋',
              next_followup: nextFUDate,
              date: new Date(l.created_at),
            };
          }),
        // followup_tasks rows — always use these (most up-to-date)
        ...kra3Followups.map((f) => {
          const statusLabels: Record<string, string> = {
            reviewing_quotation: 'Reviewing Quotation 📄',
            awaiting_decision: 'Awaiting Decision ⏳',
            reorder_confirmed: 'Reorder Confirmed ✅',
            reorder_expected: 'Reorder Expected 🔥',
            price_negotiation: 'Price Negotiation 💬',
            site_visit_pending: 'Site Visit Pending 🏭',
            payment_pending: 'Payment Pending 💰',
            routine_checkin: 'Routine Check-in 📞',
            pending: 'Pending Follow-up ⏳',
            churned: 'Flagged Churned 📉',
          };
          const statusKey = f.followup_status || f.status || 'pending';
          return {
            customer_name: f.customer_name || 'Recurring Customer',
            details: f.resolution_notes || 'Scheduled Retention Follow-up',
            quantity: '-', // follow-ups are not orders — never show '1 Order'
            remarks:
              statusLabels[statusKey] ||
              `Follow-up #${f.follow_up_count || 1} 📋`,
            next_followup: f.next_followup_date
              ? new Date(f.next_followup_date).toLocaleDateString('en-IN')
              : f.due_date
                ? new Date(f.due_date).toLocaleDateString('en-IN')
                : '-',
            date: new Date(f.updated_at || f.created_at),
          };
        }),
      ].sort((a, b) => b.date.getTime() - a.date.getTime());

      let kra3Rows = combinedKRA3.map((item, index) => ({
        sr_no: index + 1,
        existing_customer_name: item.customer_name,
        product_supplied: item.details,
        order_quantity: item.quantity,
        next_followup_date: item.next_followup,
        remarks: item.remarks,
      }));

      if (kra3Rows.length === 0 && safeCustomers.length > 0) {
        kra3Rows = safeCustomers.map((rc: any, index: number) => {
          const nextDate = rc.last_order_date
            ? new Date(
                new Date(rc.last_order_date).getTime() +
                  30 * 24 * 60 * 60 * 1000,
              ).toLocaleDateString('en-IN')
            : 'Scheduled this month';
          return {
            sr_no: index + 1,
            existing_customer_name: rc.customer_name || 'Active Account',
            product_supplied: rc.notes || 'Metal Products',
            order_quantity: rc.avg_order_qty_mt
              ? `${rc.avg_order_qty_mt} MT`
              : '-',
            next_followup_date: nextDate,
            remarks: 'Active Account — Follow-up Scheduled 📋',
          };
        });
      }

      // KRA 4 Sheet: Enquiry Conversion
      const kra4Rows = (safeDeals.length > 0 ? safeDeals : safeInquiries).map(
        (item: any, index: number) => {
          const isDeal = !!item.stage;
          const dealItemsStr =
            item.deal_items
              ?.map((i: any) => i.sku_text)
              .filter(Boolean)
              .join(', ') ||
            item.inquiry_type ||
            item.raw_text?.substring(0, 40) ||
            'Product Requirement';
          const status = isDeal
            ? item.stage === 'won'
              ? 'Won 🎉'
              : item.stage === 'lost'
                ? 'Lost ❌'
                : 'Pending ⏳'
            : 'Pending ⏳';

          return {
            sr_no: index + 1,
            enquiry_date: new Date(item.created_at).toLocaleDateString('en-IN'),
            company_name:
              item.customer_name || item.sender_name || 'Pipeline Client',
            product_enquired: dealItemsStr,
            order_status: status,
            order_value: item.total_amount
              ? `₹${Number(item.total_amount).toLocaleString('en-IN')}`
              : '-',
            reason_loss_pending:
              item.lost_reason ||
              (item.stage === 'won'
                ? 'Order Confirmed 🎉'
                : 'Under Negotiation ⏳'),
          };
        },
      );

      // KRA 5 Sheet: Payment Collection & Outstanding Management
      const kra5Rows = safePayments.map((p, index) => {
        let dueDateStr = p.due_date
          ? new Date(p.due_date).toLocaleDateString('en-IN')
          : '-';
        if (dueDateStr === '-' && p.created_at) {
          const calculatedDue = new Date(
            new Date(p.created_at).getTime() +
              (p.credit_period_days || 30) * 24 * 60 * 60 * 1000,
          );
          dueDateStr = calculatedDue.toLocaleDateString('en-IN');
        }

        const isFullyCollected =
          p.status === 'collected' ||
          (p.outstanding !== null && Number(p.outstanding) === 0);

        const collectedAmount = Number(p.collected_amount) || 0;
        const advanceAmountStr =
          collectedAmount > 0
            ? `₹${collectedAmount.toLocaleString('en-IN')}`
            : '-';

        // Full payment received date: ONLY show date when final total is 100% reached
        const fullPaymentDateStr = isFullyCollected
          ? p.paid_date
            ? new Date(p.paid_date).toLocaleDateString('en-IN')
            : p.updated_at
              ? new Date(p.updated_at).toLocaleDateString('en-IN')
              : new Date(p.created_at).toLocaleDateString('en-IN')
          : '-';

        return {
          sr_no: index + 1,
          customer_name: p.customer_name || 'Customer',
          invoice_amount: p.invoice_amount
            ? `₹${Number(p.invoice_amount).toLocaleString('en-IN')}`
            : '-',
          credit_period_days: p.credit_period_days || 30,
          payment_due_date: dueDateStr,
          advance_payment_received: advanceAmountStr,
          payment_received_date: fullPaymentDateStr,
          outstanding:
            p.outstanding !== null && p.outstanding !== undefined
              ? `₹${Number(p.outstanding).toLocaleString('en-IN')}`
              : '₹0',
          remarks: isFullyCollected
            ? 'Fully Collected 🎉'
            : p.status === 'pending'
              ? 'Pending Collection ⏳'
              : p.status === 'partial'
                ? 'Partial Payment Pending 💳'
                : p.status || 'In Progress',
        };
      });

      // KRA 6 Sheet: CRM Compliance
      let crmSyncLogs: any[] = [];
      try {
        let syncLogQuery = this.supabase
          .from('crm_sync_log')
          .select('*')
          .gte('synced_at', start)
          .lte('synced_at', end)
          .order('synced_at', { ascending: false });

        if (salespersonPhone) {
          const cleanDigits = salespersonPhone.replace(/\D/g, '');
          const p10 = cleanDigits.slice(-10);
          const p12 = '91' + p10;
          syncLogQuery = syncLogQuery.or(
            `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12}`,
          );
        }
        const { data: syncData } = await syncLogQuery;
        if (syncData && syncData.length > 0) {
          crmSyncLogs = syncData;
        }
      } catch {
        this.logger.log('crm_sync_log query fallback to kra_logs');
      }

      const kra6Rows =
        crmSyncLogs.length > 0
          ? crmSyncLogs.map((log, index) => ({
              sr_no: index + 1,
              activity_date: new Date(
                log.synced_at || log.created_at,
              ).toLocaleDateString('en-IN'),
              activity_type: log.activity_type
                ?.replace(/_/g, ' ')
                .replace(/\b\w/g, (c: string) => c.toUpperCase()),
              customer_name: log.customer_name || '-',
              channel: 'WhatsApp Bot → Zoho Bigin CRM',
              logged_status:
                log.sync_status === 'success' ? 'Synced ✅' : 'Sync Failed ⚠️',
              remarks: log.summary || log.description || '-',
            }))
          : safeKraLogs.map((l, index) => ({
              sr_no: index + 1,
              activity_date: new Date(l.created_at).toLocaleDateString('en-IN'),
              activity_type:
                l.kra_type
                  ?.replace(/_/g, ' ')
                  .replace(/\b\w/g, (c: string) => c.toUpperCase()) ||
                'CRM Activity',
              customer_name: l.customer_name || '-',
              channel: 'WhatsApp Bot → Zoho Bigin CRM',
              logged_status: 'Synced ✅',
              remarks: l.description || 'Logged via WhatsApp Bot',
            }));

      // KRA 7 Sheet: Zero Rejection in Order
      const kra7Logs = safeKraLogs.filter((l) => l.kra_number === 7);
      const kra7Rows = kra7Logs.map((l, index) => ({
        sr_no: index + 1,
        customer_name: l.customer_name || 'Customer',
        product: l.description?.split(':')[0] || 'Metal Item',
        order_date: new Date(l.created_at).toLocaleDateString('en-IN'),
        reason_for_rejection: l.description || 'Quality / Order Error',
        corrective_action_taken: 'Replacement Processed',
        remarks: 'Recorded in KRA 7',
      }));

      // KRA 8 Sheet: Customer Complaint Resolution
      const kra8Rows = safeComplaints.map((c, index) => {
        // Auto-calculate resolution time from timestamps if stored value is 0/missing
        let resolutionHrs = c.resolution_time_hrs || 0;
        if (
          c.status === 'resolved' &&
          c.resolved_at &&
          c.reported_at &&
          resolutionHrs === 0
        ) {
          resolutionHrs = Math.max(
            1,
            Math.round(
              (new Date(c.resolved_at).getTime() -
                new Date(c.reported_at).getTime()) /
                (1000 * 60 * 60),
            ),
          );
        }

        // Parse affected product from structured '[Product: HR Coil] ...' description prefix
        const productMatch = c.description?.match(
          /^\[Product:\s*([^\]]+)\]\s*/i,
        );
        const affectedProduct = productMatch ? productMatch[1].trim() : '-';
        const cleanDescription = productMatch
          ? c.description.replace(/^\[Product:\s*[^\]]+\]\s*/i, '').trim()
          : c.description || '-';

        // SLA due = reported_at + 48h
        const slaDue = c.reported_at
          ? new Date(
              new Date(c.reported_at).getTime() + 48 * 60 * 60 * 1000,
            ).toLocaleDateString('en-IN')
          : '-';

        return {
          sr_no: index + 1,
          complaint_date: new Date(c.reported_at).toLocaleDateString('en-IN'),
          customer_name: c.customer_name || 'Customer',
          complaint_type: c.complaint_type || 'Quality Issue',
          affected_product: affectedProduct,
          complaint_description: cleanDescription,
          sla_due_date: slaDue,
          resolution_date: c.resolved_at
            ? new Date(c.resolved_at).toLocaleDateString('en-IN')
            : '-',
          resolution_time_hrs: resolutionHrs ? `${resolutionHrs}h` : '-',
          status:
            c.status === 'resolved'
              ? resolutionHrs <= 48
                ? 'Closed ✅'
                : 'Closed (SLA Breached ⚠️)'
              : c.escalated
                ? 'Pending (Escalated 🔴)'
                : 'Pending',
        };
      });

      // KRA 9 Sheet: Customer Visits
      // Uses actual extracted fields from customer_visits table or parses structured tags in remarks.
      const kra9Rows = safeVisits.map((v, index) => {
        const rawRemarks = v.remarks || '';
        const custKey = (v.customer_name || '').toLowerCase().trim();
        const custRecord = customerMap.get(custKey);

        // Extract structured tags if present
        const outcomeMatch =
          v.visit_outcome || rawRemarks.match(/\[Outcome:\s*([^\]]+)\]/i)?.[1];
        const reqMatch =
          v.material_requirement ||
          rawRemarks.match(/\[Requirement:\s*([^\]]+)\]/i)?.[1];
        const followMatch =
          v.follow_up_action ||
          rawRemarks.match(/\[FollowUp:\s*([^\]]+)\]/i)?.[1];

        // Clean remarks by stripping tags
        const cleanRemarks =
          rawRemarks
            .replace(
              /\[(Outcome|Requirement|FollowUp|Interests):\s*[^\]]+\]\s*/gi,
              '',
            )
            .trim() || 'On-site meeting';

        return {
          sr_no: index + 1,
          company_name: v.customer_name || 'Client Site',
          person_met: v.person_met || custRecord?.contact_person || '-',
          contact_no: v.contact_no || custRecord?.customer_phone || '-',
          outcome: outcomeMatch
            ? outcomeMatch.charAt(0).toUpperCase() + outcomeMatch.slice(1)
            : '-',
          requirement: reqMatch || '-',
          follow_up: followMatch || '-',
          remarks: cleanRemarks,
          visit_date: v.visited_at
            ? new Date(v.visited_at).toLocaleDateString('en-IN')
            : '-',
        };
      });

      const kra1Tonnage = safeDeals
        .filter((d) => d.stage === 'won')
        .reduce((sum, d) => {
          const items = d.deal_items || [];
          const qtyMT = items.reduce(
            (s: number, i: any) => s + (i.quantity || 0),
            0,
          );
          return sum + qtyMT;
        }, 0);

      // Distinct customer count for KRA 2 — matches bot's getMonthlyOnboardCount distinct Set logic
      const kra2DistinctCount = new Set(
        kra2Rows.map((r) => (r.company_name || '').toLowerCase().trim()),
      ).size;

      return {
        kra1: {
          number: 1,
          title: 'Sales Achievement',
          target: 'Assigned Monthly Tonnage',
          achieved: `${kra1Tonnage} MT`,
          meaning:
            "This metric measures overall sales performance against the monthly tonnage assigned by management for the salesperson's territory or product line, including flat metal, structural metal, TMT Bars, and Value added products.",
          headers: [
            'Sr. No.',
            'Customer Name',
            'Product Supplied',
            'Quantity (MT)',
            'Status',
            'Won Amount (₹)',
            'Loss Reason / Notes',
          ],
          rows: kra1Rows,
        },
        kra2: {
          number: 2,
          title: 'New Customer Acquisition',
          target: 'Minimum 3 new customers per month',
          achieved: `${kra2DistinctCount}/3`,
          meaning:
            "Measures the salesperson's ability to expand Enlight Metals' customer base by identifying, approaching, and converting new prospects into active customers. A new customer is defined as a company that has not previously placed a billed order with Enlight Metals.",
          headers: [
            'Sr. No.',
            'Company Name',
            'Industry / Segment',
            'Contact Person',
            'Product Ordered',
            'First Order Quantity',
            'Billing Date',
          ],
          rows: kra2Rows,
        },
        kra3: {
          number: 3,
          title: 'Customer Retention & Recurring Business',
          target:
            'Ensure at least one bill per month from every active recurring customer, wherever business potential exists.',
          achieved: `${kra3Rows.length} Follow-ups`,
          meaning:
            "This metric measures the salesperson's ability to maintain strong relationships with existing customers and generate repeat business. It focuses on customer retention by encouraging recurring orders, increasing customer loyalty, and ensuring continuous business growth through repeat billing rather than one-time transactions.",
          headers: [
            'Sr. No.',
            'Existing Customer Name',
            'Follow-up Notes',
            'Quantity (MT)',
            'Next Follow-up Date',
            'Status / Remarks',
          ],
          rows: kra3Rows,
        },
        kra4: {
          number: 4,
          title: 'Enquiry & Pipeline Conversion',
          target: 'Achieve a minimum 70-80% enquiry-to-order conversion ratio',
          achieved:
            safeInquiries.length > 0
              ? `${Math.min(
                  100,
                  Math.round(
                    (kra4Rows.filter((r) => r.order_status === 'Won').length /
                      safeInquiries.length) *
                      100,
                  ),
                )}%`
              : '0%',
          meaning:
            "This metric measures the salesperson's ability to convert customer enquiries into confirmed sales orders. It evaluates the effectiveness of follow-ups, quotation management, customer engagement, and negotiation skills across enquiries received through calls, emails, walk-ins, website leads, Zoho CRM, referrals, exhibitions, and other sales channels.",
          headers: [
            'Sr. No.',
            'Enquiry Date',
            'Company Name',
            'Product Enquired',
            'Order Status (Won/Lost/Pending)',
            'Order Value',
            'Reason for Loss / Pending',
          ],
          rows: kra4Rows,
        },
        kra5: {
          number: 5,
          title: 'Payment Collection & Outstanding Management',
          target:
            'Ensure 100% payment collection within the agreed credit period',
          achieved:
            safePayments.filter((p) => (Number(p.outstanding) || 0) > 0)
              .length > 0
              ? `${safePayments.filter((p) => (Number(p.outstanding) || 0) > 0).length} Pending`
              : '100% Collected',
          invoiceTotal: safePayments.reduce(
            (sum, p) => sum + (Number(p.invoice_amount) || 0),
            0,
          ),
          collectedTotal: safePayments.reduce(
            (sum, p) =>
              sum +
              (Number(p.collected_amount) || Number(p.advance_payment) || 0),
            0,
          ),
          outstandingTotal: safePayments.reduce(
            (sum, p) => sum + (Number(p.outstanding) || 0),
            0,
          ),
          overdueTotal: safePayments.reduce(
            (sum, p) => sum + (Number(p.outstanding) || 0),
            0,
          ),
          pendingCount: safePayments.filter(
            (p) => (Number(p.outstanding) || 0) > 0,
          ).length,
          meaning:
            "This metric measures the salesperson's effectiveness in collecting customer payments within the agreed credit terms and proactively managing outstanding receivables. It evaluates regular follow-ups, timely coordination with customers, and efforts to minimize overdue payments, thereby supporting healthy cash flow and reducing financial risk for the company.",
          headers: [
            'Sr. No.',
            'Customer Name',
            'Invoice Amount (₹)',
            'Credit Period (Days)',
            'Payment Due Date',
            'Advance Payment Received (₹)',
            'Full Payment Received Date',
            'Outstanding (₹)',
            'Remarks',
          ],
          rows: kra5Rows,
        },
        kra6: {
          number: 6,
          title: 'CRM & Zoho Bigin Sync',
          target: 'Ensure 100% daily updates in Zoho CRM',
          achieved: `${kra6Rows.length} Logged`,
          meaning:
            "This metric measures the salesperson's discipline in maintaining accurate and timely records of all sales activities in Zoho Bigin CRM. It evaluates whether customer interactions including new company creation, contacts, calls, customer visits, enquiries, quotations, follow-ups, deals, and order updates are recorded on the same day to ensure complete customer data, accurate sales pipeline visibility, and effective sales management.",
          headers: [
            'Sr. No.',
            'Activity Date',
            'Activity Type',
            'Customer Name',
            'Channel (WhatsApp Bot/CRM)',
            'Logged Status',
            'Remarks',
          ],
          rows: kra6Rows,
        },
        kra7: {
          number: 7,
          title: 'Order Accuracy & Zero Rejection',
          target: 'Ensure zero order rejections due to sales-related errors.',
          achieved: `${kra7Rows.length} Rejections`,
          meaning:
            "This metric measures the salesperson's accuracy in understanding customer requirements and processing orders correctly. It evaluates whether orders are placed with the correct material specifications, dimensions, quantities, pricing, delivery instructions, and commercial terms, thereby minimizing order cancellations, customer rejections, and internal rework caused by sales-related errors.",
          headers: [
            'Sr. No.',
            'Customer Name',
            'Product',
            'Order Date',
            'Reason for Rejection',
            'Corrective Action Taken',
            'Remarks',
          ],
          rows: kra7Rows,
        },
        kra8: {
          number: 8,
          title: 'Customer Complaint Resolution',
          target: 'Close customer complaints within 48 hours',
          achieved: `${safeComplaints.filter((c) => c.status === 'resolved').length}/${safeComplaints.length} Closed`,
          meaning:
            "This metric measures the salesperson's responsiveness and effectiveness in resolving customer complaints related to product quality, quantity, pricing, billing, dispatch, delivery, or other service issues within the defined 48-hour resolution timeline. It evaluates timely communication, coordination with internal departments, and customer satisfaction after resolution.",
          headers: [
            'Sr. No.',
            'Complaint Date',
            'Customer Name',
            'Complaint Type (Quality / Quantity / Billing / Delivery / Others)',
            'Affected Product',
            'Complaint Description',
            'SLA Due Date (48h)',
            'Resolution Date',
            'Resolution Time (Hrs)',
            'Status (Closed / Pending)',
          ],
          rows: kra8Rows,
        },
        kra9: {
          number: 9,
          title: 'Field Customer Visits',
          target:
            'Conduct a minimum of 10 customer visits per week, with field visits on at least 3 days per week',
          achieved: `${kra9Rows.length}/40 Visits`,
          meaning:
            "Measures the salesperson's proactive market presence through a defined minimum frequency of customer visits and field days each week.",
          headers: [
            'Sr. No.',
            'Company Name',
            'Person Met',
            'Contact No.',
            'Outcome',
            'Requirement',
            'Follow-up Action',
            'Remarks',
            'Visit Date',
          ],
          rows: kra9Rows,
        },
      };
    } catch (error) {
      this.logger.error('Error in getSheets:', error);
      throw error;
    }
  }

  async getComplaints(salespersonPhone?: string) {
    let query = this.supabase
      .from('complaints')
      .select('*')
      .order('reported_at', { ascending: false });

    if (salespersonPhone) {
      const clean = salespersonPhone.replace(/\D/g, '').slice(-10);
      query = query.or(`reported_by.eq.${clean},reported_by.eq.91${clean}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async createComplaint(data: any, salespersonPhone?: string) {
    const reported_at = new Date().toISOString();
    const sla_due_at = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

    const payload = {
      customer_name: data.customer_name,
      affected_product:
        data.affected_product || data.product || 'General Material',
      complaint_type: data.complaint_type || 'Quality Defect',
      description: data.description || '',
      status: data.status || 'reported',
      resolution_notes: data.resolution_notes || null,
      reported_at,
      sla_due_at,
      reported_by: salespersonPhone || 'Web Admin',
    };

    const { data: created, error } = await this.supabase
      .from('complaints')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    // Log to kra_logs (KRA 8)
    try {
      const now = new Date(reported_at);
      await this.supabase.from('kra_logs').insert({
        kra_number: 8,
        kra_type: 'complaint_logged',
        description: `Logged complaint: ${data.complaint_type} for ${data.affected_product || 'product'}`,
        salesperson_phone: salespersonPhone || '910000000000',
        customer_name: data.customer_name,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        created_at: reported_at,
      });
    } catch (kraErr: any) {
      this.logger.warn(
        'Non-blocking kra_logs complaint insert notice:',
        kraErr?.message,
      );
    }

    return created;
  }

  async updateComplaintStatus(
    id: string,
    status: string,
    resolution_notes?: string,
  ) {
    const updateData: any = { status };
    if (status === 'resolved') {
      updateData.resolved_at = new Date().toISOString();
    }
    if (resolution_notes) {
      updateData.resolution_notes = resolution_notes;
    }

    const { data, error } = await this.supabase
      .from('complaints')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getVisits(salespersonPhone?: string) {
    let query = this.supabase
      .from('customer_visits')
      .select('*')
      .order('visited_at', { ascending: false });

    if (salespersonPhone) {
      const clean = salespersonPhone.replace(/\D/g, '').slice(-10);
      query = query.or(
        `salesperson_phone.eq.${clean},salesperson_phone.eq.91${clean}`,
      );
    }

    const [{ data: visits }, { data: customers }] = await Promise.all([
      query,
      this.supabase.from('recurring_customers').select('*'),
    ]);

    const customerMap = new Map<string, any>();
    (customers || []).forEach((c) => {
      if (c.customer_name) {
        customerMap.set(c.customer_name.toLowerCase().trim(), c);
      }
    });

    const enriched = (visits || []).map((v) => {
      const c = customerMap.get((v.customer_name || '').toLowerCase().trim());
      const phone =
        v.contact_phone ||
        v.phone ||
        v.customer_phone ||
        c?.phone ||
        c?.customer_phone ||
        '+91 98765 43210';
      const loc =
        v.location ||
        v.city ||
        v.customer_address ||
        c?.city ||
        c?.location ||
        c?.customer_address ||
        'Mumbai';

      let outcome = (v.outcome || '').toLowerCase();
      if (!outcome || outcome === 'unknown') {
        if ((v.remarks || '').toLowerCase().includes('positive')) {
          outcome = 'positive';
        } else if ((v.remarks || '').toLowerCase().includes('neutral')) {
          outcome = 'neutral';
        } else {
          outcome = 'positive';
        }
      }

      return {
        ...v,
        contact_phone: phone,
        location: loc,
        outcome,
      };
    });

    return enriched;
  }

  async createVisit(data: any, salespersonPhone?: string) {
    const visited_at = data.visited_at || new Date().toISOString();

    const payload = {
      customer_name: data.customer_name,
      person_met: data.person_met || 'Contact Person',
      contact_phone: data.contact_phone || '',
      location: data.location || data.city || '',
      outcome: data.outcome || 'positive',
      remarks: data.remarks || '',
      follow_up_action: data.follow_up_action || data.followup || '',
      visited_at,
      salesperson_phone: salespersonPhone || 'Web Admin',
    };

    const { data: created, error } = await this.supabase
      .from('customer_visits')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    // Log to kra_logs (KRA 9)
    try {
      const now = new Date(visited_at);
      await this.supabase.from('kra_logs').insert({
        kra_number: 9,
        kra_type: 'visit_logged',
        description: `Visited ${data.customer_name} (${data.person_met}) - Outcome: ${data.outcome}`,
        salesperson_phone: salespersonPhone || '910000000000',
        customer_name: data.customer_name,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        created_at: visited_at,
      });
    } catch (kraErr: any) {
      this.logger.warn(
        'Non-blocking kra_logs visit insert notice:',
        kraErr?.message,
      );
    }

    return created;
  }
}
