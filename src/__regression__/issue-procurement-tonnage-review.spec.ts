/**
 * Regression: a Price Ready tonnage change did not tell the assigned
 * procurement person, and the inquiry stayed closed for a new base price.
 * Issue: <add GitHub issue link>
 */
import { InquiryPricingService } from '../modules/inquiries/inquiry-pricing.service';
import { preserveHistoricalPricingStatus } from '../modules/inquiries/inquiry-pricing.util';
import { InquiriesService } from '../modules/inquiries/inquiries.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../test-utils/supabase.mock';

const person = 'person-a';

function readyInquiry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inq-1',
    procurement_number: 'PR-10041',
    procurement_employee_id: person,
    status: 'review',
    pricing_status: 'price_ready',
    salesperson_phone: '919811111111',
    customer_name: 'Secret Mills',
    sender_phone: '919900000001',
    raw_text: 'Need coil for Secret Mills',
    inquiry_type: 'inquiry',
    source_channel: 'web_dashboard',
    created_at: '2026-10-20T04:00:00.000Z',
    ai_extraction_json: {
      customer_name: 'Secret Mills',
      line_items: [{ sku_text: 'HR Coil', quantity: 12, unit: 'MT', rate: 0 }],
    },
    ...overrides,
  };
}

function serviceFor(
  row: Record<string, unknown>,
  logActivity = jest.fn(),
  deals: Record<string, unknown>[] = [],
) {
  const db = createSupabaseMock({
    tables: {
      inquiries: [row],
      inquiry_line_pricing: [],
      deals,
      employees: [
        {
          id: person,
          name: 'Rishi Mehta',
          phone: '919800000001',
          role: 'procurement_person',
        },
        {
          id: 'sales-1',
          name: 'Akruti',
          phone: '919811111111',
          role: 'salesperson',
        },
      ],
      recurring_customers: [],
    },
  });
  const inquiries = new InquiriesService(
    asSupabaseService(db.client),
    {} as any,
    { logActivity } as any,
    {} as any,
  );
  return { db, inquiries, logActivity };
}

function lines(quantity: number, unit = 'MT', rate = 0) {
  return {
    companyName: 'Secret Mills',
    lineItems: [{ sku_text: 'HR Coil', quantity, unit, rate }],
    line_items: [{ sku_text: 'HR Coil', quantity, unit, rate }],
  };
}

