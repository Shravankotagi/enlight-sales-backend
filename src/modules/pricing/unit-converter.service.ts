import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  LineItemInput,
  convertLineItemToMt as deterministicConvert,
  normalizeUnit,
} from './pricing.engine';

export interface ConvertedItemWeight {
  index: number;
  sku_text?: string;
  original_qty: number;
  original_unit: string;
  unit_weight_kg: number;
  weight_mt: number;
  reasoning?: string;
  is_verified: boolean;
}

export interface BatchConversionResult {
  items: ConvertedItemWeight[];
  total_tonnage_mt: number;
  source: 'gemini' | 'deterministic';
}

@Injectable()
export class UnitConverterService {
  private readonly logger = new Logger(UnitConverterService.name);

  private readonly candidateModels = [
    'gemini-3.5-flash',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-2.5-flash',
  ];

  /**
   * Batch convert all line items in an inquiry or order to Metric Tons (MT)
   * using Gemini 3.8 Flash, with strict physical sanity bounds & deterministic fallback.
   */
  async convertLineItems(
    items: LineItemInput[],
  ): Promise<BatchConversionResult> {
    if (!Array.isArray(items) || items.length === 0) {
      return { items: [], total_tonnage_mt: 0, source: 'deterministic' };
    }

    // 1. Check if all items can be resolved deterministically using standard physical steel formulas
    // (covers all plates, sheets, angles, channels, beams, pipes, tubes, cable trays, slotted angles, purlins, TMT, bars)
    // OR if the batch is large (> 15 items), calculate deterministically with zero latency (< 1ms) and 100% precision.
    const unconvertibleItems = items.filter((it) => {
      const u = normalizeUnit(it.unit);
      if (u === 'MT' || u === 'KG') return false;
      const res = deterministicConvert(it);
      return !res.canConvert;
    });

    if (unconvertibleItems.length === 0 || items.length > 15) {
      return this.convertDeterministically(items);
    }

    // 2. Attempt AI Batch Conversion only for small batches with non-standard items
    try {
      const aiResult = await this.callGeminiBatchConversion(items);
      if (
        aiResult &&
        aiResult.items &&
        aiResult.items.length === items.length
      ) {
        // Sanity-check every item
        const verifiedItems = items.map((item, idx) => {
          const aiItem = aiResult.items[idx];
          return this.sanitizeItemWeight(item, aiItem, idx);
        });

        const totalTonnage =
          Math.round(
            verifiedItems.reduce((acc, i) => acc + (i.weight_mt || 0), 0) *
              1000,
          ) / 1000;

        return {
          items: verifiedItems,
          total_tonnage_mt: totalTonnage,
          source: 'gemini',
        };
      }
    } catch (err: any) {
      this.logger.warn(
        `Gemini batch unit conversion failed: ${err.message}. Using deterministic fallback.`,
      );
    }

    // 3. Fallback to deterministic calculation
    return this.convertDeterministically(items);
  }

