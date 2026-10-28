import { convertLineItemToMt, normalizeUnit } from '../pricing/pricing.engine';

export type PricingStatus =
  'awaiting_price' | 'price_ready' | 'unavailable' | 'sales_priced';

export interface PricingLineInput {
  line_key: string;
  sku_text?: string;
  quantity?: number;
  unit?: string;
  base_price_per_mt?: number | null;
  line_note?: string | null;
  transport_per_mt?: number | null;
  loading_per_mt?: number | null;
  credit_per_mt?: number | null;
  margin_per_mt?: number | null;
}

export interface StoredPricingLine extends PricingLineInput {
  line_status: 'needs_price' | 'priced' | 'cannot_price';
  procurement_base_price_per_mt?: number | null;
  sales_base_price_per_mt?: number | null;
  rate_per_mt?: number | null;
  taxable_amount?: number | null;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
  final_amount?: number | null;
}

const money = (value: number) => Math.round(value * 100) / 100;
const nonNegative = (value: unknown) => Math.max(0, Number(value) || 0);
const PIECE_UNITS = new Set([
  'Nos',
  'Pcs',
  'Pieces',
  'Units',
  'Bundles',
  'Sheets',
  'Plates',
  'Coils',
]);

export function lineKeyFor(item: any, index: number) {
  return String(
    item?.id || item?.line_key || `${index}:${item?.sku_text || 'line'}`,
  );
}

export function sourceLines(inquiry: any) {
  const ai = inquiry?.ai_extraction_json || {};
  const lines = ai.line_items || ai.lineItems || [];
  return (
    lines.length
      ? lines
      : [
          {
            sku_text: ai.productType || 'Material',
            quantity: ai.quantityTons || 0,
            unit: 'MT',
          },
        ]
  ).map((item: any, index: number) => ({
    line_key: lineKeyFor(item, index),
    sku_text: item.sku_text || item.description || 'Material',
    quantity: Number(item.original_quantity ?? item.quantity ?? item.qty) || 0,
    unit: item.original_unit || item.unit || 'MT',
  }));
}

export function quantityToMt(quantity: number, unit: string) {
  const normalized = String(unit || '').toLowerCase();
  if (normalized === 'kg' || normalized === 'kgs')
    return nonNegative(quantity) / 1000;
  return nonNegative(quantity);
}

export function sourceItemFor(
  inquiry: any,
  line: { line_key?: string },
  index: number,
) {
  const ai = inquiry?.ai_extraction_json || {};
  const lines = ai.line_items || ai.lineItems || [];
  return (
    lines.find(
      (item: any, itemIndex: number) =>
        lineKeyFor(item, itemIndex) === line?.line_key,
    ) ||
    lines[index] ||
    {}
  );
}

export interface TonnageReviewLine {
  sku_text: string;
  from_mt: number;
  to_mt: number;
}

export interface TonnageReviewBaseline {
  sku_text: string;
  mt: number;
}

export interface TonnageReview {
  changed_at: string;
  previous_total_mt: number;
  next_total_mt: number;
  lines: TonnageReviewLine[];
  baseline: TonnageReviewBaseline[];
}

const roundMt = (value: number) => Math.round((Number(value) || 0) * 1000) / 1000;

function isManualMt(item: any) {
  const flag = item?.is_manual_mt;
  return flag === true || flag === 'true' || flag === 1 || flag === '1';
}

function lineForWeight(item: any) {
  const manualMt = Number(item?.converted_mt);
  if (isManualMt(item) && Number.isFinite(manualMt) && manualMt > 0) {
    return {
      ...(item || {}),
      quantity: manualMt,
      unit: 'MT',
      original_unit: 'MT',
      converted_mt: manualMt,
      weight_mt: undefined,
    };
  }
  const unit = String(item?.original_unit || item?.unit || 'MT').toLowerCase();
  if (unit === 'mt' || unit === 'kg' || unit === 'kgs') {
    const copy = { ...(item || {}) };
    delete copy.weight_mt;
    delete copy.converted_mt;
    return copy;
  }
  return item || {};
}

