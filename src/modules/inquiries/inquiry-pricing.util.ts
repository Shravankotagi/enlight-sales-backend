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
  const taxable = money(
    rate * quantityToMt(Number(line.quantity) || 0, line.unit || 'MT'),
  );
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
  T extends { pricing_status?: string | null; created_at?: string | null },
>(item: T): T {
  if (!item || item.pricing_status !== 'awaiting_price') return item;
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