describe('procurement tonnage review', () => {
  it('reopens a Price Ready inquiry when the weight changes and stores the diff', async () => {
    const { db, inquiries, logActivity } = serviceFor(readyInquiry());
    await inquiries.updateStatus(
      'inq-1',
      'confirmed',
      lines(18),
      null,
      null,
      null,
    );

    const row = db.store.inquiries[0];
    expect(row.pricing_status).toBe('awaiting_price');
    expect(row.tonnage_review_open).toBe(true);
    expect(row.tonnage_review.previous_total_mt).toBe(12);
    expect(row.tonnage_review.next_total_mt).toBe(18);
    expect(row.tonnage_review.lines).toEqual([
      { sku_text: 'HR Coil', from_mt: 12, to_mt: 18 },
    ]);
    const reviewLog = logActivity.mock.calls
      .map((call) => call[0])
      .find((entry) => entry.action_type === 'procurement_tonnage_review');
    expect(reviewLog.description).toBe(
      'Tonnage changed on PR-10041 from 12 MT to 18 MT',
    );
    expect(reviewLog.salesperson_phone).toBeUndefined();
    expect(reviewLog.customer_name).toBeUndefined();
  });

  it('ignores a kilogram change that is the same weight in MT and a rate-only edit', async () => {
    const kilograms = serviceFor(
      readyInquiry({
        ai_extraction_json: {
          line_items: [{ sku_text: 'HR Coil', quantity: 1, unit: 'MT' }],
        },
      }),
    );
    await kilograms.inquiries.updateStatus(
      'inq-1',
      'confirmed',
      lines(1000, 'KG'),
      null,
      null,
      null,
    );
    expect(kilograms.db.store.inquiries[0].pricing_status).toBe('price_ready');
    expect(kilograms.db.store.inquiries[0].tonnage_review_open).not.toBe(true);

    const rateOnly = serviceFor(readyInquiry());
    await rateOnly.inquiries.updateStatus(
      'inq-1',
      'confirmed',
      lines(12, 'MT', 64000),
      null,
      null,
      null,
    );
    expect(rateOnly.db.store.inquiries[0].pricing_status).toBe('price_ready');
    expect(rateOnly.db.store.inquiries[0].tonnage_review_open).not.toBe(true);
  });

  it('keeps the original weight when the tonnage changes again before procurement saves', async () => {
    const { db, inquiries } = serviceFor(readyInquiry());
    await inquiries.updateStatus(
      'inq-1',
      'confirmed',
      lines(18),
      null,
      null,
      null,
    );
    await inquiries.updateStatus(
      'inq-1',
      'confirmed',
      lines(20),
      null,
      null,
      null,
    );

    const review = db.store.inquiries[0].tonnage_review;
    expect(db.store.inquiries[0].pricing_status).toBe('awaiting_price');
    expect(review.previous_total_mt).toBe(12);
    expect(review.next_total_mt).toBe(20);
    expect(review.lines[0]).toEqual({
      sku_text: 'HR Coil',
      from_mt: 12,
      to_mt: 20,
    });
  });

  it('clears the review when procurement saves a base price', async () => {
    const { db, inquiries } = serviceFor(readyInquiry());
    await inquiries.updateStatus(
      'inq-1',
      'confirmed',
      lines(18),
      null,
      null,
      null,
    );
    const pricing = new InquiryPricingService(asSupabaseService(db.client), {
      logActivity: () => undefined,
    } as any);
    const saved = await pricing.saveProcurement(
      db.store.inquiries[0],
      {
        lines: [
          {
            line_key: '0:HR Coil',
            sku_text: 'HR Coil',
            quantity: 18,
            unit: 'MT',
            base_price_per_mt: 50000,
          },
        ],
      },
      { id: person, name: 'Rishi Mehta' },
    );

    expect(saved.pricing_status).toBe('price_ready');
    expect(db.store.inquiries[0].tonnage_review_open).toBe(false);
    expect(db.store.inquiries[0].tonnage_review).toBeNull();
  });

  it('shows the review only to the procurement person who can see that inquiry', async () => {
    const { db, inquiries } = serviceFor(readyInquiry());
    await inquiries.updateStatus(
      'inq-1',
      'confirmed',
      lines(18),
      null,
      null,
      null,
    );
    db.store.inquiries.push(
      readyInquiry({
        id: 'inq-other',
        procurement_number: 'PR-10099',
        procurement_employee_id: 'person-b',
        tonnage_review_open: true,
        tonnage_review: {
          changed_at: '2026-10-21T04:00:00.000Z',
          previous_total_mt: 4,
          next_total_mt: 9,
          lines: [{ sku_text: 'GI Sheet', from_mt: 4, to_mt: 9 }],
        },
      }),
    );

    const own = await inquiries.listTonnageReviews({
      ids: [person],
      includeUnassignedPool: false,
    });
    expect(own).toEqual([
      expect.objectContaining({
        id: 'inq-1',
        procurement_number: 'PR-10041',
        salesperson_name: 'Akruti',
        previous_total_mt: 12,
        next_total_mt: 18,
      }),
    ]);
    expect(own[0]).not.toHaveProperty('customer_name');
    expect(own[0]).not.toHaveProperty('raw_text');
    expect(own[0]).not.toHaveProperty('sender_phone');

    const other = await inquiries.listTonnageReviews({
      ids: ['person-b'],
      includeUnassignedPool: false,
    });
    expect(other.map((row) => row.id)).toEqual(['inq-other']);
  });

  it('reopens a manual kilogram weight without moving the deal to Price Quote', async () => {
    const { db, inquiries } = serviceFor(
      readyInquiry({
        ai_extraction_json: {
          line_items: [{ sku_text: 'HR Coil', quantity: 5000, unit: 'KG' }],
        },
      }),
      jest.fn(),
      [{ id: 'deal-1', inquiry_id: 'inq-1', stage: 'negotiation' }],
    );
    const edited = {
      companyName: 'Secret Mills',
      lineItems: [
        {
          sku_text: 'HR Coil',
          quantity: 5000,
          unit: 'KG',
          rate: 0,
          is_manual_mt: true,
          converted_mt: 8,
        },
      ],
      line_items: [
        {
          sku_text: 'HR Coil',
          quantity: 5000,
          unit: 'KG',
          rate: 0,
          is_manual_mt: true,
          converted_mt: 8,
        },
      ],
    };
    await inquiries.updateStatus(
      'inq-1',
      'confirmed',
      edited,
      null,
      null,
      null,
    );

    const row = db.store.inquiries[0];
    expect(row.status).toBe('review');
    expect(row.pricing_status).toBe('awaiting_price');
    expect(row.tonnage_review.previous_total_mt).toBe(5);
    expect(row.tonnage_review.next_total_mt).toBe(8);
    expect(db.store.deals[0].stage).toBe('negotiation');
  });

  it('keeps awaiting price visible on an old inquiry while the review is open', async () => {
    const { inquiries } = serviceFor(
      readyInquiry({
        created_at: '2026-10-01T00:00:00.000Z',
        pricing_status: 'awaiting_price',
        tonnage_review_open: true,
        tonnage_review: {
          changed_at: '2026-10-21T04:30:00.000Z',
          previous_total_mt: 5,
          next_total_mt: 8,
          lines: [{ sku_text: 'HR Coil', from_mt: 5, to_mt: 8 }],
          baseline: [{ sku_text: 'HR Coil', mt: 5 }],
        },
      }),
    );
    const found = await inquiries.findOne('inq-1');
    expect(found.pricing_status).toBe('awaiting_price');
    expect(
      preserveHistoricalPricingStatus({
        pricing_status: 'awaiting_price',
        created_at: '2026-10-01T00:00:00.000Z',
        tonnage_review_open: false,
      }).pricing_status,
    ).toBeNull();
  });
});
