import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
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

function getDealTonnage(deal: any): number {
  if (!deal) return 0;
  if (Array.isArray(deal.deal_items) && deal.deal_items.length > 0) {
    return deal.deal_items.reduce((sum: number, item: any) => {
      const q = Number(item.quantity ?? item.quantity_mt ?? item.qty ?? 0) || 0;
      const unit = (item.unit || 'MT').toUpperCase().trim();
      return (
        sum +
        (unit === 'KG' || unit === 'KGS' || unit === 'KILOGRAM' ? q / 1000 : q)
      );
    }, 0);
  }
  const q = Number(deal.quantity ?? deal.quantity_mt ?? 0) || 0;
  const unit = (deal.unit || 'MT').toUpperCase().trim();
  return unit === 'KG' || unit === 'KGS' || unit === 'KILOGRAM' ? q / 1000 : q;
}

function areNamesCompatible(n1?: string, n2?: string): boolean {
  const c1 = cleanLegalSuffixes(n1);
  const c2 = cleanLegalSuffixes(n2);
  if (!c1 || !c2) return true;
  if (c1 === c2) return true;
  if (c1.startsWith(c2) || c2.startsWith(c1)) return true;
  const w1 = c1.split(' ').filter((w) => w.length > 2);
  const w2 = c2.split(' ').filter((w) => w.length > 2);
  if (w1.length > 0 && w2.length > 0) {
    if (w1.every((w) => w2.includes(w)) || w2.every((w) => w1.includes(w))) {
      return true;
    }
  }
  return false;
}

