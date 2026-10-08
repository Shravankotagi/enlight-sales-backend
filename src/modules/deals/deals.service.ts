import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { phoneInList } from '../employees/employees.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { ZohoService } from '../zoho/zoho.service';
import {
  getAssignedPhoneFromCustomerMap,
  buildCustomerOwnerMap,
  isValidSalespersonPhone,
} from '../../utils/customerOwnerMap';
import { convertLineItemToMt } from '../pricing/pricing.engine';

function customerNameMatchesAssigned(
  inputName: string,
  assignedList: string[],
): boolean {
  const cleanInput = inputName.trim().toLowerCase();
  if (!cleanInput) return false;
  if (assignedList.some((c) => c.trim().toLowerCase() === cleanInput)) {
    return true;
  }

  const stripSuffixes = (str: string) =>
    str
      .toLowerCase()
      .replace(
        /\b(private\s+limited|pvt\s+ltd|pvt\s+limited|private\s+ltd|co\s+ltd|llp|limited|pvt|ltd|inc|corp)\b/gi,
        '',
      )
      .replace(/[^a-z0-9]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const strippedInput = stripSuffixes(cleanInput);
  if (!strippedInput) return false;

  return assignedList.some((c) => {
    const strippedC = stripSuffixes(c);
    return (
      !!strippedC &&
      (strippedC === strippedInput ||
        strippedInput.startsWith(strippedC) ||
        strippedC.startsWith(strippedInput))
    );
  });
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
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private activityLogsService: ActivityLogsService,
    private zohoService: ZohoService,
  ) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  private cleanPoValue(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const cleaned = String(value).trim();
    return cleaned || null;
  }

  private async allocateSystemPo(
    reservationToken: string,
    dealId?: string | null,
  ): Promise<string> {
    const context = {
      reservationToken: reservationToken
        ? `${reservationToken.slice(0, 24)}${reservationToken.length > 24 ? '…' : ''}`
        : null,
      dealId: dealId || null,
    };
    this.logger.log(
      `[SystemPO] allocate_system_po started ${JSON.stringify(context)}`,
    );

    const { data, error } = await this.supabase.rpc('allocate_system_po', {
      p_reservation_token: reservationToken,
      p_deal_id: dealId || null,
    });

    if (error || !data || !/^EM\/PO\/\d+$/.test(String(data))) {
      this.logger.error(
        `[SystemPO] allocate_system_po failed ${JSON.stringify({
          ...context,
          error: error
            ? {
                message: error.message,
                code: error.code,
                details: error.details,
                hint: error.hint,
              }
            : null,
          returnedData: data ?? null,
        })}`,
      );
      throw new BadRequestException(
        'System PO generation is unavailable. Please try again.',
      );
    }

    this.logger.log(
      `[SystemPO] allocate_system_po succeeded ${JSON.stringify({
        ...context,
        poNumber: String(data),
      })}`,
    );
    return String(data);
  }

  private async checkPoAvailability(
    poNumber: string,
    reservationToken?: string | null,
    dealId?: string | null,
  ): Promise<{ available: boolean; reason?: string; po_number?: string }> {
    const { data, error } = await this.supabase.rpc('check_po_availability', {
      p_po_number: poNumber,
      p_reservation_token: reservationToken || null,
      p_deal_id: dealId || null,
    });

    if (error || !data || typeof data !== 'object') {
      this.logger.error(
        `PO availability check failed: ${error?.message || 'invalid response'}`,
      );
      throw new BadRequestException(
        'PO availability could not be checked. Please try again.',
      );
    }

    return data as { available: boolean; reason?: string; po_number?: string };
  }

  async claimPoNumber(
    poNumber: string,
    reservationToken?: string | null,
    dealId?: string | null,
  ): Promise<void> {
    const { data, error } = await this.supabase.rpc('claim_po_number', {
      p_po_number: poNumber,
      p_reservation_token: reservationToken || null,
      p_deal_id: dealId || null,
    });

    if (error) {
      this.logger.error(`PO claim failed: ${error.message}`);
      throw new BadRequestException(
        'PO number could not be reserved. Please try again.',
      );
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.claimed) {
      throw new ConflictException(
        result?.reason ||
          `PO number "${poNumber}" is already allocated. Please choose another number.`,
      );
    }
  }

  async releasePoReservation(
    reservationToken?: string | null,
    poNumber?: string | null,
    dealId?: string | null,
  ): Promise<{ released: boolean; po_number?: string; reason?: string }> {
    const token = this.cleanPoValue(reservationToken);
    if (!token) {
      return {
        released: false,
        reason: 'Reservation token is required',
      };
    }

    const { data, error } = await this.supabase.rpc('release_po_reservation', {
      p_reservation_token: token,
      p_po_number: this.cleanPoValue(poNumber),
      p_deal_id: dealId || null,
    });

    if (error || !data || typeof data !== 'object') {
      this.logger.error(
        `PO reservation release failed: ${error?.message || 'invalid response'}`,
      );
      throw new BadRequestException(
        'PO reservation could not be released. Please try again.',
      );
    }

    return data as {
      released: boolean;
      po_number?: string;
      reason?: string;
    };
  }

  async resolvePoNumbers(input: {
    requestedPo?: unknown;
    generatedPo?: unknown;
    referencePo?: unknown;
    reservationToken?: string | null;
    existingDeal?: any;
    dealId?: string | null;
  }): Promise<{
    poNumber: string;
    generatedPoNumber: string;
    referencePoNumber: string | null;
    poSource: string;
    reservationToken: string;
    poGeneratedAt: string;
  }> {
    const reservationToken =
      this.cleanPoValue(input.reservationToken) || `order:${randomUUID()}`;
    const existingDealPo = this.cleanPoValue(input.existingDeal?.po_number);
    const existingGeneratedCandidate = this.cleanPoValue(
      input.existingDeal?.generated_po_number,
    );
    const existingGenerated =
      (existingGeneratedCandidate &&
      /^EM\/PO\/\d+$/i.test(existingGeneratedCandidate)
        ? existingGeneratedCandidate
        : null) ||
      (existingDealPo && /^EM\/PO\/\d+$/i.test(existingDealPo)
        ? existingDealPo
        : null);
    let generatedPoNumber = existingGenerated;

    const requestedGenerated = this.cleanPoValue(input.generatedPo);
    if (!generatedPoNumber && requestedGenerated) {
      const generatedAvailability = await this.checkPoAvailability(
        requestedGenerated,
        reservationToken,
        input.dealId || input.existingDeal?.id || null,
      );
      if (
        generatedAvailability.available &&
        /^EM\/PO\/\d+$/.test(requestedGenerated)
      ) {
        generatedPoNumber = requestedGenerated;
      }
    }

    if (!generatedPoNumber) {
      generatedPoNumber = await this.allocateSystemPo(
        reservationToken,
        input.dealId || input.existingDeal?.id || null,
      );
    }

    await this.claimPoNumber(
      generatedPoNumber,
      reservationToken,
      input.dealId || input.existingDeal?.id || null,
    );

    const requestedPoRaw = this.cleanPoValue(input.requestedPo);
    const legacyPo =
      !existingGenerated &&
      existingDealPo &&
      !/^EM\/PO\/\d+$/i.test(existingDealPo)
        ? existingDealPo
        : null;
    const requestedPo =
      requestedPoRaw &&
      (!legacyPo || requestedPoRaw.toLowerCase() !== legacyPo.toLowerCase())
        ? requestedPoRaw
        : null;
    const poNumber = requestedPo || generatedPoNumber;
    const referencePoNumber =
      this.cleanPoValue(input.referencePo) || legacyPo || null;

    const availability = await this.checkPoAvailability(
      poNumber,
      reservationToken,
      input.dealId || input.existingDeal?.id || null,
    );
    if (!availability.available) {
      throw new ConflictException(
        availability.reason ||
          `PO number "${poNumber}" is already allocated. Please choose another number.`,
      );
    }

    return {
      poNumber,
      generatedPoNumber,
      referencePoNumber,
      poSource:
        poNumber.toLowerCase() === generatedPoNumber.toLowerCase()
          ? 'generated'
          : 'user_edit',
      reservationToken,
      poGeneratedAt:
        this.cleanPoValue(input.existingDeal?.po_generated_at) ||
        new Date().toISOString(),
    };
  }

  async allocatePoNumber(reservationToken?: string, dealId?: string) {
    const token =
      this.cleanPoValue(reservationToken) || `draft:${randomUUID()}`;
    const poNumber = await this.allocateSystemPo(token, dealId);
    return {
      po_number: poNumber,
      generated_po_number: poNumber,
      po_reservation_token: token,
    };
  }

  async getPoAvailability(
    poNumber: string,
    reservationToken?: string,
    dealId?: string,
  ) {
    return this.checkPoAvailability(
      poNumber,
      reservationToken || null,
      dealId || null,
    );
  }

  async findAll(filters?: {
    stage?: string;
    salesperson_phone?: string[] | string;
    from?: string;
    to?: string;
  }) {
    try {
      if (
        Array.isArray(filters?.salesperson_phone) &&
        filters.salesperson_phone.length === 0
      ) {
        return [];
      }

      let query = this.supabase
        .from('deals')
        .select(
          `
          id, inquiry_id, stage, po_number, reference_po_number, generated_po_number, po_source, po_status, po_generated_at, po_confirmed_at, po_date, customer_name, customer_phone, customer_gst, customer_address, delivery_location, delivery_date, payment_terms, total_amount, inquiry_type, overall_confidence, status, created_at, bigin_deal_id, lost_reason, salesperson_phone, employee_id, won_at,
          deal_items (*),
          inquiries (source_channel, inquiry_type, raw_text, customer_phone)
        `,
        )
        .order(filters?.stage === 'won' ? 'won_at' : 'created_at', {
          ascending: false,
          nullsFirst: false,
        });

      if (filters?.stage) {
        if (filters.stage === 'new_inquiry') {
          query = query.or(
            'stage.eq.new_inquiry,stage.eq.review,stage.is.null',
          );
        } else {
          query = query.eq('stage', filters.stage);
        }
      }

      // Note: Scoping by salesperson phone is done in Node after resolving customer owner mappings,
      // ensuring deals for assigned customers are never prematurely dropped at DB layer.
      if (filters?.from && filters?.to) {
        // Each date field is tested as a complete [from, to] pair - prevents
        // cross-column mismatches (e.g. created_at >= from AND won_at <= to).
        const fromIso = filters.from.includes('T')
          ? filters.from
          : `${filters.from}T00:00:00.000Z`;
        const toEnd = filters.to.includes('T')
          ? filters.to
          : `${filters.to}T23:59:59.999Z`;
        const fromDateOnly = filters.from.split('T')[0];
        const toDateOnly = filters.to.split('T')[0];
        if (filters?.stage === 'won') {
          query = query.or(
            `and(won_at.gte.${fromIso},won_at.lte.${toEnd}),` +
              `and(po_date.gte.${fromDateOnly},po_date.lte.${toDateOnly}),` +
              `and(won_at.is.null,created_at.gte.${fromIso},created_at.lte.${toEnd})`,
          );
        } else {
          query = query.gte('created_at', fromIso).lte('created_at', toEnd);
        }
      } else if (filters?.from) {
        const fromIso = filters.from.includes('T')
          ? filters.from
          : `${filters.from}T00:00:00.000Z`;
        const fromDateOnly = filters.from.split('T')[0];
        if (filters?.stage === 'won') {
          query = query.or(
            `won_at.gte.${fromIso},po_date.gte.${fromDateOnly},and(won_at.is.null,created_at.gte.${fromIso})`,
          );
        } else {
          query = query.gte('created_at', fromIso);
        }
      } else if (filters?.to) {
        const toEnd = filters.to.includes('T')
          ? filters.to
          : `${filters.to}T23:59:59.999Z`;
        const toDateOnly = filters.to.split('T')[0];
        if (filters?.stage === 'won') {
          query = query.or(
            `won_at.lte.${toEnd},po_date.lte.${toDateOnly},and(won_at.is.null,created_at.lte.${toEnd})`,
          );
        } else {
          query = query.lte('created_at', toEnd);
        }
      }

      const [dealsRes, customersRes, employeesRes] = await Promise.all([
        query,
        this.supabase
          .from('recurring_customers')
          .select('customer_name, assigned_salesperson_phone, updated_at')
          .eq('is_active', true)
          .order('updated_at', { ascending: false }),
        this.supabase.from('employees').select('name, phone'),
      ]);

      if (dealsRes.error) throw dealsRes.error;

      const empPhoneMap = new Map<string, string>();
      employeesRes.data?.forEach((e: any) => {
        if (e.name && e.phone) {
          const clean = String(e.phone).replace(/\D/g, '');
          empPhoneMap.set(clean, e.name);
          empPhoneMap.set(clean.slice(-10), e.name);
        }
      });

      const customerOwnerMap = buildCustomerOwnerMap(
        customersRes.data || [],
        empPhoneMap,
      );

      const lightweightDeals = (dealsRes.data || []).map((d: any) => {
        let computedTotal = Number(d.total_amount) || 0;
        if (
          computedTotal <= 0 &&
          Array.isArray(d.deal_items) &&
          d.deal_items.length > 0
        ) {
          const subtotal = d.deal_items.reduce((s: number, i: any) => {
            const amt =
              Number(i.amount) ||
              (Number(i.quantity) || 0) *
                (Number(i.rate || i.quoted_price || i.price_per_mt) || 0);
            return s + amt;
          }, 0);
          if (subtotal > 0) {
            computedTotal = subtotal + Math.round(subtotal * 0.18);
          }
        }

        const hasMedia = Boolean(d.inquiry_id);
        const assignedOwnerPhone = getAssignedPhoneFromCustomerMap(
          d.customer_name,
          customerOwnerMap,
        );
        const validDirectPhone =
          d.salesperson_phone && isValidSalespersonPhone(d.salesperson_phone)
            ? d.salesperson_phone
            : null;
        const effectiveSalespersonPhone =
          validDirectPhone || assignedOwnerPhone || d.salesperson_phone || '';

        const inqRawText = d.inquiries?.raw_text || d.raw_text || null;
        const resolvedPhone =
          d.customer_phone || d.inquiries?.customer_phone || null;

        return {
          ...d,
          salesperson_phone: effectiveSalespersonPhone,
          raw_salesperson_phone: d.salesperson_phone || null,
          assigned_owner_phone: assignedOwnerPhone || null,
          total_amount: computedTotal > 0 ? computedTotal : null,
          raw_text: inqRawText,
          customer_phone: resolvedPhone,
          has_media: hasMedia,
          media_urls: hasMedia ? ['attached_document'] : [],
        };
      });

      if (filters?.salesperson_phone) {
        const phoneList = Array.isArray(filters.salesperson_phone)
          ? filters.salesperson_phone
          : [filters.salesperson_phone];
        const allowedPhoneSet = new Set(
          phoneList
            .map((p: string) => String(p).replace(/\D/g, '').slice(-10))
            .filter(Boolean),
        );
        return lightweightDeals.filter((d: any) => {
          const directClean = (d.salesperson_phone || '')
            .replace(/\D/g, '')
            .slice(-10);
          const rawDirectClean = (d.raw_salesperson_phone || '')
            .replace(/\D/g, '')
            .slice(-10);
          const assignedClean = (d.assigned_owner_phone || '')
            .replace(/\D/g, '')
            .slice(-10);
          return (
            allowedPhoneSet.has(directClean) ||
            allowedPhoneSet.has(rawDirectClean) ||
            allowedPhoneSet.has(assignedClean)
          );
        });
      }

      return lightweightDeals;
    } catch (error) {
      this.logger.error('Error in findAll:', error);
      throw error;
    }
  }

  async findOne(id: string, accessiblePhones?: string[] | null) {
    try {
      const { data, error } = await this.supabase
        .from('deals')
        .select('*, deal_items(*)')
        .eq('id', id)
        .single();
      if (error || !data) {
        throw new NotFoundException('Deal not found');
      }

      if (accessiblePhones && accessiblePhones.length > 0) {
        if (
          !data.salesperson_phone ||
          !phoneInList(data.salesperson_phone, accessiblePhones)
        ) {
          throw new ForbiddenException(
            'Access Denied: You do not have permission to view this deal.',
          );
        }
      }

      // Enrich with media_urls on-demand for this single deal
      if (data) {
        if (data.inquiry_id) {
          const { data: inq } = await this.supabase
            .from('inquiries')
            .select('media_urls, raw_text')
            .eq('id', data.inquiry_id)
            .limit(1)
            .maybeSingle();
          if (inq) {
            if (Array.isArray(inq.media_urls) && inq.media_urls.length > 0) {
              data.media_urls = inq.media_urls;
            }
            if (inq.raw_text && !data.raw_text) {
              data.raw_text = inq.raw_text;
            }
          }
        }

        const hasValidMedia =
          Array.isArray(data.media_urls) &&
          data.media_urls.length > 0 &&
          data.media_urls.some(
            (u: any) =>
              typeof u === 'string' &&
              (u.startsWith('data:') || u.startsWith('http')),
          );

        if (!hasValidMedia) {
          // If no media on linked inquiry, only match an inquiry that explicitly shares the same PO number and customer
          const dPo = (data.po_number || '').trim();
          const dName = (data.customer_name || '').toLowerCase().trim();
          if (
            dPo &&
            dPo.length >= 4 &&
            !['none', 'null', 'auto', 'pending'].includes(dPo.toLowerCase())
          ) {
            const { data: poInqs } = await this.supabase
              .from('inquiries')
              .select(
                'id, sender_name, customer_name, raw_text, media_urls, po_number',
              )
              .not('media_urls', 'is', null)
              .ilike('po_number', dPo)
              .limit(5);

            const matched = (poInqs || []).find((mi: any) => {
              const miCust = (mi.customer_name || mi.sender_name || '')
                .toLowerCase()
                .trim();
              if (dName && miCust) {
                return dName.includes(miCust) || miCust.includes(dName);
              }
              return false;
            });

            if (
              matched &&
              Array.isArray(matched.media_urls) &&
              matched.media_urls.length > 0
            ) {
              data.media_urls = matched.media_urls;
              if (matched.raw_text && !data.raw_text) {
                data.raw_text = matched.raw_text;
              }
            }
          }
        }
      }

      // Enrich with actual customer phone from recurring_customers
      // (deals.customer_phone stores salesperson phone, not customer phone)
      if (data && data.customer_name) {
        const { data: custData } = await this.supabase
          .from('recurring_customers')
          .select('customer_phone, customer_gst, contact_person')
          .ilike('customer_name', `%${data.customer_name}%`)
          .limit(1)
          .single();
        if (custData) {
          data.customer_phone = custData.customer_phone;
          data.customer_gst = data.customer_gst || custData.customer_gst;
          data.contact_person = custData.contact_person;
        }
      }

      return data;
    } catch (error) {
      this.logger.error(`Error in findOne for id ${id}:`, error);
      throw error;
    }
  }

  async updateStage(
    id: string,
    stage: string,
    lostReason?: string,
    accessiblePhones?: string[] | null,
    poNumber?: string,
    poDate?: string,
    referencePoNumber?: string,
    generatedPoNumber?: string,
    poReservationToken?: string,
  ) {
    try {
      const { data: existingDeal, error: fetchErr } = await this.supabase
        .from('deals')
        .select(
          'id, salesperson_phone, stage, po_number, reference_po_number, generated_po_number, po_generated_at, po_date',
        )
        .eq('id', id)
        .single();
      if (fetchErr || !existingDeal) {
        throw new NotFoundException('Deal not found');
      }

      if (accessiblePhones && accessiblePhones.length > 0) {
        if (
          !existingDeal.salesperson_phone ||
          !phoneInList(existingDeal.salesperson_phone, accessiblePhones)
        ) {
          throw new ForbiddenException(
            'Access Denied: You do not have permission to update this deal.',
          );
        }
      }

      const targetStage = (stage || '').toLowerCase().trim();
      let poResolution: Awaited<
        ReturnType<DealsService['resolvePoNumbers']>
      > | null = null;

      if (targetStage === 'won') {
        poResolution = await this.resolvePoNumbers({
          requestedPo: poNumber,
          generatedPo: generatedPoNumber,
          referencePo: referencePoNumber || existingDeal.reference_po_number,
          reservationToken: poReservationToken,
          existingDeal,
          dealId: id,
        });
        await this.claimPoNumber(
          poResolution.poNumber,
          poResolution.reservationToken,
          id,
        );
      }

      const updateData: any = { stage: targetStage };
      if (targetStage === 'lost' && lostReason) {
        updateData.lost_reason = lostReason;
      }
      if (targetStage === 'won' && poResolution) {
        updateData.won_at = new Date().toISOString();
        updateData.po_number = poResolution.poNumber;
        updateData.reference_po_number = poResolution.referencePoNumber;
        updateData.generated_po_number = poResolution.generatedPoNumber;
        updateData.po_source = poResolution.poSource;
        updateData.po_status = 'confirmed';
        updateData.po_generated_at = poResolution.poGeneratedAt;
        updateData.po_confirmed_at = updateData.won_at;
        if (poDate && poDate.trim()) {
          updateData.po_date = poDate.trim();
        }
      } else {
        updateData.won_at = null;
      }
      const { data, error } = await this.supabase
        .from('deals')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      // Sync linked inquiry status in 1-to-1 manner
      if (data && data.inquiry_id) {
        if (targetStage === 'lost') {
          await this.supabase
            .from('inquiries')
            .update({
              status: 'lost',
              stage: 'lost',
              lost_reason: lostReason || null,
            })
            .eq('id', data.inquiry_id);
        } else if (targetStage === 'won' && poResolution) {
          await this.supabase
            .from('inquiries')
            .update({
              status: 'confirmed',
              stage: 'won',
              po_number: poResolution.poNumber,
              reference_po_number: poResolution.referencePoNumber,
              generated_po_number: poResolution.generatedPoNumber,
              po_source: poResolution.poSource,
              po_status: 'confirmed',
              po_generated_at: poResolution.poGeneratedAt,
              po_confirmed_at: updateData.won_at,
              po_date: poDate || existingDeal.po_date || null,
            })
            .eq('id', data.inquiry_id);
        } else if (targetStage === 'quoted') {
          await this.supabase
            .from('inquiries')
            .update({ status: 'quoted', stage: 'quoted' })
            .eq('id', data.inquiry_id);
        } else if (targetStage === 'negotiation') {
          await this.supabase
            .from('inquiries')
            .update({ status: 'negotiation', stage: 'negotiation' })
            .eq('id', data.inquiry_id);
        } else if (targetStage === 'on_hold') {
          await this.supabase
            .from('inquiries')
            .update({ status: 'on_hold', stage: 'on_hold' })
            .eq('id', data.inquiry_id);
        } else if (targetStage === 'qualified') {
          await this.supabase
            .from('inquiries')
            .update({ status: 'confirmed', stage: 'qualified' })
            .eq('id', data.inquiry_id);
        }
      }

      // When deal is marked WON, ensure total_amount holds the exact Grand Total (Subtotal + 18% GST)
      let effectiveTotal = Number(data?.total_amount) || 0;
      if (targetStage === 'won') {
        if (effectiveTotal <= 0) {
          const { data: items } = await this.supabase
            .from('deal_items')
            .select('*')
            .eq('deal_id', id);
          if (items && items.length > 0) {
            const subtotal = items.reduce((s: number, i: any) => {
              const amt =
                Number(i.amount) ||
                (Number(i.quantity) || 0) *
                  (Number(i.rate || i.quoted_price || i.price_per_mt) || 0);
              return s + amt;
            }, 0);
            if (subtotal > 0) {
              effectiveTotal = subtotal + Math.round(subtotal * 0.18);
              await this.supabase
                .from('deals')
                .update({ total_amount: effectiveTotal })
                .eq('id', id);
              data.total_amount = effectiveTotal;
            }
          }
        }
      }

      // Automatically create or update payment tracking record when a deal is marked WON
      if (targetStage === 'won' && data) {
        const wonDate = data.won_at ? new Date(data.won_at) : new Date();
        const dueDate = new Date(wonDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        const dueDateStr = dueDate.toISOString().split('T')[0];

        // Try to find matching payment record by deal_id first, then by customer_name
        let existingRecord = null;
        const { data: byDeal } = await this.supabase
          .from('payment_tracking')
          .select('id')
          .eq('deal_id', data.id)
          .limit(1);

        if (byDeal && byDeal.length > 0) {
          existingRecord = byDeal[0];
        } else {
          const { data: byCust } = await this.supabase
            .from('payment_tracking')
            .select('id')
            .ilike('customer_name', `%${data.customer_name}%`)
            .limit(1);
          if (byCust && byCust.length > 0) {
            existingRecord = byCust[0];
          }
        }

        if (existingRecord) {
          await this.supabase
            .from('payment_tracking')
            .update({
              total_deal_amount: effectiveTotal || data.total_amount || 0,
              pending_amount: effectiveTotal || data.total_amount || 0,
              due_date: dueDateStr,
              deal_id: data.id,
              salesperson_phone: data.salesperson_phone || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingRecord.id);
        } else {
          await this.supabase.from('payment_tracking').insert({
            deal_id: data.id,
            customer_name: data.customer_name,
            total_deal_amount: effectiveTotal || data.total_amount || 0,
            paid_amount: 0,
            pending_amount: effectiveTotal || data.total_amount || 0,
            status: 'pending',
            due_date: dueDateStr,
            salesperson_phone: data.salesperson_phone || null,
            created_at: new Date().toISOString(),
          });
        }

        // Log to kra_logs for KRA 1 (Sales Achievement)
        try {
          const now = new Date();
          const nowIso = now.toISOString();
          await this.supabase.from('kra_logs').insert({
            kra_number: 1,
            kra_type: 'deal_won',
            description: `Deal Won: ${data.customer_name} (₹${(effectiveTotal || 0).toLocaleString('en-IN')})`,
            salesperson_phone: data.salesperson_phone || null,
            customer_name: data.customer_name,
            value: effectiveTotal || 0,
            month: now.getMonth() + 1,
            year: now.getFullYear(),
            created_at: nowIso,
          });
        } catch (kraErr: any) {
          this.logger.warn('Non-blocking KRA log notice:', kraErr?.message);
        }

        await this.syncCustomerFromOrder(
          data.customer_name,
          data.customer_phone,
          data.won_at || new Date().toISOString(),
          data.salesperson_phone,
          data.customer_gst,
          data.contact_person,
        );
      }

      // Trigger live sync to Zoho Bigin directly
      if (data) {
        this.zohoService
          .syncDealToBigin(data)
          .catch((err) =>
            this.logger.warn(`Bigin live sync notice: ${err?.message}`),
          );
      }

      // Non-blocking activity log
      try {
        const custName = data?.customer_name || 'Customer';
        this.activityLogsService.logActivity({
          salesperson_name: 'Sales Team',
          salesperson_phone: data?.salesperson_phone || null,
          description: `Order for ${custName} updated to ${targetStage}`,
          module: 'Orders',
          customer_name: custName,
        });
      } catch (actErr: any) {
        this.logger.warn('Non-blocking activity log notice:', actErr?.message);
      }

      return data;
    } catch (error) {
      this.logger.error(`Error in updateStage for id ${id}:`, error);
      throw error;
    }
  }

  async getPipelineSummary() {
    try {
      const stages = [
        'new_inquiry',
        'quoted',
        'negotiation',
        'on_hold',
        'won',
        'lost',
      ];

      const { data, error } = await this.supabase
        .from('deals')
        .select('stage, total_amount, id');

      if (error) throw error;

      const summary = stages.map((stage) => {
        const stageDeals = (data || []).filter((d: any) => {
          const st = (d.stage || 'new_inquiry').toLowerCase().trim();
          if (stage === 'new_inquiry') {
            return st === 'new_inquiry' || st === 'review' || !st;
          }
          if (stage === 'quoted') {
            return st === 'quoted' || st === 'qualified';
          }
          if (stage === 'on_hold') {
            return st === 'on_hold' || st === 'hold';
          }
          return st === stage;
        });
        return {
          stage,
          count: stageDeals.length || 0,
          total_value:
            stageDeals.reduce(
              (sum: number, d: any) => sum + (d.total_amount || 0),
              0,
            ) || 0,
        };
      });

      return summary;
    } catch (error) {
      this.logger.error('Error in getPipelineSummary:', error);
      throw error;
    }
  }

  async assertAssignedCustomer(
    customerName: string | undefined,
    phones: string[] | null,
  ) {
    const name = String(customerName || '').trim();
    if (!name || !phones || phones.length === 0) {
      throw new ForbiddenException(
        'You can only create orders for your assigned customers.',
      );
    }

    const orFilter = buildMultiFieldOrFilter(phones, [
      'assigned_salesperson_phone',
    ]);
    if (!orFilter) {
      throw new ForbiddenException(
        'You can only create orders for your assigned customers.',
      );
    }

    const { data, error } = await this.supabase
      .from('recurring_customers')
      .select('customer_name')
      .eq('is_active', true)
      .or(orFilter);

    if (error) {
      this.logger.warn(`Assigned customer check failed: ${error.message}`);
      throw new ForbiddenException(
        'You can only create orders for your assigned customers.',
      );
    }

    const assignedNames = (data || [])
      .map((row: any) => String(row.customer_name || '').trim())
      .filter(Boolean);

    if (!customerNameMatchesAssigned(name, assignedNames)) {
      throw new ForbiddenException(
        'You can only create orders for your assigned customers.',
      );
    }
  }

  async createOrder(data: any, salespersonPhone?: string) {
    try {
      const wonAt = data.won_at || new Date().toISOString();
      const totalAmount = Math.max(0, Number(data.total_amount || 0));
      const poResolution = await this.resolvePoNumbers({
        requestedPo: data.po_number,
        generatedPo: data.generated_po_number,
        referencePo: data.reference_po_number || data.customer_po_number,
        reservationToken: data.po_reservation_token || data.po_draft_token,
      });
      await this.claimPoNumber(
        poResolution.poNumber,
        poResolution.reservationToken,
      );
      const insertPayload: any = {
        customer_name: data.customer_name,
        stage: 'won',
        inquiry_type: 'purchase_order',
        po_number: poResolution.poNumber,
        reference_po_number: poResolution.referencePoNumber,
        generated_po_number: poResolution.generatedPoNumber,
        po_source: poResolution.poSource,
        po_status: 'confirmed',
        po_generated_at: poResolution.poGeneratedAt,
        po_confirmed_at: wonAt,
        po_date: data.po_date || null,
        total_amount: totalAmount,
        won_at: wonAt,
        delivery_location: data.delivery_location || null,
        delivery_date: data.delivery_date || null,
        payment_terms: data.payment_terms || null,
        notes: data.notes || null,
        created_at: new Date().toISOString(),
      };

      if (salespersonPhone) {
        insertPayload.salesperson_phone = salespersonPhone;
      }
      insertPayload.customer_phone = data.customer_phone || null;

      const { data: deal, error: dealError } = await this.supabase
        .from('deals')
        .insert(insertPayload)
        .select()
        .single();

      if (dealError) throw dealError;

      await this.claimPoNumber(
        poResolution.poNumber,
        poResolution.reservationToken,
        deal.id,
      );

      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        const itemRows = data.items
          .map((item: any) => {
            const quantity = Math.max(0, Number(item.quantity || 0));
            const rate = Math.max(0, Number(item.rate || 0));
            const amount = Math.max(
              0,
              Number(
                item.amount !== undefined && item.amount !== null
                  ? item.amount
                  : quantity * rate,
              ),
            );
            const converted = convertLineItemToMt(item);
            const weightMt =
              item.weight_mt !== undefined &&
              item.weight_mt !== null &&
              !isNaN(Number(item.weight_mt))
                ? Number(item.weight_mt)
                : converted.canConvert && converted.mt !== null
                  ? converted.mt
                  : null;
            const unitWeightKg =
              item.unit_weight_kg !== undefined &&
              item.unit_weight_kg !== null &&
              !isNaN(Number(item.unit_weight_kg))
                ? Number(item.unit_weight_kg)
                : quantity > 0 && weightMt !== null
                  ? Math.round(((weightMt * 1000) / quantity) * 100) / 100
                  : null;

            return {
              deal_id: deal.id,
              sku_text: item.sku_text,
              dimensions: item.dimensions || null,
              quantity,
              unit: item.unit || 'MT',
              rate,
              amount,
              weight_mt: weightMt,
              unit_weight_kg: unitWeightKg,
              created_at: new Date().toISOString(),
            };
          })
          .filter((row: any) => row.sku_text && row.quantity > 0);

        const { error: itemsError } = await this.supabase
          .from('deal_items')
          .insert(itemRows);

        if (itemsError) {
          this.logger.error('Error inserting deal items:', itemsError);
        }
      }

      if (deal) {
        await this.syncCustomerFromOrder(
          deal.customer_name,
          deal.customer_phone,
          deal.created_at,
          deal.salesperson_phone,
          deal.customer_gst,
          deal.contact_person,
        );

        // Trigger live Zoho Bigin deal sync
        this.zohoService
          .syncDealToBigin(deal)
          .catch((err) =>
            this.logger.warn(`Bigin live sync notice: ${err?.message}`),
          );

        // Non-blocking activity log
        try {
          const cust = deal.customer_name || 'Customer';
          const poStr = deal.po_number ? ` (PO: ${deal.po_number})` : '';
          this.activityLogsService.logActivity({
            salesperson_name: 'Sales Team',
            salesperson_phone: deal.salesperson_phone || null,
            description: `New order created for ${cust}${poStr}`,
            module: 'Orders',
            customer_name: cust,
          });
        } catch (actErr: any) {
          this.logger.warn(
            'Non-blocking activity log notice:',
            actErr?.message,
          );
        }
      }

      return deal;
    } catch (error) {
      this.logger.error('Error in createOrder:', error);
      throw error;
    }
  }

  async getKanbanBoard() {
    try {
      const { data, error } = await this.supabase
        .from('deals')
        .select('*, deal_items(*)')
        .not('stage', 'in', '("won","lost")')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const stages = ['new_inquiry', 'quoted', 'negotiation', 'on_hold'];

      const board = stages.reduce(
        (acc, stage) => {
          acc[stage] =
            data?.filter((d) => {
              const st = (d.stage || 'new_inquiry').toLowerCase().trim();
              if (stage === 'new_inquiry') {
                return st === 'new_inquiry' || st === 'review' || !st;
              }
              if (stage === 'quoted') {
                return st === 'quoted' || st === 'qualified';
              }
              if (stage === 'on_hold') {
                return st === 'on_hold' || st === 'hold';
              }
              return st === stage;
            }) || [];
          return acc;
        },
        {} as Record<string, any[]>,
      );

      return board;
    } catch (error) {
      this.logger.error('Error in getKanbanBoard:', error);
      throw error;
    }
  }

  async processPo(data: any, salespersonPhone?: string) {
    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const poDate = data.po_date || nowIso.split('T')[0];
      let poNumber = '';
      let generatedPoNumber = '';
      let referencePoNumber: string | null = null;
      let poSource = 'generated';
      let poGeneratedAt = nowIso;
      const poReservationToken =
        this.cleanPoValue(data.po_reservation_token || data.po_draft_token) ||
        `order:${randomUUID()}`;

      const customerName = data.customer_name?.trim() || null;
      const customerPhone = data.customer_phone || null;
      const phone =
        salespersonPhone || data.salesperson_phone || '910000000000';

      const lineItems = data.line_items || data.items || [];
      let totalAmount = Number(data.total_amount) || 0;
      if (
        totalAmount <= 0 &&
        Array.isArray(lineItems) &&
        lineItems.length > 0
      ) {
        totalAmount = lineItems.reduce(
          (sum: number, item: any) =>
            sum +
            (Number(item.amount) ||
              Math.round(Number(item.quantity || 0) * Number(item.rate || 0))),
          0,
        );
      }

      const deliveryLocation = data.delivery_location || '';
      const paymentTerms = data.payment_terms || '';

      // 1. Search for existing deal to update and mark WON
      let dealId = data.deal_id || null;
      let existingDeal: any = null;
      let inquiryId = data.inquiry_id || null;

      if (dealId) {
        const { data: d } = await this.supabase
          .from('deals')
          .select('*')
          .eq('id', dealId)
          .single();
        if (d) {
          existingDeal = d;
          if (!inquiryId && d.inquiry_id) inquiryId = d.inquiry_id;
        }
      } else if (inquiryId) {
        const { data: d } = await this.supabase
          .from('deals')
          .select('*')
          .eq('inquiry_id', inquiryId)
          .limit(1);
        if (d && d.length > 0) {
          existingDeal = d[0];
          dealId = existingDeal.id;
        }
      }

      // Auto-link to matching inquiry and deal for this customer based on Company Name + Products
      if (!existingDeal && customerName) {
        const cleanCustomer = customerName.trim();

        // 1. Fetch candidate deals with line items for this customer
        const { data: candidateDeals } = await this.supabase
          .from('deals')
          .select('*, deal_items(*)')
          .ilike('customer_name', cleanCustomer)
          .not('stage', 'in', '("won","lost")')
          .order('created_at', { ascending: false });

        // 2. Fetch candidate inquiries from inquiries table for this customer
        const { data: candidateInquiries } = await this.supabase
          .from('inquiries')
          .select('*')
          .or(
            `sender_name.ilike.${cleanCustomer},customer_name.ilike.${cleanCustomer}`,
          )
          .not('status', 'in', '("won","lost")')
          .order('created_at', { ascending: false });

        // Extract products from the incoming PO line items
        const orderProductTokens = lineItems
          .map((item: any) => {
            const raw = String(
              item.sku_text || item.product_name || item.description || '',
            ).toLowerCase();
            return raw.replace(/[^a-z0-9]/g, ' ').trim();
          })
          .filter(Boolean);

        let bestDeal: any = null;
        let bestScore = -1;
        let bestInquiryId: string | null = null;

        // Score candidate deals based on product overlap, stage, and recency
        if (candidateDeals && candidateDeals.length > 0) {
          for (const deal of candidateDeals) {
            let score = 0;
            const dealStage = (deal.stage || '').toLowerCase().trim();
            if (dealStage === 'negotiation') score += 20;
            else if (dealStage === 'quoted' || dealStage === 'qualified')
              score += 15;
            else if (dealStage === 'new_inquiry' || dealStage === 'review')
              score += 5;

            const dItems = Array.isArray(deal.deal_items)
              ? deal.deal_items
              : [];
            const dealProductTokens = dItems
              .map((di: any) => {
                const raw = String(
                  di.sku_text || di.description || '',
                ).toLowerCase();
                return raw.replace(/[^a-z0-9]/g, ' ').trim();
              })
              .filter(Boolean);

            // Check product overlaps
            let matchedProductsCount = 0;
            for (const oToken of orderProductTokens) {
              const hasMatch = dealProductTokens.some((dToken: string) => {
                return (
                  (oToken.length >= 3 && dToken.includes(oToken)) ||
                  (dToken.length >= 3 && oToken.includes(dToken)) ||
                  oToken
                    .split(' ')
                    .some((word) => word.length >= 4 && dToken.includes(word))
                );
              });
              if (hasMatch) matchedProductsCount++;
            }

            if (matchedProductsCount > 0) {
              score += matchedProductsCount * 25;
            }

            if (score > bestScore) {
              bestScore = score;
              bestDeal = deal;
              bestInquiryId = deal.inquiry_id || null;
            }
          }
        }

        // If no deal matched with products but inquiries exist with product relevance
        if (
          (!bestDeal || bestScore < 20) &&
          candidateInquiries &&
          candidateInquiries.length > 0
        ) {
          for (const inq of candidateInquiries) {
            let inqScore = 0;
            const inqStatus = (inq.status || '').toLowerCase().trim();
            if (inqStatus === 'negotiation') inqScore += 20;
            else if (inqStatus === 'quoted' || inqStatus === 'confirmed')
              inqScore += 15;
            else inqScore += 5;

            const aiJson = (inq.ai_extraction_json as any) || {};
            const inqItems = Array.isArray(aiJson.line_items)
              ? aiJson.line_items
              : Array.isArray(aiJson.lineItems)
                ? aiJson.lineItems
                : [];
            const inqTokens = inqItems
              .map((it: any) =>
                String(it.sku_text || it.description || '').toLowerCase(),
              )
              .filter(Boolean);
            const inqRawText = String(inq.raw_text || '').toLowerCase();

            let matchedCount = 0;
            for (const oToken of orderProductTokens) {
              const hasItemMatch = inqTokens.some(
                (iToken: string) =>
                  iToken.includes(oToken) || oToken.includes(iToken),
              );
              const hasTextMatch =
                oToken.length >= 3 && inqRawText.includes(oToken);
              if (hasItemMatch || hasTextMatch) matchedCount++;
            }

            if (matchedCount > 0) {
              inqScore += matchedCount * 25;
            }

            if (inqScore > bestScore) {
              bestScore = inqScore;
              bestInquiryId = inq.id;
              const matchingDealForInq = (candidateDeals || []).find(
                (d) => d.inquiry_id === inq.id,
              );
              if (matchingDealForInq) {
                bestDeal = matchingDealForInq;
              }
            }
          }
        }

        if (bestDeal) {
          existingDeal = bestDeal;
          dealId = bestDeal.id;
          if (!inquiryId && bestDeal.inquiry_id) {
            inquiryId = bestDeal.inquiry_id;
          }
        }
        if (!inquiryId && bestInquiryId) {
          inquiryId = bestInquiryId;
        }
      }

      // 2. Resolve inquiry ID from deal or payload
      if (!inquiryId && existingDeal?.inquiry_id) {
        inquiryId = existingDeal.inquiry_id;
      }

      const poResolution = await this.resolvePoNumbers({
        requestedPo: data.po_number,
        generatedPo: data.generated_po_number,
        referencePo: data.reference_po_number || data.customer_po_number,
        reservationToken: poReservationToken,
        existingDeal,
        dealId,
      });
      poNumber = poResolution.poNumber;
      generatedPoNumber = poResolution.generatedPoNumber;
      referencePoNumber = poResolution.referencePoNumber;
      poSource = poResolution.poSource;
      poGeneratedAt = poResolution.poGeneratedAt;

      await this.claimPoNumber(poNumber, poReservationToken, dealId);

      const targetSourceChannel = data.source_channel || 'web_dashboard';

      if (inquiryId) {
        const inqUpdates: any = {
          status: 'confirmed',
          stage: 'won',
          won_at: nowIso,
          po_number: poNumber,
          reference_po_number: referencePoNumber,
          generated_po_number: generatedPoNumber,
          po_source: poSource,
          po_status: 'confirmed',
          po_generated_at: poGeneratedAt,
          po_confirmed_at: nowIso,
          po_date: poDate,
          total_amount: totalAmount,
        };
        if (Array.isArray(data.media_urls) && data.media_urls.length > 0) {
          inqUpdates.media_urls = data.media_urls;
        }
        await this.supabase
          .from('inquiries')
          .update(inqUpdates)
          .eq('id', inquiryId);
      } else if (Array.isArray(data.media_urls) && data.media_urls.length > 0) {
        try {
          const { data: newInq } = await this.supabase
            .from('inquiries')
            .insert({
              source_channel: targetSourceChannel,
              raw_text: `[PO Document Attached: ${poNumber}] ${customerName || 'Customer'} - Original PO Document`,
              media_urls: data.media_urls,
              sender_name: customerName,
              sender_phone: customerPhone,
              salesperson_phone: phone,
              status: 'confirmed',
              inquiry_type: 'inquiry',
              po_number: poNumber,
              reference_po_number: referencePoNumber,
              generated_po_number: generatedPoNumber,
              po_source: poSource,
              po_status: 'confirmed',
              po_generated_at: poGeneratedAt,
              po_confirmed_at: nowIso,
              po_date: poDate,
              created_at: nowIso,
            })
            .select()
            .single();
          if (newInq) {
            inquiryId = newInq.id;
          }
        } catch (inqErr: any) {
          this.logger.warn(
            'Non-blocking inquiry media save notice:',
            inqErr?.message,
          );
        }
      }

      let savedDeal: any;

      if (existingDeal) {
        // Update existing deal with new negotiated PO figures & mark WON
        const { data: updated, error: updErr } = await this.supabase
          .from('deals')
          .update({
            inquiry_id: inquiryId || existingDeal.inquiry_id,
            stage: 'won',
            won_at: nowIso,
            po_number: poNumber,
            reference_po_number: referencePoNumber,
            generated_po_number: generatedPoNumber,
            po_source: poSource,
            po_status: 'confirmed',
            po_generated_at: poGeneratedAt,
            po_confirmed_at: nowIso,
            po_date: poDate,
            total_amount: totalAmount,
            delivery_location:
              deliveryLocation || existingDeal.delivery_location,
            payment_terms: paymentTerms || existingDeal.payment_terms,
            inquiry_type: 'purchase_order',
            status: 'auto_created',
          })
          .eq('id', dealId)
          .select()
          .single();

        if (updErr) throw updErr;
        savedDeal = updated;
      } else {
        // Create brand new Won Deal
        const { data: created, error: createErr } = await this.supabase
          .from('deals')
          .insert({
            inquiry_id: inquiryId || null,
            customer_name: customerName,
            salesperson_phone: phone,
            customer_phone: customerPhone,
            stage: 'won',
            won_at: nowIso,
            po_number: poNumber,
            reference_po_number: referencePoNumber,
            generated_po_number: generatedPoNumber,
            po_source: poSource,
            po_status: 'confirmed',
            po_generated_at: poGeneratedAt,
            po_confirmed_at: nowIso,
            po_date: poDate,
            total_amount: totalAmount,
            delivery_location: deliveryLocation,
            payment_terms: paymentTerms,
            inquiry_type: 'purchase_order',
            status: 'auto_created',
            overall_confidence: Number(data.overall_confidence) || 0.98,
            created_at: nowIso,
          })
          .select()
          .single();

        if (createErr) throw createErr;
        savedDeal = created;
        dealId = savedDeal.id;
      }

      await this.claimPoNumber(poNumber, poReservationToken, dealId);

      // 2. Replace / Update line items with exact PO values
      if (Array.isArray(lineItems) && lineItems.length > 0) {
        await this.supabase.from('deal_items').delete().eq('deal_id', dealId);

        const dealItemsToInsert = lineItems.map((item: any) => {
          const qty = Number(item.quantity) || null;
          const converted = convertLineItemToMt(item);
          const weightMt =
            item.weight_mt !== undefined &&
            item.weight_mt !== null &&
            !isNaN(Number(item.weight_mt))
              ? Number(item.weight_mt)
              : converted.canConvert && converted.mt !== null
                ? converted.mt
                : null;
          const unitWeightKg =
            item.unit_weight_kg !== undefined &&
            item.unit_weight_kg !== null &&
            !isNaN(Number(item.unit_weight_kg))
              ? Number(item.unit_weight_kg)
              : qty && weightMt !== null
                ? Math.round(((weightMt * 1000) / qty) * 100) / 100
                : null;

          return {
            deal_id: dealId,
            sku_text:
              item.sku_text || item.product_name || item.description || null,
            dimensions: item.dimensions || null,
            quantity: qty,
            unit: item.unit || 'MT',
            rate: Number(item.rate) || null,
            amount:
              Number(item.amount) ||
              (Number(item.quantity) && Number(item.rate)
                ? Number(item.quantity) * Number(item.rate)
                : null),
            weight_mt: weightMt,
            unit_weight_kg: unitWeightKg,
            confidence: Number(item.confidence) || 0.98,
            created_at: nowIso,
          };
        });

        await this.supabase.from('deal_items').insert(dealItemsToInsert);
      }

      // 3. If linked to an inquiry, update the inquiry status & stage
      if (savedDeal.inquiry_id) {
        await this.supabase
          .from('inquiries')
          .update({
            status: 'confirmed',
            stage: 'won',
            won_at: nowIso,
            po_number: poNumber,
            reference_po_number: referencePoNumber,
            generated_po_number: generatedPoNumber,
            po_source: poSource,
            po_status: 'confirmed',
            po_generated_at: poGeneratedAt,
            po_confirmed_at: nowIso,
            po_date: poDate,
            total_amount: totalAmount,
          })
          .eq('id', savedDeal.inquiry_id);
      }

      // 4. Automatically create / update Payment Tracking record
      try {
        let creditDays = 30;
        const termsStr = String(paymentTerms).toLowerCase();
        const daysMatch = termsStr.match(/(\d+)\s*(?:days|day)/);
        if (daysMatch) {
          creditDays = parseInt(daysMatch[1], 10);
        } else if (
          termsStr.includes('advance') ||
          termsStr.includes('immediate') ||
          termsStr.includes('cash')
        ) {
          creditDays = 0;
        }

        const poDateTime = new Date(poDate).getTime() || now.getTime();
        const dueDate = new Date(poDateTime + creditDays * 24 * 60 * 60 * 1000);
        const dueDateStr = dueDate.toISOString().split('T')[0];

        const { data: existingPay } = await this.supabase
          .from('payment_tracking')
          .select('id')
          .eq('deal_id', dealId)
          .limit(1);

        if (existingPay && existingPay.length > 0) {
          await this.supabase
            .from('payment_tracking')
            .update({
              invoice_amount: totalAmount,
              outstanding: totalAmount,
              due_date: dueDateStr,
              credit_period_days: creditDays,
              customer_name: customerName,
              salesperson_phone: phone,
              updated_at: nowIso,
            })
            .eq('id', existingPay[0].id);
        } else {
          await this.supabase.from('payment_tracking').insert({
            deal_id: dealId,
            salesperson_phone: phone,
            customer_name: customerName,
            invoice_amount: totalAmount,
            outstanding: totalAmount,
            status: 'pending',
            due_date: dueDateStr,
            credit_period_days: creditDays,
            created_at: nowIso,
          });
        }
      } catch (payErr: any) {
        this.logger.warn(
          'Non-blocking payment tracking notice:',
          payErr?.message,
        );
      }

      // 5. Log to kra_logs for KRA 1 (Final Sales Achievement with exact PO Value)
      try {
        await this.supabase.from('kra_logs').insert({
          kra_number: 1,
          kra_type: 'order_created',
          description: `PO Received: ${poNumber} - ${customerName} (₹${totalAmount.toLocaleString('en-IN')}) - Deal Won `,
          salesperson_phone: phone,
          customer_name: customerName,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          created_at: nowIso,
        });
      } catch (kraErr: any) {
        this.logger.warn('Non-blocking KRA log notice:', kraErr?.message);
      }

      // 6. Automatically resolve any open follow-up tasks for this customer & update last_order_date
      try {
        await this.supabase
          .from('followup_tasks')
          .update({
            status: 'resolved',
            resolved_at: nowIso,
            resolution_notes: `Order placed: PO #${poNumber} (₹${totalAmount.toLocaleString('en-IN')}) `,
          })
          .ilike('customer_name', `%${customerName}%`)
          .eq('status', 'pending');

        await this.syncCustomerFromOrder(
          customerName,
          customerPhone,
          poDate || nowIso,
          phone,
          null,
          null,
        );
      } catch (fErr: any) {
        this.logger.warn(
          'Non-blocking follow-up resolution notice:',
          fErr?.message,
        );
      }

      // Trigger live Zoho Bigin deal sync
      if (savedDeal) {
        this.zohoService
          .syncDealToBigin(savedDeal)
          .catch((err) =>
            this.logger.warn(`Bigin live sync notice: ${err?.message}`),
          );
      }

      // Non-blocking activity log
      try {
        const poStr = poNumber ? ` (PO: ${poNumber})` : '';
        this.activityLogsService.logActivity({
          salesperson_name: 'Sales Team',
          salesperson_phone: phone || null,
          description: `New order created for ${customerName}${poStr}`,
          module: 'Orders',
          customer_name: customerName,
        });
      } catch (actErr: any) {
        this.logger.warn('Non-blocking activity log notice:', actErr?.message);
      }

      return savedDeal;
    } catch (error) {
      this.logger.error('Error in processPo:', error);
      throw error;
    }
  }

  async deleteDeal(id: string, accessiblePhones?: string[] | null) {
    try {
      this.logger.log(`Deleting deal ${id} and all associated records...`);

      // 1. Fetch deal to inspect details and check access
      const { data: deal, error: fetchErr } = await this.supabase
        .from('deals')
        .select('id, inquiry_id, po_number, customer_name, salesperson_phone')
        .eq('id', id)
        .single();
      if (fetchErr || !deal) {
        throw new NotFoundException('Deal not found');
      }

      if (accessiblePhones && accessiblePhones.length > 0) {
        if (
          !deal.salesperson_phone ||
          !phoneInList(deal.salesperson_phone, accessiblePhones)
        ) {
          throw new ForbiddenException(
            'Access Denied: You do not have permission to delete this deal.',
          );
        }
      }

      // 2. Delete deal_items
      await this.supabase.from('deal_items').delete().eq('deal_id', id);

      // 3. Delete payment_tracking records for this deal
      await this.supabase.from('payment_tracking').delete().eq('deal_id', id);

      // 4. Delete followup_tasks for this deal if any
      try {
        await this.supabase.from('followup_tasks').delete().eq('deal_id', id);
      } catch (err: any) {
        this.logger.warn(
          `Non-blocking followup_tasks cleanup: ${err?.message}`,
        );
      }

      // 5. Delete corresponding kra_logs if PO/deal specific
      if (deal?.po_number) {
        try {
          await this.supabase
            .from('kra_logs')
            .delete()
            .ilike('description', `%${deal.po_number}%`);
        } catch (err: any) {
          this.logger.warn(`Non-blocking kra_logs cleanup: ${err?.message}`);
        }
      }

      // 6. Delete the deal itself
      const { error } = await this.supabase.from('deals').delete().eq('id', id);

      if (error) throw error;

      this.logger.log(`Deal ${id} successfully deleted.`);
      return { success: true, message: 'Deal deleted successfully', id };
    } catch (error) {
      this.logger.error(`Error deleting deal ${id}:`, error);
      throw error;
    }
  }

  private async syncCustomerFromOrder(
    customerName?: string | null,
    customerPhone?: string | null,
    orderDate?: string | null,
    salespersonPhone?: string | null,
    customerGst?: string | null,
    contactPerson?: string | null,
  ) {
    if (!customerName || !customerName.trim()) return;
    const cleanName = customerName.trim();
    const orderDateIso = orderDate || new Date().toISOString();

    try {
      const { data: existing } = await this.supabase
        .from('recurring_customers')
        .select('id, last_order_date')
        .ilike('customer_name', cleanName)
        .limit(1);

      if (existing && existing.length > 0) {
        const cust = existing[0];
        const newDate = new Date(orderDateIso);
        const oldDate = cust.last_order_date
          ? new Date(cust.last_order_date)
          : null;

        if (!oldDate || newDate >= oldDate) {
          await this.supabase
            .from('recurring_customers')
            .update({
              last_order_date: orderDateIso,
              ...(customerPhone ? { customer_phone: customerPhone } : {}),
              ...(customerGst ? { customer_gst: customerGst } : {}),
              ...(contactPerson ? { contact_person: contactPerson } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq('id', cust.id);
        }
      } else {
        await this.supabase.from('recurring_customers').insert({
          customer_name: cleanName,
          customer_phone: customerPhone || null,
          customer_gst: customerGst || null,
          contact_person: contactPerson || null,
          last_order_date: orderDateIso,
          avg_order_frequency_days: 30,
          is_active: true,
          assigned_salesperson_phone: salespersonPhone || null,
          created_at: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      this.logger.error(
        `Failed to sync customer '${cleanName}' from order: ${err?.message}`,
      );
    }
  }
}
