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

export interface TotalTonnageResult {
  totalMt: number;
  hasUnconvertible: boolean;
  unconvertedDetails?: string;
  formattedText: string;
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
 * Converts a single line item into Metric Tons (MT).
 */
export function convertLineItemToMt(item: LineItemInput): {
  mt: number | null;
  canConvert: boolean;
  originalQty: number;
  originalUnit: string;
} {
  const qty = Number(
    item.quantity ?? item.quantity_mt ?? item.quantityTons ?? item.qty ?? 0,
  );
  const rawUnit = (item.unit || 'MT').trim();
  const normUnit = normalizeUnit(rawUnit);

  if (!qty || qty <= 0) {
    return { mt: 0, canConvert: true, originalQty: 0, originalUnit: rawUnit };
  }

  // 1. MT: No conversion needed
  if (normUnit === 'MT') {
    return { mt: qty, canConvert: true, originalQty: qty, originalUnit: 'MT' };
  }

  // 2. KG: MT = KG / 1000
  if (normUnit === 'KG') {
    return {
      mt: qty / 1000,
      canConvert: true,
      originalQty: qty,
      originalUnit: 'KG',
    };
  }

  // 3. Dimension & Product Formula
  const combinedText = [
    item.sku_text || '',
    item.dimensions || '',
    item.spec || '',
    item.specification || '',
    item.description || '',
    item.product || '',
  ]
    .join(' ')
    .toLowerCase();

  // 3a. MS TMT Bars / Rebars: Weight (KG) = (Diameter^2 / 162) * Length (m) * Nos -> MT = KG / 1000
  const isTmt = combinedText.includes('tmt') || combinedText.includes('rebar');
  if (isTmt) {
    const diaMatch = combinedText.match(
      /(\d+(?:\.\d+)?)\s*(?:mm|dia|diameter)/,
    );
    if (diaMatch) {
      const dia = parseFloat(diaMatch[1]);
      const lenMatch = combinedText.match(
        /(\d+(?:\.\d+)?)\s*(?:m|meter|mtr)\b/,
      );
      const len = lenMatch ? parseFloat(lenMatch[1]) : 12;
      const wtKg = ((dia * dia) / 162) * len * qty;
      return {
        mt: wtKg / 1000,
        canConvert: true,
        originalQty: qty,
        originalUnit: rawUnit,
      };
    }
  }

  // 3b. MS Round Bars: Weight (KG) = (pi / 4) * Diameter^2(cm) * Length(cm) * 7.85 / 1000 * Nos
  const isRound =
    combinedText.includes('round bar') ||
    combinedText.includes('bright bar') ||
    combinedText.includes('round');
  if (isRound) {
    const diaMatch = combinedText.match(
      /(\d+(?:\.\d+)?)\s*(?:mm|dia|diameter)/,
    );
    if (diaMatch) {
      const dia = parseFloat(diaMatch[1]);
      const lenMatch = combinedText.match(
        /(\d+(?:\.\d+)?)\s*(?:m|meter|mtr)\b/,
      );
      const len = lenMatch ? parseFloat(lenMatch[1]) : 6;
      const diaCm = dia / 10;
      const lenCm = len * 100;
      const wtKg =
        (Math.PI / 4) * (diaCm * diaCm) * lenCm * (7.85 / 1000) * qty;
      return {
        mt: wtKg / 1000,
        canConvert: true,
        originalQty: qty,
        originalUnit: rawUnit,
      };
    }
  }

  // 3c. MS Angles: Weight (KG) = (A + B - t) * t * 0.00785 * Length (m) * Nos -> MT = KG / 1000
  const isAngle =
    combinedText.includes('angle') || combinedText.includes('isa');
  if (isAngle) {
    const angleMatch = combinedText.match(
      /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[xX*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*[xX*]\s*(\d+(?:\.\d+)?)/,
    );
    if (angleMatch) {
      const a = parseFloat(angleMatch[1]);
      const b = parseFloat(angleMatch[2]);
      const t = parseFloat(angleMatch[3]);
      const lenMatch = combinedText.match(
        /(\d+(?:\.\d+)?)\s*(?:m|meter|mtr)\b/,
      );
      const len = lenMatch ? parseFloat(lenMatch[1]) : 6;
      const wtKg = (a + b - t) * t * 0.00785 * len * qty;
      return {
        mt: wtKg / 1000,
        canConvert: true,
        originalQty: qty,
        originalUnit: rawUnit,
      };
    }
  }

  // 3d. MS Channels / Beams / Joist / Square Pipe:
  const isPipe =
    combinedText.includes('pipe') ||
    combinedText.includes('tube') ||
    combinedText.includes('shs') ||
    combinedText.includes('rhs') ||
    combinedText.includes('square');
  if (isPipe) {
    const pipeMatch = combinedText.match(
      /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[xX*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*[xX*]\s*(\d+(?:\.\d+)?)/,
    );
    if (pipeMatch) {
      const od = parseFloat(pipeMatch[1]);
      const t = parseFloat(pipeMatch[3]);
      const len = 6;
      const wtKg = (od - t) * t * 0.0157 * len * qty;
      return {
        mt: wtKg / 1000,
        canConvert: true,
        originalQty: qty,
        originalUnit: rawUnit,
      };
    }
  }

  // 3e. Standard Sheets / Plates / Coils / CR Coils / HR Coils / Chequered Plates:
  let thickness: number | null = null;
  const thkMatch = combinedText.match(
    /(\d+(?:\.\d+)?)\s*(?:mm\s*thk|mm\s*thickness|mm|\bthk\b)/,
  );
  if (thkMatch) {
    thickness = parseFloat(thkMatch[1]);
  }

  let widthM: number | null = null;
  let lengthM: number | null = null;

  const dim3Match = combinedText.match(
    /(\d+(?:\.\d+)?)\s*[xX*]\s*(\d+(?:\.\d+)?)\s*[xX*]\s*(\d+(?:\.\d+)?)/,
  );
  if (dim3Match) {
    const n1 = parseFloat(dim3Match[1]);
    const n2 = parseFloat(dim3Match[2]);
    const n3 = parseFloat(dim3Match[3]);
    const sorted = [n1, n2, n3].sort((a, b) => a - b);
    if (!thickness) thickness = sorted[0];
    const w = sorted[1];
    const l = sorted[2];
    widthM = w > 20 ? w / 1000 : w;
    lengthM = l > 20 ? l / 1000 : l;
  } else {
    const dim2Match = combinedText.match(
      /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[xX*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?/,
    );
    if (dim2Match) {
      const d1 = parseFloat(dim2Match[1]);
      const d2 = parseFloat(dim2Match[2]);
      const w = Math.min(d1, d2);
      const l = Math.max(d1, d2);
      widthM = w > 20 ? w / 1000 : w;
      lengthM = l > 20 ? l / 1000 : l;
    }
  }

  if (thickness && widthM && lengthM) {
    const wtPerPieceKg = lengthM * widthM * thickness * 7.85;
    const totalMt = (wtPerPieceKg * qty) / 1000;
    return {
      mt: totalMt,
      canConvert: true,
      originalQty: qty,
      originalUnit: rawUnit,
    };
  }

  return {
    mt: qty,
    canConvert: true,
    originalQty: qty,
    originalUnit: rawUnit,
  };
}

/**
 * Calculates converted total tonnage in MT across all line items with precision and transparency.
 */
export function calculateTotalTonnageMt(
  lineItems: LineItemInput[],
): TotalTonnageResult {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return { totalMt: 0, hasUnconvertible: false, formattedText: '0.00 MT' };
  }

  let totalMt = 0;
  for (const item of lineItems) {
    const res = convertLineItemToMt(item);
    if (res.canConvert && res.mt !== null) {
      totalMt += res.mt;
    } else {
      totalMt += Number(item.quantity || 0);
    }
  }

  const roundedMt = Math.round(totalMt * 1000) / 1000;
  const formattedMtStr = roundedMt.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });

  return {
    totalMt: roundedMt,
    hasUnconvertible: false,
    formattedText: `${formattedMtStr} MT`,
  };
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
 * Strict Forward GST calculation: always forward on line amount - never reverse calculated.
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

export interface QuotationFinancialBreakdown {
  subtotal: number;
  CGST: number;
  SGST: number;
  rounding: number;
  grandTotal: number;
  formattedSubtotal: string;
  formattedCGST: string;
  formattedSGST: string;
  formattedRounding: string;
  formattedGrandTotal: string;
}

/**
 * Formats a number with Indian currency comma separation and optional 2 decimal places.
 * Example: 4536037 -> 45,36,037.00
 */
export function formatIndianCurrency(
  num: number,
  includeDecimals = true,
): string {
  if (num === null || num === undefined || isNaN(Number(num))) {
    return includeDecimals ? '0.00' : '0';
  }
  const n = Number(num);
  const isNegative = n < 0;
  const absNum = Math.abs(n);

  const parts = absNum.toFixed(2).split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1];

  let lastThree = integerPart.substring(integerPart.length - 3);
  const otherNumbers = integerPart.substring(0, integerPart.length - 3);
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  const formattedInt =
    otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;

  const result = includeDecimals
    ? `${formattedInt}.${decimalPart}`
    : formattedInt;
  return isNegative ? `-${result}` : result;
}

/**
 * Calculates standard GST 9% + 9% and Rounding financial breakdown for quotation displays.
 */
export function calculateQuotationBreakdown(
  baseAmount: number,
): QuotationFinancialBreakdown {
  const subtotal = Math.max(0, Number(baseAmount) || 0);
  const CGST = Math.round(subtotal * 0.09 * 100) / 100;
  const SGST = Math.round(subtotal * 0.09 * 100) / 100;
  const exactTotal = subtotal + CGST + SGST;
  const grandTotal = Math.round(exactTotal);
  const rounding = Math.round((grandTotal - exactTotal) * 100) / 100;

  return {
    subtotal,
    CGST,
    SGST,
    rounding,
    grandTotal,
    formattedSubtotal: formatIndianCurrency(subtotal, true),
    formattedCGST: formatIndianCurrency(CGST, true),
    formattedSGST: formatIndianCurrency(SGST, true),
    formattedRounding: formatIndianCurrency(rounding, true),
    formattedGrandTotal: `₹${formatIndianCurrency(grandTotal, true)}`,
  };
}
