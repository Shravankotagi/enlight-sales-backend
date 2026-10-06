import { BadRequestException } from '@nestjs/common';
import { InquiriesService } from './inquiries.service';

describe('InquiriesService quotation email', () => {
  const createService = (employeeLookup: any = { data: null }) => {
    const supabase = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          or: jest.fn(() => ({
            limit: jest.fn(() => ({
              maybeSingle: jest.fn().mockResolvedValue(employeeLookup),
            })),
          })),
        })),
      })),
    };
    const service = new InquiriesService(
      { getAdminClient: () => supabase } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, supabase };
  };

  it('builds a stable preview body and removes the customer from CC', () => {
    const { service } = createService();
    const content = (service as any).buildQuotationEmailContent(
      { customer_name: 'Acme', customer_email: 'customer@example.com' },
      {
        customer_email: 'customer@example.com',
        customer_name: 'Acme',
        quotation_reference: 'QT-2026-42',
        details: { isOrder: false },
      },
    );

    expect(content.referenceNumber).toBe('QT-2026-42');
    expect(content.subject).toContain('QT-2026-42');
    expect(content.text).toContain('Dear Acme');
    expect(
      (service as any).buildQuotationCc(
        'sender@example.com',
        'DJ@enlightmetals.com',
      ),
    ).toEqual(['sender@example.com', 'vedant@enlightmetals.com']);
  });

  it('resolves the authenticated employee email from employees', async () => {
    const { service } = createService({
      data: { email: 'employee@example.com' },
    });
    await expect(
      (service as any).resolveQuotationSenderEmail({
        employee_id: 'EMP-1',
      }),
    ).resolves.toBe('employee@example.com');
  });

  it('blocks quotation sending when employee email is not configured', async () => {
    const { service } = createService();
    await expect(
      (service as any).resolveQuotationSenderEmail({
        employee_id: 'EMP-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