function lineSnapshot(item: any): TonnageReviewBaseline {
  const weighed = lineForWeight(item);
  return {
    sku_text: String(item?.sku_text || item?.description || 'Material'),
    mt: roundMt(pricingWeightMt(weighed, weighed)),
  };
}

export function inquiryCommercialLines(source: any): any[] {
  if (Array.isArray(source)) return source;
  const ai = source?.ai_extraction_json || source || {};
  const lines =
    ai.line_items || ai.lineItems || source?.line_items || source?.lineItems;
  if (Array.isArray(lines) && lines.length) return lines;
  const tons = Number(ai.quantityTons || source?.quantityTons || 0);
  if (tons > 0) {
    return [
      {
        sku_text: ai.productType || ai.product_type || 'Material',
        quantity: tons,
        unit: 'MT',
      },
    ];
  }
  return [];
}

export function tonnageReviewPatch(input: {
  pricingStatus?: string | null;
  reviewOpen?: boolean;
  existingReview?: Partial<TonnageReview> | null;
  beforeLines: any[];
  afterLines: any[];
  now?: string;
}): {
  pricing_status: 'awaiting_price' | 'price_ready';
  tonnage_review_open: boolean;
  tonnage_review: TonnageReview | null;
} | null {
  const status = input.pricingStatus || null;
  const open = Boolean(input.reviewOpen);
  const canOpen = status === 'price_ready';
  const canUpdate = open && status === 'awaiting_price';
  if (!canOpen && !canUpdate) return null;
  if (!Array.isArray(input.afterLines) || input.afterLines.length === 0) {
    return null;
  }

  const before = (input.beforeLines || []).map(lineSnapshot);
  const after = input.afterLines.map(lineSnapshot);
  const countNow = Math.max(before.length, after.length);
  let weightChanged = before.length !== after.length;
  for (let index = 0; index < countNow; index += 1) {
    if ((before[index]?.mt ?? 0) !== (after[index]?.mt ?? 0)) weightChanged = true;
  }
  if (!weightChanged) return null;

  const baseline =
    canUpdate && input.existingReview?.baseline?.length
      ? input.existingReview.baseline.map((line) => ({
          sku_text: line.sku_text || 'Material',
          mt: roundMt(line.mt),
        }))
      : before;
  const count = Math.max(baseline.length, after.length);
  const lines: TonnageReviewLine[] = [];
  let previous = 0;
  let next = 0;
  for (let index = 0; index < count; index += 1) {
    const from = roundMt(baseline[index]?.mt ?? 0);
    const to = roundMt(after[index]?.mt ?? 0);
    previous += from;
    next += to;
    if (from !== to) {
      lines.push({
        sku_text: after[index]?.sku_text || baseline[index]?.sku_text || 'Material',
        from_mt: from,
        to_mt: to,
      });
    }
  }
  previous = roundMt(previous);
  next = roundMt(next);
  const previousTotal =
    canUpdate && input.existingReview?.previous_total_mt != null
      ? roundMt(Number(input.existingReview.previous_total_mt))
      : previous;

  if (!lines.length && previousTotal === next) {
    if (!canUpdate) return null;
    return {
      pricing_status: 'price_ready',
      tonnage_review_open: false,
      tonnage_review: null,
    };
  }

  return {
    pricing_status: 'awaiting_price',
    tonnage_review_open: true,
    tonnage_review: {
      changed_at: input.now || new Date().toISOString(),
      previous_total_mt: previousTotal,
      next_total_mt: next,
      lines,
      baseline,
    },
  };
}

