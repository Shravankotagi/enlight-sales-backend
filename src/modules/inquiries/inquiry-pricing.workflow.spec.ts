import { ForbiddenException } from '@nestjs/common';
import { InquiryPricingService } from './inquiry-pricing.service';
import { InquiriesService } from './inquiries.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../../test-utils/supabase.mock';

const inquiry = {
  id: 'inq-1',
  status: 'review',
  inquiry_type: 'inquiry',
  source_channel: 'web_dashboard',
  customer_name: 'Alpha Metals',
  customer_phone: '919900000001',
  sender_name: 'Alpha Metals',
  sender_phone: '919900000001',
  raw_text: 'Need coil for Alpha Metals',
  delivery_location: 'Pune, Maharashtra',
  created_at: '2026-10-01T00:00:00.000Z',
  ai_extraction_json: {
    customer_name: 'Alpha Metals',
    customer_phone: '919900000001',
    line_items: [
      { sku_text: 'HR Coil', quantity: 2, unit: 'MT' },
      { sku_text: 'GI Sheet', quantity: 500, unit: 'KG' },
    ],
  },
};

function pricingService(store?: Record<string, any[]>) {
  const db = createSupabaseMock({
    tables: {
      inquiries: [{ ...inquiry }],
      inquiry_line_pricing: [],
      ...store,
    },
  });
  const service = new InquiryPricingService(asSupabaseService(db.client), {
    logActivity: () => undefined,
  } as any);
  return { service, db };
}

