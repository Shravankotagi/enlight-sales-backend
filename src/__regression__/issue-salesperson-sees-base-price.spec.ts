/**
 * Regression: a salesperson who could see a Price Ready inquiry could not
 * load its base price, because line pricing matched a phone string.
 * Access follows employees.id.
 * Issue: <add GitHub issue link>
 */
import { ForbiddenException } from '@nestjs/common';
import { InquiriesService } from '../modules/inquiries/inquiries.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../test-utils/supabase.mock';

const caller = ['sp-1'];

function serviceFor(extra: Record<string, any[]> = {}) {
  const db = createSupabaseMock({
    tables: {
      inquiries: [],
      deals: [],
      employees: [
        {
          id: 'sp-1',
          name: 'Akruti',
          phone: '919876543210',
          role: 'salesperson',
          is_active: true,
        },
      ],
      recurring_customers: [],
      ...extra,
    },
  });
  return new InquiriesService(
    asSupabaseService(db.client),
    {} as any,
    { logActivity: () => undefined } as any,
    {} as any,
  );
}

function inquiry(overrides: Record<string, any>) {
  return {
    id: 'inq-1',
    status: 'review',
    inquiry_type: 'inquiry',
    source_channel: 'web_dashboard',
    salesperson_phone: null,
    sender_phone: null,
    employee_id: null,
    customer_name: 'Acme Steel',
    created_at: '2026-10-16T04:00:00.000Z',
    ...overrides,
  };
}

describe('salesperson line pricing follows employees.id', () => {
  it('opens an inquiry stored on the caller even when the phone is blank', async () => {
    const service = serviceFor({
      inquiries: [inquiry({ employee_id: 'sp-1' })],
    });

    const row = await service.findOne('inq-1', null, null, caller);

    expect(row.id).toBe('inq-1');
  });

  it('opens an inquiry owned only through the customer-owner employee', async () => {
    const service = serviceFor({
      inquiries: [inquiry({ id: 'inq-owner', employee_id: null })],
      recurring_customers: [
        {
          customer_name: 'Acme Steel',
          assigned_salesperson_phone: '919876543210',
          is_active: true,
        },
      ],
    });

    const row = await service.findOne('inq-owner', null, null, caller);

    expect(row.id).toBe('inq-owner');
  });

  it('opens an inquiry owned only through the deal employee id', async () => {
    const service = serviceFor({
      inquiries: [inquiry({ id: 'inq-deal', employee_id: null })],
      deals: [{ inquiry_id: 'inq-deal', employee_id: 'sp-1' }],
    });

    const row = await service.findOne('inq-deal', null, null, caller);

    expect(row.id).toBe('inq-deal');
  });

  it('denies a different employee id', async () => {
    const service = serviceFor({
      inquiries: [inquiry({ employee_id: 'other' })],
    });

    await expect(service.findOne('inq-1', null, null, caller)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('denies a matching phone that belongs to no employee', async () => {
    const service = serviceFor({
      inquiries: [
        inquiry({
          employee_id: null,
          salesperson_phone: '919876543210',
        }),
      ],
      employees: [],
    });

    await expect(service.findOne('inq-1', null, null, caller)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('stores the salesperson employees.id when an inquiry is created', async () => {
    const service = serviceFor();
    const created = await service.createInquiry(
      {
        raw_text: 'Need HR Coil',
        customer_name: 'Alpha Metals',
        ai_extraction_json: {
          customer_name: 'Alpha Metals',
          line_items: [{ sku_text: 'HR Coil', quantity: 12, unit: 'MT' }],
        },
      },
      '919876543210',
    );

    expect(created.employee_id).toBe('sp-1');
  });
});