export function pricingWeightMt(line: any, sourceItem: any = {}) {
  const item = {
    ...(sourceItem || {}),
    quantity: line?.quantity ?? sourceItem?.quantity,
    unit: line?.unit || sourceItem?.unit || sourceItem?.original_unit,
    sku_text: line?.sku_text || sourceItem?.sku_text || sourceItem?.description,
    dimensions: line?.dimensions || sourceItem?.dimensions,
    weight_mt: line?.weight_mt ?? sourceItem?.weight_mt,
    converted_mt: line?.converted_mt ?? sourceItem?.converted_mt,
  };
  const converted = convertLineItemToMt(item);
  if (converted.canConvert && converted.mt != null && converted.mt > 0) {
    return Math.round(Number(converted.mt) * 1000) / 1000;
  }
  if (PIECE_UNITS.has(normalizeUnit(item.unit))) return 0;
  return quantityToMt(Number(item.quantity) || 0, item.unit || 'MT');
}

export function deriveProcurementLines(
  existing: StoredPricingLine[],
  submitted: PricingLineInput[],
) {
  return submitted.map((line) => {
    const price =
      line.base_price_per_mt == null || line.base_price_per_mt === ('' as any)
        ? null
        : nonNegative(line.base_price_per_mt);
    const previous = existing.find((item) => item.line_key === line.line_key);
    return {
      ...previous,
      ...line,
      procurement_base_price_per_mt: price && price > 0 ? price : null,
      line_status:
        price && price > 0 ? ('priced' as const) : ('cannot_price' as const),
      procurement_line_note: line.line_note || null,
    };
  });
}

export function procurementStatus(
  lines: Array<{ line_status?: string }>,
): PricingStatus {
  if (lines.some((line) => line.line_status === 'priced')) return 'price_ready';
  if (
    lines.length &&
    lines.every((line) => line.line_status === 'cannot_price')
  )
    return 'unavailable';
  return 'awaiting_price';
}

export function gstSplit(amount: number, deliveryAddress = '') {
  const taxable = nonNegative(amount);
  const maharashtra = /\bmaharashtra\b|\bmh\b/i.test(deliveryAddress);
  if (maharashtra) {
    const cgst = money(taxable * 0.09);
    const sgst = money(taxable * 0.09);
    return {
      cgst_amount: cgst,
      sgst_amount: sgst,
      igst_amount: 0,
      total: money(cgst + sgst),
    };
  }
  const igst = money(taxable * 0.18);
  return { cgst_amount: 0, sgst_amount: 0, igst_amount: igst, total: igst };
}

export function calculateSalesLine(
  line: StoredPricingLine,
  deliveryAddress = '',
  sourceItem?: any,
) {
  const base = nonNegative(
    line.sales_base_price_per_mt ?? line.procurement_base_price_per_mt,
  );
  const rate = money(
    base +
      nonNegative(line.transport_per_mt) +
      nonNegative(line.loading_per_mt) +
      nonNegative(line.credit_per_mt) +
      nonNegative(line.margin_per_mt),
  );
  const taxable = money(rate * pricingWeightMt(line, sourceItem));
  const gst = gstSplit(taxable, deliveryAddress);
  return {
    ...line,
    sales_base_price_per_mt: base,
    rate_per_mt: rate,
    taxable_amount: taxable,
    ...gst,
    final_amount: money(taxable + gst.total),
  };
}

/** Inquiries created before this instant keep their original status. */
export const PROCUREMENT_PRICING_CUTOFF = '2026-10-15T00:00:00+05:30';

export function preserveHistoricalPricingStatus<
  T extends {
    pricing_status?: string | null;
    created_at?: string | null;
    tonnage_review_open?: boolean | null;
  },
>(item: T): T {
  if (!item || item.pricing_status !== 'awaiting_price') return item;
  if (item.tonnage_review_open) return item;
  const created = item.created_at ? new Date(item.created_at).getTime() : NaN;
  const cutoff = new Date(PROCUREMENT_PRICING_CUTOFF).getTime();
  if (!Number.isNaN(created) && created < cutoff) {
    return { ...item, pricing_status: null };
  }
  return item;
}