  private async callGeminiBatchConversion(
    items: LineItemInput[],
  ): Promise<{ items: any[]; total_tonnage_mt?: number } | null> {
    const apiKeys = [
      process.env.GEMINI_PAID_API_KEY,
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_1,
      process.env.GEMINI_API_KEY_2,
    ].filter(Boolean) as string[];

    if (apiKeys.length === 0) {
      throw new Error('No GEMINI_API_KEY configured');
    }

    const prompt = `You are an expert steel metallurgist and weight calculator for Enlight Metals Private Limited.
Calculate the Metric Ton (MT) weight of each line item.
Steel Density: 7,850 kg/m³.

Standard Steel Formulas:
1. Flat Sheet/Plate: Length(m) * Width(m) * Thickness(mm) * 7.85 * Qty / 1000 = MT
2. Chequered Sheet: Length(m) * Width(m) * (Thickness(mm) * 7.85 + 2.1) * Qty / 1000 = MT
3. TMT / Round Bar: (Dia_mm^2 / 162) * Length(m) * Qty / 1000 = MT (Default 12m for TMT, 6m for round bar)
4. MS Angle: (Leg1 + Leg2 - Thk) * Thk * 0.00785 * Length(m) * Qty / 1000 = MT (Default 6m)
5. MS Round Pipe: (OD_mm - Thk_mm) * Thk_mm * 0.02466 * Length(m) * Qty / 1000 = MT (Default 6m)
6. MS Square/Rect Tube: 2 * (W + H - 2*Thk) * Thk * 0.00785 * Length(m) * Qty / 1000 = MT (Default 6m)
7. Perforated Cable Tray: Girth(m) * Thk(mm) * 7.85 * Length(m) * 0.88 * Qty / 1000 = MT (Default length 2.5m, thk 1.6mm, collar height ~50mm; piece weight ~5 to 18 kg/pc, NEVER thousands of kg!)
8. Ladder Cable Tray: Side runners + rungs (~8 to 25 kg/pc for 2.5m)
9. Slotted Angle: (Leg1 + Leg2 - Thk) * Thk * 0.00785 * Length(m) * 0.85 * Qty / 1000 = MT
10. GI Earthing Strip: Width(mm) * Thk(mm) * 0.00785 * Length(m) * 1.05 * Qty / 1000 = MT

CRITICAL RULES:
- If unit is already MT, weight_mt = quantity.
- If unit is KG, weight_mt = quantity / 1000.
- If dimensions/diameter/thickness are omitted by customer, use Indian industry standard defaults:
  * TMT Bar: 12mm dia, 12m length (~10.67 kg/piece)
  * Steel Plate: 10mm thickness, 1.25m x 2.5m (~245.3 kg/piece)
  * Steel Sheet: 1.6mm thickness, 1.25m x 2.5m (~39.25 kg/piece)
  * Round Bar: 16mm dia, 6m length (~9.47 kg/piece)
  * MS Angle: 50x50x5mm, 6m length (~22.37 kg/piece)
  * MS Pipe: 50mm OD x 2.5mm thk, 6m length (~17.55 kg/piece)
- Do NOT mistake Width (e.g. 300mm) for Thickness! Cable tray sheet thickness is typically 1.2mm - 2.0mm.
- Return ONLY a JSON object with this exact structure (no markdown, no backticks):
{
  "items": [
    {
      "index": 0,
      "sku_text": "...",
      "original_qty": 500,
      "original_unit": "Nos",
      "unit_weight_kg": 11.0,
      "weight_mt": 5.5,
      "reasoning": "..."
    }
  ],
  "total_tonnage_mt": 5.5
}

Line Items to calculate:
${JSON.stringify(
  items.map((it, idx) => ({
    index: idx,
    sku_text: it.sku_text || it.product_name || '',
    dimensions: it.dimensions || it.specification || '',
    quantity: Number(it.quantity || it.qty || 0),
    unit: it.unit || 'MT',
  })),
  null,
  2,
)}`;

    let lastError: any = null;
    for (const key of apiKeys) {
      for (const model of this.candidateModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
          const response = await axios.post(
            url,
            { contents: [{ parts: [{ text: prompt }] }] },
            { timeout: 18000 },
          );

          let text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            text = text
              .replace(/```json/gi, '')
              .replace(/```/g, '')
              .trim();
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed.items)) {
              return parsed;
            }
          }
        } catch (err: any) {
          lastError = err;
          this.logger.debug(
            `Unit conversion attempt with ${model} failed: ${err?.response?.data?.error?.message || err.message}`,
          );
          if (
            err?.code === 'ECONNABORTED' ||
            /timeout/i.test(String(err?.message || ''))
          ) {
            // Stop retry cascade on timeout to avoid blocking downstream response
            break;
          }
        }
      }
    }

    throw lastError || new Error('All candidate Gemini models failed');
  }

  private sanitizeItemWeight(
    item: LineItemInput,
    aiItem: any,
    idx: number,
  ): ConvertedItemWeight {
    const rawUnit = item.unit || 'MT';
    const normUnit = normalizeUnit(rawUnit);
    const qty = Number(item.quantity ?? item.qty ?? 0) || 0;

    // 1. Direct unit override (zero chance of hallucination)
    if (normUnit === 'MT') {
      return {
        index: idx,
        sku_text: item.sku_text || item.product_name,
        original_qty: qty,
        original_unit: rawUnit,
        unit_weight_kg: 1000,
        weight_mt: qty,
        reasoning: 'Direct MT',
        is_verified: true,
      };
    }
    if (normUnit === 'KG') {
      return {
        index: idx,
        sku_text: item.sku_text || item.product_name,
        original_qty: qty,
        original_unit: rawUnit,
        unit_weight_kg: 1,
        weight_mt: qty / 1000,
        reasoning: 'Direct KG',
        is_verified: true,
      };
    }

    // 2. Physical reality check for discrete units (Nos, Pcs, Sheets, etc.)
    const aiPieceKg = Number(aiItem?.unit_weight_kg);
    const maxBoundKg = this.getMaxPieceWeightBound(
      item.sku_text || item.product_name,
    );
    const minBoundKg = 0.05; // 50 grams

    if (
      aiPieceKg &&
      !isNaN(aiPieceKg) &&
      aiPieceKg >= minBoundKg &&
      aiPieceKg <= maxBoundKg
    ) {
      const verifiedMt = Math.round(((aiPieceKg * qty) / 1000) * 1000) / 1000;
      return {
        index: idx,
        sku_text: item.sku_text || item.product_name,
        original_qty: qty,
        original_unit: rawUnit,
        unit_weight_kg: Math.round(aiPieceKg * 100) / 100,
        weight_mt: verifiedMt,
        reasoning: aiItem?.reasoning || 'AI calculated',
        is_verified: true,
      };
    }

    // 3. Fallback to deterministic formula for this item
    const det = deterministicConvert(item);
    const detMt = det.canConvert && det.mt !== null ? det.mt : 0;
    const detPieceKg = qty > 0 ? (detMt * 1000) / qty : 0;

    return {
      index: idx,
      sku_text: item.sku_text || item.product_name,
      original_qty: qty,
      original_unit: rawUnit,
      unit_weight_kg: Math.round(detPieceKg * 100) / 100,
      weight_mt: detMt,
      reasoning: 'Deterministic fallback formula',
      is_verified: det.canConvert,
    };
  }

  private getMaxPieceWeightBound(skuText?: string): number {
    const text = (skuText || '').toLowerCase();
    if (text.includes('cable tray')) return 40; // max 40 kg per 2.5m piece
    if (text.includes('slotted angle')) return 15;
    if (text.includes('purlin') || text.includes('solar')) return 50;
    if (text.includes('pipe') || text.includes('tube')) return 300; // max 300 kg for a 6m pipe
    if (text.includes('tmt') || text.includes('rebar')) return 150; // max 150 kg for a 12m bar
    if (text.includes('sheet')) return 800; // max 800 kg for large sheet
    if (text.includes('plate')) return 5000; // max 5 MT for massive plate
    return 2000; // safe default upper bound
  }

  private convertDeterministically(
    items: LineItemInput[],
  ): BatchConversionResult {
    let totalMt = 0;
    const convertedItems = items.map((item, idx) => {
      const rawUnit = item.unit || 'KG';
      const qty = Number(item.quantity ?? item.qty ?? 0) || 0;
      const res = deterministicConvert(item);
      const mt = res.canConvert && res.mt !== null ? res.mt : 0;
      totalMt += mt;
      const pieceKg = qty > 0 ? (mt * 1000) / qty : 0;

      return {
        index: idx,
        sku_text: item.sku_text || item.product_name,
        original_qty: qty,
        original_unit: rawUnit,
        unit_weight_kg: Math.round(pieceKg * 100) / 100,
        weight_mt: mt,
        reasoning: 'Deterministic calculation',
        is_verified: res.canConvert,
      };
    });

    return {
      items: convertedItems,
      total_tonnage_mt: Math.round(totalMt * 1000) / 1000,
      source: 'deterministic',
    };
  }
}
