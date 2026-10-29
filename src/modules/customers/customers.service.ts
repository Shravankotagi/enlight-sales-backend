import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CustomerInsightsService } from './customer-insights.service';
import { phoneInList } from '../employees/employees.service';
import {
  convertLineItemToMt,
  resolveCustomerState,
} from '../pricing/pricing.engine';

function extractCustomerState(customer: any): string | null {
  if (!customer) return null;
  let explicitFromNotes: string | null = null;
  if (typeof customer.notes === 'string') {
    const m = customer.notes.match(/\[State:\s*([^\]]+)\]/i);
    if (m && m[1]) explicitFromNotes = m[1].trim();
  }
  const resolved = resolveCustomerState({
    customerState: customer.customer_state || explicitFromNotes,
    customerGstin: customer.customer_gst,
    customerAddress: customer.customer_address || customer.address,
  });
  return resolved ? resolved.label : explicitFromNotes;
}

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
    if (!phone || typeof phone !== 'string') continue;
    const clean = phone.replace(/\D/g, '');
    const p10 = clean.slice(-10);
    const p12 = '91' + p10;
    for (const field of fieldNames) {
      parts.push(`${field}.eq.${p10}`, `${field}.eq.${p12}`);
    }
  }
  return parts.length > 0 ? parts.join(',') : null;
}

