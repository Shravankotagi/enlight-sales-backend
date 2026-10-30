/**
 * Regression: an Unavailable inquiry only previewed a generic decline, and
 * send ignored the customer address, the edited body, and CC.
 * Issue: <add GitHub issue link>
 */
import { BadRequestException } from '@nestjs/common';
import { InquiryPricingService } from '../modules/inquiries/inquiry-pricing.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../test-utils/supabase.mock';

const inquiry = {
  id: 'inq-decline',
  customer_name: 'Om Fabricators',
  sender_name: 'Om Fabricators',
  ai_extraction_json: { customer_name: 'Om Fabricators' },
};

const lines = [
  {
    line_status: 'cannot_price',
    sku_text: 'HR PLATE',
    dimensions: '05X1500X6300MM',
    quantity: 40,
    unit: 'MT',
  },
];

const employee = {
  id: 'sales-1',
  email: 'sales@enlightmetals.com',
  phone: '919811111111',
};

function serviceFor() {
  const db = createSupabaseMock({
    tables: { inquiries: [{ ...inquiry }], inquiry_line_pricing: [] },
  });
  const service = new InquiryPricingService(asSupabaseService(db.client), {
    logActivity: () => undefined,
  } as any);
  return { service, db };
}

describe('send decline email', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.RESEND_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  it('names the unavailable material and keeps the fixed CC addresses', async () => {
    const { service, db } = serviceFor();
    const preview = await service.declinePreview(inquiry, lines, employee);
    expect(preview.subject).toBe(
      'Enlight Metals - Quotation Update for Om Fabricators',
    );
    expect(preview.body).toContain('Om Fabricators');
    expect(preview.body).toContain('HR PLATE');
    expect(preview.body).toMatch(/not available/i);
    expect(preview.customer_email).toBe('');
    expect(preview.cc[0]).toBe('sales@enlightmetals.com');
    expect(preview.cc).toEqual(
      expect.arrayContaining([
        'dj@enlightmetals.com',
        'vedant@enlightmetals.com',
        'sales@enlightmetals.com',
      ]),
    );

    await expect(
      service.sendDecline(inquiry, lines, employee, { cc: preview.cc }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const fetchMock = jest.fn(async () => ({ ok: true })) as jest.Mock;
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.RESEND_API_KEY = 'test-key';
    const sent = await service.sendDecline(inquiry, lines, employee, {
      customer_email: 'buyer@omfabricators.com',
      email_subject: 'Update on your material inquiry',
      email_body: preview.body,
      cc: ['accounts@omfabricators.com'],
    });
    expect(sent.sent).toBe(true);
    const request = fetchMock.mock.calls[0][1] as { body: string };
    const payload = JSON.parse(request.body);
    expect(payload.to).toEqual(['buyer@omfabricators.com']);
    expect(payload.cc).toEqual(
      expect.arrayContaining([
        'dj@enlightmetals.com',
        'vedant@enlightmetals.com',
        'accounts@omfabricators.com',
      ]),
    );
    expect(payload.cc).not.toContain('buyer@omfabricators.com');
    expect(payload.cc).not.toContain('sales@enlightmetals.com');
    expect(payload.text).toContain('HR PLATE');
    expect(payload.html).toContain('cid:enlight-logo');
    expect(payload.html).toContain('HR PLATE');
    expect(payload.attachments?.[0]?.content_id).toBe('enlight-logo');
    const stored = db.store.inquiries.find((row) => row.id === 'inq-decline');
    expect(stored.ai_extraction_json.customer_email).toBe(
      'buyer@omfabricators.com',
    );
    expect(stored.decline_sent_at).toBeTruthy();
  });

  it('loads the salesperson email from the employee row and leaves it off when removed', async () => {
    const db = createSupabaseMock({
      tables: {
        inquiries: [{ ...inquiry }],
        inquiry_line_pricing: [],
        employees: [
          {
            id: 'sales-2',
            phone: '919811111111',
            email: 'sales@enlightmetals.com',
          },
        ],
      },
    });
    const service = new InquiryPricingService(asSupabaseService(db.client), {
      logActivity: () => undefined,
    } as any);
    const session = { id: 'sales-2', phone: '919811111111' };
    const preview = await service.declinePreview(inquiry, lines, session);
    expect(preview.subject).toBe(
      'Enlight Metals - Quotation Update for Om Fabricators',
    );
    expect(preview.cc[0]).toBe('sales@enlightmetals.com');
    expect(preview.employee_email).toBe('sales@enlightmetals.com');
    expect(preview.cc).toEqual(
      expect.arrayContaining([
        'dj@enlightmetals.com',
        'vedant@enlightmetals.com',
      ]),
    );

    const fetchMock = jest.fn(async () => ({ ok: true })) as jest.Mock;
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.RESEND_API_KEY = 'test-key';
    await service.sendDecline(inquiry, lines, session, {
      customer_email: 'buyer@omfabricators.com',
      email_subject: '',
      email_body: preview.body,
      cc: ['dj@enlightmetals.com', 'vedant@enlightmetals.com'],
    });
    const request = fetchMock.mock.calls[0][1] as { body: string };
    const payload = JSON.parse(request.body);
    expect(payload.subject).toBe(
      'Enlight Metals - Quotation Update for Om Fabricators',
    );
    expect(payload.cc).toEqual(
      expect.arrayContaining([
        'dj@enlightmetals.com',
        'vedant@enlightmetals.com',
      ]),
    );
    expect(payload.cc).not.toContain('sales@enlightmetals.com');
    expect(db.store.inquiries[0].ai_extraction_json.customer_email).toBe(
      'buyer@omfabricators.com',
    );
  });
});
