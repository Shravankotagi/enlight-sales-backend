/**
 * Regression: procurement price saves failed when credit_per_mt was missing,
 * and a failed pricing-status update was ignored.
 * Issue: <add GitHub issue link>
 */
import { InquiryPricingService } from '../modules/inquiries/inquiry-pricing.service';

const inquiry = {
  id: 'inq-1',
  status: 'review',
  delivery_location: 'Ahmedabad',
  ai_extraction_json: {
    line_items: [{ sku_text: 'HR Coil', quantity: 2, unit: 'MT' }],
  },
};

const submitted = {
  lines: [
    {
      line_key: '0:HR Coil',
      sku_text: 'HR Coil',
      quantity: 2,
      unit: 'MT',
      base_price_per_mt: 200,
    },
  ],
};

function serviceFor(client: any) {
  return new InquiryPricingService(
    { getAdminClient: () => client } as any,
    { logActivity: () => undefined } as any,
  );
}

describe('procurement base price save', () => {
  it('retries the line upsert without credit_per_mt when that column is missing', async () => {
    const calls: Array<{ op: string; payload: any }> = [];
    const client = {
      from: () => {
        const api: any = {
          select: () => api,
          eq: () => api,
          upsert: (payload: any) => {
            calls.push({ op: 'upsert', payload });
            const rows = [].concat(payload);
            const missingCredit = rows.some((row) =>
              Object.prototype.hasOwnProperty.call(row, 'credit_per_mt'),
            );
            return Promise.resolve({
              data: null,
              error: missingCredit
                ? { message: "Could not find the 'credit_per_mt' column" }
                : null,
            });
          },
          update: (payload: any) => ({
            eq: () => {
              calls.push({ op: 'update', payload });
              return Promise.resolve({ data: null, error: null });
            },
          }),
          then: (resolve: any, reject: any) =>
            Promise.resolve({ data: [], error: null }).then(resolve, reject),
        };
        return api;
      },
    };

    const saved = await serviceFor(client).saveProcurement(inquiry, submitted, {
      id: 'buyer',
      phone: '919800000002',
      name: 'Rishi',
    });

    const upserts = calls.filter((call) => call.op === 'upsert');
    expect(saved.pricing_status).toBe('price_ready');
    expect(upserts).toHaveLength(2);
    expect(upserts[0].payload[0]).toHaveProperty('credit_per_mt');
    expect(upserts[1].payload[0].credit_per_mt).toBeUndefined();
    expect(upserts[1].payload[0].procurement_base_price_per_mt).toBe(200);
  });

  it('fails the request when the pricing status update does not persist', async () => {
    const client = {
      from: () => {
        const api: any = {
          select: () => api,
          eq: () => api,
          upsert: () => Promise.resolve({ data: null, error: null }),
          update: () => ({
            eq: () =>
              Promise.resolve({
                data: null,
                error: { message: 'pricing_status column missing' },
              }),
          }),
          then: (resolve: any, reject: any) =>
            Promise.resolve({ data: [], error: null }).then(resolve, reject),
        };
        return api;
      },
    };

    await expect(
      serviceFor(client).saveProcurement(inquiry, submitted, { id: 'buyer' }),
    ).rejects.toThrow(/pricing_status/);
  });
});
