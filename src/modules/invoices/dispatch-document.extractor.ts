import { Injectable, Logger } from '@nestjs/common';
import { SlipReading } from './dispatch-template';

const PROMPT = `Read this steel dispatch document and return only JSON with these keys:
net_kg, vehicle_number, bill_number, bill_date, eway_bill, vendor_rate, lr_number, transporter, pieces.
Use null when a value is not on the page. vendor_rate is the purchase rate per MT. net_kg is the net weight in kilograms. bill_date is YYYY-MM-DD.`;

@Injectable()
export class DispatchDocumentExtractor {
  private readonly logger = new Logger(DispatchDocumentExtractor.name);

  async extract(file: {
    content_base64?: string;
    mime?: string;
  }): Promise<SlipReading> {
    const apiKey =
      process.env.GEMINI_API_KEY || process.env.GEMINI_PAID_API_KEY;
    if (!apiKey || !file.content_base64) return {};
    const clean = file.content_base64.replace(/^data:[^;]+;base64,/, '');
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PROMPT },
                {
                  inline_data: {
                    mime_type: file.mime || 'application/pdf',
                    data: clean,
                  },
                },
              ],
            },
          ],
        }),
      },
    );
    if (!response.ok) {
      this.logger.warn('Dispatch document reading failed');
      return {};
    }
    const json = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      return {
        netKg: numberOrNull(parsed.net_kg),
        vehicleNumber: stringOrNull(parsed.vehicle_number),
        billNumber: stringOrNull(parsed.bill_number),
        billDate: stringOrNull(parsed.bill_date),
        ewayBill: stringOrNull(parsed.eway_bill),
        vendorRate: numberOrNull(parsed.vendor_rate),
        lrNumber: stringOrNull(parsed.lr_number),
        transporter: stringOrNull(parsed.transporter),
        pieces: numberOrNull(parsed.pieces),
      };
    } catch {
      return {};
    }
  }
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text && text !== 'null' ? text : null;
}