function isCustomerMatch(
  custName?: string,
  custPhone?: string,
  targetName?: string,
  targetPhone?: string,
): boolean {
  const cClean = cleanLegalSuffixes(custName);
  const tClean = cleanLegalSuffixes(targetName);

  if (cClean && tClean && cClean === tClean) return true;
  if (
    cClean &&
    tClean &&
    (cClean.startsWith(tClean) || tClean.startsWith(cClean)) &&
    Math.min(cClean.length, tClean.length) >= 4
  ) {
    return true;
  }

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

  if (cClean && tClean && cClean.length >= 4 && tClean.length >= 4) {
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

  const cp = cleanPhone(custPhone);
  const tp = cleanPhone(targetPhone);
  if (cp && tp && cp === tp) {
    if (areNamesCompatible(custName, targetName)) {
      return true;
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
      const decodedId = decodeURIComponent(id || '').trim();
      let customer: any = null;

      if (decodedId.startsWith('virtual-')) {
        const namePart = decodedId.replace(
          /^(virtual-deal-|virtual-visit-|virtual-inquiry-|virtual-complaint-)/,
          '',
        );
        const { data: found } = await this.supabase
          .from('recurring_customers')
          .select('*')
          .ilike('customer_name', `%${namePart}%`)
          .limit(1);
        if (found && found.length > 0) {
          customer = found[0];
        } else {
          customer = {
            id: decodedId,
            customer_name: namePart,
            avg_order_frequency_days: 30,
            is_active: true,
          };
        }
      } else {
        const { data: found, error } = await this.supabase
          .from('recurring_customers')
          .select('*')
          .eq('id', decodedId)
          .single();

        if (error || !found) {
          // Fallback: search by name
          const { data: foundByName } = await this.supabase
            .from('recurring_customers')
            .select('*')
            .ilike('customer_name', `%${decodedId}%`)
            .limit(1);

          if (foundByName && foundByName.length > 0) {
            customer = foundByName[0];
          } else {
            // Create a virtual customer object rather than 404
            customer = {
              id: decodedId,
              customer_name: decodedId,
              avg_order_frequency_days: 30,
              is_active: true,
            };
          }
        } else {
          customer = found;
        }
      }

      // Build targeted customer search terms for database queries
      const targetNameClean = cleanLegalSuffixes(customer.customer_name);
      const targetWords = targetNameClean
        .split(' ')
        .filter((w) => w.length >= 3)
        .slice(0, 3);
      const targetPhoneClean = cleanPhone(customer.customer_phone);

      const dealCandidateFilters: string[] = [];
      if (targetNameClean)
        dealCandidateFilters.push(`customer_name.ilike.%${targetNameClean}%`);
      targetWords.forEach((w) =>
        dealCandidateFilters.push(`customer_name.ilike.%${w}%`),
      );
      if (targetPhoneClean) {
        dealCandidateFilters.push(`customer_phone.ilike.%${targetPhoneClean}%`);
        dealCandidateFilters.push(
          `customer_phone.ilike.%91${targetPhoneClean}%`,
        );
      }

      const visitCandidateFilters: string[] = [];
      if (targetNameClean)
        visitCandidateFilters.push(`customer_name.ilike.%${targetNameClean}%`);
      targetWords.forEach((w) =>
        visitCandidateFilters.push(`customer_name.ilike.%${w}%`),
      );
      if (targetPhoneClean) {
        visitCandidateFilters.push(`contact_no.ilike.%${targetPhoneClean}%`);
        visitCandidateFilters.push(`contact_no.ilike.%91${targetPhoneClean}%`);
      }

      const inqCandidateFilters: string[] = [];
      if (targetNameClean)
        inqCandidateFilters.push(`sender_name.ilike.%${targetNameClean}%`);
      targetWords.forEach((w) =>
        inqCandidateFilters.push(`sender_name.ilike.%${w}%`),
      );
      if (targetPhoneClean) {
        inqCandidateFilters.push(`sender_phone.ilike.%${targetPhoneClean}%`);
        inqCandidateFilters.push(`sender_phone.ilike.%91${targetPhoneClean}%`);
      }

      const compCandidateFilters: string[] = [];
      if (targetNameClean)
        compCandidateFilters.push(`customer_name.ilike.%${targetNameClean}%`);
      targetWords.forEach((w) =>
        compCandidateFilters.push(`customer_name.ilike.%${w}%`),
      );

      const payCandidateFilters: string[] = [];
      if (targetNameClean)
        payCandidateFilters.push(`customer_name.ilike.%${targetNameClean}%`);
      targetWords.forEach((w) =>
        payCandidateFilters.push(`customer_name.ilike.%${w}%`),
      );

      // Query related collections targeted to candidate matches
      let dealsQuery = this.supabase
        .from('deals')
        .select('*, deal_items(*)')
        .order('created_at', { ascending: false });
      if (dealCandidateFilters.length > 0) {
        dealsQuery = dealsQuery.or(dealCandidateFilters.join(','));
      }

      let visitsQuery = this.supabase
        .from('customer_visits')
        .select('*')
        .order('visited_at', { ascending: false });
      if (visitCandidateFilters.length > 0) {
        visitsQuery = visitsQuery.or(visitCandidateFilters.join(','));
      }

      let paymentsQuery = this.supabase
        .from('payment_tracking')
        .select('*')
        .order('created_at', { ascending: false });
      if (payCandidateFilters.length > 0) {
        paymentsQuery = paymentsQuery.or(payCandidateFilters.join(','));
      }

      let complaintsQuery = this.supabase
        .from('complaints')
        .select('*')
        .order('reported_at', { ascending: false });
      if (compCandidateFilters.length > 0) {
        complaintsQuery = complaintsQuery.or(compCandidateFilters.join(','));
      }

      let inquiriesQuery = this.supabase
        .from('inquiries')
        .select('*')
        .order('created_at', { ascending: false });
      if (inqCandidateFilters.length > 0) {
        inquiriesQuery = inquiriesQuery.or(inqCandidateFilters.join(','));
      }

      const [
        dealsRes,
        visitsRes,
        paymentsRes,
        complaintsRes,
        inquiriesRes,
        empsRes,
      ] = await Promise.all([
        dealsQuery,
        visitsQuery,
        paymentsQuery,
        complaintsQuery,
        inquiriesQuery,
        this.supabase.from('employees').select('name, phone'),
      ]);

      const empMap = new Map<string, string>();
      (empsRes.data || []).forEach((e) => {
        if (e.phone && e.name) {
          empMap.set(cleanPhone(e.phone), e.name);
        }
      });

      const assignedSpClean = cleanPhone(customer.assigned_salesperson_phone);
      const assignedSalespersonName = assignedSpClean
        ? empMap.get(assignedSpClean) || null
        : null;

      const allDeals = dealsRes.data || [];
      const allVisits = visitsRes.data || [];
      const allPayments = paymentsRes.data || [];
      const allComplaints = complaintsRes.data || [];
      const allInquiries = inquiriesRes.data || [];

      // Match related items using safe matcher
      const deals = allDeals.filter((d) =>
        isCustomerMatch(
          customer.customer_name,
          customer.customer_phone,
          d.customer_name,
          d.customer_phone,
        ),
      );

      const visits = allVisits.filter((v) =>
        isCustomerMatch(
          customer.customer_name,
          customer.customer_phone,
          v.customer_name,
          v.contact_no,
        ),
      );

      const payments = allPayments.filter((p) =>
        isCustomerMatch(
          customer.customer_name,
          customer.customer_phone,
          p.customer_name,
          null,
        ),
      );

      const complaints = allComplaints.filter((c) =>
        isCustomerMatch(
          customer.customer_name,
          customer.customer_phone,
          c.customer_name,
          null,
        ),
      );

      const inquiries = allInquiries.filter((inq) =>
        isCustomerMatch(
          customer.customer_name,
          customer.customer_phone,
          inq.sender_name,
          inq.sender_phone,
        ),
      );

      if (salespersonPhone) {
        const allowedList = Array.isArray(salespersonPhone)
          ? salespersonPhone
          : [salespersonPhone];

        const isAssigned =
          customer.assigned_salesperson_phone &&
          phoneInList(customer.assigned_salesperson_phone, allowedList);

        const hasHandledActivity =
          deals.length > 0 ||
          visits.length > 0 ||
          inquiries.length > 0 ||
          complaints.length > 0;

        if (!isAssigned && !hasHandledActivity) {
          throw new ForbiddenException(
            'Access Denied: You do not have permission to view this customer.',
          );
        }
      }

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

      // Persist refreshed last_order_date on recurring_customers (non-blocking)
      if (
        customer.id &&
        !String(customer.id).startsWith('virtual-') &&
        effectiveLastOrderDate &&
        effectiveLastOrderDate !== customer.last_order_date
      ) {
        const dateOnly = effectiveLastOrderDate.includes('T')
          ? effectiveLastOrderDate.split('T')[0]
          : effectiveLastOrderDate;
        Promise.resolve(
          this.supabase
            .from('recurring_customers')
            .update({
              last_order_date: dateOnly,
              updated_at: new Date().toISOString(),
            })
            .eq('id', customer.id),
        ).catch((err: any) =>
          this.logger.warn(
            `Failed to update customer summary: ${err?.message || err}`,
          ),
        );
      }

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

      const now = new Date();
      const lastOrderDateObj = effectiveLastOrderDate
        ? new Date(effectiveLastOrderDate)
        : null;
      const daysSinceOrder = lastOrderDateObj
        ? Math.max(
            0,
            Math.floor(
              (now.getTime() - lastOrderDateObj.getTime()) /
                (1000 * 60 * 60 * 24),
            ),
          )
        : null;

      const cadenceDays = customer.avg_order_frequency_days || 30;

      // Health Status (Active <= 35d, At Risk 35-45d, Churning > 45d)
      let churnRisk = 'active';
      if (daysSinceOrder !== null) {
        if (daysSinceOrder > 45) {
          churnRisk = 'churning';
        } else if (daysSinceOrder >= 35) {
          churnRisk = 'at_risk';
        } else {
          churnRisk = 'active';
        }
      }

      // Segment Classification
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

      const totalOrders = wonDeals.length;
      const totalTonnage =
        Math.round(
          wonDeals.reduce((sum, d) => sum + getDealTonnage(d), 0) * 1000,
        ) / 1000;
      const avgOrderValue =
        totalOrders > 0 ? Math.round(lifetimeValue / totalOrders) : 0;

      // Trailing 12 Month Revenue
      const t12mCutoff = new Date(
        now.getTime() - 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const t12mRevenue = wonDeals
        .filter((d) => (d.won_at || d.created_at) >= t12mCutoff)
        .reduce((sum, d) => sum + (Number(d.total_amount) || 0), 0);

      // AI-Derived Health Signals & Strategic Action
      let sentiment: 'positive' | 'warning' | 'critical' = 'positive';
      let cadenceHealth = `On Track: Last order was ${daysSinceOrder ?? 0} days ago (Cadence: ${cadenceDays}d).`;

      if (daysSinceOrder === null) {
        cadenceHealth = 'New Account: No confirmed orders recorded yet.';
      } else if (daysSinceOrder > 45) {
        cadenceHealth = `Churn Alert: ${daysSinceOrder} days since last order (${daysSinceOrder - cadenceDays} days past expected cadence).`;
        sentiment = 'critical';
      } else if (daysSinceOrder >= 35) {
        cadenceHealth = `Re-order Due: ${daysSinceOrder} days since last order (expected every ${cadenceDays}d).`;
        sentiment = 'warning';
      }

      if (openComplaints > 0) {
        sentiment = 'critical';
      }

      const revenueSignal =
        totalTonnage >= 100
          ? `High-Volume Key Account with ${totalTonnage.toLocaleString('en-IN')} MT total ordered tonnage.`
          : totalTonnage >= 20
            ? `Growing Account with ${totalTonnage.toLocaleString('en-IN')} MT total volume.`
            : `Emerging Account with ${totalOrders} order(s).`;

      const qualitySignal =
        openComplaints > 0
          ? `Attention Required: ${openComplaints} open complaint ticket(s) currently active.`
          : complaints.length > 0
            ? `Stable Quality: All ${complaints.length} previous issue(s) resolved.`
            : 'Excellent Quality: Zero complaints logged.';

      let recommendedAction =
        'Schedule a routine check-in with the procurement team for upcoming material requirements.';
      if (openComplaints > 0) {
        recommendedAction =
          'Coordinate with QA & Logistics immediately to resolve active complaint tickets before soliciting new RFQs.';
      } else if (churnRisk === 'churning') {
        recommendedAction =
          'Schedule an urgent on-site visit to understand supply disruption or competitor displacement.';
      } else if (churnRisk === 'at_risk') {
        recommendedAction =
          'Proactively send current metal coil / TMT pricing sheet and request their monthly schedule.';
      } else if (segment === 'key_account') {
        recommendedAction =
          'Review upcoming quarterly tonnage requirements and offer customized payment & dispatch terms.';
      }

      const executiveSummary = `${customer.customer_name} is currently ${churnRisk === 'active' ? 'actively engaged' : churnRisk === 'at_risk' ? 'at risk of order delay' : 'churning and overdue for re-order'} with ${totalOrders} confirmed order(s) totaling ${totalTonnage.toLocaleString('en-IN')} MT. ${openComplaints > 0 ? `There are ${openComplaints} unresolved issue(s) requiring immediate rep attention.` : 'Account satisfaction remains steady with zero open tickets.'}`;

      return {
        ...customer,
        assigned_salesperson_name: assignedSalespersonName,
        last_order_date: effectiveLastOrderDate,
        days_since_order: daysSinceOrder,
        churn_risk: churnRisk,
        total_orders: totalOrders,
        total_tonnage: totalTonnage,
        lifetime_value: lifetimeValue,
        avg_order_value: avgOrderValue,
        t12m_revenue: t12mRevenue,
        open_complaints: openComplaints,
        total_complaints: complaints.length,
        segment,
        avg_order_frequency_days: cadenceDays,
        health_signals: {
          sentiment,
          cadence_health: cadenceHealth,
          revenue_signal: revenueSignal,
          quality_signal: qualitySignal,
          executive_summary: executiveSummary,
          recommended_action: recommendedAction,
        },
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

      let dealsQuery = this.supabase
        .from('deals')
        .select(
          'customer_name, customer_phone, created_at, won_at, stage, total_amount, po_number, inquiry_type, salesperson_phone, deal_items(amount, rate, quantity, unit)',
        )
        .order('created_at', { ascending: false });

      let visitsQuery = this.supabase
        .from('customer_visits')
        .select(
          'customer_name, person_met, contact_no, visited_at, salesperson_phone',
        )
        .order('visited_at', { ascending: false });

      let inquiriesQuery = this.supabase
        .from('inquiries')
        .select('sender_name, sender_phone, created_at, salesperson_phone')
        .order('created_at', { ascending: false });

      let complaintsQuery = this.supabase
        .from('complaints')
        .select(
          'id, customer_name, status, reported_at, created_at, complaint_type, reported_by',
        );

      if (salespersonPhone) {
        const spFilter = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (spFilter) {
          dealsQuery = dealsQuery.or(spFilter);
          visitsQuery = visitsQuery.or(spFilter);
          inquiriesQuery = inquiriesQuery.or(spFilter);
        }
        const compFilter = buildMultiFieldOrFilter(salespersonPhone, [
          'reported_by',
        ]);
        if (compFilter) {
          complaintsQuery = complaintsQuery.or(compFilter);
        }
      }

      const [
        { data: allDeals, error: dealsErr },
        { data: allVisits, error: visitsErr },
        { data: allInquiries, error: inqErr },
        { data: allComplaints, error: compErr },
        { data: allEmps },
      ] = await Promise.all([
        dealsQuery,
        visitsQuery,
        inquiriesQuery,
        complaintsQuery,
        this.supabase.from('employees').select('name, phone'),
      ]);

      const empMap = new Map<string, string>();
      (allEmps || []).forEach((e) => {
        if (e.phone && e.name) {
          empMap.set(cleanPhone(e.phone), e.name);
        }
      });

      if (dealsErr) this.logger.warn('Deals query error:', dealsErr);
      if (visitsErr) this.logger.warn('Visits query error:', visitsErr);
      if (inqErr) this.logger.warn('Inquiries query error:', inqErr);
      if (compErr) this.logger.warn('Complaints query error:', compErr);

      const safeAllDeals = allDeals || [];
      const safeAllVisits = allVisits || [];
      const safeAllInquiries = allInquiries || [];
      const safeAllComplaints = allComplaints || [];

      const extraCustomersMap = new Map<string, any>();

      const customerExistsForRep = (
        name?: string,
        phone?: string,
        repPhone?: string,
      ) => {
        if (!name && !phone) return true;
        const cleanRep = cleanPhone(repPhone);
        const inDb = (customers || []).some((c) => {
          const cRep = cleanPhone(c.assigned_salesperson_phone);
          if (cRep && cleanRep && cRep !== cleanRep) return false;
          return isCustomerMatch(
            c.customer_name,
            c.customer_phone,
            name,
            phone,
          );
        });
        if (inDb) return true;
        for (const ec of extraCustomersMap.values()) {
          const ecRep = cleanPhone(ec.assigned_salesperson_phone);
          if (ecRep && cleanRep && ecRep !== cleanRep) continue;
          if (
            isCustomerMatch(ec.customer_name, ec.customer_phone, name, phone)
          ) {
            return true;
          }
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
        if (
          !customerExistsForRep(
            deal.customer_name,
            deal.customer_phone,
            deal.salesperson_phone,
          )
        ) {
          const norm = cleanLegalSuffixes(deal.customer_name);
          const repKey = cleanPhone(deal.salesperson_phone);
          extraCustomersMap.set(`${repKey}-${norm || deal.customer_name}`, {
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
        if (
          !customerExistsForRep(
            visit.customer_name,
            visit.contact_no,
            visit.salesperson_phone,
          )
        ) {
          const norm = cleanLegalSuffixes(visit.customer_name);
          const repKey = cleanPhone(visit.salesperson_phone);
          extraCustomersMap.set(`${repKey}-${norm || visit.customer_name}`, {
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
        if (
          !customerExistsForRep(
            inq.sender_name,
            inq.sender_phone,
            inq.salesperson_phone,
          )
        ) {
          const norm = cleanLegalSuffixes(inq.sender_name);
          const repKey = cleanPhone(inq.salesperson_phone);
          extraCustomersMap.set(`${repKey}-${norm || inq.sender_name}`, {
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
        if (!customerExistsForRep(comp.customer_name, null, comp.reported_by)) {
          const norm = cleanLegalSuffixes(comp.customer_name);
          const repKey = cleanPhone(comp.reported_by);
          extraCustomersMap.set(`${repKey}-${norm || comp.customer_name}`, {
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

      const results: any[] = [];

      for (const customer of combinedCustomers) {
        const repPhone = cleanPhone(customer.assigned_salesperson_phone);

        // Safe matching for Won Deals
        const customerWonDeals = safeAllDeals.filter((d) => {
          const isWon =
            d.stage === 'won' ||
            d.stage === 'order' ||
            Boolean(d.po_number) ||
            d.inquiry_type === 'purchase_order';
          if (!isWon) return false;
          if (repPhone && cleanPhone(d.salesperson_phone) !== repPhone) {
            return false;
          }
          return isCustomerMatch(
            customer.customer_name,
            customer.customer_phone,
            d.customer_name,
            d.customer_phone,
          );
        });

        // Safe matching for Complaints
        const customerComplaints = safeAllComplaints.filter((c) => {
          if (repPhone && cleanPhone(c.reported_by) !== repPhone) {
            return false;
          }
          return isCustomerMatch(
            customer.customer_name,
            customer.customer_phone,
            c.customer_name,
            null,
          );
        });

        // Safe matching for Visits
        const customerVisits = safeAllVisits.filter((v) => {
          if (repPhone && cleanPhone(v.salesperson_phone) !== repPhone) {
            return false;
          }
          return isCustomerMatch(
            customer.customer_name,
            customer.customer_phone,
            v.customer_name,
            v.contact_no,
          );
        });

        // Safe matching for Inquiries
        const customerInquiries = safeAllInquiries.filter((i) => {
          if (repPhone && cleanPhone(i.salesperson_phone) !== repPhone) {
            return false;
          }
          return isCustomerMatch(
            customer.customer_name,
            customer.customer_phone,
            i.sender_name,
            i.sender_phone,
          );
        });

        const totalActivityCount =
          customerWonDeals.length +
          customerComplaints.length +
          customerVisits.length +
          customerInquiries.length;

        // Omit ghost seed records that have 0 activity for this salesperson/scope
        const isVirtual = String(customer.id || '').startsWith('virtual-');
        if (
          !isVirtual &&
          totalActivityCount === 0 &&
          !customer.contact_person &&
          !customer.notes &&
          !customer.customer_gst
        ) {
          continue;
        }

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

        // Metrics: Orders, Total Tonnage & Lifetime Value (including deal_items fallback)
        const totalOrders = customerWonDeals.length;
        const totalTonnage =
          Math.round(
            customerWonDeals.reduce((sum, d) => sum + getDealTonnage(d), 0) *
              1000,
          ) / 1000;
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

        const openComplaints = customerComplaints.filter((c) => {
          const st = (c.status || '').toLowerCase();
          return st !== 'resolved' && st !== 'closed';
        }).length;

        // Segment Classification: Key Account, Growth, New
        let segment = 'new';
        const explicitSegment = (customer.segment || '').toLowerCase();
        if (['key_account', 'growth', 'new'].includes(explicitSegment)) {
          segment = explicitSegment;
        } else if (
          totalTonnage >= 100 ||
          lifetimeValue >= 1000000 ||
          totalOrders >= 5
        ) {
          segment = 'key_account';
        } else if (
          totalOrders >= 2 ||
          totalTonnage >= 20 ||
          (lifetimeValue >= 100000 && lifetimeValue < 1000000)
        ) {
          segment = 'growth';
        } else {
          segment = 'new';
        }

        const repName = repPhone ? empMap.get(repPhone) || null : null;

        results.push({
          ...customer,
          assigned_salesperson_name: repName,
          last_order_date: effectiveLastOrderStr,
          days_since_order: daysSinceOrder,
          churn_risk: churnRisk,
          total_orders: totalOrders,
          total_tonnage: totalTonnage,
          lifetime_value: lifetimeValue,
          open_complaints: openComplaints,
          total_complaints: customerComplaints.length,
          total_visits: customerVisits.length,
          total_inquiries: customerInquiries.length,
          segment,
          avg_order_frequency_days: customer.avg_order_frequency_days || 30,
        });
      }

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

  async updateCustomer(
    id: string,
    data: any,
    accessiblePhones?: string[] | null,
  ) {
    try {
      const decodedId = decodeURIComponent(id || '').trim();

      if (accessiblePhones && accessiblePhones.length > 0) {
        if (!decodedId.startsWith('virtual-')) {
          const { data: existingCust } = await this.supabase
            .from('recurring_customers')
            .select('id, assigned_salesperson_phone')
            .eq('id', decodedId)
            .single();

          if (
            existingCust?.assigned_salesperson_phone &&
            !phoneInList(
              existingCust.assigned_salesperson_phone,
              accessiblePhones,
            )
          ) {
            throw new ForbiddenException(
              'Access Denied: You do not have permission to update this customer.',
            );
          }
        }

        if (
          data.assigned_salesperson_phone &&
          !phoneInList(data.assigned_salesperson_phone, accessiblePhones)
        ) {
          throw new ForbiddenException(
            'Access Denied: You cannot assign customers outside your authorized scope.',
          );
        }
      }
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

      if (decodedId.startsWith('virtual-')) {
        const namePart =
          data.customer_name ||
          decodedId.replace(
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
        .eq('id', decodedId)
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

      let dealsQuery = this.supabase
        .from('deals')
        .select('customer_name, won_at, created_at, salesperson_phone')
        .eq('stage', 'won')
        .order('created_at', { ascending: false });

      if (salespersonPhone) {
        const dealsOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (dealsOr) dealsQuery = dealsQuery.or(dealsOr);
      }

      const [{ data: customers, error }, { data: allWonDeals }] =
        await Promise.all([query, dealsQuery]);
      if (error) throw error;

      const safeWonDeals = allWonDeals || [];
      const normalize = (str?: string) =>
        (str || '')
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]/g, '');

      const existingNameSet = new Set(
        (customers || []).map((c) => normalize(c.customer_name)),
      );

      const extraCustomersMap = new Map<string, any>();
      for (const deal of safeWonDeals) {
        if (!deal.customer_name || !deal.customer_name.trim()) continue;
        const norm = normalize(deal.customer_name);
        if (
          norm &&
          !existingNameSet.has(norm) &&
          !extraCustomersMap.has(norm)
        ) {
          extraCustomersMap.set(norm, {
            id: `virtual-reorder-${norm}`,
            customer_name: deal.customer_name.trim(),
            contact_person: null,
            customer_phone: null,
            customer_gst: null,
            avg_order_frequency_days: 30,
            is_active: true,
            created_at: deal.created_at,
          });
        }
      }

      const combinedCustomers = [
        ...(customers || []),
        ...Array.from(extraCustomersMap.values()),
      ];

      const reorderList = combinedCustomers
        .map((customer: any) => {
          const custKeyNorm = normalize(customer.customer_name);
          const matchingDeals = safeWonDeals.filter(
            (d) => normalize(d.customer_name) === custKeyNorm,
          );
          const latestWonDeal =
            matchingDeals.length > 0 ? matchingDeals[0] : null;
          const effectiveLastOrderStr = latestWonDeal
            ? latestWonDeal.won_at || latestWonDeal.created_at
            : customer.last_order_date || null;

          const lastOrder = effectiveLastOrderStr
            ? new Date(effectiveLastOrderStr)
            : null;
          const avgFrequency = Number(customer.avg_order_frequency_days) || 30;
          const predictedDate = lastOrder
            ? new Date(lastOrder.getTime() + avgFrequency * 24 * 60 * 60 * 1000)
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
        })
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
          'id, lost_reason, total_amount, customer_name, created_at, salesperson_phone',
        )
        .eq('stage', 'lost')
        .gte('created_at', threeMonthsAgo)
        .order('created_at', { ascending: false });

      let logsQuery = this.supabase
        .from('kra_logs')
        .select(
          'id, customer_name, value, description, created_at, salesperson_phone',
        )
        .eq('kra_type', 'deal_lost')
        .gte('created_at', threeMonthsAgo)
        .order('created_at', { ascending: false });

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
        deal_number: d.id
          ? `DEAL-${d.id.substring(0, 6).toUpperCase()}`
          : undefined,
        customer_name: d.customer_name || 'Unnamed Account',
        lost_reason: d.lost_reason || 'Not specified',
        total_amount: Number(d.total_amount) || 0,
        created_at: d.created_at,
        salesperson_phone: d.salesperson_phone,
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
          deal_number: l.id
            ? `LOG-${l.id.substring(0, 6).toUpperCase()}`
            : undefined,
          customer_name: l.customer_name || 'Unnamed Account',
          lost_reason:
            l.description?.match(/Reason:\s*([^|]+)/)?.[1]?.trim() ||
            'Price / Commercials',
          total_amount: Number(l.value) || 0,
          created_at: l.created_at,
          salesperson_phone: l.salesperson_phone,
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

      combinedLosses.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

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
        recent_losses: combinedLosses,
        deals: combinedLosses,
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
        .select('id, customer_name, assigned_salesperson_phone');

      const toUpdate: any[] = [];
      const toInsert: any[] = [];

      for (const client of formattedClients) {
        const clientRepClean = cleanPhone(client.assigned_salesperson_phone);
        // Find existing matching customer
        const match = (existingCustomers || []).find((ec: any) => {
          const ecRepClean = cleanPhone(ec.assigned_salesperson_phone);
          if (clientRepClean && ecRepClean && clientRepClean !== ecRepClean) {
            return false;
          }
          const c1 = cleanLegalSuffixes(ec.customer_name);
          const c2 = cleanLegalSuffixes(client.customer_name);
          return (
            ec.customer_name.trim().toLowerCase() ===
              client.customer_name.trim().toLowerCase() ||
            (c1 && c2 && c1 === c2)
          );
        });

        if (match) {
          toUpdate.push({ id: match.id, ...client });
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
