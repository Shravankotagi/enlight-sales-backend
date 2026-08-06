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
      const wonDeals = deals.filter((d) => {
        if (d.stage !== 'won') return false;
        const dealDate = d.won_at || d.created_at;
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
      const collectedPayments = payments.filter(
        (p) => p.status === 'collected',
      );
      const collectedLogs = kraLogs.filter(
        (l) =>
          l.kra_number === 5 &&
          (l.kra_type === 'payment_collected' ||
            l.kra_type === 'payment_advance'),
      );

      const collectedLogsSum = collectedLogs.reduce(
        (sum, l) => sum + (Number(l.value) || 0),
        0,
      );
      const collectedPaymentsSum = collectedPayments.reduce(
        (sum, p) => sum + (Number(p.collected_amount) || 0),
        0,
      );

      const collectedAmount = Math.max(collectedLogsSum, collectedPaymentsSum);
      const collectedCount = Math.max(
        collectedPayments.length,
        collectedLogs.length,
      );

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
          // Use kra_logs inquiry_received count (accurate — deduped per customer per month)
          // Fallback to raw inquiries.length if no kra4 logs exist yet
          total_inquiries:
            kraLogs.filter(
              (l) => l.kra_number === 4 && l.kra_type === 'inquiry_received',
            ).length || inquiries.length,
          won_deals: wonDeals.length,
          conversion_rate:
            (kraLogs.filter(
              (l) => l.kra_number === 4 && l.kra_type === 'inquiry_received',
            ).length || inquiries.length) > 0
              ? Math.round(
                  (wonDeals.length /
                    (kraLogs.filter(
                      (l) =>
                        l.kra_number === 4 && l.kra_type === 'inquiry_received',
                    ).length || inquiries.length)) *
                    100,
                )
              : 0,
          target_rate: 70,
          status:
            (kraLogs.filter(
              (l) => l.kra_number === 4 && l.kra_type === 'inquiry_received',
            ).length || inquiries.length) > 0 &&
            wonDeals.length /
              (kraLogs.filter(
                (l) => l.kra_number === 4 && l.kra_type === 'inquiry_received',
              ).length || inquiries.length) >=
              0.7
              ? 'achieved'
              : 'in_progress',
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

  async getSheets(salespersonPhone?: string, month?: number, year?: number) {
    try {
      const { start, end } = this.getMonthRange(month, year);

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
        dealsQuery = dealsQuery.eq('salesperson_phone', salespersonPhone);
        inquiriesQuery = inquiriesQuery.eq(
          'salesperson_phone',
          salespersonPhone,
        );
        kraLogsQuery = kraLogsQuery.eq('salesperson_phone', salespersonPhone);
        paymentsQuery = paymentsQuery.eq('salesperson_phone', salespersonPhone);
        visitsQuery = visitsQuery.eq('salesperson_phone', salespersonPhone);
        complaintsQuery = complaintsQuery.eq('reported_by', salespersonPhone);
        followupsQuery = followupsQuery.eq(
          'salesperson_phone',
          salespersonPhone,
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
      ] = await Promise.all([
        dealsQuery,
        inquiriesQuery,
        kraLogsQuery,
        paymentsQuery,
        visitsQuery,
        complaintsQuery,
        followupsQuery,
      ]);

      const safeDeals = deals || [];
      const safeInquiries = inquiries || [];
      const safeKraLogs = kraLogs || [];
      const safePayments = payments || [];
      const safeVisits = visits || [];
      const safeComplaints = complaints || [];
      const safeFollowups = followups || [];

      // KRA 1 Sheet: Sales Achievement
      const wonDeals = safeDeals.filter((d) => d.stage === 'won');
      const kra1Rows = wonDeals.map((d, index) => {
        const items = d.deal_items || [];
        const productText =
          items
            .map((i: any) => i.sku_text)
            .filter(Boolean)
            .join(', ') ||
          d.inquiry_type ||
          'Steel Products';
        const qtyMT =
          items.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0) ||
          1;
        return {
          sr_no: index + 1,
          customer_name: d.customer_name || 'Customer',
          product_supplied: productText,
          quantity_mt: qtyMT,
        };
      });

      // KRA 2 Sheet: New Customer Acquisition
      const kra2Logs = safeKraLogs.filter(
        (l) => l.kra_number === 2 && l.kra_type === 'new_customer',
      );
      const kra2Rows = kra2Logs.map((l, index) => ({
        sr_no: index + 1,
        company_name: l.customer_name || 'New Client',
        industry_segment: 'Manufacturing / Industrial',
        contact_person: 'Key Contact',
        product_ordered: l.description || 'Steel Order',
        first_order_qty: l.value
          ? `₹${Number(l.value).toLocaleString('en-IN')}`
          : '1 Order',
        billing_date: new Date(l.created_at).toLocaleDateString('en-IN'),
      }));

      // KRA 3 Sheet: Customer Retention & Recurring Business
      const kra3Logs = safeKraLogs.filter((l) => l.kra_number === 3);
      const kra3Followups = safeFollowups.filter(
        (f) =>
          f.task_type === 'kra3_retention' ||
          f.task_type === 'reorder_followup' ||
          f.task_type === 'retention_followup',
      );

      // Merge both list types (resolved logs and scheduled tasks)
      const combinedKRA3 = [
        ...kra3Logs.map((l) => ({
          customer_name: l.customer_name || 'Recurring Customer',
          details: l.description || 'Repeat Order / Follow-up',
          quantity: l.value ? `${l.value} MT` : '1 Order',
          remarks:
            l.kra_type === 'customer_churned'
              ? 'Flagged Churned 📉'
              : 'Follow-up Logged ✅',
          date: new Date(l.created_at),
        })),
        ...kra3Followups.map((f) => ({
          customer_name: f.customer_name || 'Recurring Customer',
          details: f.resolution_notes || 'Scheduled Retention Follow-up',
          quantity: '-',
          remarks:
            f.status === 'pending'
              ? 'Pending Follow-up ⏳'
              : `Follow-up Sent 📱 (Count: ${f.follow_up_count})`,
          date: new Date(f.created_at),
        })),
      ].sort((a, b) => b.date.getTime() - a.date.getTime());

      const kra3Rows = combinedKRA3.map((item, index) => ({
        sr_no: index + 1,
        existing_customer_name: item.customer_name,
        product_supplied: item.details,
        order_quantity: item.quantity,
        remarks: item.remarks,
      }));

      // KRA 4 Sheet: Enquiry Conversion
      const kra4Rows = safeInquiries.map((inq, index) => {
        const matchingDeal = safeDeals.find((d) => d.inquiry_id === inq.id);
        const status =
          matchingDeal?.stage === 'won'
            ? 'Won'
            : matchingDeal?.stage === 'lost'
              ? 'Lost'
              : 'Pending';
        return {
          sr_no: index + 1,
          enquiry_date: new Date(inq.created_at).toLocaleDateString('en-IN'),
          company_name:
            matchingDeal?.customer_name || inq.sender_name || 'Enquiry Client',
          product_enquired:
            inq.raw_text?.substring(0, 40) || 'Steel requirement',
          order_status: status,
          order_value: matchingDeal?.total_amount
            ? `₹${Number(matchingDeal.total_amount).toLocaleString('en-IN')}`
            : '-',
          reason_loss_pending:
            matchingDeal?.lost_reason ||
            (status === 'Pending' ? 'Under Negotiation' : '-'),
        };
      });

      // KRA 5 Sheet: Payment Collection & Outstanding Management
      // Mapped strictly from payment_tracking table records (logged explicitly by salesperson)
      const kra5Rows = safePayments.map((p, index) => ({
        sr_no: index + 1,
        customer_name: p.customer_name || 'Customer',
        invoice_amount: p.invoice_amount
          ? `₹${Number(p.invoice_amount).toLocaleString('en-IN')}`
          : '-',
        credit_period_days: p.credit_period_days || 30,
        payment_due_date: p.due_date
          ? new Date(p.due_date).toLocaleDateString('en-IN')
          : '-',
        payment_received_date: p.paid_date
          ? new Date(p.paid_date).toLocaleDateString('en-IN')
          : '-',
        outstanding:
          p.outstanding !== null && p.outstanding !== undefined
            ? `₹${Number(p.outstanding).toLocaleString('en-IN')}`
            : '₹0',
        remarks:
          p.status === 'collected'
            ? 'Fully Collected 🎉'
            : p.status === 'pending'
              ? 'Pending Collection ⏳'
              : p.status === 'partial'
                ? 'Partial Payment Pending 💳'
                : p.status || 'In Progress',
      }));

      // KRA 6 Sheet: CRM Compliance
      const kra6Rows = safeKraLogs.map((l, index) => ({
        sr_no: index + 1,
        activity_date: new Date(l.created_at).toLocaleDateString('en-IN'),
        activity_type: l.kra_type || 'Activity Log',
        customer_name: l.customer_name || '-',
        channel: 'WhatsApp Bot / CRM',
        logged_status: 'Compliant ✅',
        remarks: l.description || 'Logged via WhatsApp',
      }));

      // KRA 7 Sheet: Zero Rejection in Order
      const kra7Logs = safeKraLogs.filter((l) => l.kra_number === 7);
      const kra7Rows = kra7Logs.map((l, index) => ({
        sr_no: index + 1,
        customer_name: l.customer_name || 'Customer',
        product: l.description?.split(':')[0] || 'Steel Item',
        order_date: new Date(l.created_at).toLocaleDateString('en-IN'),
        reason_for_rejection: l.description || 'Quality / Order Error',
        corrective_action_taken: 'Replacement Processed',
        remarks: 'Recorded in KRA 7',
      }));

      // KRA 8 Sheet: Customer Complaint Resolution
      const kra8Rows = safeComplaints.map((c, index) => ({
        sr_no: index + 1,
        complaint_date: new Date(c.reported_at).toLocaleDateString('en-IN'),
        customer_name: c.customer_name || 'Customer',
        complaint_type: c.complaint_type || 'Quality Issue',
        complaint_description: c.description || '-',
        resolution_date: c.resolved_at
          ? new Date(c.resolved_at).toLocaleDateString('en-IN')
          : '-',
        resolution_time_hrs: c.resolution_time_hrs
          ? `${c.resolution_time_hrs}h`
          : '-',
        status: c.status === 'resolved' ? 'Closed' : 'Pending',
      }));

      // KRA 9 Sheet: Customer Visits
      const kra9Rows = safeVisits.map((v, index) => ({
        sr_no: index + 1,
        company_name: v.customer_name || 'Client Site',
        address: v.location || v.address || 'Field Visit Location',
        person_met: v.person_met || 'Owner / Buyer',
        contact_no: v.contact_no || '-',
        remarks: v.notes || 'Visited & Market Presence Recorded',
      }));

      const kra1Tonnage = kra1Rows.reduce(
        (sum, r) => sum + (r.quantity_mt || 0),
        0,
      );

      return {
        kra1: {
          number: 1,
          title: 'KRA 1: Sales Achievement',
          target: 'Assigned Monthly Tonnage',
          achieved: `${kra1Tonnage} MT`,
          meaning:
            "This KRA measures overall sales performance against the monthly tonnage assigned by management for the salesperson's territory or product line, including flat steel, structural steel, TMT Bars, and Value added products.",
          headers: [
            'Sr. No.',
            'Customer Name',
            'Product Supplied',
            'Quantity (MT)',
          ],
          rows: kra1Rows,
        },
        kra2: {
          number: 2,
          title: 'KRA 2: New Customer Acquisition',
          target: 'Minimum 3 new customers per month',
          achieved: `${kra2Rows.length}/3`,
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
          title: 'KRA 3: Customer Retention & Recurring Business',
          target:
            'Ensure at least one bill per month from every active recurring customer, wherever business potential exists.',
          achieved: `${kra3Rows.length} Orders`,
          meaning:
            "This KRA measures the salesperson's ability to maintain strong relationships with existing customers and generate repeat business. It focuses on customer retention by encouraging recurring orders, increasing customer loyalty, and ensuring continuous business growth through repeat billing rather than one-time transactions.",
          headers: [
            'Sr. No.',
            'Existing Customer Name',
            'Product Supplied',
            'Order Quantity',
            'Remarks',
          ],
          rows: kra3Rows,
        },
        kra4: {
          number: 4,
          title: 'KRA 4: Enquiry Conversion',
          target: 'Achieve a minimum 70-80% enquiry-to-order conversion ratio',
          achieved:
            safeInquiries.length > 0
              ? `${Math.round((wonDeals.length / safeInquiries.length) * 100)}%`
              : '0%',
          meaning:
            "This KRA measures the salesperson's ability to convert customer enquiries into confirmed sales orders. It evaluates the effectiveness of follow-ups, quotation management, customer engagement, and negotiation skills across enquiries received through calls, emails, walk-ins, website leads, Zoho CRM, referrals, exhibitions, and other sales channels.",
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
          title: 'KRA 5: Payment Collection & Outstanding Management',
          target:
            'Ensure 100% payment collection within the agreed credit period',
          achieved:
            kra5Rows.filter((r) => r.remarks === 'Fully Collected').length > 0
              ? '100%'
              : 'In Progress',
          meaning:
            "This KRA measures the salesperson's effectiveness in collecting customer payments within the agreed credit terms and proactively managing outstanding receivables. It evaluates regular follow-ups, timely coordination with customers, and efforts to minimize overdue payments, thereby supporting healthy cash flow and reducing financial risk for the company.",
          headers: [
            'Sr. No.',
            'Customer Name',
            'Invoice Amount (₹)',
            'Credit Period (Days)',
            'Payment Due Date',
            'Payment Received Date',
            'Outstanding (₹)',
            'Remarks',
          ],
          rows: kra5Rows,
        },
        kra6: {
          number: 6,
          title: 'KRA 6: CRM Compliance',
          target: 'Ensure 100% daily updates in Zoho CRM',
          achieved: `${kra6Rows.length} Logged`,
          meaning:
            "This KRA measures the salesperson's discipline in maintaining accurate and timely records of all sales activities in Zoho Bigin CRM. It evaluates whether customer interactions including new company creation, contacts, calls, customer visits, enquiries, quotations, follow-ups, deals, and order updates are recorded on the same day to ensure complete customer data, accurate sales pipeline visibility, and effective sales management.",
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
          title: 'KRA 7: Zero Rejection in Order',
          target: 'Ensure zero order rejections due to sales-related errors.',
          achieved: `${kra7Rows.length} Rejections`,
          meaning:
            "This KRA measures the salesperson's accuracy in understanding customer requirements and processing orders correctly. It evaluates whether orders are placed with the correct material specifications, dimensions, quantities, pricing, delivery instructions, and commercial terms, thereby minimizing order cancellations, customer rejections, and internal rework caused by sales-related errors.",
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
          title: 'KRA 8: Customer Complaint Resolution',
          target: 'Close customer complaints within 48 hours',
          achieved: `${safeComplaints.filter((c) => c.status === 'resolved').length}/${safeComplaints.length} Closed`,
          meaning:
            "This KRA measures the salesperson's responsiveness and effectiveness in resolving customer complaints related to product quality, quantity, pricing, billing, dispatch, delivery, or other service issues within the defined 48-hour resolution timeline. It evaluates timely communication, coordination with internal departments, and customer satisfaction after resolution.",
          headers: [
            'Sr. No.',
            'Complaint Date',
            'Customer Name',
            'Complaint Type (Quality / Quantity / Billing / Delivery / Others)',
            'Complaint Description',
            'Resolution Date',
            'Resolution Time (Hrs)',
            'Status (Closed / Pending)',
          ],
          rows: kra8Rows,
        },
        kra9: {
          number: 9,
          title: 'KRA 9: Customer Visits',
          target:
            'Conduct a minimum of 10 customer visits per week, with field visits on at least 3 days per week',
          achieved: `${kra9Rows.length}/40 Visits`,
          meaning:
            "Measures the salesperson's proactive market presence through a defined minimum frequency of customer visits and field days each week.",
          headers: [
            'Sr. No.',
            'Company Name',
            'Address',
            'Person Met',
            'Contact No.',
            'Remarks',
          ],
          rows: kra9Rows,
        },
      };
    } catch (error) {
      this.logger.error('Error in getSheets:', error);
      throw error;
    }
  }
}
