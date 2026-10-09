import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

const PDFDocument = require('pdfkit');
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { phoneInList } from '../employees/employees.service';
import { ZohoService } from '../zoho/zoho.service';
import { ENLIGHT_LOGO_BASE64 } from '../../assets/logoBase64';

const QUOTATION_FROM_EMAIL = 'quotes@enlightmetals.com';

function getCompanyLogoBuffer(): Buffer | null {
  const possiblePaths = [
    path.join(process.cwd(), 'assets', 'logo.png'),
    path.join(process.cwd(), 'assets', 'logo.jpg'),
    path.join(process.cwd(), 'assets', 'logo.jpeg'),
    path.join(process.cwd(), 'backend', 'assets', 'logo.png'),
    path.join(process.cwd(), 'dist', 'assets', 'logo.png'),
    path.join(__dirname, '../../../assets/logo.png'),
    path.join(__dirname, '../../../assets/logo.jpg'),
    path.join(__dirname, '../../../assets/logo.jpeg'),
    path.join(__dirname, '../../assets/logo.png'),
    path.join(__dirname, '../assets/logo.png'),
    path.join(__dirname, 'assets/logo.png'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p);
      } catch {}
    }
  }
  if (ENLIGHT_LOGO_BASE64) {
    try {
      return Buffer.from(ENLIGHT_LOGO_BASE64, 'base64');
    } catch {}
  }
  return null;
}

