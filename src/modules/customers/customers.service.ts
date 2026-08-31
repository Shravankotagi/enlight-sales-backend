import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
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

function cleanLegalSuffixes(str?: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .trim()
    .replace(
      /\b(private\s+limited|pvt\s+ltd|pvt\s+limited|private\s+ltd|co\s+ltd|co\s+limited|llp|limited|pvt|ltd|inc|corp|co|corporation)\b/gi,
      '',
    )
    .replace(/[^a-z0-9]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPhone(p?: string): string {
  if (!p) return '';
  const digits = String(p).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function isCustomerMatch(
  custName?: string,
  custPhone?: string,
  targetName?: string,
  targetPhone?: string,
): boolean {
  const cp = cleanPhone(custPhone);
  const tp = cleanPhone(targetPhone);
  if (cp && tp && cp === tp) {
    return true;
  }

  const cClean = cleanLegalSuffixes(custName);
  const tClean = cleanLegalSuffixes(targetName);

  if (!cClean || !tClean) return false;
  if (cClean === tClean) return true;

  const genericWords = new Set([
    'steel',
    'metals',
    'traders',
    'industries',
    'engineering',
    'enterprises',
    'enterprise',
    'infra',
    'works',
    'projects',
    'systems',
  ]);

  if (cClean.length >= 4 && tClean.length >= 4) {
    if (cClean.startsWith(tClean) || tClean.startsWith(cClean)) {
      return true;
    }

    const cWords = cClean
      .split(' ')
      .filter((w) => w.length > 2 && !genericWords.has(w));
    const tWords = tClean
      .split(' ')
      .filter((w) => w.length > 2 && !genericWords.has(w));

    if (cWords.length > 0 && tWords.length > 0) {
      const matchesAllC = cWords.every((w) => tWords.includes(w));
      const matchesAllT = tWords.every((w) => cWords.includes(w));
      if (matchesAllC || matchesAllT) return true;
    }
  }

  return false;
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(private supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async findAll(salespersonPhone?: string[] | string) {
    try {
      if (Array.isArray(salespersonPhone) && salespersonPhone.length === 0) {
        return [];
      }

      let query = this.supabase
        .from('recurring_customers')
        .select('*')
        .order('customer_name', { ascending: true });

      if (salespersonPhone) {
        const orFilter = buildMultiFieldOrFilter(salespersonPhone, [
          'assigned_salesperson_phone',
        ]);
        if (orFilter) query = query.or(orFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (error) {
      this.logger.error('Error in findAll:', error);
      throw error;
    }
  }

  async findOne(id: string, salespersonPhone?: string[] | string) {
    try {
      let customer: any = null;
      if (id.startsWith('virtual-')) {
        const namePart = id.replace(/^(virtual-deal-|virtual-visit-)/, '');
        const { data: found } = await this.supabase
          .from('recurring_customers')
          .select('*')
          .ilike('customer_name', `%${namePart}%`)
          .limit(1);
        if (found && found.length > 0) {
          customer = found[0];
        } else {
          customer = {
            id,
            customer_name: namePart,
            avg_order_frequency_days: 30,
            is_active: true,
          };
        }
      } else {
        const { data: found, error } = await this.supabase
          .from('recurring_customers')
          .select('*')
          .eq('id', id)
          .single();
        if (error || !found) {
          throw new NotFoundException('Customer not found');
        }
        customer = found;
      }

      if (salespersonPhone && customer.assigned_salesperson_phone) {
        const allowedList = Array.isArray(salespersonPhone)
          ? salespersonPhone
          : [salespersonPhone];
        if (!phoneInList(customer.assigned_salesperson_phone, allowedList)) {
          throw new ForbiddenException(
            'Access Denied: You do not have permission to view this customer.',
          );
        }
      }

      let dealsQuery = this.supabase
        .from('deals')
        .select('*, deal_items(*)')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('created_at', { ascending: false })
        .limit(10);
      if (salespersonPhone) {
        const dealsOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (dealsOr) dealsQuery = dealsQuery.or(dealsOr);
      }

      let visitsQuery = this.supabase
        .from('customer_visits')
        .select('*')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('visited_at', { ascending: false })
        .limit(5);
      if (salespersonPhone) {
        const visitsOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (visitsOr) visitsQuery = visitsQuery.or(visitsOr);
      }

      let paymentsQuery = this.supabase
        .from('payment_tracking')
        .select('*')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('created_at', { ascending: false });
      if (salespersonPhone) {
        const paymentsOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (paymentsOr) paymentsQuery = paymentsQuery.or(paymentsOr);
      }

      const complaintsQuery = this.supabase
        .from('complaints')
        .select('*')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('reported_at', { ascending: false });

      let inquiriesQuery = this.supabase
        .from('inquiries')
        .select('*')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('created_at', { ascending: false })
        .limit(5);
      if (salespersonPhone) {
        const inquiriesOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (inquiriesOr) inquiriesQuery = inquiriesQuery.or(inquiriesOr);
      }

      const [dealsRes, visitsRes, paymentsRes, complaintsRes, inquiriesRes] =
        await Promise.all([
          dealsQuery,
          visitsQuery,
          paymentsQuery,
          complaintsQuery,
          inquiriesQuery,
        ]);

      const deals = dealsRes.data || [];
      const visits = visitsRes.data || [];
      const payments = paymentsRes.data || [];
      const complaints = complaintsRes.data || [];
      const inquiries = inquiriesRes.data || [];

      const wonDeals = deals.filter(
        (d) =>
          d.stage === 'won' ||
          d.stage === 'order' ||
          Boolean(d.po_number) ||
          d.inquiry_type === 'purchase_order',
      );
      const latestWonDeal = wonDeals.length > 0 ? wonDeals[0] : null;
      const effectiveLastOrderDate = latestWonDeal
        ? latestWonDeal.won_at || latestWonDeal.created_at
        : customer.last_order_date || null;

      // Calculate lifetime value with deal_items fallback
      const lifetimeValue = wonDeals.reduce((sum, d) => {
        let amt = Number(d.total_amount || 0);
        if (
          amt <= 0 &&
          Array.isArray(d.deal_items) &&
          d.deal_items.length > 0
        ) {
          amt = d.deal_items.reduce(
            (s: number, i: any) =>
              s +
              (Number(i.amount) || Number(i.rate) * Number(i.quantity) || 0),
            0,
          );
        }
        return sum + amt;
      }, 0);

      const openComplaints = complaints.filter((c) => {
        const st = (c.status || '').toLowerCase();
        return st !== 'resolved' && st !== 'closed';
      }).length;

      // Trailing 12 Month Revenue & Tier Calculation
      const now = new Date();
      const t12mCutoff = new Date(
        now.getTime() - 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const t12mRevenue = wonDeals
        .filter((d) => (d.won_at || d.created_at) >= t12mCutoff)
        .reduce((sum, d) => sum + (Number(d.total_amount) || 0), 0);

      let tier = 'C';
      if (t12mRevenue >= 1000000 || lifetimeValue >= 1000000) {
        tier = 'A';
      } else if (t12mRevenue >= 200000 || lifetimeValue >= 100000) {
        tier = 'B';
      }

      let segment = 'new';
      const explicitSegment = (customer.segment || '').toLowerCase();
      if (['key_account', 'growth', 'new'].includes(explicitSegment)) {
        segment = explicitSegment;
      } else if (lifetimeValue >= 1000000 || wonDeals.length >= 5) {
        segment = 'key_account';
      } else if (
        wonDeals.length >= 2 ||
        (lifetimeValue >= 100000 && lifetimeValue < 1000000)
      ) {
        segment = 'growth';
      } else {
        segment = 'new';
      }

      return {
        ...customer,
        last_order_date: effectiveLastOrderDate,
        t12m_revenue: t12mRevenue,
        lifetime_value: lifetimeValue,
        total_orders: wonDeals.length,
        open_complaints: openComplaints,
        total_complaints: complaints.length,
        segment,
        tier,
        deals,
        visits,
        payments,
        complaints,
        inquiries,
      };
    } catch (error) {
      this.logger.error(`Error in findOne for id ${id}:`, error);
      throw error;
    }
  }

  async getChurnRisk(salespersonPhone?: string[] | string) {
    try {
      if (Array.isArray(salespersonPhone) && salespersonPhone.length === 0) {
        return [];
      }

      let query = this.supabase
        .from('recurring_customers')
        .select('*')
        .eq('is_active', true);

      if (salespersonPhone) {
        const orFilter = buildMultiFieldOrFilter(salespersonPhone, [
          'assigned_salesperson_phone',
        ]);
        if (orFilter) query = query.or(orFilter);
      }

      const { data: customers, error } = await query;
      if (error) throw error;

      const now = new Date();

      const dealsQuery = this.supabase
        .from('deals')
        .select(
          'customer_name, customer_phone, created_at, won_at, stage, total_amount, po_number, inquiry_type, salesperson_phone, deal_items(amount, rate, quantity)',
        )
        .order('created_at', { ascending: false });

      const visitsQuery = this.supabase
        .from('customer_visits')
        .select(
          'customer_name, person_met, contact_no, visited_at, salesperson_phone',
        )
        .order('visited_at', { ascending: false });

      const inquiriesQuery = this.supabase
        .from('inquiries')
        .select('sender_name, sender_phone, created_at, salesperson_phone')
        .order('created_at', { ascending: false });

      const complaintsQuery = this.supabase
        .from('complaints')
        .select(
          'id, customer_name, status, reported_at, complaint_type, reported_by',
        );

      const [
        { data: allDeals, error: dealsErr },
        { data: allVisits, error: visitsErr },
        { data: allInquiries, error: inqErr },
        { data: allComplaints, error: compErr },
      ] = await Promise.all([
        dealsQuery,
        visitsQuery,
        inquiriesQuery,
        complaintsQuery,
      ]);

      if (dealsErr) this.logger.warn('Deals query error:', dealsErr);
      if (visitsErr) this.logger.warn('Visits query error:', visitsErr);
      if (inqErr) this.logger.warn('Inquiries query error:', inqErr);
      if (compErr) this.logger.warn('Complaints query error:', compErr);

      const safeAllDeals = allDeals || [];
      const safeAllVisits = allVisits || [];
      const safeAllInquiries = allInquiries || [];
      const safeAllComplaints = allComplaints || [];

      const extraCustomersMap = new Map<string, any>();

      const customerExists = (name?: string, phone?: string) => {
        if (!name && !phone) return true;
        const inDb = (customers || []).some((c) =>
          isCustomerMatch(c.customer_name, c.customer_phone, name, phone),
        );
        if (inDb) return true;
        for (const ec of extraCustomersMap.values()) {
          if (isCustomerMatch(ec.customer_name, ec.customer_phone, name, phone))
            return true;
        }
        return false;
      };

      const spPhonesList = salespersonPhone
        ? Array.isArray(salespersonPhone)
          ? salespersonPhone
          : [salespersonPhone]
        : null;

      const matchesSpPhone = (repPhone?: string) => {
        if (!spPhonesList) return true;
        if (!repPhone) return false;
        return phoneInList(repPhone, spPhonesList);
      };

      for (const deal of safeAllDeals) {
        if (!deal.customer_name || !deal.customer_name.trim()) continue;
        if (!matchesSpPhone(deal.salesperson_phone)) continue;
        if (!customerExists(deal.customer_name, deal.customer_phone)) {
          const norm = cleanLegalSuffixes(deal.customer_name);
          extraCustomersMap.set(norm || deal.customer_name, {
            id: `virtual-deal-${norm || deal.customer_name}`,
            customer_name: deal.customer_name.trim(),
            contact_person: null,
            customer_phone: deal.customer_phone || null,
            customer_gst: null,
            assigned_salesperson_phone: deal.salesperson_phone || null,
            avg_order_frequency_days: 30,
            is_active: true,
            created_at: deal.created_at,
          });
        }
      }

      for (const visit of safeAllVisits) {
        if (!visit.customer_name || !visit.customer_name.trim()) continue;
        if (!matchesSpPhone(visit.salesperson_phone)) continue;
        if (!customerExists(visit.customer_name, visit.contact_no)) {
          const norm = cleanLegalSuffixes(visit.customer_name);
          extraCustomersMap.set(norm || visit.customer_name, {
            id: `virtual-visit-${norm || visit.customer_name}`,
            customer_name: visit.customer_name.trim(),
            contact_person: visit.person_met || null,
            customer_phone: visit.contact_no || null,
            customer_gst: null,
            assigned_salesperson_phone: visit.salesperson_phone || null,
            avg_order_frequency_days: 30,
            is_active: true,
            created_at: visit.visited_at,
          });
        }
      }

      for (const inq of safeAllInquiries) {
        if (!inq.sender_name || !inq.sender_name.trim()) continue;
        if (!matchesSpPhone(inq.salesperson_phone)) continue;
        if (!customerExists(inq.sender_name, inq.sender_phone)) {
          const norm = cleanLegalSuffixes(inq.sender_name);
          extraCustomersMap.set(norm || inq.sender_name, {
            id: `virtual-inquiry-${norm || inq.sender_name}`,
            customer_name: inq.sender_name.trim(),
            contact_person: null,
            customer_phone: inq.sender_phone || null,
            customer_gst: null,
            assigned_salesperson_phone: inq.salesperson_phone || null,
            avg_order_frequency_days: 30,
            is_active: true,
            created_at: inq.created_at,
          });
        }
      }

      for (const comp of safeAllComplaints) {
        if (!comp.customer_name || !comp.customer_name.trim()) continue;
        if (!matchesSpPhone(comp.reported_by)) continue;
        if (!customerExists(comp.customer_name, null)) {
          const norm = cleanLegalSuffixes(comp.customer_name);
          extraCustomersMap.set(norm || comp.customer_name, {
            id: `virtual-complaint-${norm || comp.customer_name}`,
            customer_name: comp.customer_name.trim(),
            contact_person: null,
            customer_phone: null,
            customer_gst: null,
            assigned_salesperson_phone: comp.reported_by || null,
            avg_order_frequency_days: 30,
            is_active: true,
            created_at: comp.reported_at,
          });
        }
      }

      const combinedCustomers = [
        ...(customers || []),
        ...Array.from(extraCustomersMap.values()),
      ];

      const results = combinedCustomers.map((customer) => {
        // Robust Matching for Deals
        const customerWonDeals = safeAllDeals.filter((d) => {
          const isWon =
            d.stage === 'won' ||
            d.stage === 'order' ||
            Boolean(d.po_number) ||
            d.inquiry_type === 'purchase_order';
          if (!isWon) return false;
          return isCustomerMatch(
            customer.customer_name,
            customer.customer_phone,
            d.customer_name,
            d.customer_phone,
          );
        });

        const latestWonDeal =
          customerWonDeals.length > 0 ? customerWonDeals[0] : null;
        const effectiveLastOrderStr = latestWonDeal
          ? latestWonDeal.won_at || latestWonDeal.created_at
          : customer.last_order_date || null;

        const lastOrderDate = effectiveLastOrderStr
          ? new Date(effectiveLastOrderStr)
          : null;
        const daysSinceOrder = lastOrderDate
          ? Math.max(
              0,
              Math.floor(
                (now.getTime() - lastOrderDate.getTime()) /
                  (1000 * 60 * 60 * 24),
              ),
            )
          : null;

        const daysSinceCreated = customer.created_at
          ? Math.floor(
              (now.getTime() - new Date(customer.created_at).getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : 0;

        // Health Status Classification (Active <= 35d, At Risk 35-45d, Churning > 45d)
        let churnRisk = 'active';
        if (daysSinceOrder !== null) {
          if (daysSinceOrder > 45) {
            churnRisk = 'churning';
          } else if (daysSinceOrder >= 35) {
            churnRisk = 'at_risk';
          } else {
            churnRisk = 'active';
          }
        } else {
          if (daysSinceCreated > 45) {
            churnRisk = 'churning';
          } else if (daysSinceCreated >= 35) {
            churnRisk = 'at_risk';
          } else {
            churnRisk = 'active';
          }
        }

        // Metrics: Orders & Lifetime Value (including deal_items fallback)
        const totalOrders = customerWonDeals.length;
        const lifetimeValue = customerWonDeals.reduce((sum, d) => {
          let amt = Number(d.total_amount || 0);
          if (
            amt <= 0 &&
            Array.isArray(d.deal_items) &&
            d.deal_items.length > 0
          ) {
            amt = d.deal_items.reduce(
              (s: number, i: any) =>
                s +
                (Number(i.amount) || Number(i.rate) * Number(i.quantity) || 0),
              0,
            );
          }
          return sum + amt;
        }, 0);

        // Metrics: Complaints & Open Issues
        const customerComplaints = safeAllComplaints.filter((c) =>
          isCustomerMatch(
            customer.customer_name,
            customer.customer_phone,
            c.customer_name,
            null,
          ),
        );
        const openComplaints = customerComplaints.filter((c) => {
          const st = (c.status || '').toLowerCase();
          return st !== 'resolved' && st !== 'closed';
        }).length;

        // Segment Classification: Key Account, Growth, New
        let segment = 'new';
        const explicitSegment = (customer.segment || '').toLowerCase();
        if (['key_account', 'growth', 'new'].includes(explicitSegment)) {
          segment = explicitSegment;
        } else if (lifetimeValue >= 1000000 || totalOrders >= 5) {
          segment = 'key_account';
        } else if (
          totalOrders >= 2 ||
          (lifetimeValue >= 100000 && lifetimeValue < 1000000)
        ) {
          segment = 'growth';
        } else {
          segment = 'new';
        }

        return {
          ...customer,
          last_order_date: effectiveLastOrderStr,
          days_since_order: daysSinceOrder,
          churn_risk: churnRisk,
          total_orders: totalOrders,
          lifetime_value: lifetimeValue,
          open_complaints: openComplaints,
          total_complaints: customerComplaints.length,
          segment,
          avg_order_frequency_days: customer.avg_order_frequency_days || 30,
        };
      });

      return results.sort((a, b) => {
        const riskOrder: Record<string, number> = {
          churning: 0,
          at_risk: 1,
          active: 2,
        };
        return (riskOrder[a.churn_risk] ?? 2) - (riskOrder[b.churn_risk] ?? 2);
      });
    } catch (error) {
      this.logger.error('Error in getChurnRisk:', error);
      throw error;
    }
  }

  async updateCustomer(id: string, data: any) {
    try {
      const updatePayload: any = {
        updated_at: new Date().toISOString(),
      };
      if (data.customer_name !== undefined)
        updatePayload.customer_name = data.customer_name.trim();
      if (data.contact_person !== undefined)
        updatePayload.contact_person = data.contact_person;
      if (data.customer_phone !== undefined)
        updatePayload.customer_phone = data.customer_phone;
      if (data.customer_gst !== undefined)
        updatePayload.customer_gst = data.customer_gst;
      if (data.address !== undefined) updatePayload.address = data.address;
      if (data.avg_order_frequency_days !== undefined)
        updatePayload.avg_order_frequency_days = Number(
          data.avg_order_frequency_days,
        );
      if (data.assigned_salesperson_phone !== undefined)
        updatePayload.assigned_salesperson_phone =
          data.assigned_salesperson_phone;
      if (data.churn_risk !== undefined)
        updatePayload.churn_risk = data.churn_risk;
      if (data.segment !== undefined) updatePayload.segment = data.segment;

      if (id.startsWith('virtual-')) {
        const namePart =
          data.customer_name ||
          id.replace(
            /^(virtual-deal-|virtual-visit-|virtual-inquiry-|virtual-complaint-)/,
            '',
          );
        const { data: created, error } = await this.supabase
          .from('recurring_customers')
          .insert({
            customer_name: namePart,
            avg_order_frequency_days: 30,
            is_active: true,
            ...updatePayload,
          })
          .select()
          .single();
        if (error) throw error;
        return created;
      }

      const { data: updated, error } = await this.supabase
        .from('recurring_customers')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return updated;
    } catch (error) {
      this.logger.error(`Error updating customer ${id}:`, error);
      throw error;
    }
  }

  async getReorderQueue(salespersonPhone?: string[] | string) {
    try {
      if (Array.isArray(salespersonPhone) && salespersonPhone.length === 0) {
        return [];
      }

      const now = new Date();
      let query = this.supabase
        .from('recurring_customers')
        .select('*')
        .eq('is_active', true);

      if (salespersonPhone) {
        const orFilter = buildMultiFieldOrFilter(salespersonPhone, [
          'assigned_salesperson_phone',
        ]);
        if (orFilter) query = query.or(orFilter);
      }

      const { data: customers, error } = await query;
      if (error) throw error;

      const reorderList = (
        await Promise.all(
          (customers || []).map(async (customer: any) => {
            const { data: deals } = await this.supabase
              .from('deals')
              .select('created_at, won_at')
              .ilike('customer_name', `%${customer.customer_name}%`)
              .eq('stage', 'won')
              .order('created_at', { ascending: false })
              .limit(1);

            const latestWonDeal = deals && deals.length > 0 ? deals[0] : null;
            const effectiveLastOrderStr = latestWonDeal
              ? latestWonDeal.won_at || latestWonDeal.created_at
              : customer.last_order_date || null;

            const lastOrder = effectiveLastOrderStr
              ? new Date(effectiveLastOrderStr)
              : null;
            const avgFrequency = customer.avg_order_frequency_days || 30;
            const predictedDate = lastOrder
              ? new Date(
                  lastOrder.getTime() + avgFrequency * 24 * 60 * 60 * 1000,
                )
              : null;
            const daysUntilReorder = predictedDate
              ? Math.floor(
                  (predictedDate.getTime() - now.getTime()) /
                    (1000 * 60 * 60 * 24),
                )
              : null;

            return {
              ...customer,
              last_order_date: effectiveLastOrderStr,
              predicted_reorder_date: predictedDate?.toISOString() || null,
              days_until_reorder: daysUntilReorder,
              is_overdue: daysUntilReorder !== null && daysUntilReorder < 0,
              is_due_soon:
                daysUntilReorder !== null &&
                daysUntilReorder >= 0 &&
                daysUntilReorder <= 7,
            };
          }),
        )
      )
        .filter(
          (c: any) =>
            c.days_until_reorder !== null && c.days_until_reorder <= 14,
        )
        .sort(
          (a: any, b: any) =>
            (a.days_until_reorder || 0) - (b.days_until_reorder || 0),
        );

      return reorderList;
    } catch (error) {
      this.logger.error('Error in getReorderQueue:', error);
      throw error;
    }
  }

  async getLossAnalytics(salespersonPhone?: string[] | string) {
    try {
      if (Array.isArray(salespersonPhone) && salespersonPhone.length === 0) {
        return {
          total_lost: 0,
          total_lost_value: 0,
          by_reason: [],
          recent_lost: [],
        };
      }

      const now = new Date();
      const threeMonthsAgo = new Date(
        now.getFullYear(),
        now.getMonth() - 3,
        1,
      ).toISOString();

      let query = this.supabase
        .from('deals')
        .select(
          'id, deal_number, lost_reason, total_amount, customer_name, created_at',
        )
        .eq('stage', 'lost')
        .gte('created_at', threeMonthsAgo);

      let logsQuery = this.supabase
        .from('kra_logs')
        .select('*')
        .eq('kra_type', 'deal_lost')
        .gte('created_at', threeMonthsAgo);

      if (salespersonPhone) {
        const dealsOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (dealsOr) {
          query = query.or(dealsOr);
          logsQuery = logsQuery.or(dealsOr);
        }
      }

      const [{ data: lostDeals }, { data: lostLogs }] = await Promise.all([
        query,
        logsQuery,
      ]);

      const primaryLostDeals = (lostDeals || []).map((d) => ({
        id: d.id,
        deal_number:
          d.deal_number ||
          (d.id ? `DEAL-${d.id.substring(0, 6).toUpperCase()}` : undefined),
        customer_name: d.customer_name,
        lost_reason: d.lost_reason || 'Not specified',
        total_amount: d.total_amount || 0,
        created_at: d.created_at,
      }));

      // Add kra_logs ONLY if no corresponding deal exists for that customer & amount (prevents double-counting)
      const orphanLogs = (lostLogs || [])
        .filter((l) => {
          const lAmount = Number(l.value || 0);
          const lName = (l.customer_name || '').toLowerCase().trim();
          const matchInDeals = primaryLostDeals.some((d) => {
            const dName = (d.customer_name || '').toLowerCase().trim();
            return (
              (dName.includes(lName) || lName.includes(dName)) &&
              (lAmount === 0 ||
                Math.abs(Number(d.total_amount) - lAmount) < 100)
            );
          });
          return !matchInDeals;
        })
        .map((l) => ({
          id: l.id,
          deal_number: undefined,
          customer_name: l.customer_name,
          lost_reason:
            l.description?.match(/Reason:\s*([^|]+)/)?.[1]?.trim() ||
            l.notes ||
            'Price / Commercials',
          total_amount: l.value || 0,
          created_at: l.created_at,
        }));

      // Deduplicate log records by customer + date (within 60 seconds) or exact amount
      const combinedLosses: any[] = [];
      for (const item of [...primaryLostDeals, ...orphanLogs]) {
        const itemDateStr = new Date(item.created_at)
          .toISOString()
          .slice(0, 10);
        const itemName = (item.customer_name || '').toLowerCase().trim();
        const isDuplicate = combinedLosses.some((existing) => {
          const existingDateStr = new Date(existing.created_at)
            .toISOString()
            .slice(0, 10);
          const existingName = (existing.customer_name || '')
            .toLowerCase()
            .trim();
          return (
            existingName === itemName &&
            existingDateStr === itemDateStr &&
            Math.abs(
              Number(existing.total_amount) - Number(item.total_amount),
            ) < 100
          );
        });
        if (!isDuplicate) {
          combinedLosses.push(item);
        }
      }

      const byReason = combinedLosses.reduce((acc: any, deal: any) => {
        const reason = deal.lost_reason || 'Unknown';
        if (!acc[reason]) acc[reason] = { count: 0, value: 0 };
        acc[reason].count++;
        acc[reason].value += Number(deal.total_amount || 0);
        return acc;
      }, {});

      return {
        total_lost: combinedLosses.length,
        total_lost_value: combinedLosses.reduce(
          (sum: number, d: any) => sum + (Number(d.total_amount) || 0),
          0,
        ),
        by_reason: Object.entries(byReason)
          .map(([reason, data]: [string, any]) => ({ reason, ...data }))
          .sort((a, b) => b.count - a.count),
        recent_losses: combinedLosses.slice(0, 5),
      };
    } catch (error) {
      this.logger.error('Error in getLossAnalytics:', error);
      throw error;
    }
  }

  async importClients(clients: any[], defaultSalespersonPhone?: string) {
    try {
      if (!clients || !Array.isArray(clients) || clients.length === 0) {
        throw new Error('No client records provided for import');
      }

      const formattedClients = clients
        .map((c) => {
          const assignedPhone =
            c.assigned_salesperson_phone ||
            c.salesperson_phone ||
            defaultSalespersonPhone ||
            null;

          const cleanPhone =
            c.customer_phone || c.phone
              ? String(c.customer_phone || c.phone).replace(/\D/g, '')
              : null;

          const contactName = (c.contact_person || c.contact_name || '').trim();
          const email = (c.customer_email || c.email || '').trim();
          const industry = (c.industry || c.segment || '').trim();

          const notesParts = [
            contactName ? `Contact: ${contactName}` : '',
            email ? `Email: ${email}` : '',
            industry ? `Industry: ${industry}` : '',
          ]
            .filter(Boolean)
            .join(' | ');

          return {
            customer_name: (
              c.customer_name ||
              c.company_name ||
              c.name ||
              ''
            ).trim(),
            customer_phone: cleanPhone,
            customer_gst:
              (c.customer_gst || c.gstin || c.gst || '').trim() || null,
            customer_address:
              (c.address || c.customer_address || c.city || '').trim() || null,
            assigned_salesperson_phone: assignedPhone,
            notes: notesParts || 'Bulk imported client',
            is_active: true,
            avg_order_frequency_days: 30,
          };
        })
        .filter((c) => c.customer_name.length > 0);

      if (formattedClients.length === 0) {
        throw new Error('No valid company/customer names found in file');
      }

      // Query existing customers to safely split into update vs insert
      const { data: existingCustomers } = await this.supabase
        .from('recurring_customers')
        .select('id, customer_name');

      const existingMap = new Map<string, string>(
        (existingCustomers || []).map((c) => [
          c.customer_name.toLowerCase(),
          c.id,
        ]),
      );

      const toUpdate: any[] = [];
      const toInsert: any[] = [];

      for (const client of formattedClients) {
        const existingId = existingMap.get(client.customer_name.toLowerCase());
        if (existingId) {
          toUpdate.push({ id: existingId, ...client });
        } else {
          toInsert.push(client);
        }
      }

      let insertedCount = 0;
      if (toInsert.length > 0) {
        const { data: insertedData, error: insertError } = await this.supabase
          .from('recurring_customers')
          .insert(toInsert)
          .select();

        if (insertError) {
          this.logger.error('Error inserting imported clients:', insertError);
          throw insertError;
        }
        insertedCount = insertedData?.length || toInsert.length;
      }

      for (const updateItem of toUpdate) {
        const { error: updateError } = await this.supabase
          .from('recurring_customers')
          .update(updateItem)
          .eq('id', updateItem.id);

        if (updateError) {
          this.logger.warn(
            `Error updating client ${updateItem.customer_name}:`,
            updateError.message,
          );
        }
      }

      const totalCount = insertedCount + toUpdate.length;
      return { count: totalCount };
    } catch (error: any) {
      this.logger.error('Error in importClients:', error);
      throw error;
    }
  }
}