describe('procurement pricing workflow', () => {
  it('strips customer identity from a procurement list and keeps it for sales', async () => {
    const db = createSupabaseMock({
      tables: {
        inquiries: [{ ...inquiry, procurement_employee_id: 'buyer' }],
        deals: [],
        employees: [],
        recurring_customers: [],
      },
    });
    const inquiries = new InquiriesService(
      asSupabaseService(db.client),
      {} as any,
      { logActivity: () => undefined } as any,
      {} as any,
    );

    const hidden = await inquiries.findAll({
      procurementScope: { ids: ['buyer'], includeUnassignedPool: false },
    });
    expect(hidden).toHaveLength(1);
    expect(hidden[0].customer_name).toBeUndefined();
    expect(hidden[0].raw_text).toBeUndefined();
    expect(hidden[0].ai_extraction_json.customer_name).toBeUndefined();
    expect(hidden[0].ai_extraction_json.line_items).toHaveLength(2);

    const visible = await inquiries.findAll({});
    expect(visible[0].customer_name).toBe('Alpha Metals');
    expect(visible[0].raw_text).toContain('Alpha Metals');
  });

  it('marks a partial save Price Ready and an all-blank save Unavailable', async () => {
    const { service } = pricingService();
    const partial = await service.saveProcurement(
      inquiry,
      {
        lines: [
          {
            line_key: '0:HR Coil',
            sku_text: 'HR Coil',
            quantity: 2,
            unit: 'MT',
            base_price_per_mt: 61000,
          },
          {
            line_key: '1:GI Sheet',
            sku_text: 'GI Sheet',
            quantity: 500,
            unit: 'KG',
            base_price_per_mt: null,
          },
        ],
      },
      { id: 'buyer', phone: '9100000002' },
    );
    expect(partial.pricing_status).toBe('price_ready');
    expect(partial.lines.map((line) => line.line_status)).toEqual([
      'priced',
      'cannot_price',
    ]);

    const { service: blankService } = pricingService();
    const unavailable = await blankService.saveProcurement(
      inquiry,
      {
        lines: [
          { line_key: '0:HR Coil', base_price_per_mt: null },
          { line_key: '1:GI Sheet', base_price_per_mt: '' },
        ],
      },
      { id: 'buyer' },
    );
    expect(unavailable.pricing_status).toBe('unavailable');
  });

  it('lets sales override the working base and keeps procurement’s original price', async () => {
    const { service, db } = pricingService({
      inquiry_line_pricing: [
        {
          inquiry_id: 'inq-1',
          line_key: '0:HR Coil',
          sku_text: 'HR Coil',
          quantity: 2,
          unit: 'MT',
          procurement_base_price_per_mt: 61000,
          line_status: 'priced',
        },
        {
          inquiry_id: 'inq-1',
          line_key: '1:GI Sheet',
          sku_text: 'GI Sheet',
          quantity: 500,
          unit: 'KG',
          line_status: 'cannot_price',
        },
      ],
    });

    const saved = await service.saveSales(
      inquiry,
      {
        lines: [
          {
            line_key: '0:HR Coil',
            base_price_per_mt: 62000,
            transport_per_mt: 1000,
            loading_per_mt: 500,
            credit_per_mt: 200,
            margin_per_mt: 1500,
          },
          {
            line_key: '1:GI Sheet',
            base_price_per_mt: 1000,
            transport_per_mt: 100,
            loading_per_mt: 100,
            margin_per_mt: 100,
          },
        ],
      },
      { id: 'sales-1', phone: '9100000003' },
    );

    const available = saved.lines.find((line) => line.line_key === '0:HR Coil');
    const blocked = saved.lines.find((line) => line.line_key === '1:GI Sheet');
    expect(saved.pricing_status).toBe('sales_priced');
    expect(db.store.inquiries[0].status).toBe('quoted');
    expect(db.store.inquiries[0].pricing_status).toBe('sales_priced');
    expect(available.procurement_base_price_per_mt).toBe(61000);
    expect(available.sales_base_price_per_mt).toBe(62000);
    expect(available.rate_per_mt).toBe(65200);
    expect(available.credit_per_mt).toBe(200);
    expect(available.cgst_amount).toBeGreaterThan(0);
    expect(available.igst_amount).toBe(0);
    expect(blocked.line_status).toBe('cannot_price');
    expect(blocked.rate_per_mt).toBeUndefined();
  });

  it('moves a New Inquiry deal to Price Quote and leaves Negotiation where it is', async () => {
    const { service, db } = pricingService({
      inquiry_line_pricing: [
        {
          inquiry_id: 'inq-1',
          line_key: '0:HR Coil',
          sku_text: 'HR Coil',
          quantity: 2,
          unit: 'MT',
          procurement_base_price_per_mt: 61000,
          line_status: 'priced',
        },
      ],
      deals: [
        { id: 'deal-new', inquiry_id: 'inq-1', stage: 'new_inquiry' },
        { id: 'deal-talk', inquiry_id: 'inq-1', stage: 'negotiation' },
      ],
    });

    await service.saveSales(
      inquiry,
      {
        lines: [
          {
            line_key: '0:HR Coil',
            base_price_per_mt: 62000,
            transport_per_mt: 1000,
            loading_per_mt: 500,
            credit_per_mt: 0,
            margin_per_mt: 1500,
          },
        ],
      },
      { id: 'sales-1', phone: '9100000003' },
    );

    expect(db.store.deals.find((deal) => deal.id === 'deal-new').stage).toBe(
      'quoted',
    );
    expect(db.store.deals.find((deal) => deal.id === 'deal-talk').stage).toBe(
      'negotiation',
    );
  });

  it('keeps a won inquiry stage when the sales price is saved', async () => {
    const won = { ...inquiry, status: 'won' };
    const { service, db } = pricingService();
    db.store.inquiries[0].status = 'won';
    const saved = await service.saveSales(
      won,
      {
        lines: [
          {
            line_key: '0:HR Coil',
            base_price_per_mt: 62000,
            transport_per_mt: 1000,
            loading_per_mt: 500,
            credit_per_mt: 0,
            margin_per_mt: 1500,
          },
        ],
      },
      { id: 'sales-1', phone: '9100000003' },
    );
    expect(saved.pricing_status).toBe('sales_priced');
    expect(db.store.inquiries[0].pricing_status).toBe('sales_priced');
    expect(db.store.inquiries[0].status).toBe('won');
  });

  it('allows a decline only when every line is unavailable', async () => {
    const { service } = pricingService();
    await expect(
      service.declinePreview(inquiry, [
        { line_status: 'priced' },
        { line_status: 'cannot_price' },
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const preview = await service.declinePreview(inquiry, [
      { line_status: 'cannot_price' },
      { line_status: 'cannot_price' },
    ]);
    expect(preview.subject).toBe(
      'Enlight Metals - Quotation Update for Alpha Metals',
    );
    expect(preview.body).toContain('Alpha Metals');
    expect(preview.body).toMatch(/unable to offer/i);
  });
});
