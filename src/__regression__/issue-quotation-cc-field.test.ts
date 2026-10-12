import { InquiriesService } from '../modules/inquiries/inquiries.service';

describe('quotation CC field regression', () => {
  const createService = () => {
    const supabase = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          or: jest.fn(() => ({
            limit: jest.fn(() => ({
              maybeSingle: jest.fn().mockResolvedValue({ data: null }),
            })),
          })),
        })),
      })),
    };
    return new InquiriesService(
      { getAdminClient: () => supabase } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  };

  it('keeps the user-selected CC list, normalizes it, and excludes the customer', () => {
    const service = createService();

    expect(
      (service as any).buildQuotationCc(
        'sender@example.com',
        'customer@example.com',
        ['Team@Example.com', 'team@example.com', 'CUSTOMER@example.com'],
      ),
    ).toEqual(['team@example.com']);
  });

  it('rejects invalid CC addresses before sending', () => {
    const service = createService();

    expect(() =>
      (service as any).buildQuotationCc(
        'sender@example.com',
        'customer@example.com',
        ['not-an-email'],
      ),
    ).toThrow('CC recipients must contain valid email addresses.');
  });
});
