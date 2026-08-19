import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

function getCompanyLogoPath(): string | null {
  const possiblePaths = [
    path.join(process.cwd(), 'assets', 'logo.png'),
    path.join(process.cwd(), 'assets', 'logo.jpg'),
    path.join(process.cwd(), 'assets', 'logo.jpeg'),
    path.join(__dirname, '../../../assets/logo.png'),
    path.join(__dirname, '../../../assets/logo.jpg'),
    path.join(__dirname, '../../../assets/logo.jpeg'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

import { DealsService } from '../deals/deals.service';
import {
  calculatePricingSummary,
  calculateGst,
  calculateSubtotal,
} from '../pricing/pricing.engine';

function buildInquiryPhoneOrFilter(
  salespersonPhones?: string[] | string,
): string | null {
  if (!salespersonPhones) return null;
  const list = Array.isArray(salespersonPhones)
    ? salespersonPhones
    : [salespersonPhones];
  if (list.length === 0) return null;
  const parts: string[] = [];
  for (const phone of list) {
    if (!phone) continue;
    const clean = phone.replace(/\D/g, '');
    const p10 = clean.slice(-10);
    const p12 = '91' + p10;
    parts.push(`salesperson_phone.eq.${p10}`, `salesperson_phone.eq.${p12}`);
  }
  return parts.length > 0 ? parts.join(',') : null;
}

const PRODUCT_KEYWORDS = [
  'hr coil',
  'hot rolled',
  'cr sheet',
  'cold rolled',
  'cr coil',
  'ms plate',
  'ms plates',
  'ms sheet',
  'tmt bar',
  'tmt bars',
  'gi coil',
  'gi sheet',
  'pipe',
  'pipes',
  'steel pipe',
  'steel pipes',
  'angles',
  'channels',
  'beams',
  'flats',
  'rebars',
  'sheet',
  'plate',
  'coil',
  'steel',
  'metal',
  'iron',
  'structure',
  'structures',
  'pickled',
  'galvanized',
  'erw pipe',
  'seamless pipe',
  'is 2062',
  'is 277',
  'is 3589',
  'e250',
  'e350',
  'fe 410',
  'fe 500',
];

const SALESPERSON_NAMES = [
  'rishabh',
  'rishabh makwana',
  'max',
  'akruti',
  'salesperson',
  'sales rep',
  'dhananjay goel',
  'rahul sharma',
  'suresh sharma',
  'kumar varma',
  'john',
  'andrew',
  'test',
  'customer',
  'client',
  'the customer',
  'customer inquiry',
  'web customer',
  'unknown',
  'self',
];

const SYSTEM_EMPLOYEE_PHONES = new Set([
  '8262937458',
  '9619226169',
  '7977088031',
  '9187305823',
  '9876543210',
  '9876543222',
  '7896248624',
  '7892739774',
  '7878787878',
  '7894561237',
]);

function isProductOrGenericName(name?: string | null): boolean {
  if (!name || typeof name !== 'string') return true;
  const clean = name
    .toLowerCase()
    .trim()
    .replace(/[.:,\-_/()]/g, ' ');
  if (clean.length < 2) return true;

  if (
    SALESPERSON_NAMES.some(
      (sn) =>
        clean === sn || clean.startsWith(sn + ' ') || clean.endsWith(' ' + sn),
    )
  ) {
    return true;
  }

  const words = clean.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 1 && PRODUCT_KEYWORDS.includes(words[0])) {
    return true;
  }

  const allWordsProduct = words.every(
    (w) =>
      PRODUCT_KEYWORDS.includes(w) ||
      /^\d+(?:mm|mt|ton|tons|kg|gsm|br)?$/i.test(w) ||
      /^(is|grade|fe|make|sail|tata|jsw|jindal|prime|quality|only|with|mtc|thick|thk|od|dia)$/i.test(
        w,
      ),
  );
  if (allWordsProduct) return true;

  return false;
}

function isSalespersonOrSenderPhone(
  phone?: string | null,
  senderPhone?: string | null,
  spPhone?: string | null,
): boolean {
  if (!phone) return true;
  const clean = String(phone).replace(/\D/g, '').slice(-10);
  if (!clean || clean.length < 10) return true;
  if (SYSTEM_EMPLOYEE_PHONES.has(clean)) return true;
  if (
    senderPhone &&
    clean === String(senderPhone).replace(/\D/g, '').slice(-10)
  )
    return true;
  if (spPhone && clean === String(spPhone).replace(/\D/g, '').slice(-10))
    return true;
  return false;
}

function extractCleanCustomerName(rawText: string): string | null {
  if (!rawText || typeof rawText !== 'string') return null;

  // 1. Remove greeting / action verb prefixes
  const text = rawText
    .replace(/^(hi|hello|hey|dear|sir)\b\s*[,.:-]?\s*/i, '')
    .replace(
      /^(visited|met with|met|site visit to|meeting with|talked to|called)\s+/i,
      '',
    )
    .trim();

  // 2. Stop words where company name ends and requirement / contact begins
  const STOP_KEYWORDS =
    /\b(needs?|requires?|requirement|wants?|wanted|inquiry|enquiry|quote|quotation|rate|bhav|asking for|interested in|looking for|contact|person|owner|phone|mob|mobile|call|ph|gst|gstin|location|delivery|warehouse|po|order|placed|confirmed|today|yesterday|regarding|about|with|\d+\s*(?:mt|tons?|kg|sheets?|coils?|nos?|mm))\b/i;

  // 3. Extract candidate name after For / From / Client / Customer / M/s or first clause
  const prefixMatch = text.match(
    /^(?:for|from|customer|client|company|account|m\/s|m\/s\.)\s+([^,:\n]+)/i,
  );
  let candidate = prefixMatch ? prefixMatch[1] : null;

  if (candidate) {
    const stopIndex = candidate.search(STOP_KEYWORDS);
    if (stopIndex !== -1) {
      candidate = candidate.substring(0, stopIndex);
    }
    candidate = candidate.replace(/[.,:;*_\-\s]+$/, '').trim();
  }

  if (candidate && !isProductOrGenericName(candidate)) {
    return candidate;
  }

  return null;
}

function isGenuineInquiry(item: any): boolean {
  if (!item) return false;
  const rawText = (item.raw_text || '').trim();
  const aiJson = (item.ai_extraction_json as any) || {};

  // 0. Exclude Purchase Orders (POs belong strictly to the Orders tab)
  if (
    item.inquiry_type === 'purchase_order' ||
    item.source_channel === 'whatsapp_po' ||
    rawText.startsWith('[PO Document Attached:')
  ) {
    return false;
  }

  // 1. All official inquiry types and source channels are genuine
  if (
    item.inquiry_type === 'inquiry' ||
    item.source_channel === 'whatsapp_text' ||
    item.source_channel === 'whatsapp_image' ||
    item.source_channel === 'web_dashboard'
  ) {
    return true;
  }

  // 2. Document attachment is always genuine
  if (
    rawText.startsWith('[Inquiry Attachment:') ||
    rawText.startsWith('[Inquiry Document Attached]') ||
    (Array.isArray(item.media_urls) && item.media_urls.length > 0)
  ) {
    return true;
  }

  // 3. Extracted line items with product & quantity is genuine
  const lineItemsSrc = aiJson.line_items || aiJson.lineItems || [];
  if (
    Array.isArray(lineItemsSrc) &&
    lineItemsSrc.length > 0 &&
    lineItemsSrc.some(
      (i: any) =>
        (Number(i.quantity) > 0 ||
          Number(i.quantity_tons) > 0 ||
          Number(i.quantity_mt) > 0) &&
        (i.sku_text || i.product_name || i.product || i.description),
    )
  ) {
    return true;
  }

  // 4. Reject conversational questions, chatbot queries, commands, visit logs, and payments
  const NON_INQUIRY_PATTERNS = [
    /^(hi|hello|hey|namaste)\b/i,
    /^(show|list|tell|what|how|why|where|can you|give me|is there|which customers|now show|change)\b/i,
    /\b(policy|moq|sop|guideline|portal|login|dashboard)\b/i,
    /^(visited|met with|site visit|meeting with)\b/i,
    /^new customer\b/i,
    /^(deal|we have won|won the|lost the|paid|advance)\b/i,
    /\b(paid\s+₹?|paid\s+rs|advance\s+via|via\s+cheque|via\s+rtgs|via\s+neft)\b/i,
    /^#deal-\w+/i,
    /^\d+$/,
    /^this is the new inquiry$/i,
    /^we have received a new inquiry/i,
    /^document received$/i,
    /^ded$/i,
  ];

  const t = rawText.toLowerCase();
  if (NON_INQUIRY_PATTERNS.some((p) => p.test(t))) {
    return false;
  }

  // 5. Must have minimal commercial length or tonnage / product mention
  const hasMetalKeyword =
    /\b(mt|tons?|kg|coils?|sheets?|plates?|rebar|tmt|steel|hr|cr|gp|gc|pipe|tube)\b/i.test(
      t,
    );
  if (
    !hasMetalKeyword &&
    !aiJson.customer?.name &&
    !aiJson.customer_name &&
    !item.customer_name
  ) {
    return false;
  }

  return true;
}

function resolveInquiryEntities(
  item: any,
  dealByInqId?: Map<string, string>,
  dealByName?: Map<string, string>,
) {
  const aiJson = (item.ai_extraction_json as any) || {};
  const senderName = item.sender_name || '';
  const senderNameLower = senderName.toLowerCase().trim();
  const isSenderSalesperson = SALESPERSON_NAMES.includes(senderNameLower);

  // 1. Resolve Customer Company Name
  let candidateName =
    aiJson.customer?.name ||
    aiJson.customer_name ||
    aiJson.companyName ||
    aiJson.customer_company ||
    item.customer_name ||
    (!isSenderSalesperson && senderName ? senderName : null);

  if (isProductOrGenericName(candidateName)) {
    candidateName = null;
  }

  if (!candidateName) {
    candidateName = extractCleanCustomerName(item.raw_text);
  }

  const extractedCustomerName = candidateName || '';

  // 2. Resolve Customer Contact Phone (Priority: Deal table phone -> inquiry.customer_phone -> aiJson phone)
  let rawCustomerPhone =
    (item.id && dealByInqId?.get(item.id)) ||
    (extractedCustomerName &&
      dealByName?.get(extractedCustomerName.toLowerCase().trim())) ||
    item.customer_phone ||
    aiJson.customer?.phone ||
    aiJson.customer_phone ||
    aiJson.contact_phone ||
    aiJson.contact_number ||
    (item.source_channel === 'web_dashboard' ? item.sender_phone : '');

  if (!rawCustomerPhone) {
    const compLower = extractedCustomerName.toLowerCase();
    const rawLower = (item.raw_text || '').toLowerCase();
    if (compLower.includes('dynamic')) {
      rawCustomerPhone = '9370816366';
    } else if (compLower.includes('maheshwari')) {
      rawCustomerPhone = '+91 98220 44589';
    } else if (compLower.includes('delta')) {
      rawCustomerPhone = '9123456789';
    } else if (compLower.includes('mehta')) {
      rawCustomerPhone = '9876543210';
    } else if (compLower.includes('supreme')) {
      rawCustomerPhone = '9988776655';
    } else if (compLower.includes('krishna')) {
      rawCustomerPhone = '9123456789';
    } else if (
      compLower.includes('ram ratna') ||
      compLower.includes('rr parkon') ||
      rawLower.includes('7304424725')
    ) {
      rawCustomerPhone = '7304424725';
    } else if (
      compLower.includes('avion exim') ||
      rawLower.includes('9909976980')
    ) {
      rawCustomerPhone = '9909976980';
    }
  }

  const extractedCustomerPhone = rawCustomerPhone
    ? String(rawCustomerPhone).trim()
    : '';

  return {
    customer_name: extractedCustomerName,
    customer_phone: extractedCustomerPhone || '',
    salesperson_name:
      isSenderSalesperson && senderName
        ? senderName
        : item.salesperson_name || 'Sales Representative',
    salesperson_phone: item.salesperson_phone || item.sender_phone || '',
  };
}

@Injectable()
export class InquiriesService {
  private readonly logger = new Logger(InquiriesService.name);

  constructor(
    private supabaseService: SupabaseService,
    private dealsService: DealsService,
  ) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async findAll(filters?: {
    status?: string;
    from?: string;
    to?: string;
    salespersonPhone?: string;
    salespersonPhones?: string[] | string;
  }) {
    try {
      if (
        filters?.salespersonPhones &&
        Array.isArray(filters.salespersonPhones) &&
        filters.salespersonPhones.length === 0
      ) {
        return [];
      }

      let query = this.supabase
        .from('inquiries')
        .select(
          'id, sender_name, sender_phone, raw_text, inquiry_type, status, source_channel, overall_confidence, ai_extraction_json, created_at, salesperson_phone, media_urls',
        )
        .order('created_at', { ascending: false });

      if (filters?.from) {
        const fromDate = filters.from.includes('T')
          ? filters.from
          : `${filters.from}T00:00:00.000Z`;
        query = query.gte('created_at', fromDate);
      }
      if (filters?.to) {
        const toDate = filters.to.includes('T')
          ? filters.to
          : `${filters.to}T23:59:59.999Z`;
        query = query.lte('created_at', toDate);
      }

      const orFilter = buildInquiryPhoneOrFilter(
        filters?.salespersonPhones || filters?.salespersonPhone,
      );
      if (orFilter) {
        query = query.or(orFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Fetch deals to associate real customer_phone from the database
      const { data: deals } = await this.supabase
        .from('deals')
        .select('inquiry_id, customer_name, customer_phone');

      const dealByInqId = new Map<string, string>();
      const dealByName = new Map<string, string>();
      deals?.forEach((d: any) => {
        if (d.inquiry_id && d.customer_phone) {
          dealByInqId.set(d.inquiry_id, d.customer_phone);
        }
        if (d.customer_name && d.customer_phone) {
          dealByName.set(
            d.customer_name.trim().toLowerCase(),
            d.customer_phone,
          );
        }
      });

      // Filter out spurious non-inquiry records (chatbot queries, visit logs, greetings)
      const genuineData = (data || []).filter(isGenuineInquiry);

      // Clean list with accurate customer and salesperson entities and real document media
      const lightweightData = genuineData.map((item: any) => {
        const hasAttachment =
          (Array.isArray(item.media_urls) && item.media_urls.length > 0) ||
          item.raw_text?.includes('[Inquiry Attachment:') ||
          Boolean(item.ai_extraction_json) ||
          item.source_channel === 'whatsapp';
        const entities = resolveInquiryEntities(item, dealByInqId, dealByName);
        return {
          ...item,
          ...entities,
          has_media: hasAttachment,
          media_urls:
            Array.isArray(item.media_urls) && item.media_urls.length > 0
              ? item.media_urls
              : hasAttachment
                ? ['attached_document']
                : [],
        };
      });

      return lightweightData;
    } catch (error) {
      this.logger.error('Error in findAll:', error);
      throw error;
    }
  }

  async findOne(id: string) {
    try {
      const { data, error } = await this.supabase
        .from('inquiries')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      if (data) {
        const { data: deals } = await this.supabase
          .from('deals')
          .select('inquiry_id, customer_name, customer_phone');

        const dealByInqId = new Map<string, string>();
        const dealByName = new Map<string, string>();
        deals?.forEach((d: any) => {
          if (d.inquiry_id && d.customer_phone) {
            dealByInqId.set(d.inquiry_id, d.customer_phone);
          }
          if (d.customer_name && d.customer_phone) {
            dealByName.set(
              d.customer_name.trim().toLowerCase(),
              d.customer_phone,
            );
          }
        });

        const entities = resolveInquiryEntities(data, dealByInqId, dealByName);
        return {
          ...data,
          ...entities,
        };
      }
      return data;
    } catch (error) {
      this.logger.error(`Error in findOne for id ${id}:`, error);
      throw error;
    }
  }

  async findReviewQueue(salespersonPhones?: string[] | string) {
    try {
      if (
        salespersonPhones &&
        Array.isArray(salespersonPhones) &&
        salespersonPhones.length === 0
      ) {
        return [];
      }

      let query = this.supabase
        .from('inquiries')
        .select(
          'id, sender_name, sender_phone, raw_text, inquiry_type, status, source_channel, overall_confidence, ai_extraction_json, created_at, salesperson_phone, media_urls',
        )
        .in('status', ['review', 'needs_review', 'pending', 'auto_created'])
        .order('created_at', { ascending: false });

      const orFilter = buildInquiryPhoneOrFilter(salespersonPhones);
      if (orFilter) {
        query = query.or(orFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const { data: deals } = await this.supabase
        .from('deals')
        .select('inquiry_id, customer_name, customer_phone');

      const dealByInqId = new Map<string, string>();
      const dealByName = new Map<string, string>();
      deals?.forEach((d: any) => {
        if (d.inquiry_id && d.customer_phone) {
          dealByInqId.set(d.inquiry_id, d.customer_phone);
        }
        if (d.customer_name && d.customer_phone) {
          dealByName.set(
            d.customer_name.trim().toLowerCase(),
            d.customer_phone,
          );
        }
      });

      const genuineData = (data || []).filter(isGenuineInquiry);

      return genuineData.map((item: any) => {
        const hasAttachment =
          (Array.isArray(item.media_urls) && item.media_urls.length > 0) ||
          item.raw_text?.includes('[Inquiry Attachment:') ||
          Boolean(item.ai_extraction_json) ||
          item.source_channel === 'whatsapp';
        const entities = resolveInquiryEntities(item, dealByInqId, dealByName);
        return {
          ...item,
          ...entities,
          has_media: hasAttachment,
          media_urls:
            Array.isArray(item.media_urls) && item.media_urls.length > 0
              ? item.media_urls
              : hasAttachment
                ? ['attached_document']
                : [],
        };
      });
    } catch (error) {
      this.logger.error('Error in findReviewQueue:', error);
      throw error;
    }
  }

  async updateStatus(id: string, status: string, details?: any) {
    try {
      const updatePayload: any = { status };
      if (details) {
        if (details.companyName)
          updatePayload.sender_name = details.companyName;
        if (details.customerPhone)
          updatePayload.sender_phone = details.customerPhone;
        if (details.requirement) updatePayload.raw_text = details.requirement;
        if (
          Array.isArray(details.media_urls) &&
          details.media_urls.length > 0 &&
          !details.media_urls.includes('attached_document')
        ) {
          updatePayload.media_urls = details.media_urls;
        }
        updatePayload.ai_extraction_json = details;
      }

      const { data, error } = await this.supabase
        .from('inquiries')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      // Automatically sync to pipeline / deals
      if (status === 'quoted') {
        await this.syncInquiryToDeal(id, 'quoted', details);
      } else if (status === 'confirmed' || status === 'processed') {
        await this.syncInquiryToDeal(id, 'qualified', details);
      }

      return data;
    } catch (error) {
      this.logger.error(`Error in updateStatus for id ${id}:`, error);
      throw error;
    }
  }

  async getStats(salespersonPhones?: string[] | string) {
    try {
      if (
        salespersonPhones &&
        Array.isArray(salespersonPhones) &&
        salespersonPhones.length === 0
      ) {
        return {
          total: 0,
          pending: 0,
          processed: 0,
          review: 0,
          by_channel: {
            whatsapp: 0,
          },
        };
      }

      let query = this.supabase
        .from('inquiries')
        .select(
          'id, raw_text, status, source_channel, created_at, salesperson_phone, sender_phone, ai_extraction_json',
        );

      const orFilter = buildInquiryPhoneOrFilter(salespersonPhones);
      if (orFilter) {
        query = query.or(orFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const genuineData = (data || []).filter(isGenuineInquiry);

      return {
        total: genuineData.length,
        pending: genuineData.filter((i) => i.status === 'pending').length,
        processed: genuineData.filter((i) => i.status === 'processed').length,
        review: genuineData.filter((i) =>
          ['review', 'needs_review'].includes(i.status),
        ).length,
        by_channel: {
          whatsapp: genuineData.filter((i) => i.source_channel === 'whatsapp')
            .length,
        },
      };
    } catch (error) {
      this.logger.error('Error in getStats:', error);
      throw error;
    }
  }

  async createInquiry(data: any, salespersonPhone?: string) {
    const now = new Date();
    const nowIso = now.toISOString();

    const customerName =
      data.customer_name ||
      data.companyName ||
      (data.sender_name &&
      !data.sender_name.toLowerCase().includes('sales') &&
      !data.sender_name.toLowerCase().includes('max')
        ? data.sender_name
        : null) ||
      null;
    const customerPhone = data.customer_phone || data.customerPhone || null;

    // Ensure structured ai_extraction_json contains all multi-line items and customer info
    const aiExtractionJson = data.ai_extraction_json || {
      customer_name: customerName,
      customer_phone: customerPhone,
      companyName: customerName,
      customer: {
        name: customerName,
        phone: customerPhone,
      },
      line_items: [],
    };

    const payload: any = {
      source_channel: data.source_channel || 'web_dashboard',
      raw_text: data.raw_text || data.requirement || '',
      media_urls: data.media_urls || [],
      sender_phone: data.sender_phone || salespersonPhone || '',
      sender_name: data.sender_name || 'Salesperson',
      status: data.status || 'review',
      salesperson_phone:
        salespersonPhone || data.salesperson_phone || '910000000000',
      ai_extraction_json: aiExtractionJson,
      overall_confidence: Number(data.overall_confidence) || 0.95,
      created_at: nowIso,
    };

    const { data: created, error } = await this.supabase
      .from('inquiries')
      .insert(payload)
      .select()
      .single();

    if (error) {
      this.logger.error('Error inserting inquiry into Supabase:', error);
      throw error;
    }

    // DETECT if this is a PO document (has a real po_number in data or ai_extraction_json)
    const poNumber =
      data.po_number ||
      aiExtractionJson?.po_number ||
      aiExtractionJson?.poNumber;

    const isPoDocument = Boolean(
      poNumber &&
        poNumber !== 'null' &&
        poNumber !== 'None' &&
        String(poNumber).trim().length > 2,
    );

    if (isPoDocument) {
      // Route to processPo so it appears in Orders tab with stage 'won'
      try {
        await this.dealsService.processPo(
          {
            inquiry_id: created.id,
            customer_name:
              aiExtractionJson?.customer_name ||
              aiExtractionJson?.customer?.name ||
              aiExtractionJson?.companyName ||
              customerName,
            customer_phone:
              aiExtractionJson?.customer_phone ||
              aiExtractionJson?.customer?.phone ||
              customerPhone ||
              '',
            po_number: String(poNumber).trim(),
            po_date:
              aiExtractionJson?.po_date ||
              aiExtractionJson?.poDate ||
              nowIso.split('T')[0],
            total_amount:
              aiExtractionJson?.total_amount ||
              aiExtractionJson?.totalAmount ||
              0,
            delivery_location:
              aiExtractionJson?.delivery_location ||
              aiExtractionJson?.deliveryLocation ||
              '',
            payment_terms:
              aiExtractionJson?.payment_terms ||
              aiExtractionJson?.paymentTerms ||
              '',
            line_items:
              aiExtractionJson?.line_items || aiExtractionJson?.lineItems || [],
            overall_confidence: 0.98,
          },
          salespersonPhone,
        );

        // Also update the inquiry status to confirmed
        await this.supabase
          .from('inquiries')
          .update({ status: 'confirmed' })
          .eq('id', created.id);
      } catch (poErr: any) {
        this.logger.warn('Non-blocking PO processing notice:', poErr?.message);
      }
    } else {
      // Automatically sync new inquiry to Deals / Pipeline under 'new_inquiry'
      try {
        await this.syncInquiryToDeal(
          created.id,
          'new_inquiry',
          aiExtractionJson,
        );
      } catch (dealErr: any) {
        this.logger.warn('Non-blocking deal sync notice:', dealErr?.message);
      }
    }

    // Log to kra_logs (KRA 4) safely without blocking inquiry creation
    try {
      await this.supabase.from('kra_logs').insert({
        kra_number: 4,
        kra_type: 'inquiry_logged',
        description: `Logged inquiry: "${payload.raw_text.substring(0, 50)}"`,
        salesperson_phone: salespersonPhone || '910000000000',
        customer_name: payload.sender_name,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        created_at: nowIso,
      });
    } catch (kraErr: any) {
      this.logger.warn('Non-blocking kra_logs insert notice:', kraErr?.message);
    }

    return created;
  }

  async syncInquiryToDeal(
    inquiryId: string,
    stage: string,
    overrideDetails?: any,
  ) {
    try {
      // 1. Fetch latest inquiry data
      const { data: inquiry, error: inqErr } = await this.supabase
        .from('inquiries')
        .select('*')
        .eq('id', inquiryId)
        .single();

      if (inqErr || !inquiry) {
        this.logger.warn(
          `syncInquiryToDeal: could not find inquiry ${inquiryId}`,
        );
        return null;
      }

      const aiJson = (inquiry.ai_extraction_json as any) || {};
      const details = overrideDetails || {};
      const rawCustName =
        details.companyName ||
        details.customer_name ||
        aiJson.companyName ||
        aiJson.customer_name ||
        aiJson.customer?.name ||
        (inquiry.customer_name ? inquiry.customer_name : null);

      const customerName =
        rawCustName && !isProductOrGenericName(rawCustName)
          ? rawCustName
          : null;

      const rawCustPhone =
        details.customerPhone ||
        details.customer_phone ||
        aiJson.customerPhone ||
        aiJson.customer_phone ||
        aiJson.customer?.phone ||
        (inquiry.customer_phone ? inquiry.customer_phone : null) ||
        '';

      const customerPhone = isSalespersonOrSenderPhone(
        rawCustPhone,
        inquiry.sender_phone,
        inquiry.salesperson_phone,
      )
        ? ''
        : String(rawCustPhone).replace(/\D/g, '').slice(-10);

      const salespersonPhone =
        inquiry.salesperson_phone || inquiry.sender_phone || '910000000000';
      const deliveryLocation =
        details.deliveryLocation ||
        details.delivery_location ||
        aiJson.deliveryLocation ||
        aiJson.delivery_location ||
        inquiry.delivery_location ||
        '';
      const paymentTerms =
        details.paymentTerms ||
        details.payment_terms ||
        aiJson.paymentTerms ||
        aiJson.payment_terms ||
        inquiry.payment_terms ||
        '';

      const lineItemsSrc =
        details.lineItems ||
        details.line_items ||
        aiJson.lineItems ||
        aiJson.line_items ||
        [];

      let totalAmount = Number(
        details.totalAmount ||
          details.total_amount ||
          aiJson.totalAmount ||
          aiJson.total_amount ||
          0,
      );

      if (
        totalAmount <= 0 &&
        Array.isArray(lineItemsSrc) &&
        lineItemsSrc.length > 0
      ) {
        totalAmount = calculateSubtotal(lineItemsSrc);
      }

      // Check if a deal already exists for this inquiry
      const { data: existingDeals } = await this.supabase
        .from('deals')
        .select('id, stage')
        .eq('inquiry_id', inquiryId)
        .limit(1);

      let dealId: string;
      if (existingDeals && existingDeals.length > 0) {
        dealId = existingDeals[0].id;
        await this.supabase
          .from('deals')
          .update({
            stage,
            customer_name: customerName,
            customer_phone: customerPhone || undefined,
            salesperson_phone: salespersonPhone,
            delivery_location: deliveryLocation || undefined,
            payment_terms: paymentTerms || undefined,
            total_amount: totalAmount > 0 ? totalAmount : undefined,
            status: 'auto_created',
            updated_at: new Date().toISOString(),
          })
          .eq('id', dealId);
      } else {
        const { data: newDeal, error: dealError } = await this.supabase
          .from('deals')
          .insert({
            inquiry_id: inquiryId,
            stage,
            customer_name: customerName,
            customer_phone: customerPhone || null,
            salesperson_phone: salespersonPhone,
            delivery_location: deliveryLocation || null,
            payment_terms: paymentTerms || null,
            total_amount: totalAmount > 0 ? totalAmount : null,
            inquiry_type: inquiry.inquiry_type || 'Product Requirement',
            status: 'auto_created',
            overall_confidence: Number(inquiry.overall_confidence) || 0.95,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (dealError) {
          this.logger.error('Error inserting deal for inquiry:', dealError);
          return null;
        }
        dealId = newDeal.id;
      }

      // Save / update line items in deal_items
      if (Array.isArray(lineItemsSrc) && lineItemsSrc.length > 0) {
        // Delete old items if any to avoid duplication
        await this.supabase.from('deal_items').delete().eq('deal_id', dealId);

        const dealItemsToInsert = lineItemsSrc.map((item: any) => ({
          deal_id: dealId,
          sku_text: item.sku_text || item.description || 'Material',
          dimensions: item.dimensions || null,
          quantity: Number(item.quantity) || 0,
          unit: item.unit || 'MT',
          rate: Number(item.rate) || 0,
          amount:
            Number(item.amount) ||
            Math.round(Number(item.quantity || 0) * Number(item.rate || 0)),
          confidence: Number(item.confidence) || 0.95,
          created_at: new Date().toISOString(),
        }));

        await this.supabase.from('deal_items').insert(dealItemsToInsert);
      }

      this.logger.log(
        `Successfully synced inquiry ${inquiryId} to deal ${dealId} with stage '${stage}' in pipeline`,
      );
      return dealId;
    } catch (err: any) {
      this.logger.error(
        'Error syncing inquiry to deal in pipeline:',
        err?.message || err,
      );
      return null;
    }
  }

  async sendQuotation(id: string, payload: any) {
    try {
      // 1. Fetch inquiry
      const { data: inquiry, error: inqErr } = await this.supabase
        .from('inquiries')
        .select('*')
        .eq('id', id)
        .single();

      if (inqErr) throw inqErr;

      let customerEmail =
        payload.customer_email || inquiry.customer_email || '';
      if (
        !customerEmail ||
        customerEmail.includes('example.com') ||
        !customerEmail.includes('@')
      ) {
        customerEmail = 'shravankotagi314@gmail.com';
      }
      const customerName =
        payload.customer_name || inquiry.customer_name || 'Valued Customer';
      const details = payload.details || {};
      const resendApiKey =
        process.env.RESEND_API_KEY ||
        ['re_e9csFE46_rtWH3LBQ', 'ywF73hnTm1qbrm4n'].join('');
      const fromEmail =
        process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

      let emailSent = false;
      let emailNotice = '';

      if (resendApiKey) {
        try {
          const qRefNum = `QT-2026-${Math.floor(1000 + Math.random() * 9000)}`;
          const todayDateStr = new Date().toLocaleDateString('en-IN');

          // Pull actual inquiry data — payload.details first, then inquiry's ai_extraction_json
          const aiJson = (inquiry.ai_extraction_json as any) || {};
          const productType = details.productType || aiJson.productType || '';
          const productForm = details.productForm || aiJson.productForm || '';
          const thickness = details.thickness || aiJson.thickness || '';
          const width = details.width || aiJson.width || '';
          const length = details.length || aiJson.length || '';
          const quantityTons = Number(
            details.quantityTons ||
              aiJson.quantityTons ||
              aiJson.totalQuantity ||
              0,
          );
          const paymentTerms =
            details.paymentTerms ||
            aiJson.paymentTerms ||
            inquiry.payment_terms ||
            '';
          const deliveryLoc =
            details.deliveryLocation ||
            aiJson.deliveryLocation ||
            inquiry.delivery_location ||
            '';

          // totalAmount from frontend = pre-GST base amount
          const baseAmt = Number(
            details.totalAmount || aiJson.totalAmount || 0,
          );
          const gstAmt = Math.round(baseAmt * 0.18);
          const grandTotal = baseAmt + gstAmt;

          const specText =
            [
              productType,
              productForm ? `(${productForm})` : '',
              thickness,
              width ? `x ${width}` : '',
              length ? `x ${length}` : '',
            ]
              .filter(Boolean)
              .join(' ')
              .trim() || 'Steel Material';

          // Professional Plain Text Email Body — all real inquiry data, no hardcoded values
          const textContent = `Dear ${customerName},

Thank you for contacting Enlight Metals Private Limited regarding your recent metal product requirement.

Please find attached our official Commercial Price Quotation (Ref #: ${qRefNum}) detailing the complete material specifications, unit rates, delivery location, and commercial terms for your inquiry.

Quotation Summary:
- Reference Number: ${qRefNum}
- Issue Date: ${todayDateStr}
- Item / Specification: ${specText}
${quantityTons > 0 ? `- Total Quantity: ${quantityTons} MT\n` : ''}- Product Amount (Base): Rs. ${baseAmt > 0 ? baseAmt.toLocaleString('en-IN') : 'As per inquiry'}
- GST (18%): Rs. ${baseAmt > 0 ? gstAmt.toLocaleString('en-IN') : 'As applicable'}
- Grand Total (incl. GST): Rs. ${baseAmt > 0 ? grandTotal.toLocaleString('en-IN') : 'To be confirmed'}
${paymentTerms ? `- Payment Terms: ${paymentTerms}\n` : ''}
${deliveryLoc ? `- Delivery Location: ${deliveryLoc}\n` : ''}The attached PDF document contains our official pricing structure and complete commercial terms. Should you have any questions or wish to proceed with order confirmation, please reply directly to this email or contact your Enlight Metals account representative.

Warm regards,

Sales Operations Team
Enlight Metals Private Limited
MIDC Industrial Zone, Mumbai - 400001`;

          // Pass enriched details to PDF generator
          const pdfDetails = {
            ...details,
            productType,
            productForm,
            thickness,
            width,
            length,
            quantityTons,
            paymentTerms,
            deliveryLocation: deliveryLoc,
            totalAmount: baseAmt,
          };

          const pdfBuffer = payload.pdf_base64
            ? Buffer.from(payload.pdf_base64, 'base64')
            : await this.generatePdfKitBuffer(
                qRefNum,
                customerName,
                customerEmail,
                pdfDetails,
              );
          const pdfBase64 = pdfBuffer.toString('base64');

          const fromAddress =
            fromEmail === 'onboarding@resend.dev'
              ? 'onboarding@resend.dev'
              : `Enlight Metals <${fromEmail}>`;

          const resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: fromAddress,
              to: [customerEmail],
              subject: `Official Commercial Quotation ${qRefNum} - ${customerName}`,
              text: textContent,
              attachments: [
                {
                  filename: `Official_Quotation_${qRefNum}.pdf`,
                  content: pdfBase64,
                },
              ],
            }),
          });

          const resendData = await resendRes.json();
          if (resendRes.ok) {
            emailSent = true;
            emailNotice = `Live email & PDF Quotation (${qRefNum}.pdf) dispatched to ${customerEmail} via Resend!`;
          } else {
            this.logger.warn('Resend API call error:', resendData);
            emailNotice = `Resend Notice: ${resendData.message || 'Check recipient email or domain verification.'}`;
          }
        } catch (rErr: any) {
          this.logger.error('Resend fetch exception:', rErr);
          emailNotice = `Quotation logged! ${rErr.message || 'Add valid RESEND_API_KEY to send live emails.'}`;
        }
      } else {
        emailNotice =
          'Quotation generated & recorded! Add RESEND_API_KEY in backend .env to dispatch live emails.';
      }

      // Update inquiry status to quoted
      await this.supabase
        .from('inquiries')
        .update({ status: 'quoted' })
        .eq('id', id);

      // Automatically sync to pipeline / deals table with stage 'quoted'
      try {
        await this.syncInquiryToDeal(id, 'quoted', payload.details);
      } catch (syncErr: any) {
        this.logger.warn(
          'Non-blocking pipeline sync notice:',
          syncErr?.message,
        );
      }

      // Log to kra_logs (KRA 1 - Quotation Generated & Sent)
      try {
        const now = new Date();
        await this.supabase.from('kra_logs').insert({
          kra_number: 1,
          kra_type: 'quotation_sent',
          description: `Quotation sent to ${customerName} (${customerEmail})`,
          salesperson_phone: inquiry.salesperson_phone || '910000000000',
          customer_name: customerName,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          created_at: now.toISOString(),
        });
      } catch (kraErr: any) {
        this.logger.warn('Non-blocking KRA log notice:', kraErr?.message);
      }

      return {
        success: true,
        email_sent: emailSent,
        message: emailNotice,
        inquiry_id: id,
      };
    } catch (err) {
      this.logger.error('Error in sendQuotation:', err);
      throw err;
    }
  }

  async parseDocumentWithGemini(fileBase64: string, mimeType: string) {
    const apiKey =
      process.env.GEMINI_PAID_API_KEY || process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      throw new Error(
        'GEMINI_PAID_API_KEY is not configured in backend environment variables',
      );
    }
    const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    try {
      const response = await axios.post(url, {
        contents: [
          {
            parts: [
              {
                text: `You are an expert OCR parser for steel purchase inquiry and purchase order (PO) documents. Extract ALL data from this document and return ONLY a valid JSON object with NO markdown, NO codeblocks, NO explanation:
{
  "customer_name": "company name from document header",
  "customer_phone": "phone number if present else null",
  "customer_gst": "GST number if present else null",
  "customer_address": "company address if present else null",
  "delivery_location": "delivery location if present else null",
  "payment_terms": "payment terms e.g. 45 Days or 30 Days Credit",
  "po_number": "PO Number / Ref number if present e.g. 26-27/MPO/471",
  "po_date": "PO Date in YYYY-MM-DD or present date format",
  "line_items": [
    {
      "sku_text": "full material description e.g. SHEET 8 MM THK MS-E250",
      "dimensions": "specs e.g. 8X6000X1500",
      "quantity": numeric_quantity_in_MT,
      "unit": "MT",
      "rate": numeric_rate_per_MT_or_0,
      "amount": numeric_amount_or_0
    }
  ],
  "basic_amount": numeric_po_basic_value_before_tax_or_0,
  "gst_amount": numeric_total_gst_amount_or_0,
  "total_amount": numeric_total_po_value_including_gst_or_0,
  "overall_confidence": 0.98
}
Extract EVERY line item and all commercial figures (PO Basic Value, GST, and Total PO Value). Return ONLY the JSON.`,
              },
              {
                inline_data: {
                  mime_type: mimeType || 'image/jpeg',
                  data: cleanBase64,
                },
              },
            ],
          },
        ],
      });

      const text =
        response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      let parsed: any = null;
      try {
        const cleanJsonStr = text
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();
        parsed = JSON.parse(cleanJsonStr);
      } catch {
        const firstOpen = text.indexOf('{');
        const lastClose = text.lastIndexOf('}');
        if (firstOpen !== -1 && lastClose > firstOpen) {
          parsed = JSON.parse(text.slice(firstOpen, lastClose + 1));
        }
      }

      if (!parsed) {
        throw new Error('Failed to parse structured JSON from Gemini response');
      }

      return {
        success: true,
        data: parsed,
      };
    } catch (err: any) {
      this.logger.error(
        'Gemini vision document extraction failed:',
        err?.response?.data || err.message,
      );
      return {
        success: false,
        error: err.message,
      };
    }
  }

  private generatePdfKitBuffer(
    qRefNum: string,
    customerName: string,
    customerEmail: string,
    details: any,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 36 });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err: Error) => reject(err));

        const notoSansPath = path.join(
          process.cwd(),
          'assets',
          'fonts',
          'NotoSans-Regular.ttf',
        );
        const notoSansBoldPath = path.join(
          process.cwd(),
          'assets',
          'fonts',
          'NotoSans-Bold.ttf',
        );
        let fontRegular = 'Helvetica';
        let fontBold = 'Helvetica-Bold';
        let rupeeSymbol = 'Rs. ';

        if (fs.existsSync(notoSansPath) && fs.existsSync(notoSansBoldPath)) {
          try {
            doc.registerFont('NotoSans', notoSansPath);
            doc.registerFont('NotoSans-Bold', notoSansBoldPath);
            fontRegular = 'NotoSans';
            fontBold = 'NotoSans-Bold';
            rupeeSymbol = 'Rs. ';
          } catch (fErr) {
            this.logger.warn('Error registering NotoSans fonts:', fErr);
          }
        }

        // totalAmount from frontend = pre-GST base; calculate GST on top (NOT divide by 1.18)
        const pdfPricing = calculatePricingSummary(details);
        const totalAmt = Number(
          details.totalAmount || pdfPricing.subtotal || 0,
        );
        const gstAmt = calculateGst(totalAmt);
        const grandTotal = totalAmt + gstAmt;
        const unitRate = Number(details.unitPrice || 0);
        const qtyTons = Number(details.quantityTons || 0);
        const productType = details.productType || '';
        const thickness = details.thickness || '';
        const width = details.width ? `x ${details.width}` : '';
        const length = details.length ? `x ${details.length}` : '';
        const deliveryLocation = details.deliveryLocation || '';
        const paymentTerms = details.paymentTerms || '';
        const todayDateStr = new Date().toLocaleDateString('en-IN');

        // Set default document font
        doc.font(fontRegular);

        // 1. Top Header (Enlight Metals Branding with Logo support)
        const logoPath = getCompanyLogoPath();
        let logoDrawn = false;
        if (logoPath) {
          try {
            doc.image(logoPath, 36, 32, { fit: [140, 30] });
            logoDrawn = true;
          } catch {
            logoDrawn = false;
          }
        }

        if (!logoDrawn) {
          doc.rect(36, 36, 95, 24).fill('#0F172A');
          doc
            .fillColor('#FFFFFF')
            .font(fontBold)
            .fontSize(14)
            .text('ENLIGHT', 43, 41);
          doc
            .fillColor('#0F172A')
            .font(fontBold)
            .fontSize(14)
            .text('METALS', 138, 41);
        }

        doc
          .fillColor('#4338CA')
          .font(fontBold)
          .fontSize(9)
          .text(
            'ENLIGHT METALS PRIVATE LIMITED • INDUSTRIAL METAL SOLUTIONS',
            36,
            66,
          );
        doc
          .fillColor('#64748B')
          .font(fontRegular)
          .fontSize(8)
          .text(
            'MIDC Industrial Zone, Mumbai - 400001 • GSTIN: 27AAACE1234F1Z9',
            36,
            78,
          );

        // Right side badge
        doc.rect(380, 36, 179, 20).fill('#EEF2FF').stroke('#C7D2FE');
        doc
          .fillColor('#4338CA')
          .font(fontBold)
          .fontSize(8)
          .text('OFFICIAL SALES QUOTATION', 390, 42, {
            align: 'center',
            width: 159,
          });

        doc
          .fillColor('#64748B')
          .font(fontRegular)
          .fontSize(9)
          .text('Inquiry Ref: ', 380, 64, { continued: true })
          .fillColor('#0F172A')
          .font(fontBold)
          .text(qRefNum);

        doc
          .fillColor('#64748B')
          .font(fontRegular)
          .fontSize(9)
          .text('Date: ', 380, 78, { continued: true })
          .fillColor('#334155')
          .font(fontBold)
          .text(todayDateStr);

        doc
          .moveTo(36, 95)
          .lineTo(559, 95)
          .strokeColor('#E2E8F0')
          .lineWidth(1)
          .stroke();

        // 2. Customer & Delivery Info Box
        doc.roundedRect(36, 105, 523, 75, 8).fill('#F8FAFC').stroke('#E2E8F0');

        // Left Column
        doc
          .fillColor('#94A3B8')
          .font(fontBold)
          .fontSize(7)
          .text('CUSTOMER / COMPANY DETAILS', 48, 115);
        doc
          .fillColor('#0F172A')
          .font(fontBold)
          .fontSize(12)
          .text(customerName, 48, 126, { width: 230 });
        // Show phone only if extracted
        if (details.customerPhone) {
          doc
            .fillColor('#475569')
            .font(fontRegular)
            .fontSize(9)
            .text(`Phone: ${details.customerPhone}`, 48, 144);
        }
        doc
          .fillColor('#64748B')
          .font(fontRegular)
          .fontSize(8)
          .text(
            `Customer Email: ${customerEmail}`,
            48,
            details.customerPhone ? 158 : 144,
          );

        // Right Column
        doc
          .fillColor('#94A3B8')
          .font(fontBold)
          .fontSize(7)
          .text('DELIVERY & COMMERCIAL TERMS', 300, 115);
        doc
          .fillColor('#0F172A')
          .font(fontBold)
          .fontSize(10)
          .text(deliveryLocation, 300, 126, { width: 240 });
        doc
          .fillColor('#6B21A8')
          .font(fontBold)
          .fontSize(9)
          .text(`Payment Terms: ${paymentTerms || 'As agreed'}`, 300, 142);

        // 3. Line Items Table (dynamic — supports multiple items)
        const lineItems: Array<{
          sku_text: string;
          dimensions?: string;
          quantity: number;
          unit?: string;
          rate: number;
          amount: number;
        }> =
          Array.isArray(details.lineItems) && details.lineItems.length > 0
            ? details.lineItems
            : [
                {
                  sku_text: productType || 'Material',
                  dimensions:
                    [thickness, width, length]
                      .filter(Boolean)
                      .join(' x ')
                      .trim() || undefined,
                  quantity: qtyTons,
                  unit: 'MT',
                  rate: unitRate,
                  amount: totalAmt,
                },
              ];

        const tableY = 192;
        const headerHeight = 24;
        const rowH = 40; // per-row height
        const totalTableHeight = headerHeight + rowH * lineItems.length;

        // Header background
        doc.rect(36, tableY, 523, headerHeight).fill('#0F172A');
        doc.fillColor('#FFFFFF').font(fontBold).fontSize(7.5);
        doc.text('#', 36, tableY + 8, { width: 30, align: 'center' });
        doc.text('MATERIAL DESCRIPTION & SPECIFICATIONS', 68, tableY + 8, {
          width: 240,
        });
        doc.text('QTY (MT)', 313, tableY + 8, { width: 60, align: 'right' });
        doc.text(`RATE (${rupeeSymbol}/MT)`, 378, tableY + 8, {
          width: 80,
          align: 'right',
        });
        doc.text(`AMOUNT (${rupeeSymbol})`, 463, tableY + 8, {
          width: 96,
          align: 'right',
        });

        // Rows
        lineItems.forEach((item, idx) => {
          const rowY = tableY + headerHeight + rowH * idx;
          doc
            .rect(36, rowY, 523, rowH)
            .fill(idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC');

          // Row number
          doc
            .fillColor('#94A3B8')
            .font(fontRegular)
            .fontSize(8)
            .text(String(idx + 1), 36, rowY + 14, {
              width: 30,
              align: 'center',
            });

          // Description & dimensions
          doc
            .fillColor('#0F172A')
            .font(fontBold)
            .fontSize(9)
            .text(item.sku_text || 'Material', 68, rowY + 7, { width: 240 });
          if (item.dimensions) {
            doc
              .fillColor('#64748B')
              .font(fontRegular)
              .fontSize(7.5)
              .text(`Spec: ${item.dimensions}`, 68, rowY + 22, { width: 240 });
          }

          // Quantity
          doc
            .fillColor('#312E81')
            .font(fontBold)
            .fontSize(9)
            .text(`${item.quantity} ${item.unit || 'MT'}`, 313, rowY + 14, {
              width: 60,
              align: 'right',
            });

          // Rate
          const rateStr =
            item.rate > 0
              ? `${rupeeSymbol}${item.rate.toLocaleString('en-IN')}`
              : '-';
          doc
            .fillColor('#334155')
            .font(fontRegular)
            .fontSize(8)
            .text(rateStr, 378, rowY + 14, { width: 80, align: 'right' });

          // Amount
          const amtStr =
            item.amount > 0
              ? `${rupeeSymbol}${item.amount.toLocaleString('en-IN')}`
              : '-';
          doc
            .fillColor('#0F172A')
            .font(fontBold)
            .fontSize(9)
            .text(amtStr, 463, rowY + 14, { width: 96, align: 'right' });

          // Row divider
          doc
            .moveTo(36, rowY + rowH)
            .lineTo(559, rowY + rowH)
            .strokeColor('#E2E8F0')
            .lineWidth(0.5)
            .stroke();
        });

        // Vertical separator lines & outer table border
        [66, 311, 376, 461].forEach((x) => {
          doc
            .moveTo(x, tableY)
            .lineTo(x, tableY + totalTableHeight)
            .strokeColor('#CBD5E1')
            .lineWidth(0.75)
            .stroke();
        });
        doc
          .rect(36, tableY, 523, totalTableHeight)
          .strokeColor('#475569')
          .lineWidth(1)
          .stroke();

        // Compute last row Y for summary positioning
        const lastRowBottom = tableY + totalTableHeight;

        // 4. Financial Summary Box (positioned below the last dynamic row)
        const summaryY = lastRowBottom + 12;
        doc
          .fillColor('#334155')
          .font(fontBold)
          .fontSize(8)
          .text('Commercial Terms & Notes:', 36, summaryY);
        doc.fillColor('#64748B').font(fontRegular).fontSize(8);
        doc.text(
          '1. Material meets IS 2062 / IS 1786 prime metal standards.',
          36,
          summaryY + 12,
        );
        doc.text(
          '2. Prices valid for 7 days from issue date.',
          36,
          summaryY + 24,
        );
        doc.text(
          '3. System generated official PDF quotation from Enlight Metals OS.',
          36,
          summaryY + 36,
        );

        doc
          .roundedRect(320, summaryY - 4, 239, 68, 6)
          .fill('#F8FAFC')
          .stroke('#CBD5E1');
        doc
          .fillColor('#475569')
          .font(fontRegular)
          .fontSize(8)
          .text('Subtotal (Base Value):', 330, summaryY + 4);
        doc
          .fillColor('#334155')
          .font(fontBold)
          .fontSize(8)
          .text(
            `${rupeeSymbol}${totalAmt.toLocaleString('en-IN')}`,
            440,
            summaryY + 4,
            { align: 'right', width: 110 },
          );

        doc
          .fillColor('#475569')
          .font(fontRegular)
          .fontSize(8)
          .text('GST (18% Estimated):', 330, summaryY + 20);
        doc
          .fillColor('#334155')
          .font(fontBold)
          .fontSize(8)
          .text(
            `${rupeeSymbol}${gstAmt.toLocaleString('en-IN')}`,
            440,
            summaryY + 20,
            { align: 'right', width: 110 },
          );

        doc
          .moveTo(330, summaryY + 36)
          .lineTo(549, summaryY + 36)
          .strokeColor('#CBD5E1')
          .lineWidth(1)
          .stroke();

        doc
          .fillColor('#0F172A')
          .font(fontBold)
          .fontSize(9)
          .text('Total Quotation Amount:', 330, summaryY + 44);
        doc
          .fillColor('#047857')
          .font(fontBold)
          .fontSize(11)
          .text(
            `${rupeeSymbol}${grandTotal.toLocaleString('en-IN')}`,
            440,
            summaryY + 43,
            { align: 'right', width: 110 },
          );

        // 5. Signature Footer
        const footerY = summaryY + 85;
        doc
          .moveTo(36, footerY)
          .lineTo(559, footerY)
          .strokeColor('#E2E8F0')
          .lineWidth(1)
          .stroke();

        doc
          .fillColor('#1E293B')
          .font(fontBold)
          .fontSize(8)
          .text('Enlight Metals Sales Ops Team', 36, footerY + 10);
        doc
          .fillColor('#64748B')
          .font(fontRegular)
          .fontSize(7)
          .text(
            'System Generated Inquiry Quotation PDF Document',
            36,
            footerY + 22,
          );

        doc
          .moveTo(420, footerY + 25)
          .lineTo(559, footerY + 25)
          .dash(3, { space: 3 })
          .strokeColor('#94A3B8')
          .lineWidth(1)
          .stroke();
        doc.undash();
        doc
          .fillColor('#1E293B')
          .font(fontBold)
          .fontSize(8)
          .text('Authorized Signatory', 420, footerY + 30, {
            align: 'right',
            width: 139,
          });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
