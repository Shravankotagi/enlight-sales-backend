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
  summaryText?: string;
  itemBreakdownText?: string;
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

  // Priority 0: Stored normalized weight from database or Gemini unit converter
  if (
    item.weight_mt !== undefined &&
    item.weight_mt !== null &&
    !isNaN(Number(item.weight_mt)) &&
    Number(item.weight_mt) > 0
  ) {
    return {
      mt: Number(item.weight_mt),
      canConvert: true,
      originalQty: qty,
      originalUnit: rawUnit,
    };
  }
  if (
    item.converted_mt !== undefined &&
    item.converted_mt !== null &&
    !isNaN(Number(item.converted_mt)) &&
    Number(item.converted_mt) > 0
  ) {
    return {
      mt: Number(item.converted_mt),
      canConvert: true,
      originalQty: qty,
      originalUnit: rawUnit,
    };
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
    item.product_requirement || '',
    item.pName || '',
    item.raw_text || '',
    item.text || '',
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
    (combinedText.includes('round') &&
      !combinedText.includes('pipe') &&
      !combinedText.includes('tube'));
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

  // 3c. MS Flat Bar & GI Earthing Strip: Width(mm) * Thickness(mm) * 0.00785 * Length(m) * Qty / 1000
  const isFlat =
    combinedText.includes('flat bar') ||
    combinedText.includes('ms flat') ||
    combinedText.includes('earthing strip') ||
    (combinedText.includes('flat') &&
      !combinedText.includes('sheet') &&
      !combinedText.includes('plate'));
  if (isFlat) {
    const flatMatch = combinedText.match(
      /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[xX*×]\s*(\d+(?:\.\d+)?)/,
    );
    if (flatMatch) {
      const v1 = parseFloat(flatMatch[1]);
      const v2 = parseFloat(flatMatch[2]);
      const widthMm = Math.max(v1, v2);
      const thkMm = Math.min(v1, v2);
      const lenMatch = combinedText.match(
        /(\d+(?:\.\d+)?)\s*(?:m|meter|mtr)\b/,
      );
      const lenM = lenMatch ? parseFloat(lenMatch[1]) : 6;
      const galvanizeFactor =
        combinedText.includes('earthing') || combinedText.includes('gi')
          ? 1.05
          : 1.0;
      const wtKg = widthMm * thkMm * 0.00785 * lenM * galvanizeFactor * qty;
      return {
        mt: Math.round((wtKg / 1000) * 1000) / 1000,
        canConvert: true,
        originalQty: qty,
        originalUnit: rawUnit,
      };
    }
  }

  // 3d. MS Square Bar: Side(mm)^2 * 0.00785 * Length(m) * Qty / 1000
  const isSquareBar =
    combinedText.includes('square bar') ||
    (combinedText.includes('square') && combinedText.includes('bar'));
  if (isSquareBar) {
    const sqMatch = combinedText.match(/(\d+(?:\.\d+)?)\s*(?:mm)?/);
    if (sqMatch) {
      const sideMm = parseFloat(sqMatch[1]);
      const lenMatch = combinedText.match(
        /(\d+(?:\.\d+)?)\s*(?:m|meter|mtr)\b/,
      );
      const lenM = lenMatch ? parseFloat(lenMatch[1]) : 6;
      const wtKg = sideMm * sideMm * 0.00785 * lenM * qty;
      return {
        mt: Math.round((wtKg / 1000) * 1000) / 1000,
        canConvert: true,
        originalQty: qty,
        originalUnit: rawUnit,
      };
    }
  }

  // 3e. MS Angles: Weight (KG) = (A + B - t) * t * 0.00785 * Length (m) * Nos -> MT = KG / 1000
  const isAngle =
    combinedText.includes('angle') || combinedText.includes('isa');
  if (isAngle) {
    const angle3Match = combinedText.match(
      /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[xX*×]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*[xX*×]\s*(\d+(?:\.\d+)?)/,
    );
    const angle2Match = combinedText.match(
      /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[xX*×]\s*(\d+(?:\.\d+)?)/,
    );
    let a = 0;
    let b = 0;
    let t = 0;
    if (angle3Match) {
      a = parseFloat(angle3Match[1]);
      b = parseFloat(angle3Match[2]);
      t = parseFloat(angle3Match[3]);
    } else if (angle2Match) {
      const v1 = parseFloat(angle2Match[1]);
      const v2 = parseFloat(angle2Match[2]);
      a = Math.max(v1, v2);
      b = a; // Equal angle: 50x5 -> 50x50x5
      t = Math.min(v1, v2);
    }
    if (a > 0 && b > 0 && t > 0) {
      const lenMatch = combinedText.match(
        /(\d+(?:\.\d+)?)\s*(?:m|meter|mtr)\b/,
      );
      const len = lenMatch ? parseFloat(lenMatch[1]) : 6;
      const wtKg = (a + b - t) * t * 0.00785 * len * qty;
      return {
        mt: Math.round((wtKg / 1000) * 1000) / 1000,
        canConvert: true,
        originalQty: qty,
        originalUnit: rawUnit,
      };
    }
  }

  // 3f. MS Pipes & Tubes (Round Pipe, Square Pipe, Rectangular Tube):
  const isPipe =
    combinedText.includes('pipe') ||
    combinedText.includes('tube') ||
    combinedText.includes('shs') ||
    combinedText.includes('rhs');
  if (isPipe) {
    const isSquareOrRect =
      combinedText.includes('square') ||
      combinedText.includes('rect') ||
      combinedText.includes('shs') ||
      combinedText.includes('rhs');
    const lenMatch = combinedText.match(/(\d+(?:\.\d+)?)\s*(?:m|meter|mtr)\b/);
    const len = lenMatch ? parseFloat(lenMatch[1]) : 6;
    const crossSectionText = combinedText.replace(
      /[xX*×]\s*\d+(?:\.\d+)?\s*(?:m|meter|mtr)\b/g,
      '',
    );
    const dim3Match = crossSectionText.match(
      /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[xX*×]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*[xX*×]\s*(\d+(?:\.\d+)?)/,
    );
    const dim2Match = crossSectionText.match(
      /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[xX*×]\s*(\d+(?:\.\d+)?)/,
    );

    if (isSquareOrRect) {
      if (dim3Match) {
        const w = parseFloat(dim3Match[1]);
        const h = parseFloat(dim3Match[2]);
        const t = parseFloat(dim3Match[3]);
        const wtPerMeter = (w + h - 2 * t) * t * 0.0157;
        const wtKg = wtPerMeter * len * qty;
        return {
          mt: Math.round((wtKg / 1000) * 1000) / 1000,
          canConvert: true,
          originalQty: qty,
          originalUnit: rawUnit,
        };
      } else if (dim2Match) {
        const side = parseFloat(dim2Match[1]);
        const t = parseFloat(dim2Match[2]);
        const wtPerMeter = (side - t) * t * 0.0314;
        const wtKg = wtPerMeter * len * qty;
        return {
          mt: Math.round((wtKg / 1000) * 1000) / 1000,
          canConvert: true,
          originalQty: qty,
          originalUnit: rawUnit,
        };
      }
    } else {
      // Round pipe: (OD - t) * t * 0.02466 * len * qty / 1000
      if (dim2Match) {
        const od = Math.max(parseFloat(dim2Match[1]), parseFloat(dim2Match[2]));
        const t = Math.min(parseFloat(dim2Match[1]), parseFloat(dim2Match[2]));
        const wtKg = (od - t) * t * 0.02466 * len * qty;
        return {
          mt: Math.round((wtKg / 1000) * 1000) / 1000,
          canConvert: true,
          originalQty: qty,
          originalUnit: rawUnit,
        };
      }
    }
  }

  // 3g. Cable Trays (Perforated & Ladder): Girth(m) * Thk(mm) * 7.85 * Length(m) * Qty / 1000
  if (combinedText.includes('cable tray')) {
    let widthMm = 300;
    const wMatch = combinedText.match(
      /(\d+(?:\.\d+)?)\s*(?:mm\s*width|mm\s*w\b|\bwidth\s*(\d+)|w\s*(\d+))/,
    );
    if (wMatch) {
      widthMm = parseFloat(wMatch[1] || wMatch[2] || wMatch[3]);
    } else {
      const dimMatch = combinedText.match(
        /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[xX*]\s*(\d+(?:\.\d+)?)/,
      );
      if (dimMatch) {
        const v1 = parseFloat(dimMatch[1]);
        const v2 = parseFloat(dimMatch[2]);
        widthMm = Math.max(v1, v2);
      }
    }
    const collarMm = 50; // standard 50mm collar
    const girthM = (widthMm + 2 * collarMm) / 1000;
    const lenM = 2.5; // standard 2.5m section
    const thkMm = 1.6; // standard 1.6mm sheet
    const isLadder = combinedText.includes('ladder');
    const factor = isLadder ? 0.55 : 0.88;
    const wtPerPieceKg = girthM * lenM * thkMm * 7.85 * factor;
    const totalMt = Math.round(((wtPerPieceKg * qty) / 1000) * 1000) / 1000;
    return {
      mt: totalMt,
      canConvert: true,
      originalQty: qty,
      originalUnit: rawUnit,
    };
  }

  // 3h. Slotted Angle:
  if (combinedText.includes('slotted angle')) {
    const wtPerPieceKg = 3.5; // standard 40x40x2mm 2.5m piece
    return {
      mt: Math.round(((wtPerPieceKg * qty) / 1000) * 1000) / 1000,
      canConvert: true,
      originalQty: qty,
      originalUnit: rawUnit,
    };
  }

  // 3i. Solar Mounting Structure / Purlins:
  if (
    combinedText.includes('solar') ||
    combinedText.includes('purlin') ||
    combinedText.includes('mounting structure')
  ) {
    const wtPerPieceKg = 17.5; // Standard 3.2m C/Z purlin piece
    return {
      mt: Math.round(((wtPerPieceKg * qty) / 1000) * 1000) / 1000,
      canConvert: true,
      originalQty: qty,
      originalUnit: rawUnit,
    };
  }

  // 3j. Standard Sheets / Plates / Coils / CR / HR / HRPO / GP / Galvalume / Chequered:
  // Weight (KG) = Length (m) * Width (m) * Thickness (mm) * 7.85 * Nos
  let thickness: number | null = null;
  const thkMatch = combinedText.match(
    /(\d+(?:\.\d+)?)\s*(?:mm\s*thk|mm\s*thickness|\bthk\b)/,
  );
  if (thkMatch) {
    const candidate = parseFloat(thkMatch[1]);
    if (candidate <= 50) {
      thickness = candidate;
    }
  } else {
    // Check for gauge
    const gaugeMatch = combinedText.match(/(\d+)\s*(?:g|gauge)\b/);
    if (gaugeMatch) {
      const g = parseInt(gaugeMatch[1], 10);
      const GAUGE_MAP: Record<number, number> = {
        10: 3.2,
        12: 2.5,
        14: 2.0,
        16: 1.6,
        18: 1.2,
        20: 0.9,
        22: 0.8,
        24: 0.6,
      };
      if (GAUGE_MAP[g]) thickness = GAUGE_MAP[g];
    }
  }

  let widthM: number | null = null;
  let lengthM: number | null = null;

  // Check imperial feet dimensions e.g. "5ft x 20ft", "5 ft x 20 ft", "5' x 20'"
  const ftMatch = combinedText.match(
    /(\d+(?:\.\d+)?)\s*(?:ft|feet|')\s*[xX*]\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|'|"|in)?/,
  );
  if (ftMatch) {
    const f1 = parseFloat(ftMatch[1]);
    const f2 = parseFloat(ftMatch[2]);
    widthM = Math.min(f1, f2) * 0.3048;
    lengthM = Math.max(f1, f2) * 0.3048;
  }

  if (!widthM || !lengthM) {
    const dim3Match = combinedText.match(
      /(\d+(?:\.\d+)?)\s*(?:mm|m)?\s*[xX*×]\s*(\d+(?:\.\d+)?)\s*(?:mm|m)?\s*[xX*×]\s*(\d+(?:\.\d+)?)\s*(?:mm|m)?/,
    );
    if (dim3Match) {
      const n1 = parseFloat(dim3Match[1]);
      const n2 = parseFloat(dim3Match[2]);
      const n3 = parseFloat(dim3Match[3]);
      const sorted = [n1, n2, n3].sort((a, b) => a - b);
      if (!thickness && sorted[0] <= 50) thickness = sorted[0];
      const w = sorted[1];
      const l = sorted[2];
      widthM = w > 20 ? w / 1000 : w;
      lengthM = l > 20 ? l / 1000 : l;
    } else {
      const dim2Match = combinedText.match(
        /(\d+(?:\.\d+)?)\s*(?:mm|m)?\s*[xX*×]\s*(\d+(?:\.\d+)?)\s*(?:mm|m)?/,
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
  }

  // Fallback to standard sheet dimensions (1.25m x 2.5m = 1250mm x 2500mm) if thickness is known
  // and length/width are omitted for sheet/plate items
  const isSheetOrPlate =
    combinedText.includes('sheet') ||
    combinedText.includes('plate') ||
    combinedText.includes('chequered') ||
    combinedText.includes('cr ') ||
    combinedText.includes('hr ') ||
    combinedText.includes('hrpo') ||
    combinedText.includes('galvalume') ||
    combinedText.includes('gp ') ||
    normUnit === 'Sheets' ||
    normUnit === 'Plates';

  if (thickness && (!widthM || !lengthM) && isSheetOrPlate) {
    widthM = 1.25;
    lengthM = 2.5;
  }

  if (thickness && widthM && lengthM && isSheetOrPlate) {
    const isChequered =
      combinedText.includes('chequered') || combinedText.includes('checker');
    const wtPerPieceKg = isChequered
      ? lengthM * widthM * (thickness * 7.85 + 2.1)
      : lengthM * widthM * thickness * 7.85;
    const totalMt = Math.round(((wtPerPieceKg * qty) / 1000) * 1000) / 1000;
    return {
      mt: totalMt,
      canConvert: true,
      originalQty: qty,
      originalUnit: rawUnit,
    };
  }

  // If the unit is discrete (Nos, Pcs, Units, Sheets, etc.) and cannot be converted by any formula,
  // DO NOT add pieces directly to Metric Tons!
  if (
    [
      'Nos',
      'Pcs',
      'Pieces',
      'Units',
      'Bundles',
      'Sheets',
      'Plates',
      'Coils',
    ].includes(normUnit)
  ) {
    return {
      mt: null,
      canConvert: false,
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
    return {
      totalMt: 0,
      hasUnconvertible: false,
      formattedText: '0.00 MT',
      summaryText: '0 Items',
    };
  }

  const validItems = lineItems.filter((i) => {
    const q = Number(i.quantity ?? i.quantity_mt ?? i.qty ?? 0);
    return !isNaN(q) && q > 0;
  });

  if (validItems.length === 0) {
    return {
      totalMt: 0,
      hasUnconvertible: false,
      formattedText: '0.00 MT',
      summaryText: '0 Items',
    };
  }

  // 1. Group items by unit to build a clean commercial summary breakdown
  const unitTotals = new Map<string, number>();
  for (const item of validItems) {
    const rawUnit = (item.unit || 'MT').trim();
    const normUnit = normalizeUnit(rawUnit);
    const q = Number(item.quantity ?? item.quantity_mt ?? item.qty ?? 0) || 0;
    unitTotals.set(normUnit, (unitTotals.get(normUnit) || 0) + q);
  }

  const breakdownParts: string[] = [];
  for (const [u, totalQ] of unitTotals.entries()) {
    const roundedQ = Math.round(totalQ * 1000) / 1000;
    breakdownParts.push(
      `${roundedQ.toLocaleString('en-IN', { maximumFractionDigits: 3 })} ${u}`,
    );
  }
  const summaryText = breakdownParts.join(', ');
  const itemCountText = `${validItems.length} ${validItems.length === 1 ? 'item' : 'items'}`;

  // 2. Convert each line item to MT
  let totalMt = 0;
  let hasUnconvertible = false;
  const unconvertibleList: string[] = [];

  for (const item of validItems) {
    const res = convertLineItemToMt(item);
    if (res.canConvert && res.mt !== null && !isNaN(res.mt)) {
      totalMt += res.mt;
    } else {
      hasUnconvertible = true;
      const q = Number(item.quantity ?? item.qty ?? 0) || 0;
      const u = item.unit || 'Nos';
      unconvertibleList.push(`${q} ${u}`);
    }
  }

  const roundedMt = Math.round(totalMt * 1000) / 1000;
  const formattedMtStr = roundedMt.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });

  // 3. Format result with clean dual representation
  const isPureMt = unitTotals.size === 1 && unitTotals.has('MT');
  let formattedText = `${formattedMtStr} MT`;

  if (isPureMt) {
    formattedText = `${formattedMtStr} MT`;
  } else if (roundedMt > 0) {
    formattedText = `${summaryText} • Est. Total Weight: ${formattedMtStr} MT`;
  } else if (hasUnconvertible) {
    formattedText = `${summaryText} (Weight conversion unavailable)`;
  }

  return {
    totalMt: roundedMt,
    hasUnconvertible,
    unconvertedDetails:
      unconvertibleList.length > 0 ? unconvertibleList.join(', ') : undefined,
    formattedText,
    summaryText,
    itemBreakdownText: `${summaryText} (${itemCountText})`,
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

  const conv = convertLineItemToMt(item);
  let amount = 0;

  if (
    item.isManualAmount &&
    item.amount !== undefined &&
    Number(item.amount) > 0
  ) {
    amount = Number(item.amount);
  } else if (quantity > 0 && rate > 0) {
    if (conv.canConvert && conv.mt !== null && conv.mt > 0) {
      amount = Math.round(conv.mt * rate * 100) / 100;
    } else if (unit === 'KG') {
      amount = Math.round((quantity / 1000) * rate * 100) / 100;
    } else {
      amount = Math.round(quantity * rate * 100) / 100;
    }
  } else if (item.amount && Number(item.amount) > 0) {
    amount = Number(item.amount);
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
    // Mixed units or piece/count units: compute converted MT using physical formulas
    const tonnageRes = calculateTotalTonnageMt(processedItems);
    totalQuantityMt = tonnageRes.totalMt;
    totalQuantity = isUniformUnit
      ? processedItems.reduce(
          (sum, item) => sum + (Number(item.quantity) || 0),
          0,
        )
      : totalQuantityMt;
    formattedQuantity = tonnageRes.formattedText;
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
