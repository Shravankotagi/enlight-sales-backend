/**
 * Regression: procurement could change a price-ready inquiry and send a
 * status update after the inquiry left Awaiting Price.
 * Issue: <add GitHub issue link>
 */
import { ForbiddenException } from '@nestjs/common';
import { InquiriesController } from '../modules/inquiries/inquiries.controller';
import { InquiriesService } from '../modules/inquiries/inquiries.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../test-utils/supabase.mock';

const scope = { ids: ['person'], includeUnassignedPool: false };

function inquiry(pricingStatus: string, createdAt = '2026-10-20T00:00:00.000Z') {
  return {
    id: 'inq-1',
    procurement_number: 'PR-30011',
    procurement_employee_id: 'person',
    status: 'review',
    pricing_status: pricingStatus,
    created_at: createdAt,
    inquiry_type: 'inquiry',
    source_channel: 'dashboard',
  };
}

function controllerFor(row: any) {
  const saveProcurement = jest.fn(async () => ({ pricing_status: 'price_ready' }));
  const inquiries = new InquiriesController(
    { findOne: async () => row } as any,
    {
      getAccessibleProcurementIds: async () => scope,
      getAccessibleSalespersonIds: async () => null,
    } as any,
    { saveProcurement } as any,
  );
  return { inquiries, saveProcurement };
}

describe('procurement edits stay on awaiting price', () => {
  it.each(['price_ready', 'unavailable', null])(
    'refuses a procurement base-price save when pricing status is %s',
    async (pricingStatus) => {
      const { inquiries, saveProcurement } = controllerFor(
        inquiry(pricingStatus as string),
      );
      await expect(
        inquiries.saveProcurementPricing(
          { role: 'procurement_person', id: 'person' },
          'inq-1',
          { lines: [] },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(saveProcurement).not.toHaveBeenCalled();
    },
  );

  it('still lets procurement save an awaiting price inquiry and lets an admin save a later one', async () => {
    const waiting = controllerFor(inquiry('awaiting_price'));
    await waiting.inquiries.saveProcurementPricing(
      { role: 'procurement_manager', id: 'person' },
      'inq-1',
      { lines: [{ line_key: 'a' }] },
    );
    expect(waiting.saveProcurement).toHaveBeenCalled();

    const ready = controllerFor(inquiry('price_ready'));
    await ready.inquiries.saveProcurementPricing(
      { role: 'admin', id: 'admin-1' },
      'inq-1',
      { lines: [] },
    );
    expect(ready.saveProcurement).toHaveBeenCalled();
  });

  it('refuses a procurement status update unless the inquiry is awaiting a price', async () => {
    const rows = [
      inquiry('price_ready'),
      {
        ...inquiry('unavailable'),
        id: 'inq-unavailable',
      },
      {
        ...inquiry('awaiting_price', '2026-10-01T00:00:00.000Z'),
        id: 'inq-old',
      },
    ];
    const db = createSupabaseMock({
      tables: {
        inquiries: rows,
        deals: [],
        employees: [],
        recurring_customers: [],
      },
    });
    const service = new InquiriesService(
      asSupabaseService(db.client),
      {} as any,
      { logActivity: () => undefined } as any,
      {} as any,
    );

    await expect(
      service.updateStatus('inq-1', 'review', {}, null, scope),
    ).rejects.toThrow(/awaiting price/i);
    await expect(
      service.updateStatus('inq-unavailable', 'review', {}, null, scope),
    ).rejects.toThrow(/awaiting price/i);
    await expect(
      service.updateStatus('inq-old', 'review', {}, null, scope),
    ).rejects.toThrow(/awaiting price/i);
    expect(db.calls.some((call) => call.op === 'update')).toBe(false);
  });
});