function getAssetFontPath(fontFilename: string): string | null {
  const possiblePaths = [
    path.join(process.cwd(), 'assets', 'fonts', fontFilename),
    path.join(process.cwd(), 'backend', 'assets', 'fonts', fontFilename),
    path.join(__dirname, '../../../assets/fonts', fontFilename),
    path.join(__dirname, '../../assets/fonts', fontFilename),
    path.join(__dirname, '../assets/fonts', fontFilename),
    path.join(__dirname, 'assets/fonts', fontFilename),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

import { DealsService } from '../deals/deals.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  calculateLineItem,
  calculateQuotationBreakdown,
  calculateTotalTonnageMt,
  formatIndianCurrency,
} from '../pricing/pricing.engine';
import { UnitConverterService } from '../pricing/unit-converter.service';
import { detectHsnCode } from '../../utils/hsnDetector';
export { getAssignedPhoneFromCustomerMap } from '../../utils/customerOwnerMap';
import {
  getAssignedPhoneFromCustomerMap,
  buildCustomerOwnerMap,
  isValidSalespersonPhone,
} from '../../utils/customerOwnerMap';

const PRODUCT_KEYWORDS = [
  'hr coil',
  'hot rolled',
  'cr sheet',
  'cold rolled',
  'cr coil',
  'gp sheet',
  'gp coil',
  'galvanized sheet',
  'galvanized coil',
  'galvalume',
  'galvalume sheet',
  'galvalume coil',
  'hrpo',
  'hrpo sheet',
  'hrpo coil',
  'chequered sheet',
  'chequered plate',
  'chequered coil',
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
  'angle',
  'channels',
  'channel',
  'beams',
  'beam',
  'flats',
  'flat bar',
  'round bar',
  'square bar',
  'square pipe',
  'rectangular tube',
  'slotted angle',
  'earthing strip',
  'cable tray',
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
    clean === 'customer' ||
    clean === 'client' ||
    clean === 'the customer' ||
    clean === 'customer inquiry' ||
    clean === 'web customer' ||
    clean === 'test'
  ) {
    return true;
  }

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

function extractCleanDeliveryLocation(rawText?: string, aiJson?: any): string {
  const sanitize = (str: string): string => {
    if (!str) return '';
    let clean = str.replace(/^[•\-\*:\s|]+|[•\-\*:\s|]+$/g, '').trim();
    if (clean.includes('|')) clean = clean.split('|')[0].trim();
    clean = clean
      .replace(
        /\s*(?:payment\s*terms?|payment|terms?|make|brand|preferred\s*make|notes?|remarks?|email|contact|phone)\s*[:=-].*$/i,
        '',
      )
      .trim();
    return clean.replace(/^[•\-\*:\s|]+|[•\-\*:\s|]+$/g, '').trim();
  };

  const json = aiJson || {};
  const fromJson = sanitize(
    json.delivery_location || json.deliveryLocation || '',
  );

  let fromText = '';
  if (rawText && typeof rawText === 'string') {
    // 1. Line-by-line match for bullet or key-value format (stops strictly at pipe, newline, or next field)
    const lineMatch =
      rawText.match(
        /(?:^[•\-\*]?\s*(?:delivery\s*(?:location|address)?|delivered\s*to|dispatch\s*to|site\s*(?:location|address)?|destination)\s*[:=-]\s*)([^|\n\r]+)/im,
      ) ||
      rawText.match(
        /(?:(?:delivery\s*(?:location|address)?|delivered\s*to|dispatch\s*to|site\s*(?:location|address)?|destination)\s*[:=-]\s*)([^|\n\r]+)/i,
      );
    if (lineMatch && lineMatch[1].trim().length > 2) {
      fromText = sanitize(lineMatch[1]);
    }

    // 2. Multiline block fallback
    if (!fromText) {
      const blockMatch =
        rawText.match(
          /(?:delivery\s*(?:address|location)?|delivered\s*to|deliver\s*to|site\s*(?:address|location)?|destination|dispatch\s*to)\s*[:=-]?\s*([A-Za-z0-9\s,./#&'\"()\-]+?)(?:\s*(?:\||;|\n{2,}|payment\s*terms?|payment|terms?|rate|price|qty|quantity|make|brand|notes?|email|contact|phone|before|by|on\s+\d|gst\b)|$)/i,
        ) ||
        rawText.match(
          /(?:for\s+delivery\s+to|delivery\s+to|delivery\s+at|location|destination)\s+([A-Za-z0-9\s,./#&'\"()\-]+?)(?:\s+before|\s+by|\s+on|\s+within|\||$)/i,
        );
      if (blockMatch && blockMatch[1].trim().length > 2) {
        fromText = sanitize(blockMatch[1]);
      }
    }
  }

  let finalLoc = fromJson;
  if (fromText && fromText.length > fromJson.length) {
    finalLoc = fromText;
  } else if (!finalLoc) {
    finalLoc = fromText;
  }
  return sanitize(finalLoc);
}

function isGenuineInquiry(item: any): boolean {
  if (!item) return false;
  const rawText = (item.raw_text || '').trim();
  const aiJson = (item.ai_extraction_json as any) || {};

  // 1. All official inquiry types and source channels (WhatsApp, Dashboard & AI Assistant) are genuine
  const channel = String(item.source_channel || '').toLowerCase();
  if (
    item.inquiry_type === 'inquiry' ||
    item.inquiry_type === 'purchase_order' ||
    item.inquiry_type === 'quotation_sent' ||
    channel.includes('whatsapp') ||
    channel.includes('dashboard') ||
    channel.includes('assistant') ||
    channel.includes('chatbot') ||
    channel === 'manual' ||
    channel === 'form' ||
    channel === 'upload' ||
    item.source_channel === 'whatsapp' ||
    item.source_channel === 'whatsapp_text' ||
    item.source_channel === 'whatsapp_image' ||
    item.source_channel === 'whatsapp_po' ||
    item.source_channel === 'web_dashboard' ||
    item.source_channel === 'dashboard' ||
    item.source_channel === 'ai_assistant'
  ) {
    return true;
  }

  // 2. Document attachment is always genuine
  if (
    rawText.startsWith('[Inquiry Attachment:') ||
    rawText.startsWith('[Inquiry Document Attached]') ||
    rawText.startsWith('[PO Document Attached:') ||
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

  // 4. Has customer name
  if (
    item.sender_name ||
    item.customer_name ||
    aiJson.companyName ||
    aiJson.customer_name
  ) {
    return true;
  }
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

  // Reject synthetic / temporary test inquiries
  if (
    /test industries\s*\d*/i.test(rawText) ||
    /test customer\s*\d*/i.test(rawText) ||
    /test prospect\s*\d*/i.test(rawText) ||
    /^test\s+(industries|customer|corp|company)\b/i.test(
      item.customer_name || '',
    ) ||
    /^test\s+(industries|customer|corp|company)\b/i.test(
      aiJson.companyName || '',
    ) ||
    /^test\s+(industries|customer|corp|company)\b/i.test(
      aiJson.customer?.name || '',
    )
  ) {
    return false;
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
  empPhoneMap?: Map<string, string>,
  customerOwnerMap?: Map<string, string>,
): {
  customer_name: string;
  customer_phone: string;
  salesperson_name: string;
  assigned_salesperson_name: string;
  salesperson_phone: string;
  raw_salesperson_phone?: string | null;
  raw_sender_phone?: string | null;
  customer_owner_phone?: string | null;
  delivery_location: string;
  deliveryLocation: string;
  payment_terms: string;
  paymentTerms: string;
} {
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
    (item.source_channel === 'web_dashboard' ||
    item.source_channel === 'ai_assistant'
      ? item.sender_phone
      : '');

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

  // 3. Resolve Salesperson Name & Phone (with direct rep priority and CRM customer owner fallback)
  const assignedFromCust = getAssignedPhoneFromCustomerMap(
    extractedCustomerName,
    customerOwnerMap,
  );
  const validDirectSpPhone =
    item.salesperson_phone && isValidSalespersonPhone(item.salesperson_phone)
      ? item.salesperson_phone
      : null;
  const validCustOwnerPhone =
    assignedFromCust && isValidSalespersonPhone(assignedFromCust)
      ? assignedFromCust
      : null;
  const validSenderSpPhone =
    item.sender_phone && isValidSalespersonPhone(item.sender_phone)
      ? item.sender_phone
      : null;

  const effectiveSpPhone =
    validDirectSpPhone ||
    validCustOwnerPhone ||
    validSenderSpPhone ||
    (item.salesperson_phone &&
    item.salesperson_phone !== 'unassigned' &&
    item.salesperson_phone !== 'null'
      ? item.salesperson_phone
      : '') ||
    (item.sender_phone &&
    item.sender_phone !== 'unassigned' &&
    item.sender_phone !== 'null'
      ? item.sender_phone
      : '') ||
    '';
  const phone = effectiveSpPhone.replace(/\D/g, '');
  const p10 = phone.slice(-10);
  const resolvedSalesperson =
    (p10 && empPhoneMap?.get(p10)) ||
    (phone && empPhoneMap?.get(phone)) ||
    (item.salesperson_name && item.salesperson_name !== 'Sales Representative'
      ? item.salesperson_name
      : null) ||
    (item.assigned_salesperson_name ? item.assigned_salesperson_name : null) ||
    aiJson.salesperson_name ||
    aiJson.salespersonName ||
    (isSenderSalesperson && senderName ? senderName : null) ||
    (item.sender_name &&
    !item.sender_name.toLowerCase().includes('unknown') &&
    !item.sender_name.toLowerCase().includes('customer')
      ? item.sender_name
      : null) ||
    'Max';

  const extractedDeliveryLocation = extractCleanDeliveryLocation(
    item.raw_text,
    aiJson,
  );

  return {
    customer_name: extractedCustomerName,
    customer_phone: extractedCustomerPhone || '',
    salesperson_name: resolvedSalesperson,
    assigned_salesperson_name: resolvedSalesperson,
    salesperson_phone: effectiveSpPhone,
    raw_salesperson_phone: item.salesperson_phone || null,
    raw_sender_phone: item.sender_phone || null,
    customer_owner_phone: validCustOwnerPhone || null,
    delivery_location:
      item.delivery_location || extractedDeliveryLocation || '',
    deliveryLocation: item.delivery_location || extractedDeliveryLocation || '',
    payment_terms:
      item.payment_terms ||
      aiJson.payment_terms ||
      aiJson.paymentTerms ||
      aiJson.payment_term ||
      '',
    paymentTerms:
      item.payment_terms ||
      aiJson.payment_terms ||
      aiJson.paymentTerms ||
      aiJson.payment_term ||
      '',
  };
}

@Injectable()
export class InquiriesService implements OnModuleInit {
  private readonly logger = new Logger(InquiriesService.name);

  constructor(
    private supabaseService: SupabaseService,
    private dealsService: DealsService,
    private activityLogsService: ActivityLogsService,
    private zohoService: ZohoService,
    private unitConverterService?: UnitConverterService,
  ) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async onModuleInit() {
    // Keep server startup fast and lightweight
  }

  async backfillInquiryDealStages() {
    try {
      const [{ data: inquiries }, { data: deals }] = await Promise.all([
        this.supabase.from('inquiries').select('*'),
        this.supabase.from('deals').select('*'),
      ]);
      if (!inquiries || !deals) return;

      for (const inq of inquiries) {
        const ai = inq.ai_extraction_json || {};
        const custName = (
          inq.customer_name ||
          ai.companyName ||
          ai.customer_name ||
          inq.sender_name ||
          ''
        ).trim();
        let deal = deals.find((d: any) => d.inquiry_id === inq.id);
        if (!deal && custName) {
          deal = deals.find(
            (d: any) =>
              (d.customer_name || '').toLowerCase().trim() ===
              custName.toLowerCase().trim(),
          );
        }
        if (!deal) continue;

        const currentStage = (deal.stage || '').toLowerCase().trim();
        if (
          currentStage === 'won' ||
          currentStage === 'lost' ||
          currentStage === 'negotiation'
        ) {
          continue;
        }

        let targetStage = 'new_inquiry';
        const inqStatus = (inq.status || '').toLowerCase().trim();
        if (inqStatus === 'quoted' || inqStatus === 'quotation_sent') {
          targetStage = 'quoted';
        } else if (
          inqStatus === 'confirmed' ||
          inqStatus === 'saved' ||
          inqStatus === 'processed'
        ) {
          targetStage = 'qualified';
        } else if (
          inqStatus === 'review' ||
          inqStatus === 'needs_review' ||
          inqStatus === 'pending'
        ) {
          targetStage = 'new_inquiry';
        }

        if (currentStage !== targetStage) {
          await this.supabase
            .from('deals')
            .update({ stage: targetStage })
            .eq('id', deal.id);
        }
      }
    } catch (err: any) {
      this.logger.warn('Error in backfillInquiryDealStages:', err?.message);
    }
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
          'id, sender_name, sender_phone, raw_text, inquiry_type, status, source_channel, overall_confidence, ai_extraction_json, created_at, salesperson_phone, payment_terms, delivery_location, customer_name, customer_phone, stage, total_amount, po_number, reference_po_number, generated_po_number, po_source, po_status, po_generated_at, po_confirmed_at, po_date, won_at, lost_reason',
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

      // Note: Scoping by salesperson phone is done in Node after resolving customer owner mappings,
      // ensuring inquiries for assigned customers and sender reps are never prematurely dropped at DB layer.

      const { data, error } = await query;
      if (error) throw error;

      // Extract inquiry IDs to scope the deals query efficiently
      const inquiryIds = (data || []).map((inq: any) => inq.id).filter(Boolean);

      // Concurrently fetch deals, employees, and recurring_customers in parallel using Promise.all
      const [dealsRes, employeesRes, customersRes] = await Promise.all([
        inquiryIds.length > 0
          ? this.supabase
              .from('deals')
              .select(
                'inquiry_id, customer_name, customer_phone, salesperson_phone',
              )
              .in('inquiry_id', inquiryIds)
          : Promise.resolve({ data: [] }),
        this.supabase.from('employees').select('name, phone'),
        this.supabase
          .from('recurring_customers')
          .select(
            'customer_name, assigned_salesperson_phone, is_active, updated_at',
          ),
      ]);

      const deals = dealsRes.data || [];
      const employees = employeesRes.data || [];
      const customers = customersRes.data || [];

      const dealByInqId = new Map<string, string>();
      const dealByName = new Map<string, string>();
      const dealSpByInqId = new Map<string, string>();
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
        if (d.inquiry_id && d.salesperson_phone) {
          dealSpByInqId.set(d.inquiry_id, d.salesperson_phone);
        }
      });

      const empPhoneMap = new Map<string, string>();
      employees?.forEach((e: any) => {
        if (e.name && e.phone) {
          const clean = String(e.phone).replace(/\D/g, '');
          empPhoneMap.set(clean, e.name);
          empPhoneMap.set(clean.slice(-10), e.name);
        }
      });

      const customerOwnerMap = buildCustomerOwnerMap(customers, empPhoneMap);

      // Filter out spurious non-inquiry records (chatbot queries, visit logs, greetings)
      const genuineData = (data || []).filter(isGenuineInquiry);

      // Clean list with accurate customer and salesperson entities and lightweight media indicators
      const lightweightData = genuineData.map((item: any) => {
        const hasAttachment =
          item.raw_text?.includes('[Inquiry Attachment:') ||
          Boolean(item.ai_extraction_json) ||
          item.source_channel === 'whatsapp' ||
          item.source_channel === 'whatsapp_image';

        const entities = resolveInquiryEntities(
          item,
          dealByInqId,
          dealByName,
          empPhoneMap,
          customerOwnerMap,
        );

        // Strip duplicate nested base64 data from ai_extraction_json for high performance list transfer
        let cleanAiJson = item.ai_extraction_json;
        if (cleanAiJson && typeof cleanAiJson === 'object') {
          cleanAiJson = { ...cleanAiJson };
          if (cleanAiJson.media_urls) delete cleanAiJson.media_urls;
          if (cleanAiJson.image_base64) delete cleanAiJson.image_base64;
          if (cleanAiJson.file_base64) delete cleanAiJson.file_base64;
          if (entities.delivery_location) {
            cleanAiJson.delivery_location = entities.delivery_location;
            cleanAiJson.deliveryLocation = entities.delivery_location;
          }
          if (entities.payment_terms) {
            cleanAiJson.payment_terms = entities.payment_terms;
            cleanAiJson.paymentTerms = entities.payment_terms;
          }
        }

        return {
          ...item,
          ...entities,
          ai_extraction_json: cleanAiJson,
          has_media: hasAttachment,
          media_urls: hasAttachment ? ['attached_document'] : [],
        };
      });

      // Strict RBAC scope enforcement for Salesperson and Sales Manager personas
      const reqPhones = filters?.salespersonPhones || filters?.salespersonPhone;
      let scopedData = lightweightData;
      if (reqPhones) {
        const phoneList = Array.isArray(reqPhones) ? reqPhones : [reqPhones];
        const allowedPhoneSet = new Set(
          phoneList
            .map((p: string) => String(p).replace(/\D/g, '').slice(-10))
            .filter(Boolean),
        );
        scopedData = lightweightData.filter((item: any) => {
          const spPhoneClean = (item.salesperson_phone || '')
            .replace(/\D/g, '')
            .slice(-10);
          const rawSpClean = (item.raw_salesperson_phone || '')
            .replace(/\D/g, '')
            .slice(-10);
          const senderClean = (item.sender_phone || '')
            .replace(/\D/g, '')
            .slice(-10);
          const custOwnerClean = (item.customer_owner_phone || '')
            .replace(/\D/g, '')
            .slice(-10);
          const dealSpClean = (dealSpByInqId.get(item.id) || '')
            .replace(/\D/g, '')
            .slice(-10);

          return (
            allowedPhoneSet.has(spPhoneClean) ||
            allowedPhoneSet.has(rawSpClean) ||
            allowedPhoneSet.has(senderClean) ||
            allowedPhoneSet.has(custOwnerClean) ||
            allowedPhoneSet.has(dealSpClean)
          );
        });
      }

      // Strict backend sort guarantee: always newest first
      scopedData.sort((a: any, b: any) => {
        const timeA = new Date(a.created_at || 0).getTime() || 0;
        const timeB = new Date(b.created_at || 0).getTime() || 0;
        if (timeB !== timeA) return timeB - timeA;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });

      return scopedData;
    } catch (error) {
      this.logger.error('Error in findAll:', error);
      throw error;
    }
  }

  async findOne(id: string, accessiblePhones?: string[] | null) {
    try {
      const { data, error } = await this.supabase
        .from('inquiries')
        .select('*')
        .eq('id', id)
        .single();
      if (error || !data) {
        throw new NotFoundException('Inquiry not found');
      }

      if (accessiblePhones && accessiblePhones.length > 0) {
        const hasAccess =
          phoneInList(data.salesperson_phone, accessiblePhones) ||
          phoneInList(data.sender_phone, accessiblePhones);
        if (!hasAccess) {
          throw new ForbiddenException(
            'Access Denied: You do not have permission to view this inquiry.',
          );
        }
      }

      if (data) {
        const [dealsRes, employeesRes] = await Promise.all([
          this.supabase
            .from('deals')
            .select('inquiry_id, customer_name, customer_phone')
            .eq('inquiry_id', id),
          this.supabase.from('employees').select('name, phone'),
        ]);

        const deals = dealsRes.data || [];
        const employees = employeesRes.data || [];

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

        const empPhoneMap = new Map<string, string>();
        employees?.forEach((e: any) => {
          if (e.name && e.phone) {
            const clean = String(e.phone).replace(/\D/g, '');
            empPhoneMap.set(clean, e.name);
            empPhoneMap.set(clean.slice(-10), e.name);
          }
        });

        const entities = resolveInquiryEntities(
          data,
          dealByInqId,
          dealByName,
          empPhoneMap,
        );
        let cleanAiJson = data.ai_extraction_json;
        if (cleanAiJson && typeof cleanAiJson === 'object') {
          cleanAiJson = { ...cleanAiJson };
          if (entities.delivery_location) {
            cleanAiJson.delivery_location = entities.delivery_location;
            cleanAiJson.deliveryLocation = entities.delivery_location;
          }
          if (entities.payment_terms) {
            cleanAiJson.payment_terms = entities.payment_terms;
            cleanAiJson.paymentTerms = entities.payment_terms;
          }
        }
        return {
          ...data,
          ...entities,
          ai_extraction_json: cleanAiJson,
        };
      }
      return data;
    } catch (error) {
      this.logger.error(`Error in findOne for id ${id}:`, error);
      throw error;
    }
  }

  async deleteInquiry(id: string, accessiblePhones?: string[] | null) {
    try {
      this.logger.log(`Deleting inquiry ${id} and associated records...`);

      const { data: inquiry, error: fetchErr } = await this.supabase
        .from('inquiries')
        .select('id, sender_phone, salesperson_phone')
        .eq('id', id)
        .single();

      if (fetchErr || !inquiry) {
        throw new NotFoundException('Inquiry not found');
      }

      if (accessiblePhones && accessiblePhones.length > 0) {
        const hasAccess =
          phoneInList(inquiry.salesperson_phone, accessiblePhones) ||
          phoneInList(inquiry.sender_phone, accessiblePhones);
        if (!hasAccess) {
          throw new ForbiddenException(
            'Access Denied: You do not have permission to delete this inquiry.',
          );
        }
      }

      // Delete associated deals if any
      const { data: deals } = await this.supabase
        .from('deals')
        .select('id')
        .eq('inquiry_id', id);

      if (deals && deals.length > 0) {
        for (const d of deals) {
          await this.dealsService.deleteDeal(d.id, accessiblePhones);
        }
      }

      const { error: delErr } = await this.supabase
        .from('inquiries')
        .delete()
        .eq('id', id);

      if (delErr) throw delErr;

      return { success: true, message: 'Inquiry deleted successfully' };
    } catch (error) {
      this.logger.error('Error in deleteInquiry:', error);
      throw error;
    }
  }

  async findReviewQueue(
    salespersonPhones?: string[] | string,
    from?: string,
    to?: string,
  ) {
    try {
      if (Array.isArray(salespersonPhones) && salespersonPhones.length === 0) {
        return [];
      }

      let query = this.supabase
        .from('inquiries')
        .select('*')
        .in('status', ['review', 'pending', 'new', 'draft'])
        .order('created_at', { ascending: false });

      if (from) {
        const fromDate = from.includes('T') ? from : `${from}T00:00:00.000Z`;
        query = query.gte('created_at', fromDate);
      }
      if (to) {
        const toDate = to.includes('T') ? to : `${to}T23:59:59.999Z`;
        query = query.lte('created_at', toDate);
      }

      // Note: Scoping by salesperson phone is done in Node after resolving customer owner mappings,
      // ensuring inquiries for assigned customers and sender reps are never prematurely dropped at DB layer.

      const { data, error } = await query;
      if (error) throw error;

      const inquiryIds = (data || []).map((inq: any) => inq.id).filter(Boolean);
      const [dealsRes, employeesRes, customersRes] = await Promise.all([
        inquiryIds.length > 0
          ? this.supabase
              .from('deals')
              .select(
                'inquiry_id, customer_name, customer_phone, salesperson_phone',
              )
              .in('inquiry_id', inquiryIds)
          : Promise.resolve({ data: [] }),
        this.supabase.from('employees').select('name, phone'),
        this.supabase
          .from('recurring_customers')
          .select(
            'customer_name, assigned_salesperson_phone, is_active, updated_at',
          ),
      ]);

      const deals = dealsRes.data || [];
      const employees = employeesRes.data || [];
      const customers = customersRes.data || [];

      const dealByInqId = new Map<string, string>();
      const dealByName = new Map<string, string>();
      const dealSpByInqId = new Map<string, string>();
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
        if (d.inquiry_id && d.salesperson_phone) {
          dealSpByInqId.set(d.inquiry_id, d.salesperson_phone);
        }
      });

      const empPhoneMap = new Map<string, string>();
      employees?.forEach((e: any) => {
        if (e.name && e.phone) {
          const clean = String(e.phone).replace(/\D/g, '');
          empPhoneMap.set(clean, e.name);
          empPhoneMap.set(clean.slice(-10), e.name);
        }
      });

      const customerOwnerMap = buildCustomerOwnerMap(customers, empPhoneMap);

      const reviewList = (data || []).map((row: any) => {
        const entities = resolveInquiryEntities(
          row,
          dealByInqId,
          dealByName,
          empPhoneMap,
          customerOwnerMap,
        );
        const hasMedia = Boolean(
          row.media_urls &&
          Array.isArray(row.media_urls) &&
          row.media_urls.length > 0,
        );
        return {
          ...row,
          ...entities,
          has_media: hasMedia,
          media_urls: hasMedia
            ? Array.isArray(row.media_urls) &&
              row.media_urls.length > 0 &&
              (row.media_urls[0].startsWith('http') ||
                row.media_urls[0].startsWith('data:'))
              ? row.media_urls
              : ['attached_document']
            : [],
        };
      });

      let scopedReviewList = reviewList;
      if (salespersonPhones) {
        const phoneList = Array.isArray(salespersonPhones)
          ? salespersonPhones
          : [salespersonPhones];
        const allowedPhoneSet = new Set(
          phoneList
            .map((p: string) => String(p).replace(/\D/g, '').slice(-10))
            .filter(Boolean),
        );
        scopedReviewList = reviewList.filter((item: any) => {
          const spPhoneClean = (item.salesperson_phone || '')
            .replace(/\D/g, '')
            .slice(-10);
          const rawSpClean = (item.raw_salesperson_phone || '')
            .replace(/\D/g, '')
            .slice(-10);
          const senderClean = (item.sender_phone || '')
            .replace(/\D/g, '')
            .slice(-10);
          const custOwnerClean = (item.customer_owner_phone || '')
            .replace(/\D/g, '')
            .slice(-10);
          const dealSpClean = (dealSpByInqId.get(item.id) || '')
            .replace(/\D/g, '')
            .slice(-10);

          return (
            allowedPhoneSet.has(spPhoneClean) ||
            allowedPhoneSet.has(rawSpClean) ||
            allowedPhoneSet.has(senderClean) ||
            allowedPhoneSet.has(custOwnerClean) ||
            allowedPhoneSet.has(dealSpClean)
          );
        });
      }

      // Strict backend sort guarantee: always newest first
      scopedReviewList.sort((a: any, b: any) => {
        const timeA = new Date(a.created_at || 0).getTime() || 0;
        const timeB = new Date(b.created_at || 0).getTime() || 0;
        if (timeB !== timeA) return timeB - timeA;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });

      return scopedReviewList;
    } catch (error) {
      this.logger.error('Error in findReviewQueue:', error);
      throw error;
    }
  }

  async updateStatus(
    id: string,
    status: string,
    details?: any,
    accessiblePhones?: string[] | null,
  ) {
    try {
      const { data: existingInq, error: fetchErr } = await this.supabase
        .from('inquiries')
        .select('id, salesperson_phone, sender_phone, ai_extraction_json')
        .eq('id', id)
        .single();
      if (fetchErr || !existingInq) {
        throw new NotFoundException('Inquiry not found');
      }

      if (accessiblePhones && accessiblePhones.length > 0) {
        const hasAccess =
          phoneInList(existingInq.salesperson_phone, accessiblePhones) ||
          phoneInList(existingInq.sender_phone, accessiblePhones);
        if (!hasAccess) {
          throw new ForbiddenException(
            'Access Denied: You do not have permission to update this inquiry.',
          );
        }
      }

      // Backend Save Gate: Cannot transition to confirmed or quoted if any line item has Rate <= 0 or Quantity <= 0
      if (status === 'confirmed' || status === 'quoted') {
        const lineItems = details?.lineItems || details?.line_items || [];
        if (!Array.isArray(lineItems) || lineItems.length === 0) {
          throw new BadRequestException(
            'Cannot save inquiry: At least one line item is required.',
          );
        }
        for (let i = 0; i < lineItems.length; i++) {
          const item = lineItems[i];
          if (!item.sku_text || !item.sku_text.trim()) {
            throw new BadRequestException(
              `Cannot save inquiry: Description is required for Item #${i + 1}.`,
            );
          }
          if (
            item.quantity === null ||
            item.quantity === undefined ||
            item.quantity === '' ||
            Number(item.quantity) <= 0 ||
            isNaN(Number(item.quantity))
          ) {
            throw new BadRequestException(
              `Cannot save inquiry: Quantity must be greater than 0 for Item #${i + 1}.`,
            );
          }
          // Rate is permitted to be 0 or blank/empty when saving an inquiry (excluded later from quotation PDF)
          if (
            item.rate !== null &&
            item.rate !== undefined &&
            item.rate !== '' &&
            (isNaN(Number(item.rate)) || Number(item.rate) < 0)
          ) {
            throw new BadRequestException(
              `Cannot save inquiry: Rate (₹) cannot be negative for Item #${i + 1}.`,
            );
          }
        }
        if (!details?.companyName && !details?.customer_name) {
          throw new BadRequestException(
            'Cannot save inquiry: Company Name is required.',
          );
        }
      }

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
        const priorSharedAt = (existingInq as any)?.ai_extraction_json
          ?.quotation_shared_at;
        updatePayload.ai_extraction_json =
          priorSharedAt && !details.quotation_shared_at
            ? { ...details, quotation_shared_at: priorSharedAt }
            : details;
      }

      const { data, error } = await this.supabase
        .from('inquiries')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      // Automatically sync to pipeline / deals with strict status-to-stage mapping
      if (status === 'quoted' || status === 'quotation_sent') {
        await this.syncInquiryToDeal(id, 'quoted', details);
      } else if (
        status === 'confirmed' ||
        status === 'saved' ||
        status === 'processed'
      ) {
        await this.syncInquiryToDeal(id, 'qualified', details);
      } else if (
        status === 'review' ||
        status === 'needs_review' ||
        status === 'pending'
      ) {
        await this.syncInquiryToDeal(id, 'new_inquiry', details);
      } else if (status === 'lost') {
        await this.syncInquiryToDeal(id, 'lost', details);
      } else if (status === 'won') {
        await this.syncInquiryToDeal(id, 'won', details);
      } else if (status === 'negotiation') {
        await this.syncInquiryToDeal(id, 'negotiation', details);
      } else if (status === 'on_hold' || status === 'hold') {
        await this.syncInquiryToDeal(id, 'on_hold', details);
      } else {
        await this.syncInquiryToDeal(id, details?.stage || undefined, details);
      }

      // Non-blocking activity log
      try {
        const custName =
          (data as any)?.customer_name ||
          (data?.ai_extraction_json as any)?.companyName ||
          (data?.ai_extraction_json as any)?.customer_name ||
          data?.sender_name ||
          'Customer';
        this.activityLogsService.logActivity({
          salesperson_name:
            (data as any)?.assigned_salesperson_name || 'Sales Team',
          salesperson_phone: (data as any)?.salesperson_phone || null,
          description: `Inquiry status for ${custName} updated to ${status}`,
          module: 'Inquiries',
          customer_name: custName,
        });
      } catch (actErr: any) {
        this.logger.warn('Non-blocking activity log notice:', actErr?.message);
      }

      return data;
    } catch (error) {
      this.logger.error(`Error in updateStatus for id ${id}:`, error);
      throw error;
    }
  }

  async getStats(
    salespersonPhones?: string[] | string,
    from?: string,
    to?: string,
  ) {
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

      if (from) {
        const fromDate = from.includes('T') ? from : `${from}T00:00:00.000Z`;
        query = query.gte('created_at', fromDate);
      }
      if (to) {
        const toDate = to.includes('T') ? to : `${to}T23:59:59.999Z`;
        query = query.lte('created_at', toDate);
      }

      // Note: Scoping by salesperson phone is done in Node after resolving customer owner mappings,
      // ensuring inquiries for assigned customers and sender reps are never prematurely dropped at DB layer.

      const [{ data, error }, { data: customers }, { data: employees }] =
        await Promise.all([
          query,
          this.supabase
            .from('recurring_customers')
            .select(
              'customer_name, assigned_salesperson_phone, is_active, updated_at',
            ),
          this.supabase.from('employees').select('name, phone'),
        ]);
      if (error) throw error;

      const empPhoneMap = new Map<string, string>();
      employees?.forEach((e: any) => {
        if (e.name && e.phone) {
          const clean = String(e.phone).replace(/\D/g, '');
          empPhoneMap.set(clean, e.name);
          empPhoneMap.set(clean.slice(-10), e.name);
        }
      });

      const customerOwnerMap = buildCustomerOwnerMap(customers, empPhoneMap);

      const genuineData = (data || []).filter(isGenuineInquiry);

      let scopedGenuine = genuineData;
      if (salespersonPhones) {
        const phoneList = Array.isArray(salespersonPhones)
          ? salespersonPhones
          : [salespersonPhones];
        const allowedPhoneSet = new Set(
          phoneList
            .map((p: string) => String(p).replace(/\D/g, '').slice(-10))
            .filter(Boolean),
        );
        scopedGenuine = genuineData.filter((item: any) => {
          const entities = resolveInquiryEntities(
            item,
            undefined,
            undefined,
            empPhoneMap,
            customerOwnerMap,
          );
          const spPhoneClean = (entities.salesperson_phone || '')
            .replace(/\D/g, '')
            .slice(-10);
          const rawSpClean = (item.salesperson_phone || '')
            .replace(/\D/g, '')
            .slice(-10);
          const senderClean = (item.sender_phone || '')
            .replace(/\D/g, '')
            .slice(-10);
          const custOwnerClean = (entities.customer_owner_phone || '')
            .replace(/\D/g, '')
            .slice(-10);

          return (
            allowedPhoneSet.has(spPhoneClean) ||
            allowedPhoneSet.has(rawSpClean) ||
            allowedPhoneSet.has(senderClean) ||
            allowedPhoneSet.has(custOwnerClean)
          );
        });
      }

      return {
        total: scopedGenuine.length,
        pending: scopedGenuine.filter((i) => i.status === 'pending').length,
        processed: scopedGenuine.filter((i) => i.status === 'processed').length,
        review: scopedGenuine.filter((i) =>
          ['review', 'needs_review'].includes(i.status),
        ).length,
        by_channel: {
          whatsapp: scopedGenuine.filter((i) => i.source_channel === 'whatsapp')
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

    // If raw_text is provided, auto-extract details via Gemini if line_items is empty or needs extraction
    const rawText = data.raw_text || data.requirement || '';
    if (
      rawText &&
      rawText.length > 15 &&
      (!aiExtractionJson.line_items ||
        aiExtractionJson.line_items.length === 0 ||
        (aiExtractionJson.line_items.length === 1 &&
          (aiExtractionJson.line_items[0].sku_text?.length > 30 ||
            aiExtractionJson.line_items[0].quantity === 0)))
    ) {
      try {
        const textExtract = await this.parseTextWithGemini(rawText);
        if (textExtract.success && textExtract.data) {
          const ext = textExtract.data;
          if (Array.isArray(ext.line_items) && ext.line_items.length > 0) {
            aiExtractionJson.line_items = ext.line_items;
          }
          if (
            ext.customer_name &&
            (!customerName || customerName === 'Salesperson')
          ) {
            aiExtractionJson.customer_name = ext.customer_name;
            aiExtractionJson.companyName = ext.customer_name;
            if (aiExtractionJson.customer)
              aiExtractionJson.customer.name = ext.customer_name;
          }
          if (ext.customer_phone && !customerPhone) {
            aiExtractionJson.customer_phone = ext.customer_phone;
            if (aiExtractionJson.customer)
              aiExtractionJson.customer.phone = ext.customer_phone;
          }
          if (ext.delivery_location) {
            aiExtractionJson.delivery_location = ext.delivery_location;
            aiExtractionJson.deliveryLocation = ext.delivery_location;
          }
          if (ext.preferred_make) {
            aiExtractionJson.preferred_make = ext.preferred_make;
            aiExtractionJson.make = ext.preferred_make;
          }
          if (ext.payment_terms) {
            aiExtractionJson.payment_terms = ext.payment_terms;
            aiExtractionJson.paymentTerms = ext.payment_terms;
          }
        }
      } catch (err: any) {
        this.logger.warn('Auto text extraction warning:', err.message);
      }
    }

    const finalCustomerName =
      aiExtractionJson.customer_name ||
      aiExtractionJson.companyName ||
      customerName ||
      'Customer';

    let effectiveSalespersonPhone =
      salespersonPhone || data.salesperson_phone || '910000000000';

    if (finalCustomerName && finalCustomerName !== 'Customer') {
      try {
        const { data: matchedCust } = await this.supabase
          .from('recurring_customers')
          .select('assigned_salesperson_phone')
          .ilike('customer_name', finalCustomerName.trim())
          .limit(1);
        if (
          matchedCust &&
          matchedCust.length > 0 &&
          matchedCust[0].assigned_salesperson_phone
        ) {
          effectiveSalespersonPhone = matchedCust[0].assigned_salesperson_phone;
        }
      } catch (custLookupErr: any) {
        this.logger.warn(
          'Customer salesperson lookup warning:',
          custLookupErr.message,
        );
      }
    }

    const payload: any = {
      source_channel: data.source_channel || 'web_dashboard',
      raw_text: rawText,
      media_urls: data.media_urls || [],
      sender_phone:
        data.sender_phone || data.customer_phone || salespersonPhone || '',
      sender_name: finalCustomerName,
      status: data.status || 'review',
      salesperson_phone: effectiveSalespersonPhone,
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

    if (finalCustomerName && finalCustomerName !== 'Customer') {
      try {
        const { data: existing } = await this.supabase
          .from('recurring_customers')
          .select('id')
          .ilike('customer_name', finalCustomerName.trim())
          .limit(1);

        if (!existing || existing.length === 0) {
          await this.supabase.from('recurring_customers').insert({
            customer_name: finalCustomerName.trim(),
            customer_phone: customerPhone || data.sender_phone || null,
            avg_order_frequency_days: 30,
            is_active: true,
            assigned_salesperson_phone:
              salespersonPhone || data.salesperson_phone || null,
            created_at: nowIso,
          });
        }
      } catch (err: any) {
        this.logger.warn(
          `Non-blocking customer sync on inquiry create: ${err?.message}`,
        );
      }
    }

    // Automatically sync new inquiry to Deals / Pipeline under 'new_inquiry'
    try {
      await this.syncInquiryToDeal(created.id, 'new_inquiry', aiExtractionJson);
    } catch (dealErr: any) {
      this.logger.warn('Non-blocking deal sync notice:', dealErr?.message);
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

    // Log to activity_logs
    try {
      const channelLabel =
        payload.source_channel === 'whatsapp_text'
          ? 'WhatsApp'
          : payload.source_channel === 'whatsapp_image'
            ? 'WhatsApp Image'
            : payload.source_channel === 'purchase_order'
              ? 'WhatsApp PO'
              : 'Dashboard';
      this.activityLogsService.logActivity({
        salesperson_name:
          (created as any)?.assigned_salesperson_name || 'Sales Team',
        salesperson_phone:
          salespersonPhone || created.salesperson_phone || null,
        description: `New inquiry received from ${finalCustomerName} via ${channelLabel}`,
        module: 'Inquiries',
        customer_name: finalCustomerName,
      });
    } catch (actErr: any) {
      this.logger.warn('Non-blocking activity log notice:', actErr?.message);
    }

    return created;
  }

  async syncInquiryToDeal(
    inquiryId: string,
    stage?: string,
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
        extractCleanDeliveryLocation(inquiry.raw_text, details) ||
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

      let subtotal = 0;
      let hasValidRates = false;

      if (Array.isArray(lineItemsSrc) && lineItemsSrc.length > 0) {
        subtotal = lineItemsSrc.reduce((s: number, item: any) => {
          const rawQty = Number(item.original_quantity ?? item.quantity) || 0;
          const rawUnit = item.original_unit || item.unit || 'MT';
          const r = Number(item.rate) || 0;
          if (r > 0) hasValidRates = true;
          const calc = calculateLineItem({
            ...item,
            quantity: rawQty,
            unit: rawUnit,
            rate: r,
          });
          return s + (Number(item.amount) || calc.amount);
        }, 0);
      }

      let grandTotal: number | null = null;
      if (hasValidRates && subtotal > 0) {
        // Grand Total = Subtotal + 18% GST
        const gst = Math.round(subtotal * 0.18);
        grandTotal = subtotal + gst;
      } else if (Number(details.grandTotal || details.grand_total || 0) > 0) {
        grandTotal = Number(details.grandTotal || details.grand_total);
      } else if (Number(details.totalAmount || details.total_amount || 0) > 0) {
        const rawBase = Number(details.totalAmount || details.total_amount);
        grandTotal = rawBase + Math.round(rawBase * 0.18);
      }

      const sourcePoNumber =
        details.po_number ||
        details.poNumber ||
        aiJson.poNumber ||
        aiJson.po_number ||
        inquiry.po_number ||
        undefined;
      const requestedSystemPo =
        details.system_po_number ||
        details.internal_po_number ||
        (details.edit_system_po || details._editing_system_po
          ? sourcePoNumber
          : null);
      const referencePoNumber =
        details.reference_po_number ||
        details.referencePoNumber ||
        aiJson.reference_po_number ||
        aiJson.referencePoNumber ||
        inquiry.reference_po_number ||
        (!requestedSystemPo ? sourcePoNumber : null) ||
        undefined;
      const poDate =
        details.po_date ||
        details.poDate ||
        aiJson.poDate ||
        aiJson.po_date ||
        inquiry.po_date ||
        undefined;

      // Check if a deal already exists for this inquiry
      const { data: existingDeals } = await this.supabase
        .from('deals')
        .select(
          'id, stage, po_number, reference_po_number, generated_po_number, po_generated_at, inquiry_id',
        )
        .eq('inquiry_id', inquiryId)
        .limit(1);

      let dealId: string;
      let poNumber: string | null = null;
      let generatedPoNumber: string | null = null;
      let poSource: string | null = null;
      let poGeneratedAt: string | null = null;
      let poReservationToken: string | null = null;
      const targetStage = stage || existingDeals?.[0]?.stage || 'new_inquiry';

      if (targetStage === 'won') {
        const poResolution = await this.dealsService.resolvePoNumbers({
          requestedPo: requestedSystemPo,
          generatedPo: details.generated_po_number,
          referencePo: referencePoNumber,
          reservationToken:
            details.po_reservation_token ||
            `inquiry-stage:${inquiryId}:${Date.now()}`,
          existingDeal: existingDeals?.[0] || null,
          dealId: existingDeals?.[0]?.id || null,
        });
        poNumber = poResolution.poNumber;
        generatedPoNumber = poResolution.generatedPoNumber;
        poSource = poResolution.poSource;
        poGeneratedAt = poResolution.poGeneratedAt;
        poReservationToken = poResolution.reservationToken;
        await this.dealsService.claimPoNumber(
          poNumber,
          poReservationToken,
          existingDeals?.[0]?.id || null,
        );
      }

      if (existingDeals && existingDeals.length > 0) {
        dealId = existingDeals[0].id;
        const dealUpdatePayload: any = {
          stage: targetStage,
          customer_name: customerName,
          customer_phone: customerPhone || undefined,
          salesperson_phone: salespersonPhone,
          delivery_location: deliveryLocation || undefined,
          payment_terms: paymentTerms || undefined,
          total_amount:
            grandTotal !== null && grandTotal > 0 ? grandTotal : null,
          status: 'auto_created',
        };
        if (poNumber) {
          dealUpdatePayload.po_number = poNumber;
          dealUpdatePayload.reference_po_number = referencePoNumber || null;
          dealUpdatePayload.generated_po_number = generatedPoNumber;
          dealUpdatePayload.po_source = poSource;
          dealUpdatePayload.po_status = 'confirmed';
          dealUpdatePayload.po_generated_at = poGeneratedAt;
          dealUpdatePayload.po_confirmed_at = new Date().toISOString();
        }
        if (poDate) dealUpdatePayload.po_date = poDate;
        if (targetStage === 'lost') {
          dealUpdatePayload.lost_reason =
            details.lost_reason ||
            details.lostReason ||
            details.loss_reason ||
            inquiry.lost_reason ||
            null;
        } else if (targetStage === 'won') {
          dealUpdatePayload.won_at = new Date().toISOString();
        }

        await this.supabase
          .from('deals')
          .update(dealUpdatePayload)
          .eq('id', dealId);
      } else {
        const dealInsertPayload: any = {
          id: inquiryId,
          inquiry_id: inquiryId,
          stage: targetStage,
          customer_name: customerName,
          customer_phone: customerPhone || null,
          salesperson_phone: salespersonPhone,
          delivery_location: deliveryLocation || null,
          payment_terms: paymentTerms || null,
          total_amount:
            grandTotal !== null && grandTotal > 0 ? grandTotal : null,
          inquiry_type: inquiry.inquiry_type || 'Product Requirement',
          status: 'auto_created',
          overall_confidence: Number(inquiry.overall_confidence) || 0.95,
          created_at: new Date().toISOString(),
        };
        if (poNumber) {
          dealInsertPayload.po_number = poNumber;
          dealInsertPayload.reference_po_number = referencePoNumber || null;
          dealInsertPayload.generated_po_number = generatedPoNumber;
          dealInsertPayload.po_source = poSource;
          dealInsertPayload.po_status = 'confirmed';
          dealInsertPayload.po_generated_at = poGeneratedAt;
          dealInsertPayload.po_confirmed_at = new Date().toISOString();
        }
        if (poDate) dealInsertPayload.po_date = poDate;
        if (targetStage === 'lost') {
          dealInsertPayload.lost_reason =
            details.lost_reason ||
            details.lostReason ||
            details.loss_reason ||
            inquiry.lost_reason ||
            null;
        } else if (targetStage === 'won') {
          dealInsertPayload.won_at = new Date().toISOString();
        }

        const { data: newDeal, error: dealError } = await this.supabase
          .from('deals')
          .insert(dealInsertPayload)
          .select()
          .single();

        if (dealError) {
          this.logger.error('Error inserting deal for inquiry:', dealError);
          return null;
        }
        dealId = newDeal.id;
        if (poNumber) {
          await this.dealsService.claimPoNumber(
            poNumber,
            poReservationToken,
            dealId,
          );
        }
      }

      // Sync pipeline fields directly back onto inquiries table
      await this.supabase
        .from('inquiries')
        .update({
          stage: stage || 'new_inquiry',
          customer_name: customerName,
          customer_phone: customerPhone || null,
          delivery_location: deliveryLocation || null,
          payment_terms: paymentTerms || null,
          total_amount:
            grandTotal !== null && grandTotal > 0 ? grandTotal : null,
          po_number: poNumber || null,
          reference_po_number: poNumber ? referencePoNumber || null : undefined,
          generated_po_number: poNumber ? generatedPoNumber : undefined,
          po_source: poNumber ? poSource : undefined,
          po_status: poNumber ? 'confirmed' : undefined,
          po_generated_at: poNumber ? poGeneratedAt : undefined,
          po_confirmed_at: poNumber ? new Date().toISOString() : undefined,
          po_date: poDate || null,
        })
        .eq('id', inquiryId);

      // Save / update line items in inquiry_items (canonical) and deal_items (legacy mirror)
      if (Array.isArray(lineItemsSrc) && lineItemsSrc.length > 0) {
        // Delete old items to prevent duplicates
        await this.supabase
          .from('inquiry_items')
          .delete()
          .eq('inquiry_id', inquiryId);
        await this.supabase.from('deal_items').delete().eq('deal_id', dealId);

        const dealItemsToInsert = lineItemsSrc.map((item: any) => {
          const rawQty = Number(item.original_quantity ?? item.quantity) || 0;
          const rawUnit = item.original_unit || item.unit || 'MT';
          const r = Number(item.rate) || 0;
          const calc = calculateLineItem({
            ...item,
            quantity: rawQty,
            unit: rawUnit,
            rate: r,
          });
          return {
            deal_id: dealId,
            sku_text:
              item.sku_text ||
              item.description ||
              item.product_name ||
              'Material',
            dimensions: item.dimensions || item.spec || null,
            grade: item.grade || null,
            quantity: calc.quantity,
            unit: calc.unit,
            rate: calc.rate,
            amount: calc.amount,
            confidence: 0.95,
            created_at: new Date().toISOString(),
          };
        });

        const inqItemsToInsert = dealItemsToInsert.map((it) => ({
          inquiry_id: inquiryId,
          sku_text: it.sku_text,
          dimensions: it.dimensions,
          grade: it.grade,
          quantity: it.quantity,
          unit: it.unit,
          rate: it.rate,
          amount: it.amount,
          confidence: it.confidence,
          created_at: it.created_at,
        }));

        await Promise.all([
          this.supabase.from('inquiry_items').insert(inqItemsToInsert),
          this.supabase.from('deal_items').insert(dealItemsToInsert),
        ]);
      }

      // Automatically trigger live Zoho Bigin sync
      if (dealId) {
        Promise.resolve(
          this.supabase
            .from('deals')
            .select('*, deal_items(*)')
            .eq('id', dealId)
            .single(),
        )
          .then(({ data: dealToSync }) => {
            if (dealToSync) {
              this.zohoService
                .syncDealToBigin(dealToSync)
                .catch((err: any) =>
                  this.logger.warn(
                    `Zoho live sync notice for deal ${dealId}: ${err?.message}`,
                  ),
                );
            }
          })
          .catch(() => {});
      }

      // Non-blocking activity log
      try {
        const custName = customerName || 'Customer';
        const hexId = inquiryId.replace(/-/g, '').slice(0, 6).toUpperCase();
        this.activityLogsService.logActivity({
          salesperson_phone: salespersonPhone || null,
          description: `Inquiry INQ-${hexId} details updated for ${custName}${stage ? ` (Stage: ${stage})` : ''}`,
          module: 'Inquiries',
          customer_name: custName,
          entity_id: inquiryId,
          entity_type: 'inquiry',
          action_type: 'inquiry_updated',
        });
      } catch (actErr: any) {
        this.logger.warn('Non-blocking activity log notice:', actErr?.message);
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

  private isValidEmail(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    );
  }

  private async resolveQuotationSenderEmail(employee: any): Promise<string> {
    const directEmail = String(employee?.email || '')
      .trim()
      .toLowerCase();
    if (this.isValidEmail(directEmail)) return directEmail;

    const employeeId = String(
      employee?.employee_id || employee?.id || '',
    ).trim();
    const phone = String(employee?.phone || '')
      .replace(/\D/g, '')
      .slice(-10);
    const filters = [
      employeeId ? `employee_id.eq.${employeeId}` : null,
      employee?.id ? `id.eq.${employee.id}` : null,
      phone ? `phone.ilike.%${phone}` : null,
    ].filter(Boolean);

    if (filters.length > 0) {
      const { data } = await this.supabase
        .from('employees')
        .select('email')
        .or(filters.join(','))
        .limit(1)
        .maybeSingle();
      const employeeEmail = String(data?.email || '')
        .trim()
        .toLowerCase();
      if (this.isValidEmail(employeeEmail)) return employeeEmail;
    }

    throw new BadRequestException(
      'Your employee email is not configured. Ask an admin to add it before sending a quotation.',
    );
  }

  private buildQuotationEmailContent(
    inquiry: any,
    payload: any,
  ): {
    subject: string;
    text: string;
    referenceNumber: string;
    customerName: string;
    customerEmail: string;
    isOrderDoc: boolean;
  } {
    const details = payload?.details || {};
    const aiJson = (inquiry?.ai_extraction_json as any) || {};
    const customerEmail = String(
      payload?.customer_email || inquiry?.customer_email || '',
    )
      .trim()
      .toLowerCase();
    const customerName =
      details.customerName ||
      details.companyName ||
      payload?.customer_name ||
      inquiry?.customer_name ||
      'Valued Customer';
    const isOrderDoc = Boolean(details?.isOrder === true);
    const poRefNum =
      details.poNumber ||
      inquiry?.po_number ||
      aiJson.po_number ||
      `PO-${Math.floor(1000 + Math.random() * 9000)}`;
    const referenceNumber =
      payload?.quotation_reference ||
      (isOrderDoc
        ? poRefNum
        : `QT-2026-${Math.floor(1000 + Math.random() * 9000)}`);
    const productType = details.productType || aiJson.productType || '';
    const productForm = details.productForm || aiJson.productForm || '';
    const thickness = details.thickness || aiJson.thickness || '';
    const width = details.width || aiJson.width || '';
    const length = details.length || aiJson.length || '';
    const quantityTons = Number(
      details.quantityTons || aiJson.quantityTons || aiJson.totalQuantity || 0,
    );
    const paymentTerms =
      details.paymentTerms ||
      aiJson.paymentTerms ||
      inquiry?.payment_terms ||
      '';
    const deliveryLoc =
      details.deliveryLocation ||
      aiJson.deliveryLocation ||
      inquiry?.delivery_location ||
      '';
    const baseAmt = Number(details.totalAmount || aiJson.totalAmount || 0);
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
    const lineItemsList =
      Array.isArray(details.lineItems) && details.lineItems.length > 0
        ? details.lineItems
        : aiJson.line_items || [];
    const itemsSummary =
      Array.isArray(lineItemsList) && lineItemsList.length > 0
        ? lineItemsList
            .map(
              (item: any, idx: number) =>
                `  ${idx + 1}. ${item.sku_text || 'Material'}${
                  item.dimensions ? ` (${item.dimensions})` : ''
                } - Qty: ${item.quantity} ${item.unit || 'MT'} @ Rs. ${Number(
                  item.rate || 0,
                ).toLocaleString('en-IN')}/unit = Rs. ${Number(
                  item.amount || 0,
                ).toLocaleString('en-IN')}`,
            )
            .join('\n')
        : `  - Specification: ${specText}\n${
            quantityTons > 0 ? `  - Quantity: ${quantityTons} MT\n` : ''
          }`;

    const todayDateStr = new Date().toLocaleDateString('en-IN');
    const text = isOrderDoc
      ? `Dear ${customerName},

Thank you for partnering with Enlight Metals Private Limited.

Please find attached our official Purchase Order Quotation & Audit (Ref #: ${referenceNumber}) detailing the complete material specifications, unit rates, delivery location, and commercial terms.

PO Order
- Reference Number: ${referenceNumber}
- Issue Date: ${todayDateStr}
- Items & Specifications:
${itemsSummary}
- Subtotal (Base Amount): Rs. ${
          baseAmt > 0 ? baseAmt.toLocaleString('en-IN') : 'As detailed'
        }
- CGST (9%): Rs. ${Math.round(baseAmt * 0.09).toLocaleString('en-IN')}
- SGST (9%): Rs. ${Math.round(baseAmt * 0.09).toLocaleString('en-IN')}
- Grand Total (incl. GST): Rs. ${
          grandTotal > 0
            ? grandTotal.toLocaleString('en-IN')
            : 'To be confirmed'
        }
${paymentTerms ? `- Payment Terms: ${paymentTerms}\n` : ''}${
          deliveryLoc ? `- Delivery Location: ${deliveryLoc}\n` : ''
        }
The attached PDF document contains our official pricing structure and complete commercial terms.

Warm regards,

Sales Operations Team
Enlight Metals Private Limited
MIDC Industrial Zone, Mumbai - 400001`
      : `Dear ${customerName},

Thank you for your enquiry and for giving us the opportunity to quote for your requirements.

Please find attached our detailed quotation for the materials as requested. The quotation includes unit prices, applicable taxes & duties, payment terms, validity of the offer, delivery details, and other commercial conditions.

We kindly request you to review the quotation carefully. If you have any issues kindly connect with us. We look forward to your confirmation and remain available to discuss any points at your convenience.

Thank you once again for considering us.`;

    return {
      subject: isOrderDoc
        ? `Purchase Order ${referenceNumber} - ${customerName} | Enlight Metals`
        : `Official Commercial Quotation ${referenceNumber} - ${customerName}`,
      text,
      referenceNumber,
      customerName,
      customerEmail,
      isOrderDoc,
    };
  }

  private buildQuotationCc(
    senderEmail: string,
    customerEmail: string,
  ): string[] {
    const normalizedCustomerEmail = customerEmail.trim().toLowerCase();
    return Array.from(
      new Set(
        [senderEmail, 'dj@enlightmetals.com', 'vedant@enlightmetals.com']
          .map((email) => email.trim().toLowerCase())
          .filter(
            (email) =>
              this.isValidEmail(email) && email !== normalizedCustomerEmail,
          ),
      ),
    );
  }

  async previewQuotation(
    id: string,
    payload: any,
    employee: any,
    accessiblePhones?: string[] | null,
  ) {
    const { data: inquiry } = await this.supabase
      .from('inquiries')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    const record =
      inquiry ||
      (
        await this.supabase
          .from('deals')
          .select('*, deal_items(*)')
          .eq('id', id)
          .maybeSingle()
      ).data;

    if (!record)
      throw new NotFoundException('Inquiry or Order record not found');
    if (accessiblePhones && accessiblePhones.length > 0) {
      const hasAccess =
        phoneInList(record.salesperson_phone, accessiblePhones) ||
        phoneInList(record.sender_phone, accessiblePhones);
      if (!hasAccess) {
        throw new ForbiddenException(
          'Access Denied: You do not have permission to send quotations for this record.',
        );
      }
    }

    const content = this.buildQuotationEmailContent(record, payload);
    const employeeEmail = await this.resolveQuotationSenderEmail(employee);
    return {
      customer_email: content.customerEmail,
      sender_email: QUOTATION_FROM_EMAIL,
      employee_email: employeeEmail,
      cc: this.buildQuotationCc(employeeEmail, content.customerEmail),
      subject: content.subject,
      body: content.text,
      quotation_reference: content.referenceNumber,
    };
  }

  async sendQuotation(
    id: string,
    payload: any,
    accessiblePhones?: string[] | null,
    employee?: any,
  ) {
    const senderName =
      typeof employee === 'string' ? employee : employee?.name || '';
    try {
      // 1. Fetch inquiry or deal record
      let inquiry: any = null;
      let isDealRecord = false;
      const { data: inqData } = await this.supabase
        .from('inquiries')
        .select('*')
        .eq('id', id)
        .single();
      inquiry = inqData;

      if (!inquiry) {
        const { data: dealData } = await this.supabase
          .from('deals')
          .select('*, deal_items(*)')
          .eq('id', id)
          .single();
        if (dealData) {
          isDealRecord = true;
          inquiry = {
            id: dealData.id,
            customer_name: dealData.customer_name,
            customer_phone: dealData.customer_phone,
            salesperson_phone: dealData.salesperson_phone,
            delivery_location: dealData.delivery_location,
            payment_terms: dealData.payment_terms,
            ai_extraction_json: {
              customer_name: dealData.customer_name,
              po_number: dealData.po_number,
              delivery_location: dealData.delivery_location,
              payment_terms: dealData.payment_terms,
              line_items: dealData.deal_items,
            },
          };
        }
      }

      if (!inquiry) {
        throw new NotFoundException('Inquiry or Order record not found');
      }

      if (accessiblePhones && accessiblePhones.length > 0) {
        const hasAccess =
          phoneInList(inquiry.salesperson_phone, accessiblePhones) ||
          phoneInList(inquiry.sender_phone, accessiblePhones);
        if (!hasAccess) {
          throw new ForbiddenException(
            'Access Denied: You do not have permission to send quotations for this record.',
          );
        }
      }

      const customerEmail = (
        payload.customer_email ||
        inquiry.customer_email ||
        ''
      )
        .trim()
        .toLowerCase();
      if (!customerEmail || !customerEmail.includes('@')) {
        throw new BadRequestException(
          'Please provide a valid customer email address to send the quotation.',
        );
      }
      const employeeEmail = await this.resolveQuotationSenderEmail(employee);
      const emailContent = this.buildQuotationEmailContent(inquiry, {
        ...payload,
        customer_email: customerEmail,
      });
      const customerName =
        emailContent.customerName ||
        payload.customer_name ||
        inquiry.customer_name ||
        'Valued Customer';
      const details = payload.details || {};
      const resendApiKey = process.env.RESEND_API_KEY || '';
      const fromEmail = QUOTATION_FROM_EMAIL;

      let emailSent = false;
      let emailNotice = '';

      if (resendApiKey) {
        try {
          const isOrderDoc = emailContent.isOrderDoc;
          const qRefNum = emailContent.referenceNumber;
          const todayDateStr = new Date().toLocaleDateString('en-IN');

          // Pull actual inquiry data - payload.details first, then inquiry's ai_extraction_json
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

          const rawLineItemsList =
            Array.isArray(details.lineItems) && details.lineItems.length > 0
              ? details.lineItems
              : aiJson.line_items || [];

          // Exclude any products with 0 or blank rates from quotation PDF & email summary
          const pricedLineItems = Array.isArray(rawLineItemsList)
            ? rawLineItemsList.filter(
                (item: any) => Number(item.rate || item.unitPrice || 0) > 0,
              )
            : [];
          const lineItemsList =
            pricedLineItems.length > 0 ? pricedLineItems : rawLineItemsList;

          // Recompute pre-GST baseAmt from priced line items if available
          const baseAmt =
            pricedLineItems.length > 0
              ? pricedLineItems.reduce(
                  (s: number, i: any) =>
                    s +
                    (Number(i.amount) ||
                      Math.round(
                        (Number(i.quantity) || 0) * (Number(i.rate) || 0),
                      )),
                  0,
                )
              : Number(details.totalAmount || aiJson.totalAmount || 0);
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

          let itemsSummary = '';
          if (Array.isArray(lineItemsList) && lineItemsList.length > 0) {
            itemsSummary = lineItemsList
              .map((item: any, idx: number) => {
                const spec = item.dimensions ? ` (${item.dimensions})` : '';
                return `  ${idx + 1}. ${item.sku_text || 'Material'}${spec} - Qty: ${item.quantity} ${item.unit || 'MT'} @ Rs. ${Number(item.rate || 0).toLocaleString('en-IN')}/unit = Rs. ${Number(item.amount || 0).toLocaleString('en-IN')}`;
              })
              .join('\n');
          } else {
            itemsSummary = `  - Specification: ${specText}\n${quantityTons > 0 ? `  - Quantity: ${quantityTons} MT\n` : ''}`;
          }

          const orderTextContent = `Dear ${customerName},

Thank you for partnering with Enlight Metals Private Limited.

Please find attached our official Purchase Order Quotation & Audit (Ref #: ${qRefNum}) detailing the complete material specifications, unit rates, delivery location, and commercial terms.

PO Order
- Reference Number: ${qRefNum}
- Issue Date: ${todayDateStr}
- Items & Specifications:
${itemsSummary}
- Subtotal (Base Amount): Rs. ${baseAmt > 0 ? baseAmt.toLocaleString('en-IN') : 'As detailed'}
- CGST (9%): Rs. ${Math.round(baseAmt * 0.09).toLocaleString('en-IN')}
- SGST (9%): Rs. ${Math.round(baseAmt * 0.09).toLocaleString('en-IN')}
- Grand Total (incl. GST): Rs. ${grandTotal > 0 ? grandTotal.toLocaleString('en-IN') : 'To be confirmed'}
${paymentTerms ? `- Payment Terms: ${paymentTerms}\n` : ''}${deliveryLoc ? `- Delivery Location: ${deliveryLoc}\n` : ''}
The attached PDF document contains our official pricing structure and complete commercial terms.

Warm regards,

Sales Operations Team
Enlight Metals Private Limited
MIDC Industrial Zone, Mumbai - 400001`;

          const quotationTextContent = `Dear ${customerName},

Thank you for your enquiry and for giving us the opportunity to quote for your requirements.

Please find attached our detailed quotation for the materials as requested. The quotation includes unit prices, applicable taxes & duties, payment terms, validity of the offer, delivery details, and other commercial conditions.

We kindly request you to review the quotation carefully. If you have any issues kindly connect with us. We look forward to your confirmation and remain available to discuss any points at your convenience.

Thank you once again for considering us.`;

          const textContent =
            String(payload.email_body || '').trim() ||
            (isOrderDoc ? orderTextContent : quotationTextContent);

          const salespersonName =
            details.salespersonName ||
            details.salesperson_name ||
            details.salesperson ||
            senderName ||
            (inquiry as any).salesperson_name ||
            (inquiry as any).assigned_salesperson_name ||
            (aiJson as any).salespersonName ||
            (aiJson as any).salesperson_name ||
            'Shravan Kotagi';

          // Pass enriched details to PDF generator
          const pdfDetails = {
            ...details,
            salespersonName,
            salesperson_name: salespersonName,
            productType,
            productForm,
            thickness,
            width,
            length,
            quantityTons,
            paymentTerms,
            deliveryLocation: deliveryLoc,
            totalAmount: baseAmt,
            lineItems: lineItemsList,
          };

          const attachments: Array<{ filename: string; content: string }> = [];
          const sanitizedRef = qRefNum.replace(/[/\\?%*:|"<>]/g, '_');

          if (isOrderDoc) {
            // FOR ORDERS: Attach original client PO document if available, or generate official PO PDF
            const rawMedia =
              Array.isArray(details.media_urls) && details.media_urls.length > 0
                ? details.media_urls[0]
                : Array.isArray(inquiry?.media_urls) &&
                    inquiry.media_urls.length > 0
                  ? inquiry.media_urls[0]
                  : null;

            let hasOriginalDoc = false;
            if (rawMedia && typeof rawMedia === 'string') {
              if (rawMedia.startsWith('data:')) {
                const matches = rawMedia.match(/^data:([^;]+);base64,(.+)$/s);
                if (matches) {
                  const mime = matches[1];
                  const base64Data = matches[2];
                  let ext = '.pdf';
                  if (mime.includes('png')) ext = '.png';
                  else if (mime.includes('jpeg') || mime.includes('jpg'))
                    ext = '.jpg';

                  attachments.push({
                    filename: `Original_PO_${sanitizedRef}${ext}`,
                    content: base64Data,
                  });
                  hasOriginalDoc = true;
                }
              } else if (rawMedia.startsWith('http')) {
                try {
                  const docFetch = await fetch(rawMedia);
                  if (docFetch.ok) {
                    const arrBuf = await docFetch.arrayBuffer();
                    const base64Data = Buffer.from(arrBuf).toString('base64');
                    const contentType =
                      docFetch.headers.get('content-type') || '';
                    let ext = '.pdf';
                    if (contentType.includes('png')) ext = '.png';
                    else if (
                      contentType.includes('jpeg') ||
                      contentType.includes('jpg')
                    )
                      ext = '.jpg';

                    attachments.push({
                      filename: `Original_PO_${sanitizedRef}${ext}`,
                      content: base64Data,
                    });
                    hasOriginalDoc = true;
                  }
                } catch (fetchErr) {
                  this.logger.warn(
                    'Failed to fetch remote original media:',
                    fetchErr,
                  );
                }
              }
            }

            if (!hasOriginalDoc || payload.pdf_base64) {
              const pdfBuffer = payload.pdf_base64
                ? Buffer.from(payload.pdf_base64, 'base64')
                : await this.generatePdfKitBuffer(
                    qRefNum,
                    customerName,
                    customerEmail,
                    pdfDetails,
                  );
              const pdfBase64 = pdfBuffer.toString('base64');
              attachments.push({
                filename: `Official_PO_${sanitizedRef}.pdf`,
                content: pdfBase64,
              });
            }
          } else {
            // FOR INQUIRIES: ALWAYS generate and attach the official Enlight Metals Quotation PDF!
            const pdfBuffer = payload.pdf_base64
              ? Buffer.from(payload.pdf_base64, 'base64')
              : await this.generatePdfKitBuffer(
                  qRefNum,
                  customerName,
                  customerEmail,
                  pdfDetails,
                );
            const pdfBase64 = pdfBuffer.toString('base64');
            attachments.push({
              filename: `Quotation_${sanitizedRef}.pdf`,
              content: pdfBase64,
            });
          }

          const fromAddress = `Enlight Metals <${fromEmail}>`;

          const docSubject =
            String(payload.email_subject || '').trim() || emailContent.subject;

          const resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: fromAddress,
              to: [customerEmail],
              cc: this.buildQuotationCc(employeeEmail, customerEmail),
              subject: docSubject,
              text: textContent,
              attachments,
            }),
          });

          const resendData = await resendRes.json();
          if (resendRes.ok) {
            emailSent = true;
            emailNotice = `Live email & PO Document (${qRefNum}) dispatched to ${customerEmail} via Email!`;
          } else {
            this.logger.warn('Resend API call error:', resendData);
            emailNotice = `Resend Notice: ${resendData.message || 'Check recipient email or domain verification.'}`;
          }
        } catch (rErr: any) {
          this.logger.error('Resend fetch exception:', rErr);
          emailNotice = `Order logged! ${rErr.message || 'Add valid RESEND_API_KEY to send live emails.'}`;
        }
      } else {
        emailNotice =
          'Quotation generated & recorded! Add RESEND_API_KEY in backend .env to dispatch live emails.';
      }

      // Update inquiry status to quoted if it is an inquiry record
      let quotationSharedAt: string | null = null;
      if (!isDealRecord) {
        const isOrderDocument = Boolean(payload?.details?.isOrder === true);
        const inquiryUpdate: Record<string, unknown> = { status: 'quoted' };
        if (!isOrderDocument) {
          quotationSharedAt = new Date().toISOString();
          const existingAi =
            inquiry?.ai_extraction_json &&
            typeof inquiry.ai_extraction_json === 'object' &&
            !Array.isArray(inquiry.ai_extraction_json)
              ? inquiry.ai_extraction_json
              : {};
          inquiryUpdate.ai_extraction_json = {
            ...existingAi,
            quotation_shared_at: quotationSharedAt,
          };
        }
        await this.supabase
          .from('inquiries')
          .update(inquiryUpdate)
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

      // Log to activity_logs
      try {
        this.activityLogsService.logActivity({
          salesperson_name:
            (inquiry as any)?.assigned_salesperson_name ||
            (inquiry as any)?.salesperson_name ||
            'Sales Team',
          salesperson_phone: inquiry.salesperson_phone || null,
          description: `Quotation sent to ${customerName}`,
          module: 'Inquiries',
          customer_name: customerName,
          entity_id: quotationSharedAt ? id : undefined,
          entity_type: quotationSharedAt ? 'inquiry' : undefined,
        });
      } catch (actErr: any) {
        this.logger.warn('Non-blocking activity log notice:', actErr?.message);
      }

      return {
        success: true,
        email_sent: emailSent,
        message: emailNotice,
        inquiry_id: id,
        quotation_shared_at: quotationSharedAt,
      };
    } catch (err) {
      this.logger.error('Error in sendQuotation:', err);
      throw err;
    }
  }

  private normalizeParsedDocument(parsed: any) {
    const customer =
      parsed?.customer && typeof parsed.customer === 'object'
        ? parsed.customer
        : {};
    const text = (...values: any[]) => {
      for (const value of values) {
        const cleaned = String(value ?? '').trim();
        if (
          cleaned &&
          cleaned.toLowerCase() !== 'null' &&
          cleaned.toLowerCase() !== 'none'
        ) {
          return cleaned;
        }
      }
      return '';
    };
    const company = text(
      parsed?.customer_name,
      parsed?.customerName,
      parsed?.company_name,
      customer.name,
      customer.customer_name,
    );
    const phone = text(
      parsed?.customer_phone,
      parsed?.contact_phone,
      customer.phone,
      customer.customer_phone,
    );
    const gst = text(
      parsed?.customer_gst,
      parsed?.gstin,
      parsed?.gst,
      customer.gst,
      customer.gstin,
    );
    const address = text(
      parsed?.customer_address,
      parsed?.address,
      customer.address,
      customer.customer_address,
    );
    const delivery = text(
      parsed?.delivery_location,
      parsed?.deliveryLocation,
      customer.delivery_location,
      address,
    );
    const payment = text(parsed?.payment_terms, parsed?.paymentTerms);
    const contact = text(
      parsed?.contact_person,
      parsed?.contact_name,
      customer.contact_person,
      customer.contact_name,
    );
    const rawItems = Array.isArray(parsed?.line_items)
      ? parsed.line_items
      : Array.isArray(parsed?.lineItems)
        ? parsed.lineItems
        : [];
    const lineItems = rawItems
      .map((item: any) => {
        const totalWt = Number(
          item?.total_weight_kg ?? item?.total_weight ?? item?.weight_kg,
        );
        let rawQty = Number(item?.quantity ?? item?.qty) || 0;
        let rawUnit = text(item?.unit) || 'KG';
        let pieces = Number(item?.pieces ?? item?.pcs) || null;

        // When a cutting/weight list provides total weight in KG, commercial quantity is the total weight in KG
        if (
          totalWt &&
          totalWt > 0 &&
          (rawUnit.toUpperCase() === 'NOS' ||
            rawUnit.toUpperCase() === 'PCS' ||
            (rawQty > 0 && rawQty < totalWt && !pieces))
        ) {
          pieces = rawQty;
          rawQty = totalWt;
          rawUnit = 'KG';
        } else if (!item?.unit) {
          rawUnit = 'KG';
        }

        return {
          ...item,
          sku_text: text(
            item?.sku_text,
            item?.description,
            item?.product,
            item?.material,
            item?.sku,
          ),
          dimensions: text(
            item?.dimensions,
            [item?.thickness, item?.width, item?.length]
              .filter(Boolean)
              .join(' x '),
          ),
          hsn_code: text(item?.hsn_code, item?.hsn),
          quantity: rawQty,
          unit: rawUnit,
          pieces: pieces,
          grade: text(item?.grade) || null,
          rate:
            Number(item?.rate ?? item?.unit_price ?? item?.price_per_mt) || 0,
          amount: Number(item?.amount) || 0,
          unit_weight_kg:
            Number(item?.unit_weight_kg ?? item?.unit_weight) || null,
          total_weight_kg: totalWt || null,
        };
      })
      .filter((item: any) => item.sku_text || item.quantity > 0);

    const preferredMake = text(
      parsed?.preferred_make,
      parsed?.make,
      parsed?.brand,
    );

    return {
      ...parsed,
      customer_name: company || null,
      customer_phone: phone || null,
      customer_gst: gst || null,
      customer_address: address || null,
      delivery_location: delivery || null,
      payment_terms: payment || null,
      contact_person: contact || null,
      preferred_make: preferredMake || null,
      line_items: lineItems,
      customer: {
        ...customer,
        name: company || null,
        phone: phone || null,
        gst: gst || null,
        address: address || null,
        contact_person: contact || null,
      },
    };
  }

  async parseDocumentWithGemini(fileBase64: string, mimeType: string) {
    const apiKeys = [
      process.env.GEMINI_PAID_API_KEY,
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_1,
      process.env.GEMINI_API_KEY_2,
    ].filter(Boolean) as string[];

    if (apiKeys.length === 0) {
      throw new Error(
        'GEMINI_API_KEY is not configured in backend environment variables',
      );
    }

    let cleanBase64 = fileBase64;
    let detectedMime = mimeType;

    // 1. Extract data URI header if present (e.g. data:application/pdf;base64,...)
    const headerMatch = fileBase64.match(/^data:([^;]+);base64,(.+)$/s);
    if (headerMatch) {
      if (
        !detectedMime ||
        detectedMime === 'application/octet-stream' ||
        detectedMime === 'image/jpeg'
      ) {
        detectedMime = headerMatch[1];
      }
      cleanBase64 = headerMatch[2];
    } else {
      cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '');
    }

    // 2. Binary magic bytes auto-detection for 100% fail-safe MIME typing
    const prefix = cleanBase64.slice(0, 16);
    if (prefix.startsWith('JVBERi')) {
      detectedMime = 'application/pdf';
    } else if (prefix.startsWith('iVBORw')) {
      detectedMime = 'image/png';
    } else if (prefix.startsWith('/9j/')) {
      detectedMime = 'image/jpeg';
    } else if (prefix.startsWith('UklGR')) {
      detectedMime = 'image/webp';
    }

    if (!detectedMime) {
      detectedMime = 'application/pdf';
    }

    const promptText = `You are an expert OCR & document parser for Enlight Metals Private Limited, a premier Indian B2B metal & steel distributor.
Extract ALL data from this business document (Purchase Order, RFQ, Inquiry, or Material Requirement formatted in Tally ERP, Busy, SAP, cutting lists, or custom steel ERP formats) and return ONLY a valid JSON object with NO markdown, NO codeblocks, NO explanation:
{
  "customer_name": "The legal company name of the buyer / client issuing this PO or inquiry (under 'Invoice To:', 'Bill To:', 'Buyer:', 'Customer:', 'M/s:', 'Company name -'). NEVER return Enlight Metals as customer_name.",
  "contact_person": "Contact person name if mentioned e.g. Rajesh Kumar else null",
  "customer_phone": "Phone number under Invoice To or notes else null",
  "customer_email": "Email under Invoice To or notes else null",
  "customer_gst": "15-character GSTIN number of the customer if present else null",
  "customer_pan": "PAN number of customer if present else null",
  "customer_address": "Complete factory/office billing address of customer",
  "delivery_location": "Destination site / ship-to address from 'Consignee (Ship to)', 'Delivery Address', 'Destination', or 'Delivery at X'. NEVER include Enlight Metals' supplier address.",
  "payment_terms": "Payment terms e.g. '30 Days', 'Immediate', '100% Advance'",
  "delivery_terms": "Terms of delivery from 'Terms of Delivery' or 'Remarks'",
  "preferred_make": "Preferred brand/make e.g. 'E350 (Tata/Jsw/Sail)', 'SAIL', 'JSW', 'TATA' if stated else null",
  "additional_notes": "Non-product contextual remarks, TC/E-way bill requirements. NEVER put product line items here.",
  "po_number": "Explicit PO/Voucher Number e.g. 'PO/26-27/63', 'PO-26-27-00718' from 'Voucher No.', 'PO No', 'Purchase Order No'. Set null if only inquiry/RFQ/cutting list.",
  "po_date": "PO Date converted to YYYY-MM-DD (Year 2026 e.g. '2026-09-12')",
  "line_items": [
    {
      "sku_text": "Material / product category name e.g. HR PLATE, CR SHEET, MS ANGLE, GI PIPE, PLATE",
      "dimensions": "Specs / dimensions e.g. 05X1500X6300MM, 5X1250X7600, 50X50X6, 12MM",
      "grade": "Steel grade if present e.g. IS2062 E250BR, FE550D, E350 else null",
      "hsn_code": "HSN/SAC code if stated e.g. 72083840 else null",
      "quantity": numeric_quantity,
      "unit": "Exact unit of measure: 'MT', 'KG', 'Nos', 'PCS', 'Sheets'",
      "unit_weight_kg": numeric_unit_weight_in_kg_if_present_else_null,
      "total_weight_kg": numeric_total_weight_in_kg_if_present_else_null,
      "rate": numeric_pre_gst_rate_per_unit_or_0,
      "amount": numeric_pre_gst_line_amount_or_0,
      "due_on": "Delivery due date in YYYY-MM-DD if stated else null"
    }
  ],
  "basic_amount": numeric_total_pre_tax_value_or_0,
  "gst_amount": numeric_total_gst_amount_or_0,
  "total_amount": numeric_grand_total_including_tax_or_0,
  "overall_confidence": 0.98
}

CRITICAL EXTRACTION RULES:
1. SUPPLIER vs BUYER IDENTIFICATION (STRICT):
- Enlight Metals Private Limited (Shop No 606 Sn 272, Clover Hills Plaza, NIBM Undri Road, Pune - 411048, GST: 27AAICE5263E1ZN) is the SUPPLIER. NEVER EXTRACT 'Enlight Metals' AS THE CUSTOMER NAME.
- The 'customer_name' is the legal corporate name under 'Invoice To:' / 'Bill To:' / 'Company name –' (e.g. 'KDT Infrastructure Pvt Ltd', 'Suraj SIM Techno Works Pvt Ltd'). NEVER put building/street address in customer_name.

2. STEEL LINE ITEM & UOM RULES (STRICT):
- Description: Separate product title (sku_text: 'PLATE', 'HR PLATE') and size/spec (dimensions: '5X1250X7600').
- Quantity & UOM: Extract quantity from 'Quantity' / 'QTY' column.
- DEFAULT UNIT RULE: In Indian metal trading, the standard default unit is 'KG'. If no unit is explicitly specified on a row or table, set unit to 'KG'. Only set unit to 'MT' or 'Nos' if explicitly written ('MT' / 'M.T' → 'MT', 'Nos' / 'PCS' → 'Nos').
- ⚠️ CRITICAL NEGATIVE RULE: Words in the description like 'HR PLATE', 'CR SHEET', 'MS ANGLE', 'COIL', 'BEAM', 'PIPE' are PRODUCT NAMES, NEVER UNITS! If the table says '60.000 M.T' with per 'M.T', the unit is STRICTLY 'MT', NEVER 'Plates'!

3. COMMERCIAL TERMS & TOTALS:
- Extract 'Mode/Terms of Payment' or 'Payment Terms – X' into 'payment_terms'.
- Extract 'Consignee (Ship to)' or 'Delivery at X' into 'delivery_location'.
- Extract 'Make - X' into 'preferred_make'.
- basic_amount is the pre-tax total of all line items. total_amount is the grand total.

4. CUTTING / WEIGHT LISTS (MULTI-PAGE & UP TO 100+ ROWS):
- A sheet with DESCRIPTION, THK, WIDTH, LENGTH, QTY, UNIT WT, TOTAL WT is a valid inquiry even when it has no Rate or Amount column.
- Extract EVERY SINGLE product row without omission, even if there are 40, 50, 80, or 100+ rows across multiple pages.
- For each row: sku_text is the description (e.g. PLATE). dimensions is THK x WIDTH x LENGTH (e.g. 5x1250x7600).
- COMMERCIAL QUANTITY & TOTAL WT: When a cutting list has BOTH a piece count (QTY) and a TOTAL WT column, the commercial 'quantity' MUST be the TOTAL WEIGHT from the TOTAL WT column, and the 'unit' MUST be 'KG' (e.g. for row 1: quantity: 39897.63, unit: 'KG'). Put the piece count into 'pieces' (e.g. 107).
- UNIT WT and TOTAL WT: extract as unit_weight_kg and total_weight_kg. Leave rate and amount as 0 when no price is printed. Do NOT skip or drop any rows!
- Skip bare subtotal rows that have no description or item specs.
- Read notes wherever they appear (at the top, between rows, in the margins, or on page 2 / final footer):
  * "Company name – X" or "M/s X" is customer_name
  * "Make - X" is preferred_make (e.g. "E350 (Tata/Jsw/Sail)")
  * "Payment Terms – X" is payment_terms (e.g. "30 Days")
  * "Delivery at X" is delivery_location (e.g. "Chakan, Pune")

Return ONLY the JSON.`;

    const candidateModels = [
      process.env.GEMINI_PRIMARY_MODEL || 'gemini-3.5-flash',
      'gemini-3.8-flash',
      process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.7-flash',
      'gemini-2.5-flash',
    ];

    let lastError: any = null;

    keyLoop: for (const ocrKey of apiKeys) {
      for (const model of candidateModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${ocrKey}`;
          const response = await axios.post(
            url,
            {
              contents: [
                {
                  parts: [
                    {
                      text: promptText,
                    },
                    {
                      inline_data: {
                        mime_type: detectedMime,
                        data: cleanBase64,
                      },
                    },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.05,
                response_mime_type: 'application/json',
                maxOutputTokens: 65536,
              },
            },
            { timeout: 60000 },
          );

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
              try {
                parsed = JSON.parse(text.slice(firstOpen, lastClose + 1));
              } catch {
                parsed = null;
              }
            }
          }

          if (parsed) {
            const normalized = this.normalizeParsedDocument(parsed);
            if (
              !normalized.customer_name &&
              (!Array.isArray(normalized.line_items) ||
                normalized.line_items.length === 0)
            ) {
              lastError = new Error(
                'Document parsed without a company name or line items',
              );
              continue;
            }
            parsed = normalized;
            // Post-process line items & units
            if (Array.isArray(parsed.line_items)) {
              parsed.line_items = parsed.line_items.map((item: any) => {
                const skuText = (
                  item.sku_text ||
                  item.description ||
                  item.product ||
                  'Material'
                ).trim();
                const dims = (item.dimensions || '').trim();
                let rawUnit = String(item.unit || 'KG').trim();
                const uUpper = rawUnit.toUpperCase();

                if (
                  [
                    'M.T',
                    'M.T.',
                    'MT',
                    'TON',
                    'TONS',
                    'TONNE',
                    'TONNES',
                    'MTS',
                    'T',
                  ].includes(uUpper)
                ) {
                  rawUnit = 'MT';
                } else if (
                  ['KG', 'KGS', 'KILOGRAM', 'KILOGRAMS'].includes(uUpper)
                ) {
                  rawUnit = 'KG';
                } else if (
                  ['NOS', 'NO', 'NO.', 'NUMBER', 'NUMBERS'].includes(uUpper)
                ) {
                  rawUnit = 'Nos';
                } else if (['PCS', 'PC', 'PIECE', 'PIECES'].includes(uUpper)) {
                  rawUnit = 'Pcs';
                }

                const rate = Number(item.rate || 0);
                let qty = Number(item.quantity || 0);
                const totalWeightKg = Number(item.total_weight_kg || 0);
                if (
                  totalWeightKg > 0 &&
                  (rawUnit === 'KG' ||
                    !item.quantity ||
                    ['Nos', 'Pcs'].includes(rawUnit) ||
                    (qty > 0 && qty < totalWeightKg / 10))
                ) {
                  if (qty > 0 && qty < totalWeightKg && !item.pieces) {
                    item.pieces = qty;
                  }
                  qty = totalWeightKg;
                  rawUnit = 'KG';
                }

                const amt = Number(item.amount || 0) || Math.round(qty * rate);

                if (
                  /^(?:plate|plates|sheet|sheets|coil|coils|beam|channel|pipe)$/i.test(
                    rawUnit,
                  ) &&
                  (rate > 1000 ||
                    /m\.?t/i.test(skuText) ||
                    /m\.?t/i.test(dims) ||
                    /\bmt\b/i.test(skuText))
                ) {
                  rawUnit = 'MT';
                }

                return {
                  ...item,
                  sku_text: skuText,
                  dimensions: dims,
                  quantity: qty,
                  unit: rawUnit,
                  rate: rate,
                  amount: amt,
                };
              });
            }

            if (
              Array.isArray(parsed.line_items) &&
              parsed.line_items.length > 0 &&
              this.unitConverterService
            ) {
              try {
                const batchConv =
                  await this.unitConverterService.convertLineItems(
                    parsed.line_items,
                  );
                parsed.line_items = parsed.line_items.map(
                  (it: any, i: number) => ({
                    ...it,
                    weight_mt:
                      batchConv.items[i]?.weight_mt ??
                      (it.total_weight_kg
                        ? Number(it.total_weight_kg) / 1000
                        : it.unit === 'KG' && it.quantity
                          ? Number(it.quantity) / 1000
                          : null),
                    unit_weight_kg:
                      batchConv.items[i]?.unit_weight_kg ??
                      it.unit_weight_kg ??
                      null,
                  }),
                );
                parsed.total_tonnage_mt =
                  batchConv.total_tonnage_mt ||
                  Math.round(
                    parsed.line_items.reduce(
                      (acc: number, curr: any) =>
                        acc + (Number(curr.weight_mt) || 0),
                      0,
                    ) * 1000,
                  ) / 1000;
              } catch (e: any) {
                this.logger.warn(
                  `Document unit conversion fallback: ${e.message}`,
                );
              }
            }

            return {
              success: true,
              data: parsed,
            };
          }
        } catch (err: any) {
          lastError = err;
          this.logger.warn(
            `Gemini OCR parsing attempt with model ${model} failed: ${
              err?.response?.data?.error?.message || err.message
            }`,
          );
        }
      }
    }

    this.logger.error(
      'All Gemini OCR model attempts failed:',
      lastError?.response?.data || lastError?.message,
    );
    const geminiMessage =
      lastError?.response?.data?.error?.message || lastError?.message;
    throw new BadRequestException(
      geminiMessage || 'Failed to extract document details',
    );
  }

  async parseTextWithGemini(rawText: string) {
    if (!rawText || !rawText.trim()) {
      return { success: false, error: 'Empty text' };
    }
    const apiKeys = [
      process.env.GEMINI_PAID_API_KEY,
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_1,
      process.env.GEMINI_API_KEY_2,
    ].filter(Boolean) as string[];

    if (apiKeys.length === 0) {
      return {
        success: false,
        error: 'GEMINI_API_KEY is not configured',
      };
    }

    const promptText = `You are an expert AI extraction engine for steel product inquiries received via WhatsApp, emails, and sales dashboards. Extract ALL details from this inquiry text into a strict, structured JSON object with NO markdown, NO codeblocks, NO explanation:
{
  "customer_name": "Company or customer name e.g. BuildCorp Engineering",
  "contact_person": "Contact person name if mentioned e.g. Rajesh",
  "customer_phone": "Phone number if present else null",
  "delivery_location": "Full detailed delivery address / location exactly as stated in inquiry (e.g. Plot No 42, MIDC Industrial Area, Khopoli, Raigad, Maharashtra 410203 or Chakan Industrial Area, Pune)",
  "preferred_make": "Preferred make / brand e.g. JSW, AM/NS, Tata, SAIL, JSPL if mentioned else null",
  "payment_terms": "Payment terms e.g. 30 Days Credit, 100% Advance, 45 Days Credit if mentioned else null",
  "line_items": [
    {
      "sku_text": "Material name/grade e.g. CR Sheet, HR Sheet, MS Plate (IS 2062 E250BR), SS 304 Pipe",
      "dimensions": "Thickness / size / spec e.g. 1mm, 1.2mm, 1.6mm, 12mm (1500mm x 6000mm)",
      "quantity": numeric_quantity,
      "unit": "Exact unit stated e.g. nos, pcs, MT, KG, sheets (NEVER convert or fabricate)",
      "rate": numeric_rate_or_0,
      "amount": numeric_amount_or_0
    }
  ],
  "overall_confidence": 0.95
}

CRITICAL RULES:
1. MULTIPLE LINE ITEMS: NEVER merge, collapse, or summarize multiple distinct products into one line item! Every distinct product with its own thickness, grade, spec, or quantity (e.g. "CR 1mm (300 nos), CR 1.2mm (200 nos), HR 1.6mm (200 nos)") MUST produce its own separate line item object in the line_items array.
2. PRESERVE EXACT UNITS: Extract the exact quantity unit stated in the source text (nos, pcs, MT, Kg, sheets, coils, etc.). NEVER substitute, convert, or fabricate units (e.g., if user writes 300 nos, quantity is 300 and unit is "nos" - NEVER convert to MT).
3. PAYMENT TERMS: Always extract payment terms if mentioned in the text (e.g., "30 days", "30 days credit", "100% advance", "45 days"). Never drop payment terms.
4. FULL DELIVERY ADDRESS: Always extract the complete, full delivery address and location exactly as provided in the inquiry (including plot, gat, street, MIDC/industrial area, city, district, state, and pin code). Never truncate or shorten address details.

Inquiry Text:
${rawText}`;

    const candidateModels = [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-2.5-flash',
    ];

    let lastError: any = null;
    for (const key of apiKeys) {
      for (const model of candidateModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
          const response = await axios.post(
            url,
            {
              contents: [
                {
                  parts: [
                    {
                      text: promptText,
                    },
                  ],
                },
              ],
            },
            { timeout: 35000 },
          );

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

          if (parsed) {
            if (
              Array.isArray(parsed.line_items) &&
              parsed.line_items.length > 0 &&
              this.unitConverterService
            ) {
              try {
                const batchConv =
                  await this.unitConverterService.convertLineItems(
                    parsed.line_items,
                  );
                parsed.line_items = parsed.line_items.map(
                  (it: any, i: number) => ({
                    ...it,
                    weight_mt: batchConv.items[i]?.weight_mt ?? null,
                    unit_weight_kg: batchConv.items[i]?.unit_weight_kg ?? null,
                  }),
                );
                parsed.total_tonnage_mt = batchConv.total_tonnage_mt;
              } catch (e: any) {
                this.logger.warn(`Text unit conversion fallback: ${e.message}`);
              }
            }

            return {
              success: true,
              data: parsed,
            };
          }
        } catch (err: any) {
          lastError = err;
          this.logger.warn(
            `Gemini text inquiry extraction with model ${model} failed: ${
              err?.response?.data?.error?.message || err.message
            }`,
          );
        }
      }
    }

    this.logger.error(
      'All Gemini text inquiry extraction model attempts failed:',
      lastError?.response?.data || lastError?.message,
    );
    return {
      success: false,
      error: lastError?.message || 'Failed to parse inquiry with Gemini',
    };
  }

  private resolvePlaceOfSupply(address?: string): string {
    if (!address) return 'Maharashtra (27)';
    const lower = address.toLowerCase();
    if (
      lower.includes('maharashtra') ||
      lower.includes('mumbai') ||
      lower.includes('pune') ||
      lower.includes('khopoli') ||
      lower.includes('raigad') ||
      lower.includes('thane') ||
      lower.includes('nagpur') ||
      lower.includes('nashik') ||
      lower.includes('chakan') ||
      lower.includes('taloja')
    ) {
      return 'Maharashtra (27)';
    }
    if (
      lower.includes('gujarat') ||
      lower.includes('ahmedabad') ||
      lower.includes('surat') ||
      lower.includes('vadodara')
    ) {
      return 'Gujarat (24)';
    }
    if (
      lower.includes('karnataka') ||
      lower.includes('bangalore') ||
      lower.includes('bengaluru')
    ) {
      return 'Karnataka (29)';
    }
    if (lower.includes('tamil nadu') || lower.includes('chennai')) {
      return 'Tamil Nadu (33)';
    }
    if (lower.includes('delhi')) {
      return 'Delhi (07)';
    }
    if (
      lower.includes('haryana') ||
      lower.includes('gurgaon') ||
      lower.includes('faridabad')
    ) {
      return 'Haryana (06)';
    }
    if (
      lower.includes('uttar pradesh') ||
      lower.includes('noida') ||
      lower.includes('kanpur')
    ) {
      return 'Uttar Pradesh (09)';
    }
    if (lower.includes('rajasthan') || lower.includes('jaipur')) {
      return 'Rajasthan (08)';
    }
    if (lower.includes('madhya pradesh') || lower.includes('indore')) {
      return 'Madhya Pradesh (23)';
    }
    if (lower.includes('west bengal') || lower.includes('kolkata')) {
      return 'West Bengal (19)';
    }
    if (lower.includes('telangana') || lower.includes('hyderabad')) {
      return 'Telangana (36)';
    }
    return 'Maharashtra (27)';
  }

  async generateQuotationPdfBuffer(body: any): Promise<Buffer> {
    const qRefNum =
      body.piNumber ||
      body.qRefNum ||
      `QT-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const customerName =
      body.companyName || body.customerName || 'Valued Customer';
    const customerEmail = body.customerEmail || 'accounts@enlightmetals.com';
    return this.generatePdfKitBuffer(
      qRefNum,
      customerName,
      customerEmail,
      body,
    );
  }

  async generatePdfKitBuffer(
    qRefNum: string,
    customerName: string,
    customerEmail: string,
    details: any,
  ): Promise<Buffer> {
    const logger = this.logger;

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 40,
          info: {
            Title: `Invoice - ${qRefNum}`,
            Author: 'Enlight Metals Private Limited',
            Subject: `Invoice for ${customerName}`,
          },
        });

        const buffers: Buffer[] = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          resolve(Buffer.concat(buffers));
        });
        doc.on('error', (err: Error) => reject(err));

        const notoSansPath = getAssetFontPath('NotoSans-Regular.ttf');
        const notoSansBoldPath = getAssetFontPath('NotoSans-Bold.ttf');
        let fontRegular = 'Helvetica';
        let fontBold = 'Helvetica-Bold';

        if (notoSansPath && notoSansBoldPath) {
          try {
            doc.registerFont('NotoSans', notoSansPath);
            doc.registerFont('NotoSans-Bold', notoSansBoldPath);
            fontRegular = 'NotoSans';
            fontBold = 'NotoSans-Bold';
          } catch (fErr) {
            logger.warn('Error registering NotoSans fonts:', fErr);
          }
        }
        doc.font(fontRegular);

        const leftX = 40;
        const rightEdge = 555.28;
        const contentWidth = rightEdge - leftX;

        const todayDate =
          details?.poDate ||
          details?.orderDate ||
          new Date().toLocaleDateString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          });

        const salesperson =
          details?.salespersonName ||
          details?.salesperson_name ||
          details?.salesperson ||
          (details as any)?.activeSalespersonName ||
          'Max';

        const compName = (
          details?.companyName ||
          customerName ||
          'Customer'
        ).toUpperCase();
        const rawAddress = (
          details?.deliveryLocation ||
          details?.customerAddress ||
          details?.address ||
          ''
        ).trim();

        const cleanAddressLines = (raw: string, company: string): string[] => {
          if (!raw)
            return ['MIDC Industrial Area', 'Nashik', 'Maharashtra - 422010'];
          const parts = raw
            .split(',')
            .map((p: string) => p.trim())
            .filter(Boolean);
          const cleaned: string[] = [];
          for (let part of parts) {
            if (part.toUpperCase() === company.toUpperCase()) continue;
            if (part.toUpperCase().startsWith(company.toUpperCase())) {
              part = part
                .substring(company.length)
                .trim()
                .replace(/^[-,\s]+/, '');
            }
            if (part) cleaned.push(part);
          }
          return cleaned.length > 0 ? cleaned : parts;
        };

        const billToAddress = (
          details?.customerAddress ||
          details?.address ||
          rawAddress
        ).trim();
        const shipToAddress = (
          details?.deliveryLocation ||
          details?.customerAddress ||
          rawAddress
        ).trim();

        const billToLines = cleanAddressLines(billToAddress, compName);
        const shipToLines = cleanAddressLines(shipToAddress, compName);
        const customerGstin = details?.customerGstin || details?.gstin || '';
        const placeOfSupply = this.resolvePlaceOfSupply(rawAddress);

        const paymentTerms = details?.paymentTerms
          ? details.paymentTerms.trim()
          : '30 Days Credit';

        // ================= PAGE 1 =================
        // 1. Company Header (Top Left) & Proforma Invoice Meta (Top Right)
        const logoBuffer = getCompanyLogoBuffer();
        if (logoBuffer) {
          try {
            doc.image(logoBuffer, leftX, 40, { width: 140 });
          } catch {
            doc
              .fillColor('#0F172A')
              .font(fontBold)
              .fontSize(16)
              .text('ENLIGHT METALS', leftX, 40);
          }
        } else {
          doc
            .fillColor('#0F172A')
            .font(fontBold)
            .fontSize(16)
            .text('ENLIGHT METALS', leftX, 40);
        }

        let leftHeaderY = 86;
        doc
          .fillColor('#0F172A')
          .font(fontBold)
          .fontSize(9.5)
          .text('Enlight Metals Private Limited', leftX, leftHeaderY);
        leftHeaderY += 14;

        doc.fillColor('#475569').font(fontRegular).fontSize(8);
        doc.text('606 Clover Hills Plaza', leftX, leftHeaderY);
        leftHeaderY += 12;
        doc.text('NIBM Road', leftX, leftHeaderY);
        leftHeaderY += 12;
        doc.text('Pune Maharashtra 411048', leftX, leftHeaderY);
        leftHeaderY += 12;
        doc.text('India', leftX, leftHeaderY);
        leftHeaderY += 12;

        doc
          .fillColor('#334155')
          .font(fontRegular)
          .fontSize(8)
          .text('GSTIN 27AAICE5263E1ZN', leftX, leftHeaderY);
        leftHeaderY += 12;

        doc.fillColor('#475569').font(fontRegular).fontSize(8);
        doc.text('accounts@enlightmetals.com', leftX, leftHeaderY);
        leftHeaderY += 12;
        doc.text('https://enlightmetals.com/', leftX, leftHeaderY);
        leftHeaderY += 12;

        // Top Right Proforma Invoice Header

        // 2. Bill To, Ship To & Supply Section (Left) / Order Date & Salesperson (Right)
        let currY = Math.max(leftHeaderY + 22, 205);

        // Bill To Block
        doc
          .fillColor('#1E293B')
          .font(fontBold)
          .fontSize(9)
          .text('Bill To', leftX, currY);
        currY += 13;
        doc
          .fillColor('#0F172A')
          .font(fontBold)
          .fontSize(9)
          .text(compName, leftX, currY);
        currY += 13;
        doc.fillColor('#475569').font(fontRegular).fontSize(8);
        for (const line of billToLines) {
          doc.text(line, leftX, currY);
          currY += 11.5;
        }
        if (customerGstin) {
          doc.text(`GSTIN ${customerGstin}`, leftX, currY);
          currY += 11.5;
        }

        // Space between Bill To and Ship To
        currY += 12;

        // Ship To Block
        doc
          .fillColor('#1E293B')
          .font(fontBold)
          .fontSize(9)
          .text('Ship To', leftX, currY);
        currY += 13;
        doc
          .fillColor('#0F172A')
          .font(fontBold)
          .fontSize(9)
          .text(compName, leftX, currY);
        currY += 13;
        doc.fillColor('#475569').font(fontRegular).fontSize(8);
        for (const line of shipToLines) {
          doc.text(line, leftX, currY);
          currY += 11.5;
        }

        // Space before Place of Supply
        currY += 10;

        doc
          .fillColor('#1E293B')
          .font(fontBold)
          .fontSize(8.5)
          .text('Place Of Supply: ', leftX, currY, { continued: true })
          .font(fontRegular)
          .fillColor('#475569')
          .text(placeOfSupply);
        currY += 16;

        // Right Column: Order Date & Sales Person
        const rightBoxX = 395;
        const metaRightY = currY - 34;
        doc
          .fillColor('#475569')
          .font(fontRegular)
          .fontSize(8.5)
          .text('Order Date :', rightBoxX, metaRightY, { width: 75 });
        doc
          .fillColor('#0F172A')
          .font(fontRegular)
          .fontSize(8.5)
          .text(todayDate, rightBoxX + 75, metaRightY, {
            width: 85,
            align: 'right',
          });

        doc
          .fillColor('#475569')
          .font(fontRegular)
          .fontSize(8.5)
          .text('Sales person :', rightBoxX, metaRightY + 16, { width: 75 });
        doc
          .fillColor('#0F172A')
          .font(fontRegular)
          .fontSize(8.5)
          .text(salesperson, rightBoxX + 75, metaRightY + 16, {
            width: 85,
            align: 'right',
          });

        // 3. Line Items Table (Header bg: #525E6F)
        const lineItemsSrc =
          Array.isArray(details.lineItems) && details.lineItems.length > 0
            ? details.lineItems
            : Array.isArray(details.line_items) && details.line_items.length > 0
              ? details.line_items
              : [
                  {
                    sku_text: details.productType || 'HR - COIL / SHEET',
                    dimensions:
                      [
                        details.thickness,
                        details.width ? `x ${details.width}` : '',
                        details.length ? `x ${details.length}` : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                        .trim() || undefined,
                    hsn_code: detectHsnCode(
                      details.productType || 'HR - COIL / SHEET',
                      [
                        details.thickness,
                        details.width ? `x ${details.width}` : '',
                        details.length ? `x ${details.length}` : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                        .trim() || undefined,
                    ),
                    quantity: Number(details.quantityTons || 0),
                    unit: 'MT',
                    rate: Number(details.unitPrice || 0),
                    amount: Number(details.totalAmount || 0),
                  },
                ];

        const validPricedSrc = lineItemsSrc.filter(
          (item: any) => Number(item.rate || item.unitPrice || 0) > 0,
        );
        const effectiveSrc =
          validPricedSrc.length > 0 ? validPricedSrc : lineItemsSrc;

        const lineItems = effectiveSrc.map((item: any) => ({
          sku_text: (
            item.sku_text ||
            item.description ||
            item.productType ||
            'HR - COIL / SHEET'
          ).toUpperCase(),
          dimensions: item.dimensions || undefined,
          hsn_code:
            item.hsn_code ||
            item.hsn ||
            detectHsnCode(
              item.sku_text || item.description || item.productType || '',
              item.dimensions,
            ),
          quantity: Number(item.quantity || 0),
          unit: item.unit || 'MT',
          rate: Number(item.rate || item.unitPrice || 0),
          amount: Number(
            item.amount ||
              Number(item.quantity || 0) *
                Number(item.rate || item.unitPrice || 0),
          ),
        }));

        const totalTonnage = calculateTotalTonnageMt(lineItems);
        const computedSubtotal =
          lineItems.reduce(
            (s: number, i: any) => s + (Number(i.amount) || 0),
            0,
          ) || Number(details.totalAmount || 0);
        const qBreakdown = calculateQuotationBreakdown(computedSubtotal);

        const drawItemHeader = (headerY: number) => {
          doc.rect(leftX, headerY, contentWidth, 24).fill('#525E6F');
          doc.fillColor('#FFFFFF').font(fontBold).fontSize(8.5);
          doc.text('#', leftX, headerY + 7.5, {
            width: 26,
            align: 'center',
            lineBreak: false,
          });
          doc.text('Item & Description', 70, headerY + 7.5, {
            width: 205,
            lineBreak: false,
          });
          doc.text('HSN/SAC', 278, headerY + 7.5, {
            width: 62,
            align: 'center',
            lineBreak: false,
          });
          doc.text('Qty', 342, headerY + 7.5, {
            width: 68,
            align: 'right',
            lineBreak: false,
          });
          doc.text('Rate', 412, headerY + 7.5, {
            width: 65,
            align: 'right',
            lineBreak: false,
          });
          doc.text('Amount', 479, headerY + 7.5, {
            width: 76.28,
            align: 'right',
            lineBreak: false,
          });
          return headerY + 24;
        };

        const tableY = currY + 14;
        let rowY = drawItemHeader(tableY);
        lineItems.forEach((item, idx) => {
          doc.font(fontBold).fontSize(8.5);
          const skuH = doc.heightOfString(item.sku_text, { width: 205 });
          const dimH = item.dimensions
            ? doc
                .font(fontRegular)
                .fontSize(7.5)
                .heightOfString(item.dimensions, { width: 205 }) + 3
            : 0;
          const rowH = Math.max(34, skuH + dimH + 18);
          const pageBottom = doc.page.maxY();
          if (rowY + rowH > pageBottom && rowY > doc.page.margins.top + 24) {
            doc.addPage();
            rowY = drawItemHeader(doc.page.margins.top);
          }

          doc.rect(leftX, rowY, contentWidth, rowH).fill('#FFFFFF');

          // Index
          doc
            .fillColor('#64748B')
            .font(fontRegular)
            .fontSize(8.5)
            .text(String(idx + 1), leftX, rowY + 9, {
              width: 26,
              align: 'center',
              lineBreak: false,
            });

          // SKU title
          doc
            .fillColor('#0F172A')
            .font(fontBold)
            .fontSize(8.5)
            .text(item.sku_text, 70, rowY + 9, { width: 205 });

          // Dimensions placed cleanly below SKU title
          if (item.dimensions) {
            doc
              .fillColor('#64748B')
              .font(fontRegular)
              .fontSize(7.5)
              .text(item.dimensions, 70, rowY + 9 + skuH + 3, { width: 205 });
          }

          // HSN/SAC
          doc
            .fillColor('#475569')
            .font(fontRegular)
            .fontSize(8.5)
            .text(
              item.hsn_code || detectHsnCode(item.sku_text, item.dimensions),
              278,
              rowY + 9,
              {
                width: 62,
                align: 'center',
                lineBreak: false,
              },
            );

          // Qty
          doc
            .fillColor('#0F172A')
            .font(fontRegular)
            .fontSize(8.5)
            .text(
              `${formatIndianCurrency(item.quantity, true)} ${item.unit || 'MT'}`,
              342,
              rowY + 9,
              { width: 68, align: 'right', lineBreak: false },
            );

          // Rate
          doc
            .fillColor('#475569')
            .font(fontRegular)
            .fontSize(8.5)
            .text(formatIndianCurrency(item.rate, true), 412, rowY + 9, {
              width: 65,
              align: 'right',
              lineBreak: false,
            });

          // Amount
          doc
            .fillColor('#0F172A')
            .font(fontRegular)
            .fontSize(8.5)
            .text(formatIndianCurrency(item.amount, true), 479, rowY + 9, {
              width: 76.28,
              align: 'right',
              lineBreak: false,
            });

          // Bottom divider line
          doc
            .moveTo(leftX, rowY + rowH)
            .lineTo(rightEdge, rowY + rowH)
            .strokeColor('#F1F5F9')
            .lineWidth(0.5)
            .stroke();

          rowY += rowH;
        });

        // 4. Financial Totals & Summary Block
        if (rowY + 110 > doc.page.maxY()) {
          doc.addPage();
          rowY = doc.page.margins.top;
        }
        const summaryY = rowY + 22;
        doc
          .moveTo(leftX, rowY + 10)
          .lineTo(rightEdge, rowY + 10)
          .strokeColor('#E2E8F0')
          .lineWidth(0.75)
          .stroke();

        // Left Summary: Items in Total & Payment Terms
        doc
          .fillColor('#334155')
          .font(fontRegular)
          .fontSize(8.5)
          .text('Items in Total ', leftX, summaryY, { continued: true })
          .font(fontBold)
          .fillColor('#0F172A')
          .text(totalTonnage.formattedText);

        if (paymentTerms) {
          doc
            .fillColor('#334155')
            .font(fontRegular)
            .fontSize(8.5)
            .text('Payment Terms : ', leftX, summaryY + 16, { continued: true })
            .font(fontRegular)
            .fillColor('#0F172A')
            .text(paymentTerms);
        }

        // Right Financial Breakdown
        const sumX = 350;
        const sumW = 205.28;

        // Sub Total
        doc
          .fillColor('#475569')
          .font(fontRegular)
          .fontSize(8.5)
          .text('Sub Total', sumX, summaryY);
        doc
          .fillColor('#0F172A')
          .font(fontRegular)
          .fontSize(8.5)
          .text(qBreakdown.formattedSubtotal, sumX, summaryY, {
            width: sumW,
            align: 'right',
          });

        // CGST9 (9%)
        doc
          .fillColor('#475569')
          .font(fontRegular)
          .fontSize(8.5)
          .text('CGST9 (9%)', sumX, summaryY + 14);
        doc
          .fillColor('#0F172A')
          .font(fontRegular)
          .fontSize(8.5)
          .text(qBreakdown.formattedCGST, sumX, summaryY + 14, {
            width: sumW,
            align: 'right',
          });

        // SGST9 (9%)
        doc
          .fillColor('#475569')
          .font(fontRegular)
          .fontSize(8.5)
          .text('SGST9 (9%)', sumX, summaryY + 28);
        doc
          .fillColor('#0F172A')
          .font(fontRegular)
          .fontSize(8.5)
          .text(qBreakdown.formattedSGST, sumX, summaryY + 28, {
            width: sumW,
            align: 'right',
          });

        // Rounding
        doc
          .fillColor('#475569')
          .font(fontRegular)
          .fontSize(8.5)
          .text('Rounding', sumX, summaryY + 42);
        doc
          .fillColor('#0F172A')
          .font(fontRegular)
          .fontSize(8.5)
          .text(qBreakdown.formattedRounding, sumX, summaryY + 42, {
            width: sumW,
            align: 'right',
          });

        // Total
        doc
          .fillColor('#0F172A')
          .font(fontBold)
          .fontSize(10)
          .text('Total', sumX, summaryY + 58);
        doc
          .fillColor('#0F172A')
          .font(fontBold)
          .fontSize(10.5)
          .text(
            `Rs. ${formatIndianCurrency(qBreakdown.grandTotal, true)}`,
            sumX,
            summaryY + 58,
            {
              width: sumW,
              align: 'right',
            },
          );

        // ================= PAGE 2 =================
        doc.addPage();

        // Top Divider
        doc
          .moveTo(leftX, 40)
          .lineTo(rightEdge, 40)
          .strokeColor('#E2E8F0')
          .lineWidth(0.75)
          .stroke();

        // Notes & Bank Details
        doc
          .fillColor('#0F172A')
          .font(fontBold)
          .fontSize(10)
          .text('Notes', leftX, 55);

        doc
          .fillColor('#334155')
          .font(fontRegular)
          .fontSize(8.5)
          .text('Bank Details: -', leftX, 72);

        doc.fillColor('#475569').font(fontRegular).fontSize(8.5);
        doc.text('Bank Name: Kotak Mahindra Bank', leftX, 86);
        doc.text('IFSC Code: KKBK0001792', leftX, 99);
        doc.text('Account Number: 2500112233', leftX, 112);
        doc.text('Account Name: Enlight Metals Private Limited', leftX, 125);

        // Terms & Conditions
        doc
          .fillColor('#0F172A')
          .font(fontBold)
          .fontSize(10)
          .text('Terms & Conditions', leftX, 150);

        doc
          .fillColor('#334155')
          .font(fontRegular)
          .fontSize(8.5)
          .text('Declaration:', leftX, 166);

        doc
          .fillColor('#475569')
          .font(fontRegular)
          .fontSize(8.5)
          .text(
            'Certified that the particulars given above are true and correct and the amount indicated represents the price actually charged and there is no flow of additional consideration directly or indirectly from the buyer.',
            leftX,
            180,
            { width: contentWidth, lineGap: 2 },
          );

        doc
          .fillColor('#334155')
          .font(fontRegular)
          .fontSize(8.5)
          .text('Note:', leftX, 220);

        doc.fillColor('#475569').font(fontRegular).fontSize(8.5);
        doc.text(
          '1) Interest @24% p.a. will be charged if the payment is not made with stipulated date.',
          leftX,
          234,
        );
        doc.text(
          '2) All disputes are Subject to Pune Jurisdiction only.',
          leftX,
          248,
        );

        // Authorized Signature
        doc
          .fillColor('#0F172A')
          .font(fontBold)
          .fontSize(10)
          .text('Authorized Signature', leftX, 310, { lineBreak: false });

        const signatureName = String(
          details?.senderName ||
            details?.salespersonName ||
            details?.salesperson_name ||
            '',
        ).trim();
        if (
          signatureName &&
          signatureName !== 'Sales Operations Team' &&
          signatureName !== 'Sales Team'
        ) {
          doc
            .fillColor('#0F172A')
            .font(fontRegular)
            .fontSize(10)
            .text(signatureName, leftX, 328, { lineBreak: false });
          doc
            .moveTo(leftX, 372)
            .lineTo(leftX + 160, 372)
            .strokeColor('#0F172A')
            .lineWidth(0.8)
            .stroke();
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