export function nextProcurementNumber(
  rows: Array<{ procurement_number?: string | null }> | null | undefined,
): string {
  let max = 10000;
  for (const row of rows || []) {
    const match = String(row?.procurement_number || '').match(/^PR-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `PR-${String(max + 1).padStart(5, '0')}`;
}

const LINKED_DEAL_STAGES = new Set([
  'won',
  'lost',
  'negotiation',
  'quoted',
  'on_hold',
  'qualified',
  'hold',
]);

/** Newest pipeline stage among deals linked to this inquiry. */
export function linkedDealStage(
  deals:
    | Array<{
        id?: string | null;
        inquiry_id?: string | null;
        stage?: string | null;
        created_at?: string | null;
      }>
    | null
    | undefined,
  inquiryId?: string | null,
): string | null {
  if (!inquiryId) return null;
  const matches = (deals || []).filter((deal) => deal?.inquiry_id === inquiryId);
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const timeA = new Date(a?.created_at || 0).getTime() || 0;
    const timeB = new Date(b?.created_at || 0).getTime() || 0;
    if (timeB !== timeA) return timeB - timeA;
    return String(b?.id || '').localeCompare(String(a?.id || ''));
  });
  const stage = String(matches[0]?.stage || '')
    .toLowerCase()
    .trim();
  return LINKED_DEAL_STAGES.has(stage) ? stage : null;
}

/**
 * Canonical pipeline stage for every inquiry surface.
 *
 * Pricing status is intentionally excluded: it is a separate procurement
 * workflow badge and must not alter sales pipeline totals.
 */
export function displayStage(
  inquiry: {
    status?: string | null;
    stage?: string | null;
    inquiry_type?: string | null;
    source_channel?: string | null;
    raw_text?: string | null;
  },
  deals?: Array<{
    id?: string | null;
    inquiry_id?: string | null;
    stage?: string | null;
    created_at?: string | null;
  }> | null,
  inquiryId?: string | null,
): string {
  const normalizePipelineStage = (value: unknown): string | null => {
    const stage = String(value || '').toLowerCase().trim();
    if (stage === 'qualified') return 'quoted';
    if (stage === 'hold') return 'on_hold';
    return ['won', 'lost', 'negotiation', 'quoted', 'on_hold'].includes(stage)
      ? stage
      : null;
  };

  const linked = normalizePipelineStage(linkedDealStage(deals, inquiryId));
  if (linked) return linked;

  const direct = normalizePipelineStage(inquiry?.stage);
  if (direct) return direct;

  const status = String(inquiry?.status || '').toLowerCase().trim();
  const inquiryType = String(inquiry?.inquiry_type || '').toLowerCase().trim();
  const sourceChannel = String(inquiry?.source_channel || '').toLowerCase().trim();

  if (
    (inquiryType === 'purchase_order' ||
      sourceChannel === 'whatsapp_po' ||
      String(inquiry?.raw_text || '').includes('[PO Document Attached')) &&
    ['confirmed', 'won', 'processed'].includes(status)
  ) {
    return 'won';
  }
  if (status === 'won') return 'won';
  if (status === 'lost') return 'lost';
  if (status === 'negotiation') return 'negotiation';
  if (status === 'on_hold' || status === 'hold') return 'on_hold';
  if (
    [
      'quoted',
      'quotation_sent',
      'confirmed',
      'saved',
      'processed',
      'quotation_ready',
    ].includes(status) ||
    inquiryType === 'quotation_sent'
  ) {
    return 'quoted';
  }
  return 'new_inquiry';
}

export function anonymizeInquiry(item: any) {
  const ai = { ...(item?.ai_extraction_json || {}) };
  delete ai.customer_name;
  delete ai.customer_phone;
  delete ai.companyName;
  delete ai.customer;
  delete ai.customerEmail;
  delete ai.customer_email;
  delete ai.email;
  return {
    ...item,
    customer_name: undefined,
    customer_phone: undefined,
    customer_email: undefined,
    sender_name: undefined,
    sender_phone: undefined,
    raw_text: undefined,
    ai_extraction_json: ai,
  };
}