export function cleanLegalSuffixes(str?: string): string {
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

export function cleanPhone(p?: string): string {
  if (!p) return '';
  const digits = String(p).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

export function cleanGst(gst?: string): string {
  if (!gst) return '';
  return String(gst)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function calculateDiceCoefficient(s1: string, s2: string): number {
  const a = s1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = s2.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (a === b) return 1.0;
  if (a.length < 2 || b.length < 2) return 0.0;
  const getBigrams = (str: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.slice(i, i + 2);
      map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
  };
  const b1 = getBigrams(a);
  const b2 = getBigrams(b);
  let intersection = 0;
  for (const [bg, count] of b1.entries()) {
    if (b2.has(bg)) intersection += Math.min(count, b2.get(bg)!);
  }
  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

export function calculateLevenshteinSimilarity(s1: string, s2: string): number {
  const a = s1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = s2.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (a === b) return 1.0;
  const m = a.length,
    n = b.length;
  const maxLen = Math.max(m, n);
  if (maxLen === 0) return 1.0;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return (maxLen - dp[m][n]) / maxLen;
}

export function calculateJaroWinklerSimilarity(s1: string, s2: string): number {
  const a = s1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = s2.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (a === b) return 1.0;
  const len1 = a.length,
    len2 = b.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const matchDist = Math.floor(Math.max(len1, len2) / 2) - 1;
  const aMatches = new Array(len1).fill(false);
  const bMatches = new Array(len2).fill(false);
  let matches = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (!bMatches[j] && a[i] === b[j]) {
        aMatches[i] = true;
        bMatches[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0.0;

  let t = 0,
    k = 0;
  for (let i = 0; i < len1; i++) {
    if (aMatches[i]) {
      while (!bMatches[k]) k++;
      if (a[i] !== b[k]) t++;
      k++;
    }
  }
  const jaro =
    (matches / len1 + matches / len2 + (matches - t / 2) / matches) / 3;
  let l = 0;
  while (l < Math.min(4, len1, len2) && a[l] === b[l]) l++;
  return jaro + l * 0.1 * (1 - jaro);
}

export function calculateStringSimilarity(s1: string, s2: string): number {
  return Math.max(
    calculateDiceCoefficient(s1, s2),
    calculateLevenshteinSimilarity(s1, s2),
  );
}

function getDealTonnage(deal: any): number {
  if (!deal) return 0;
  if (Array.isArray(deal.deal_items) && deal.deal_items.length > 0) {
    return deal.deal_items.reduce((sum: number, item: any) => {
      const conv = convertLineItemToMt(item);
      if (conv && conv.canConvert && conv.mt !== null && !isNaN(conv.mt)) {
        return sum + Number(conv.mt);
      }
      const q = Number(item.quantity ?? item.quantity_mt ?? item.qty ?? 0) || 0;
      const unit = (item.unit || 'MT').toUpperCase().trim();
      return (
        sum +
        (unit === 'KG' || unit === 'KGS' || unit === 'KILOGRAM' ? q / 1000 : q)
      );
    }, 0);
  }
  const conv = convertLineItemToMt({
    quantity: deal.quantity ?? deal.quantity_mt,
    unit: deal.unit,
    sku_text: deal.product_type || deal.sku_text,
    dimensions: deal.dimensions,
  });
  if (conv && conv.canConvert && conv.mt !== null && !isNaN(conv.mt)) {
    return Number(conv.mt);
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

/** Delete match: same company name, or the same phone with a compatible name. */
export function customerRecordsMatch(
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
    Math.min(cClean.length, tClean.length) >= 8
  ) {
    return true;
  }
  const cp = cleanPhone(custPhone);
  const tp = cleanPhone(targetPhone);
  if (!cp || !tp || cp !== tp || !cClean || !tClean) return false;
  return (
    cClean === tClean || cClean.startsWith(tClean) || tClean.startsWith(cClean)
  );
}

function customerIdentityFilters(
  name: string | undefined,
  phone: string | undefined,
  nameFields: string[],
  phoneFields: string[],
): string[] {
  const parts: string[] = [];
  const clean = cleanLegalSuffixes(name)
    .replace(/[%_,.()]/g, '')
    .trim();
  if (clean.length >= 3) {
    for (const field of nameFields) parts.push(`${field}.ilike.%${clean}%`);
  }
  const digits = cleanPhone(phone);
  if (digits) {
    for (const field of phoneFields) parts.push(`${field}.ilike.%${digits}%`);
  }
  return parts;
}

function inquiryBelongsToCustomer(customer: any, inquiry: any): boolean {
  if (
    customerRecordsMatch(
      customer.customer_name,
      customer.customer_phone,
      inquiry.sender_name,
      inquiry.sender_phone,
    )
  ) {
    return true;
  }
  const ai = inquiry.ai_extraction_json || {};
  const aiName =
    ai.customer_name || ai.companyName || ai.customer?.name || ai.company_name;
  const aiPhone =
    ai.customerPhone || ai.customer_phone || ai.customer?.phone || ai.phone;
  if (
    customerRecordsMatch(
      customer.customer_name,
      customer.customer_phone,
      aiName,
      aiPhone,
    )
  ) {
    return true;
  }
  const clean = cleanLegalSuffixes(customer.customer_name);
  return (
    clean.length >= 8 &&
    Boolean(inquiry.raw_text) &&
    cleanLegalSuffixes(inquiry.raw_text).includes(clean)
  );
}

export type CustomerProfileAccess = {
  orders?: boolean;
  inquiries?: boolean;
  visits?: boolean;
  complaints?: boolean;
};

/** Drop module collections the caller cannot view. Omitted access keeps everything. */
export function redactCustomerProfile<T extends Record<string, any>>(
  profile: T,
  access?: CustomerProfileAccess,
): T {
  const orders = access?.orders !== false;
  const inquiries = access?.inquiries !== false;
  const visits = access?.visits !== false;
  const complaints = access?.complaints !== false;
  return {
    ...profile,
    deals: orders ? profile.deals : [],
    payments: orders ? profile.payments : [],
    inquiries: inquiries ? profile.inquiries : [],
    visits: visits ? profile.visits : [],
    complaints: complaints ? profile.complaints : [],
    total_orders: orders ? profile.total_orders : 0,
    total_tonnage: orders ? profile.total_tonnage : 0,
    last_order_date: orders ? profile.last_order_date : null,
    days_since_order: orders ? profile.days_since_order : null,
    lifetime_value: orders ? profile.lifetime_value : 0,
    avg_order_value: orders ? profile.avg_order_value : 0,
    t12m_revenue: orders ? profile.t12m_revenue : 0,
    avg_order_frequency_days: orders ? profile.avg_order_frequency_days : 0,
    open_complaints: complaints ? profile.open_complaints : 0,
    total_complaints: complaints ? profile.total_complaints : 0,
  };
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private supabaseService: SupabaseService,
    private customerInsightsService: CustomerInsightsService,
  ) {}

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
        .eq('is_active', true)
        .order('customer_name', { ascending: true });

      if (salespersonPhone) {
        const orFilter = buildMultiFieldOrFilter(salespersonPhone, [
          'assigned_salesperson_phone',
        ]);
        if (orFilter) query = query.or(orFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((c: any) => ({
        ...c,
        customer_state: extractCustomerState(c),
      }));
    } catch (error) {
      this.logger.error('Error in findAll:', error);
      throw error;
    }
  }

  async findOne(
    id: string,
    salespersonPhone?: string[] | string,
    access?: CustomerProfileAccess,
  ) {
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
      if (targetNameClean) {
        inqCandidateFilters.push(`sender_name.ilike.%${targetNameClean}%`);
        inqCandidateFilters.push(`raw_text.ilike.%${targetNameClean}%`);
      }
      targetWords.forEach((w) => {
        inqCandidateFilters.push(`sender_name.ilike.%${w}%`);
        inqCandidateFilters.push(`raw_text.ilike.%${w}%`);
      });
      if (targetPhoneClean) {
        inqCandidateFilters.push(`sender_phone.ilike.%${targetPhoneClean}%`);
        inqCandidateFilters.push(`sender_phone.ilike.%91${targetPhoneClean}%`);
        inqCandidateFilters.push(`raw_text.ilike.%${targetPhoneClean}%`);
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

      // Query related collections targeted to candidate matches and scoped to salesperson
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

      if (salespersonPhone) {
        const spFilter = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (spFilter) {
          dealsQuery = dealsQuery.or(spFilter);
          visitsQuery = visitsQuery.or(spFilter);
          inquiriesQuery = inquiriesQuery.or(spFilter);
          paymentsQuery = paymentsQuery.or(spFilter);
        }
        const compFilter = buildMultiFieldOrFilter(salespersonPhone, [
          'reported_by',
        ]);
        if (compFilter) {
          complaintsQuery = complaintsQuery.or(compFilter);
        }
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

      const allowedList = salespersonPhone
        ? Array.isArray(salespersonPhone)
          ? salespersonPhone
          : [salespersonPhone]
        : null;

      // Match related items using safe matcher AND strict RBAC scoping
      const deals = allDeals.filter((d) => {
        if (
          !isCustomerMatch(
            customer.customer_name,
            customer.customer_phone,
            d.customer_name,
            d.customer_phone,
          )
        ) {
          return false;
        }
        if (allowedList && allowedList.length > 0) {
          return (
            d.salesperson_phone && phoneInList(d.salesperson_phone, allowedList)
          );
        }
        return true;
      });

      const visits = allVisits.filter((v) => {
        if (
          !isCustomerMatch(
            customer.customer_name,
            customer.customer_phone,
            v.customer_name,
            v.contact_no,
          )
        ) {
          return false;
        }
        if (allowedList && allowedList.length > 0) {
          return (
            v.salesperson_phone && phoneInList(v.salesperson_phone, allowedList)
          );
        }
        return true;
      });

      const payments = allPayments.filter((p) => {
        if (
          !isCustomerMatch(
            customer.customer_name,
            customer.customer_phone,
            p.customer_name,
            null,
          )
        ) {
          return false;
        }
        if (allowedList && allowedList.length > 0) {
          return (
            p.salesperson_phone && phoneInList(p.salesperson_phone, allowedList)
          );
        }
        return true;
      });

      const complaints = allComplaints.filter((c) => {
        if (
          !isCustomerMatch(
            customer.customer_name,
            customer.customer_phone,
            c.customer_name,
            null,
          )
        ) {
          return false;
        }
        if (allowedList && allowedList.length > 0) {
          return c.reported_by && phoneInList(c.reported_by, allowedList);
        }
        return true;
      });

      // Collect inquiry IDs from matched deals
      const dealInquiryIds = new Set<string>();
      deals.forEach((d) => {
        if (d.inquiry_id) dealInquiryIds.add(d.inquiry_id);
        if (d.id) dealInquiryIds.add(d.id);
      });

      // Fetch any missing inquiries linked to matched deals
      const loadedInqIds = new Set(allInquiries.map((i) => i.id));
      const missingInqIds = Array.from(dealInquiryIds).filter(
        (id) => !loadedInqIds.has(id),
      );
      if (access?.inquiries !== false && missingInqIds.length > 0) {
        const { data: missingInqs } = await this.supabase
          .from('inquiries')
          .select('*')
          .in('id', missingInqIds);
        if (missingInqs && missingInqs.length > 0) {
          allInquiries.push(...missingInqs);
        }
      }

      const inquiries = allInquiries.filter((inq) => {
        const isLinkedToDeal = dealInquiryIds.has(inq.id);
        const isSenderMatch = isCustomerMatch(
          customer.customer_name,
          customer.customer_phone,
          inq.sender_name,
          inq.sender_phone,
        );

        const aiJson = inq.ai_extraction_json || {};
        const aiCustName =
          aiJson.customer_name ||
          aiJson.companyName ||
          aiJson.customer?.name ||
          aiJson.company_name;
        const aiCustPhone =
          aiJson.customerPhone ||
          aiJson.customer_phone ||
          aiJson.customer?.phone ||
          aiJson.phone;
        const isAiMatch = isCustomerMatch(
          customer.customer_name,
          customer.customer_phone,
          aiCustName,
          aiCustPhone,
        );

        const isRawTextMatch =
          inq.raw_text &&
          targetNameClean &&
          cleanLegalSuffixes(inq.raw_text).includes(targetNameClean);

        if (
          !isLinkedToDeal &&
          !isSenderMatch &&
          !isAiMatch &&
          !isRawTextMatch
        ) {
          return false;
        }

        if (allowedList && allowedList.length > 0) {
          return (
            !inq.salesperson_phone ||
            phoneInList(inq.salesperson_phone, allowedList)
          );
        }
        return true;
      });

      // Also synthesize inquiry entries for pipeline inquiry deals that don't have a record in inquiries table
      const matchedInqIds = new Set(inquiries.map((i) => i.id));
      deals.forEach((d) => {
        const isDealInquiry =
          d.inquiry_type === 'inquiry' ||
          d.stage === 'new_inquiry' ||
          d.stage === 'review';
        if (
          isDealInquiry &&
          !matchedInqIds.has(d.id) &&
          (!d.inquiry_id || !matchedInqIds.has(d.inquiry_id))
        ) {
          inquiries.push({
            id: d.inquiry_id || d.id,
            deal_id: d.id,
            customer_name: d.customer_name,
            sender_name: d.customer_name,
            sender_phone: d.customer_phone,
            salesperson_phone: d.salesperson_phone,
            source_channel: d.source_channel || 'WhatsApp',
            raw_text:
              d.deal_items && d.deal_items.length > 0
                ? d.deal_items
                    .map(
                      (it: any) =>
                        `${it.sku_text || 'Item'} (${it.quantity || ''} ${it.unit || 'MT'})`,
                    )
                    .join(', ')
                : `Inquiry for ${d.customer_name}`,
            status:
              d.stage === 'new_inquiry' || d.status === 'auto_created'
                ? 'New Inquiry'
                : d.stage || 'Inquiry',
            created_at: d.created_at,
          });
        }
      });

      if (allowedList && allowedList.length > 0) {
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

      const totalOrders = wonDeals.length;
      const totalTonnage =
        Math.round(
          wonDeals.reduce((sum, d) => sum + getDealTonnage(d), 0) * 1000,
        ) / 1000;
      const avgOrderValue =
        totalOrders > 0 ? Math.round(lifetimeValue / totalOrders) : 0;

      // Segment Classification: Key Account, Growth, New
      let segment = 'new';
      const explicitSegment = (customer.segment || '').toLowerCase();
      if (['key_account', 'growth', 'new'].includes(explicitSegment)) {
        segment = explicitSegment;
      } else if (
        totalTonnage >= 100 ||
        lifetimeValue >= 5000000 ||
        (totalOrders >= 4 && (lifetimeValue >= 2000000 || totalTonnage >= 30))
      ) {
        segment = 'key_account';
      } else if (
        (totalOrders >= 2 && (lifetimeValue >= 500000 || totalTonnage >= 10)) ||
        totalTonnage >= 25 ||
        lifetimeValue >= 1500000 ||
        (totalOrders >= 1 && (inquiries.length >= 3 || visits.length >= 2))
      ) {
        segment = 'growth';
      } else {
        segment = 'new';
      }

      // Trailing 12 Month Revenue
      const t12mCutoff = new Date(
        now.getTime() - 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const t12mRevenue = wonDeals
        .filter((d) => (d.won_at || d.created_at) >= t12mCutoff)
        .reduce((sum, d) => sum + (Number(d.total_amount) || 0), 0);

      const visible = redactCustomerProfile(
        {
          deals,
          payments,
          inquiries,
          visits,
          complaints,
          total_orders: totalOrders,
          total_tonnage: totalTonnage,
          last_order_date: effectiveLastOrderDate,
          days_since_order: daysSinceOrder,
          lifetime_value: lifetimeValue,
          avg_order_value: avgOrderValue,
          t12m_revenue: t12mRevenue,
          avg_order_frequency_days: cadenceDays,
          open_complaints: openComplaints,
          total_complaints: complaints.length,
          churn_risk: churnRisk,
          segment,
        },
        access,
      );

      const healthSignals = await this.customerInsightsService.generateInsights(
        {
          customerName: customer.customer_name || 'Customer',
          segment,
          churnRisk,
          daysSinceOrder: visible.days_since_order,
          cadenceDays: visible.avg_order_frequency_days,
          totalOrders: visible.total_orders,
          totalTonnage: visible.total_tonnage,
          lifetimeValue: visible.lifetime_value,
          openComplaints: visible.open_complaints,
          totalComplaints: visible.total_complaints,
          deals: access?.orders === false ? [] : wonDeals,
          inquiries: visible.inquiries,
          visits: visible.visits,
          complaints: visible.complaints,
          assignedSalespersonName,
        },
      );

      return {
        ...customer,
        customer_state: extractCustomerState(customer),
        assigned_salesperson_name: assignedSalespersonName,
        last_order_date: visible.last_order_date,
        days_since_order: visible.days_since_order,
        churn_risk: churnRisk,
        total_orders: visible.total_orders,
        total_tonnage: visible.total_tonnage,
        lifetime_value: visible.lifetime_value,
        avg_order_value: visible.avg_order_value,
        t12m_revenue: visible.t12m_revenue,
        open_complaints: visible.open_complaints,
        total_complaints: visible.total_complaints,
        segment,
        avg_order_frequency_days: visible.avg_order_frequency_days,
        health_signals: healthSignals,
        deals: visible.deals,
        visits: visible.visits,
        payments: visible.payments,
        complaints: visible.complaints,
        inquiries: visible.inquiries,
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
        .eq('is_active', true)
        .order('customer_name', { ascending: true });

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
          'customer_name, customer_phone, created_at, won_at, stage, total_amount, po_number, inquiry_type, salesperson_phone, deal_items(amount, rate, quantity, unit, sku_text, dimensions)',
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

      const combinedCustomers = customers || [];
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
        const isAssigned =
          Boolean(customer.assigned_salesperson_phone) &&
          customer.assigned_salesperson_phone !== 'unassigned' &&
          customer.assigned_salesperson_phone !== 'null';

        if (
          !isVirtual &&
          !isAssigned &&
          totalActivityCount === 0 &&
          !customer.contact_person &&
          !customer.notes &&
          !customer.customer_gst &&
          !customer.customer_phone &&
          !customer.customer_address
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
          lifetimeValue >= 5000000 ||
          (totalOrders >= 4 && (lifetimeValue >= 2000000 || totalTonnage >= 30))
        ) {
          segment = 'key_account';
        } else if (
          (totalOrders >= 2 &&
            (lifetimeValue >= 500000 || totalTonnage >= 10)) ||
          totalTonnage >= 25 ||
          lifetimeValue >= 1500000 ||
          (totalOrders >= 1 &&
            (customerInquiries.length >= 3 || customerVisits.length >= 2))
        ) {
          segment = 'growth';
        } else {
          segment = 'new';
        }

        const repName = repPhone ? empMap.get(repPhone) || null : null;

        results.push({
          ...customer,
          customer_state: extractCustomerState(customer),
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

  async findCustomerConflict(
    customerName?: string,
    customerPhone?: string,
    customerGst?: string,
    callerPhone?: string,
    allowSimilar?: boolean,
  ): Promise<{
    conflict: boolean;
    conflictType?: 'exact' | 'similar';
    reason?: string;
    existing?: any;
    isOwnCustomer?: boolean;
    isUnassigned?: boolean;
    repName?: string;
    repPhone?: string;
    similarityScore?: number;
  }> {
    const rawName = String(customerName || '').trim();
    const coreName = cleanLegalSuffixes(rawName);
    const phone10 = cleanPhone(customerPhone);
    const gstClean = cleanGst(customerGst);
    const caller10 = cleanPhone(callerPhone);

    if (!rawName && !phone10 && !gstClean) {
      return { conflict: false };
    }

    const { data: candidates, error } = await this.supabase
      .from('recurring_customers')
      .select('*')
      .eq('is_active', true);

    if (error) {
      this.logger.error(
        'Error fetching recurring_customers for conflict check:',
        error,
      );
      return { conflict: false };
    }

    const allRecords = candidates || [];

    // 1. Exact Match Check
    const exactMatch = allRecords.find((c: any) => {
      const dbRaw = String(c.customer_name || '').trim();
      const dbCore = cleanLegalSuffixes(dbRaw);

      if (rawName && dbRaw.toLowerCase() === rawName.toLowerCase()) return true;
      if (coreName && dbCore && coreName === dbCore) return true;

      const dbPhone = cleanPhone(c.customer_phone);
      const dbGst = cleanGst(c.customer_gst);
      const samePhone = Boolean(phone10 && dbPhone && phone10 === dbPhone);
      const sameGst = Boolean(gstClean && dbGst && gstClean === dbGst);
      if ((samePhone || sameGst) && areNamesCompatible(rawName, dbRaw))
        return true;

      return false;
    });

    if (exactMatch) {
      const assignedPhone10 = cleanPhone(exactMatch.assigned_salesperson_phone);
      const isUnassigned =
        !assignedPhone10 ||
        assignedPhone10 === 'unassigned' ||
        String(exactMatch.assigned_salesperson_phone || '').toLowerCase() ===
          'unassigned';
      const isOwnCustomer = Boolean(
        assignedPhone10 && caller10 && assignedPhone10 === caller10,
      );

      if (isUnassigned) {
        return { conflict: false, existing: exactMatch, isUnassigned: true };
      }

      if (isOwnCustomer) {
        return {
          conflict: true,
          conflictType: 'exact',
          isOwnCustomer: true,
          existing: exactMatch,
          reason: `Customer "${exactMatch.customer_name}" is already registered and assigned to your account.`,
        };
      }

      let repName = '';
      if (assignedPhone10) {
        try {
          const { data: rep } = await this.supabase
            .from('employees')
            .select('name, phone')
            .or(
              `phone.eq.${assignedPhone10},phone.eq.91${assignedPhone10},phone.eq.+91${assignedPhone10}`,
            )
            .limit(1)
            .maybeSingle();

          if (rep?.name) {
            repName = rep.name;
          }
        } catch {
          // fallback
        }
      }

      const repDisplay = repName
        ? `${repName} (${assignedPhone10})`
        : assignedPhone10 || 'another salesperson';

      return {
        conflict: true,
        conflictType: 'exact',
        existing: exactMatch,
        isOwnCustomer: false,
        repName,
        repPhone: assignedPhone10,
        reason: `Customer "${exactMatch.customer_name}" is already registered and assigned to salesperson ${repDisplay}. Cannot add to your account.`,
      };
    }

    // 2. High Similarity Check (> 80%) for customer name
    if (rawName && !allowSimilar) {
      let highestSimilarCandidate: any = null;
      let highestScore = 0;

      for (const c of allRecords) {
        const dbRaw = String(c.customer_name || '').trim();
        if (!dbRaw) continue;

        const assignedPhone10 = cleanPhone(c.assigned_salesperson_phone);
        const isCUnassigned =
          !assignedPhone10 ||
          assignedPhone10 === 'unassigned' ||
          String(c.assigned_salesperson_phone || '').toLowerCase() ===
            'unassigned';
        const isCOwn = Boolean(
          assignedPhone10 && caller10 && assignedPhone10 === caller10,
        );

        // Similarity checks only apply against customers assigned to other salespeople
        if (isCUnassigned || isCOwn) continue;

        const score = calculateStringSimilarity(rawName, dbRaw);
        const dbCore = cleanLegalSuffixes(dbRaw);
        const coreScore =
          coreName && dbCore ? calculateStringSimilarity(coreName, dbCore) : 0;
        const maxCandidateScore = Math.max(score, coreScore);

        if (maxCandidateScore > highestScore) {
          highestScore = maxCandidateScore;
          highestSimilarCandidate = c;
        }
      }

      if (highestSimilarCandidate && highestScore > 0.8) {
        const assignedPhone10 = cleanPhone(
          highestSimilarCandidate.assigned_salesperson_phone,
        );
        let repName = '';
        if (assignedPhone10) {
          try {
            const { data: rep } = await this.supabase
              .from('employees')
              .select('name, phone')
              .or(
                `phone.eq.${assignedPhone10},phone.eq.91${assignedPhone10},phone.eq.+91${assignedPhone10}`,
              )
              .limit(1)
              .maybeSingle();

            if (rep?.name) {
              repName = rep.name;
            }
          } catch {
            // fallback
          }
        }

        const repDisplay = repName
          ? `${repName} (${assignedPhone10})`
          : assignedPhone10 || 'another salesperson';

        return {
          conflict: true,
          conflictType: 'similar',
          existing: highestSimilarCandidate,
          isOwnCustomer: false,
          similarityScore: highestScore,
          repName,
          repPhone: assignedPhone10,
          reason: `"${highestSimilarCandidate.customer_name}" is already assigned for other customer${repDisplay ? ` (${repDisplay})` : ''} and still do you want to add customer "${rawName}"? Kindly contact your admin for adding only this customer.`,
        };
      }
    }

    return { conflict: false };
  }

  async createCustomer(
    dto: {
      customer_name: string;
      contact_person: string;
      customer_phone: string;
      customer_address: string;
      customer_email?: string;
      customer_gst?: string;
      customer_state?: string;
      assigned_salesperson_phone?: string;
      allow_similar?: boolean;
    },
    employee: any,
    accessiblePhones?: string[] | null,
  ) {
    const rawName = String(dto.customer_name || '').trim();
    const contact = String(dto.contact_person || '').trim();
    const phone = cleanPhone(dto.customer_phone);
    const address = String(dto.customer_address || '').trim();
    const gst = cleanGst(dto.customer_gst) || null;
    const email = dto.customer_email ? String(dto.customer_email).trim() : null;

    if (!rawName) throw new BadRequestException('Company name is required.');
    if (!contact) throw new BadRequestException('Contact person is required.');
    if (phone.length < 10) {
      throw new BadRequestException(
        'A valid 10-digit mobile number is required.',
      );
    }
    if (!address) {
      throw new BadRequestException('Delivery location is required.');
    }

    let targetPhone = employee?.phone
      ? `91${cleanPhone(employee.phone)}`
      : 'unassigned';
    if (employee?.role === 'admin' && dto.assigned_salesperson_phone) {
      targetPhone = `91${cleanPhone(dto.assigned_salesperson_phone)}`;
    } else if (
      dto.assigned_salesperson_phone &&
      accessiblePhones &&
      accessiblePhones.length > 0
    ) {
      const target10 = cleanPhone(dto.assigned_salesperson_phone);
      if (phoneInList(target10, accessiblePhones)) {
        targetPhone = `91${target10}`;
      }
    }

    const caller10 = cleanPhone(targetPhone);
    const check = await this.findCustomerConflict(
      rawName,
      phone,
      gst || undefined,
      caller10,
      employee?.role === 'admin' ? Boolean(dto.allow_similar) : false,
    );

    if (check.conflict) {
      throw new ConflictException({
        conflictType: check.conflictType || 'exact',
        message: check.reason,
        existingName: check.existing?.customer_name,
        repName: check.repName,
        repPhone: check.repPhone,
        similarityScore: check.similarityScore,
      });
    }

    const resolvedState =
      dto.customer_state?.trim() ||
      resolveCustomerState({
        customerGstin: gst || undefined,
        customerAddress: address,
      })?.label ||
      '';

    const notesParts: string[] = [];
    if (email) notesParts.push(`Email: ${email}`);
    if (resolvedState) notesParts.push(`[State: ${resolvedState}]`);
    const notes = notesParts.length > 0 ? notesParts.join(' | ') : null;

    if (check.existing && check.isUnassigned) {
      const { data: updated, error: updErr } = await this.supabase
        .from('recurring_customers')
        .update({
          customer_name: rawName,
          contact_person: contact,
          customer_phone: `91${phone}`,
          customer_address: address,
          customer_gst: gst,
          assigned_salesperson_phone: targetPhone,
          is_active: true,
          notes: notes || check.existing.notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', check.existing.id)
        .select()
        .single();

      if (updErr) {
        this.logger.error('Error claiming unassigned customer:', updErr);
        throw updErr;
      }
      return {
        ...updated,
        customer_state: extractCustomerState(updated),
      };
    }

    const nowIso = new Date().toISOString();
    const insertPayload = {
      customer_name: rawName,
      contact_person: contact,
      customer_phone: `91${phone}`,
      customer_address: address,
      customer_gst: gst,
      assigned_salesperson_phone: targetPhone,
      is_active: true,
      avg_order_frequency_days: 30,
      notes,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { data: created, error: insErr } = await this.supabase
      .from('recurring_customers')
      .insert(insertPayload)
      .select()
      .single();

    if (insErr) {
      this.logger.error('Error creating recurring customer:', insErr);
      throw insErr;
    }

    const kraBase = {
      salesperson_phone: targetPhone,
      kra_type: 'new_customer',
      customer_name: rawName,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
      created_at: nowIso,
    };
    const { error: kraError } = await this.supabase.from('kra_logs').insert([
      {
        ...kraBase,
        kra_number: 2,
        description: `New Customer Acquired: ${rawName}`,
      },
      {
        ...kraBase,
        kra_number: 6,
        description: `Added New Customer: ${rawName}`,
      },
    ]);
    if (kraError) {
      this.logger.warn('KRA log for new customer failed', kraError.message);
    }

    const { error: logError } = await this.supabase
      .from('activity_logs')
      .insert({
        timestamp: nowIso,
        salesperson_name: employee?.name || null,
        salesperson_phone: targetPhone,
        description: `New customer ${rawName} added`,
        module: 'Customers',
        source: 'dashboard',
        action_type: 'customer_created',
        entity_id: created.id,
        entity_type: 'customer',
        customer_name: rawName,
      });
    if (logError) {
      this.logger.warn(
        'Activity log for new customer failed',
        logError.message,
      );
    }

    return {
      ...created,
      customer_state: extractCustomerState(created),
    };
  }

  async updateCustomer(
    id: string,
    data: any,
    accessiblePhones?: string[] | null,
  ) {
    try {
      const decodedId = decodeURIComponent(id || '').trim();
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          decodedId,
        );

      let customerRecord: any = null;
      if (isUuid) {
        const { data: found } = await this.supabase
          .from('recurring_customers')
          .select('*')
          .eq('id', decodedId)
          .maybeSingle();
        customerRecord = found;
      } else if (!decodedId.startsWith('virtual-')) {
        const { data: found } = await this.supabase
          .from('recurring_customers')
          .select('*')
          .ilike('customer_name', `%${decodedId}%`)
          .limit(1);
        if (found && found.length > 0) {
          customerRecord = found[0];
        }
      }

      if (accessiblePhones && accessiblePhones.length > 0) {
        if (customerRecord) {
          if (
            customerRecord.assigned_salesperson_phone &&
            !phoneInList(
              customerRecord.assigned_salesperson_phone,
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
        updatePayload.contact_person = data.contact_person
          ? String(data.contact_person).trim()
          : null;
      if (data.customer_phone !== undefined)
        updatePayload.customer_phone = data.customer_phone
          ? String(data.customer_phone).trim()
          : null;
      if (data.customer_gst !== undefined)
        updatePayload.customer_gst = data.customer_gst
          ? String(data.customer_gst).trim()
          : null;

      const addr =
        data.customer_address !== undefined
          ? data.customer_address
          : data.address;
      if (addr !== undefined) {
        updatePayload.customer_address = addr ? String(addr).trim() : null;
      }

      if (data.avg_order_frequency_days !== undefined) {
        const cadence = Number(data.avg_order_frequency_days);
        updatePayload.avg_order_frequency_days =
          !isNaN(cadence) && cadence > 0 ? cadence : 30;
      }
      if (data.assigned_salesperson_phone !== undefined)
        updatePayload.assigned_salesperson_phone =
          data.assigned_salesperson_phone
            ? String(data.assigned_salesperson_phone).trim()
            : null;
      if (data.notes !== undefined) updatePayload.notes = data.notes;
      if (data.customer_state !== undefined || data.state !== undefined) {
        const stateVal = String(data.customer_state ?? data.state ?? '').trim();
        const baseNotes = String(
          updatePayload.notes !== undefined
            ? updatePayload.notes
            : customerRecord?.notes || '',
        )
          .replace(/\[State:\s*[^\]]+\]\s*/gi, '')
          .trim();
        updatePayload.notes = stateVal
          ? baseNotes
            ? `${baseNotes} [State: ${stateVal}]`
            : `[State: ${stateVal}]`
          : baseNotes || null;
      }
      if (data.is_active !== undefined)
        updatePayload.is_active = Boolean(data.is_active);

      if (decodedId.startsWith('virtual-') || (!customerRecord && !isUuid)) {
        const namePart =
          (data.customer_name ? String(data.customer_name).trim() : '') ||
          (decodedId.startsWith('virtual-')
            ? decodedId.replace(
                /^(virtual-deal-|virtual-visit-|virtual-inquiry-|virtual-complaint-)/,
                '',
              )
            : decodedId);

        const defaultPhone =
          updatePayload.assigned_salesperson_phone ||
          (accessiblePhones && accessiblePhones.length > 0
            ? accessiblePhones[0]
            : 'unassigned');

        const check = await this.findCustomerConflict(
          namePart,
          data.customer_phone || data.mobile,
          data.customer_gst || data.gstin,
          defaultPhone,
        );

        if (check.conflict) {
          throw new ConflictException({
            conflictType: check.conflictType || 'exact',
            message: check.reason,
            existingName: check.existing?.customer_name,
            repName: check.repName,
            repPhone: check.repPhone,
            similarityScore: check.similarityScore,
          });
        }

        if (check.isUnassigned && check.existing) {
          const { data: updatedUnassigned, error: updErr } = await this.supabase
            .from('recurring_customers')
            .update({
              customer_name: namePart,
              assigned_salesperson_phone: defaultPhone,
              ...updatePayload,
              updated_at: new Date().toISOString(),
            })
            .eq('id', check.existing.id)
            .select()
            .single();

          if (updErr) {
            this.logger.error(
              'Error claiming unassigned customer in updateCustomer fallback:',
              updErr,
            );
            throw updErr;
          }
          return {
            ...updatedUnassigned,
            customer_state: extractCustomerState(updatedUnassigned),
          };
        }

        const { data: created, error } = await this.supabase
          .from('recurring_customers')
          .insert({
            customer_name: namePart,
            assigned_salesperson_phone: defaultPhone,
            avg_order_frequency_days: 30,
            is_active: true,
            ...updatePayload,
          })
          .select()
          .single();
        if (error) {
          this.logger.error(
            `Error creating customer in updateCustomer fallback:`,
            error,
          );
          throw error;
        }
        return {
          ...created,
          customer_state: extractCustomerState(created),
        };
      }

      const targetDbId = customerRecord ? customerRecord.id : decodedId;

      const { data: updated, error } = await this.supabase
        .from('recurring_customers')
        .update(updatePayload)
        .eq('id', targetDbId)
        .select()
        .single();
      if (error) {
        this.logger.error(`Error updating customer ${targetDbId}:`, error);
        throw error;
      }
      return {
        ...updated,
        customer_state: extractCustomerState(updated),
      };
    } catch (error) {
      this.logger.error(`Error updating customer ${id}:`, error);
      throw error;
    }
  }

  private async loadCustomerMatches(
    table: string,
    filters: string[],
    match: (row: any) => boolean,
  ) {
    if (filters.length === 0) return [];
    const { data, error } = await this.supabase
      .from(table)
      .select('*')
      .or(filters.join(','));
    if (error) throw error;
    return (data || []).filter(match);
  }

  private async deleteIds(
    table: string,
    column: string,
    ids: string[],
    missingColumnOk = false,
  ) {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    for (let i = 0; i < unique.length; i += 100) {
      const chunk = unique.slice(i, i + 100);
      const { error } = await this.supabase
        .from(table)
        .delete()
        .in(column, chunk);
      if (error) {
        if (missingColumnOk && error.code === '42703') return;
        throw error;
      }
    }
  }

  async deleteCustomer(id: string) {
    try {
      const decodedId = decodeURIComponent(id || '').trim();
      if (!decodedId || decodedId.startsWith('virtual-')) {
        throw new BadRequestException('This customer cannot be deleted.');
      }

      const { data: customer, error } = await this.supabase
        .from('recurring_customers')
        .select('*')
        .eq('id', decodedId)
        .single();
      if (error || !customer) {
        throw new BadRequestException('Customer not found.');
      }

      const name = customer.customer_name;
      const phone = customer.customer_phone;
      const named = (rowName?: string, rowPhone?: string) =>
        customerRecordsMatch(name, phone, rowName, rowPhone);

      const deals = await this.loadCustomerMatches(
        'deals',
        customerIdentityFilters(
          name,
          phone,
          ['customer_name'],
          ['customer_phone'],
        ),
        (row) => named(row.customer_name, row.customer_phone),
      );
      const dealIds = deals.map((row) => row.id);
      const inquiries = await this.loadCustomerMatches(
        'inquiries',
        customerIdentityFilters(
          name,
          phone,
          ['sender_name', 'raw_text'],
          ['sender_phone'],
        ),
        (row) => inquiryBelongsToCustomer(customer, row),
      );
      const visits = await this.loadCustomerMatches(
        'customer_visits',
        customerIdentityFilters(name, phone, ['customer_name'], ['contact_no']),
        (row) => named(row.customer_name, row.contact_no),
      );
      const complaints = await this.loadCustomerMatches(
        'complaints',
        customerIdentityFilters(name, phone, ['customer_name'], []),
        (row) => named(row.customer_name, null),
      );
      const payments = await this.loadCustomerMatches(
        'payment_tracking',
        customerIdentityFilters(name, phone, ['customer_name'], []),
        (row) =>
          named(row.customer_name, null) || dealIds.includes(row.deal_id),
      );
      const followups = await this.loadCustomerMatches(
        'followup_tasks',
        customerIdentityFilters(
          name,
          phone,
          ['customer_name'],
          ['customer_phone'],
        ),
        (row) =>
          named(row.customer_name, row.customer_phone) ||
          dealIds.includes(row.linked_deal_id) ||
          dealIds.includes(row.deal_id),
      );
      const kraLogs = await this.loadCustomerMatches(
        'kra_logs',
        customerIdentityFilters(name, phone, ['customer_name'], []),
        (row) => named(row.customer_name, null),
      );

      const complaintIds = complaints.map((row) => row.id);
      await this.deleteIds(
        'complaint_attachments',
        'complaint_id',
        complaintIds,
      );
      await this.deleteIds('deal_items', 'deal_id', dealIds);
      await this.deleteIds('payment_tracking', 'deal_id', dealIds);
      await this.deleteIds('followup_tasks', 'linked_deal_id', dealIds, true);
      await this.deleteIds('deals', 'id', dealIds);
      const inquiryIds = [
        ...inquiries.map((row) => row.id),
        ...deals.map((row) => row.inquiry_id),
      ];
      await this.deleteIds('inquiry_items', 'inquiry_id', inquiryIds);
      await this.deleteIds('inquiries', 'id', inquiryIds);
      await this.deleteIds(
        'customer_visits',
        'id',
        visits.map((row) => row.id),
      );
      await this.deleteIds('complaints', 'id', complaintIds);
      await this.deleteIds(
        'payment_tracking',
        'id',
        payments.map((row) => row.id),
      );
      await this.deleteIds(
        'followup_tasks',
        'id',
        followups.map((row) => row.id),
      );
      await this.deleteIds(
        'kra_logs',
        'id',
        kraLogs.map((row) => row.id),
      );

      const { error: deleteErr } = await this.supabase
        .from('recurring_customers')
        .delete()
        .eq('id', customer.id);
      if (deleteErr) throw deleteErr;

      const { error: logErr } = await this.supabase
        .from('activity_logs')
        .insert({
          timestamp: new Date().toISOString(),
          description: `Customer ${name || 'record'} and related records deleted`,
          module: 'Customers',
          source: 'dashboard',
          action_type: 'customer_deleted',
          entity_id: customer.id,
          entity_type: 'customer',
        });
      if (logErr) {
        this.logger.warn('Customer delete was not written to the activity log');
      }

      return {
        success: true,
        message: 'Customer and related records deleted.',
      };
    } catch (error) {
      if (!(error instanceof BadRequestException)) {
        this.logger.error(`Error deleting customer ${id}:`, error);
      }
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

      const combinedCustomers = customers || [];

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
          'id, lost_reason, total_amount, customer_name, created_at, salesperson_phone, stage',
        )
        .eq('stage', 'lost')
        .gte('created_at', threeMonthsAgo)
        .order('created_at', { ascending: false });

      if (salespersonPhone) {
        const dealsOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (dealsOr) {
          query = query.or(dealsOr);
        }
      }

      const { data: lostDeals, error: dealsErr } = await query;
      if (dealsErr) {
        this.logger.warn('Could not query lost deals:', dealsErr.message);
      }

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

      const combinedLosses = primaryLostDeals;

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

      // Preload active employees for CSV salesperson matching
      const { data: allEmployeesData, error: empFetchError } =
        await this.supabase.from('employees').select('*');

      if (empFetchError) {
        this.logger.warn(
          'Failed to fetch employees for CSV salesperson mapping:',
          empFetchError.message,
        );
      }

      const activeEmployees = (allEmployeesData || []).filter(
        (e: any) => e.is_active !== false && Boolean(e.phone),
      );

      // Helper to resolve salesperson for each row using:
      // Corporate Email ID -> Name -> Zoho User ID -> Phone Number (fallback) with maximum matched scoring
      const resolveSalesperson = (c: any): string => {
        let rawEmail = String(c.assigned_salesperson_email || '')
          .trim()
          .toLowerCase();
        let rawName = String(c.assigned_salesperson_name || '').trim();
        let rawZohoId = String(c.assigned_salesperson_zoho_id || '').trim();
        let rawPhone = String(
          c.assigned_salesperson_phone || c.salesperson_phone || '',
        ).trim();
        const rawGeneric = String(
          c.assigned_salesperson || c.salesperson || '',
        ).trim();

        // If generic salesperson column was provided, inspect value type
        if (rawGeneric) {
          if (rawGeneric.includes('@') && !rawEmail) {
            rawEmail = rawGeneric.toLowerCase();
          } else if (
            /^\d{15,}$/.test(rawGeneric.replace(/\D/g, '')) &&
            !rawZohoId
          ) {
            rawZohoId = rawGeneric.trim();
          } else if (
            /^\d{10,14}$/.test(rawGeneric.replace(/\D/g, '')) &&
            !rawPhone
          ) {
            rawPhone = rawGeneric.trim();
          } else if (/[a-zA-Z]/.test(rawGeneric) && !rawName) {
            rawName = rawGeneric.trim();
          }
        }

        // If rawPhone accidentally contains an email or alphabetic name
        if (rawPhone.includes('@') && !rawEmail) {
          rawEmail = rawPhone.toLowerCase();
          rawPhone = '';
        } else if (/[a-zA-Z]/.test(rawPhone) && !rawName) {
          rawName = rawPhone;
          rawPhone = '';
        }

        const cleanRawPhone = cleanPhone(rawPhone);
        const normRawName = rawName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();

        // Score each candidate employee based on maximum matched
        // Hierarchy & weights:
        // Corporate Email ID: +10 pts
        // Name: +5 pts (exact) / +3 pts (token containment)
        // Zoho User ID / Employee ID: +4 pts
        // Phone Number: +2 pts
        let bestEmp: any = null;
        let highestScore = 0;
        let bestTieBreaker = 0; // email=1000, name=100, zoho=10, phone=1

        for (const emp of activeEmployees) {
          let score = 0;
          let tieBreaker = 0;

          // 1. Corporate Email Match
          const empEmail = String(emp.email || '')
            .trim()
            .toLowerCase();
          if (rawEmail && empEmail && rawEmail === empEmail) {
            score += 10;
            tieBreaker += 1000;
          }

          // 2. Name Match
          const normEmpName = String(emp.name || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
          if (normRawName && normEmpName) {
            if (normRawName === normEmpName) {
              score += 5;
              tieBreaker += 100;
            } else {
              const rawTokens = normRawName
                .split(' ')
                .filter((t) => t.length > 2);
              const empTokens = normEmpName
                .split(' ')
                .filter((t) => t.length > 2);
              if (
                rawTokens.length > 0 &&
                empTokens.length > 0 &&
                (rawTokens.every((t) => empTokens.includes(t)) ||
                  empTokens.every((t) => rawTokens.includes(t)))
              ) {
                score += 3;
                tieBreaker += 100;
              }
            }
          }

          // 3. Zoho User ID / Employee ID Match
          const empZohoId = String(emp.zoho_user_id || '').trim();
          const empCode = String(emp.employee_id || '').trim();
          if (rawZohoId) {
            if (
              empZohoId &&
              rawZohoId.toLowerCase() === empZohoId.toLowerCase()
            ) {
              score += 4;
              tieBreaker += 10;
            } else if (
              empCode &&
              rawZohoId.toLowerCase() === empCode.toLowerCase()
            ) {
              score += 4;
              tieBreaker += 10;
            }
          }

          // 4. Phone Number Fallback Match
          const empCleanPhone = cleanPhone(emp.phone);
          if (
            cleanRawPhone &&
            empCleanPhone &&
            cleanRawPhone === empCleanPhone
          ) {
            score += 2;
            tieBreaker += 1;
          }

          if (
            score > highestScore ||
            (score === highestScore && score > 0 && tieBreaker > bestTieBreaker)
          ) {
            highestScore = score;
            bestTieBreaker = tieBreaker;
            bestEmp = emp;
          }
        }

        if (bestEmp && highestScore > 0) {
          return String(bestEmp.phone).trim();
        }

        // If phone was provided and has 10 digits
        if (cleanRawPhone) {
          return cleanRawPhone.length === 10
            ? `91${cleanRawPhone}`
            : cleanRawPhone;
        }

        if (defaultSalespersonPhone && cleanPhone(defaultSalespersonPhone)) {
          return defaultSalespersonPhone.trim();
        }

        return 'unassigned';
      };

      const formattedClients = clients
        .map((c) => {
          const assignedPhone = resolveSalesperson(c);

          const cleanPhoneNum =
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
            customer_phone: cleanPhoneNum,
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
