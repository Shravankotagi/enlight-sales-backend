/**
 * Centralized TypeScript Pricing Engine for NestJS Backend
 */

export const DEFAULT_GST_RATE = 0.18;

export interface LineItemInput {
  sku_text?: string;
  description?: string;
  dimensions?: string;
  quantity?: number | string;
  quantity_mt?: number | string;
  qty?: number | string;
  unit?: string;
  rate?: number | string;
  rate_per_mt?: number | string;
  price_per_mt?: number | string;
  unitPrice?: number | string;
  amount?: number | string;
  [key: string]: any;
}

export interface CalculatedLineItem extends LineItemInput {
  quantity: number;
  rate: number;
  amount: number;
  unit: string;
}

export interface PricingSummary {
  lineItems: CalculatedLineItem[];
  totalQuantity: number;
  totalQuantityMt: number;
  unit: string;
  formattedQuantity: string;
  subtotal: number;
  gstAmount: number;
  grandTotal: number;
  gstRate: number;
}

/**
 * Normalizes unit string to standard casing and symbol.
 */
export function normalizeUnit(rawUnit?: string): string {
  if (!rawUnit || typeof rawUnit !== 'string') return 'MT';
  const u = rawUnit.trim().toUpperCase();
  if (u === 'KG' || u === 'KGS' || u === 'KILOGRAM' || u === 'KILOGRAMS')
    return 'KG';
  if (
    u === 'MT' ||
    u === 'TON' ||
    u === 'TONS' ||
    u === 'TONNE' ||
    u === 'TONNES' ||
    u === 'METRIC TON' ||
    u === 'METRIC TONS'
  )
    return 'MT';
  if (u === 'PCS' || u === 'PIECE' || u === 'PIECES') return 'Pcs';
  if (u === 'SHEET' || u === 'SHEETS') return 'Sheets';
  if (u === 'PLATE' || u === 'PLATES') return 'Plates';
  if (u === 'COIL' || u === 'COILS') return 'Coils';
  if (u === 'BAR' || u === 'BARS') return 'Bars';
  if (u === 'NOS' || u === 'NUMBER' || u === 'NUMBERS') return 'Nos';
  if (u === 'BUNDLE' || u === 'BUNDLES') return 'Bundles';
  if (u === 'PIPE' || u === 'PIPES' || u === 'TUBE' || u === 'TUBES')
    return 'Pipes';
  return rawUnit.trim();
}

/**
 * Converts a quantity to its Metric Ton (MT) equivalent.
 */
export function convertToMt(quantity: number, rawUnit?: string): number {
  const norm = normalizeUnit(rawUnit);
  if (norm === 'KG') return quantity / 1000;
  if (norm === 'MT') return quantity;
  return quantity;
}

/**
 * Checks if dimensions extracted from text are compatible with candidate SKU.
 */
export function isDimensionCompatible(
  productText?: string | null,
  skuText?: string | null,
): boolean {
  if (!productText || !skuText) return true;

  const mmMatchText = productText.match(/(\d+(?:\.\d+)?)\s*mm/i);
  const mmMatchSku = skuText.match(/(\d+(?:\.\d+)?)\s*mm/i);

  if (mmMatchText && mmMatchSku) {
    return parseFloat(mmMatchText[1]) === parseFloat(mmMatchSku[1]);
  }
  return true;
}

/**
 * Calculates line item values.
 */
export function calculateLineItem(item: LineItemInput): CalculatedLineItem {
  if (!item) {
    return { quantity: 0, rate: 0, amount: 0, unit: 'MT' };
  }
  const quantity =
    Number(item.quantity ?? item.quantity_mt ?? item.qty ?? 0) || 0;
  const rate =
    Number(
      item.rate ?? item.rate_per_mt ?? item.price_per_mt ?? item.unitPrice ?? 0,
    ) || 0;
  const unit = normalizeUnit(item.unit);

  let amount = item.amount && Number(item.amount) > 0 ? Number(item.amount) : 0;
  if (!amount && quantity > 0 && rate > 0) {
    if (unit === 'KG' && rate > 1000) {
      amount = Math.round((quantity / 1000) * rate);
    } else {
      amount = Math.round(quantity * rate);
    }
  }

  return {
    ...item,
    quantity,
    rate,
    amount,
    unit,
  };
}

/**
 * Calculates array of line items.
 */
