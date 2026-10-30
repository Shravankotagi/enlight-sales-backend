/**
 * Regression: Share Quotation denied a salesperson who could already open
 * the inquiry, because preview matched a phone string.
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
const salesperson = {
  id: 'sp-1',
  email: 'akruti@enlightmetals.example',
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
          email: 'akruti@enlightmetals.example',
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
    status: 'quoted',
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

async function preview(service: InquiriesService, id: string) {
  return service.previewQuotation(
    id,
    {
      customer_name: 'Acme Steel',
      customer_email: 'buyer@acme.example',
      quotation_reference: 'QT-2026-42',
      details: { companyName: 'Acme Steel', isOrder: false },
    },
    salesperson,
    caller,
  );
}

describe('quotation preview follows employees.id', () => {
  it('prepares an inquiry stored on the caller even when the phone is blank', async () => {
    const service = serviceFor({
      inquiries: [inquiry({ employee_id: 'sp-1' })],
    });

    const previewResult = await preview(service, 'inq-1');

    expect(previewResult.subject).toBe(
      'Enlight Metals- Quotation for Acme Steel',
    );
    expect(previewResult.body).toContain('Dear ACME STEEL');
  });

  it('prepares an inquiry owned only through the customer-owner employee', async () => {
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

    const previewResult = await preview(service, 'inq-owner');

    expect(previewResult.subject).toContain('Acme Steel');
  });

  it('prepares an inquiry owned only through the deal employee id', async () => {
    const service = serviceFor({
      inquiries: [inquiry({ id: 'inq-deal', employee_id: null })],
      deals: [{ inquiry_id: 'inq-deal', employee_id: 'sp-1' }],
    });

    const previewResult = await preview(service, 'inq-deal');

    expect(previewResult.subject).toContain('Acme Steel');
  });

  it('denies a different employee id', async () => {
    const service = serviceFor({
      inquiries: [inquiry({ employee_id: 'other' })],
    });

    await expect(preview(service, 'inq-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
