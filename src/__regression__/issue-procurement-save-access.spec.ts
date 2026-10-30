/**
 * Regression: Save Prices denied a procurement person who could already see
 * the inquiry, because detail checked the raw salesperson phone.
 * Issue: <add GitHub issue link>
 */
import { ForbiddenException } from '@nestjs/common';
import { InquiriesService } from '../modules/inquiries/inquiries.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../test-utils/supabase.mock';

const personScope = {
  ids: ['person'],
  includeUnassignedPool: false,
  salespersonPhones: ['9876543210'],
  salespersonEmployeeIds: ['sp-1'],
};

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
          assigned_procurement_employee_id: 'person',
        },
      ],
      recurring_customers: [
        {
          customer_name: 'Acme Steel',
          assigned_salesperson_phone: '919876543210',
          is_active: true,
        },
      ],
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
    procurement_employee_id: null,
    created_at: '2026-10-16T04:00:00.000Z',
    ...overrides,
  };
}

describe('procurement save access uses the list salesperson', () => {
  it('allows an unassigned inquiry whose sender is a routed salesperson', async () => {
    const service = serviceFor({
      inquiries: [inquiry({ sender_phone: '919876543210' })],
    });

    const row = await service.findOne('inq-1', null, personScope);

    expect(row.id).toBe('inq-1');
  });

  it('allows an unassigned inquiry whose customer owner is a routed salesperson', async () => {
    const service = serviceFor({
      inquiries: [
        inquiry({
          id: 'inq-owner',
          customer_name: 'Acme Steel',
          sender_phone: '919111111111',
        }),
      ],
    });

    const row = await service.findOne('inq-owner', null, personScope);

    expect(row.id).toBe('inq-owner');
  });

  it('still denies an inquiry assigned to another procurement person', async () => {
    const service = serviceFor({
      inquiries: [
        inquiry({
          procurement_employee_id: 'other',
          sender_phone: '919876543210',
        }),
      ],
    });

    await expect(
      service.findOne('inq-1', null, personScope),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies an inquiry whose salesperson is not routed to this person', async () => {
    const service = serviceFor({
      inquiries: [inquiry({ sender_phone: '919111111111' })],
    });

    await expect(
      service.findOne('inq-1', null, personScope),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