export function calculateLineItems(
  lineItems: LineItemInput[],
): CalculatedLineItem[] {
  if (!Array.isArray(lineItems)) return [];
  return lineItems.map(calculateLineItem);
}

/**
 * Calculates subtotal (sum of base amounts) across line items.
 */
export function calculateSubtotal(lineItems: LineItemInput[]): number {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return 0;
  return lineItems.reduce((sum, item) => {
    const calculated = calculateLineItem(item);
    return sum + calculated.amount;
  }, 0);
}

/**
 * Strict Forward GST calculation: always forward on line amount — never reverse calculated.
 */
export function calculateGst(
  baseAmount: number,
  gstRate: number = DEFAULT_GST_RATE,
): number {
  const base = Number(baseAmount) || 0;
  if (base <= 0) return 0;
  return Math.round(base * gstRate);
}

/**
 * Calculates Grand Total (Subtotal + Forward GST).
 */
export function calculateGrandTotal(
  baseAmount: number,
  gstRate: number = DEFAULT_GST_RATE,
): number {
  const base = Number(baseAmount) || 0;
  const gst = calculateGst(base, gstRate);
  return base + gst;
}

/**
 * Computes complete pricing summary breakdown with intelligent unit handling.
 */
export function calculatePricingSummary(
  input:
    | LineItemInput[]
    | {
        line_items?: LineItemInput[];
        lineItems?: LineItemInput[];
        basic_amount?: number;
        subtotal?: number;
        baseAmount?: number;
      },
  options: { gstRate?: number } = {},
): PricingSummary {
  const gstRate = options.gstRate ?? DEFAULT_GST_RATE;

  let rawItems: LineItemInput[] = [];
  let explicitBase = 0;

  if (Array.isArray(input)) {
    rawItems = input;
  } else if (input && typeof input === 'object') {
    rawItems = input.line_items || input.lineItems || [];
    explicitBase = Number(
      input.basic_amount ?? input.subtotal ?? input.baseAmount ?? 0,
    );
  }

  const processedItems = calculateLineItems(rawItems);
  const itemsSubtotal = calculateSubtotal(processedItems);

  const distinctUnits = Array.from(
    new Set(processedItems.map((i) => i.unit || 'MT')),
  );
  const isUniformUnit = distinctUnits.length <= 1;
  const primaryUnit = isUniformUnit ? distinctUnits[0] || 'MT' : 'MT';

  let totalQuantity = 0;
  let totalQuantityMt = 0;
  let formattedQuantity = '';

  if (primaryUnit === 'KG' && isUniformUnit) {
    totalQuantity = processedItems.reduce(
      (sum, item) => sum + (Number(item.quantity) || 0),
      0,
    );
    totalQuantityMt = totalQuantity / 1000;
    if (totalQuantityMt >= 1) {
      formattedQuantity = `${totalQuantityMt.toLocaleString('en-IN')} MT (${totalQuantity.toLocaleString('en-IN')} KG)`;
    } else {
      formattedQuantity = `${totalQuantity.toLocaleString('en-IN')} KG`;
    }
  } else if (primaryUnit === 'MT' && isUniformUnit) {
    totalQuantity = processedItems.reduce(
      (sum, item) => sum + (Number(item.quantity) || 0),
      0,
    );
    totalQuantityMt = totalQuantity;
    formattedQuantity = `${totalQuantity.toLocaleString('en-IN')} MT`;
  } else {
    totalQuantityMt = processedItems.reduce(
      (sum, item) => sum + convertToMt(Number(item.quantity) || 0, item.unit),
      0,
    );
    totalQuantity = isUniformUnit
      ? processedItems.reduce(
          (sum, item) => sum + (Number(item.quantity) || 0),
          0,
        )
      : totalQuantityMt;
    formattedQuantity = isUniformUnit
      ? `${totalQuantity.toLocaleString('en-IN')} ${primaryUnit}`
      : `${totalQuantityMt.toLocaleString('en-IN')} MT`;
  }

  const subtotal = explicitBase > 0 ? explicitBase : itemsSubtotal;
  const gstAmount = calculateGst(subtotal, gstRate);
  const grandTotal = subtotal + gstAmount;

  return {
    lineItems: processedItems,
    totalQuantity,
    totalQuantityMt,
    unit: primaryUnit,
    formattedQuantity,
    subtotal,
    gstAmount,
    grandTotal,
    gstRate,
  };
}
