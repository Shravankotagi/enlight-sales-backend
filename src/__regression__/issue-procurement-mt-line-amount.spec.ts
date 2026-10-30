/**
 * Regression: sales pricing stored piece quantity × per-MT rate for Nos lines.
 * Issue: <add GitHub issue link>
 */
import { InquiryPricingService } from '../modules/inquiries/inquiry-pricing.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../test-utils/supabase.mock';

const sheet = {
  id: 'inq-sheet',
  status: 'review',
  inquiry_type: 'inquiry',
  source_channel: 'web_dashboard',
  delivery_location: 'Ahmedabad, Gujarat',
  created_at: '2026-10-16T04:00:00.000Z',
  ai_extraction_json: {
    line_items: [
      {
        sku_text: 'CR Sheet',
        dimensions: '1250 x 2500 x 1',
        quantity: 300,
        unit: 'Nos',
        weight_mt: 7.359,
      },
    ],
  },
};

describe('procurement line amount uses weight in MT', () => {
  it('stores taxable amount as 7.359 MT × ₹200, not 300 × ₹200', async () => {
    const db = createSupabaseMock({
      tables: {
        inquiries: [{ ...sheet }],
        inquiry_line_pricing: [
          {
            inquiry_id: 'inq-sheet',
            line_key: '0:CR Sheet',
            sku_text: 'CR Sheet',
            quantity: 300,
            unit: 'Nos',
            procurement_base_price_per_mt: 200,
            line_status: 'priced',
          },
        ],
      },
    });
    const service = new InquiryPricingService(asSupabaseService(db.client), {
      logActivity: () => undefined,
    } as any);

    const saved = await service.saveSales(
      sheet,
      {
        lines: [
          {
            line_key: '0:CR Sheet',
            base_price_per_mt: 200,
            transport_per_mt: 0,
            loading_per_mt: 0,
            credit_per_mt: 0,
            margin_per_mt: 0,
          },
        ],
      },
      { id: 'sales-1', phone: '919800000099' },
    );

    expect(saved.lines[0].rate_per_mt).toBe(200);
    expect(saved.lines[0].taxable_amount).toBe(1471.8);
    expect(saved.lines[0].igst_amount).toBe(264.92);
    expect(saved.lines[0].final_amount).toBe(1736.72);
    expect(saved.lines[0].quantity).toBe(300);
    expect(saved.lines[0].unit).toBe('Nos');
  });
});
