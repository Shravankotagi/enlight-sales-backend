/**
 * Regression: a quoted inquiry whose linked deal is won stayed Price Quote
 * on the procurement list because the list omitted the deal stage.
 * Issue: <add GitHub issue link>
 */
import { InquiriesService } from '../modules/inquiries/inquiries.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../test-utils/supabase.mock';

const inquiriesService = (db: ReturnType<typeof createSupabaseMock>) =>
  new InquiriesService(
    asSupabaseService(db.client),
    {} as any,
    { logActivity: () => undefined } as any,
    {} as any,
  );

const scope = {
  ids: ['proc-1'],
  includeUnassignedPool: false,
  salespersonPhones: [] as string[],
  salespersonEmployeeIds: [] as string[],
};

function inquiry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inq-quote',
    status: 'quoted',
    procurement_employee_id: 'proc-1',
    customer_name: 'Alpha Metals',
    customer_phone: '919000000000',
    sender_phone: '919000000000',
    inquiry_type: 'inquiry',
    source_channel: 'web_dashboard',
    raw_text: 'Need coil for Alpha Metals',
    created_at: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('procurement linked deal stage', () => {
  it('stamps the newer won deal and hides the customer', async () => {
    const db = createSupabaseMock({
      tables: {
        inquiries: [inquiry()],
        employees: [],
        recurring_customers: [],
        deals: [
          {
            id: 'deal-old',
            inquiry_id: 'inq-quote',
            stage: 'quoted',
            created_at: '2026-10-01T00:00:00.000Z',
            customer_name: 'Alpha Metals',
            customer_phone: '919000000000',
          },
          {
            id: 'deal-new',
            inquiry_id: 'inq-quote',
            stage: 'won',
            created_at: '2026-10-21T00:00:00.000Z',
            customer_name: 'Alpha Metals',
            customer_phone: '919000000000',
          },
        ],
      },
    });

    const rows = await inquiriesService(db).findAll({ procurementScope: scope });
    const row = rows.find((item: any) => item.id === 'inq-quote');
    expect(row.linked_deal_stage).toBe('won');
    expect(row.display_stage).toBe('won');
    expect(row.customer_name).toBeUndefined();
    expect(row.customer_phone).toBeUndefined();
    expect(row.sender_phone).toBeUndefined();

    const one = await inquiriesService(db).findOne('inq-quote', null, scope);
    expect(one.linked_deal_stage).toBe('won');
    expect(one.display_stage).toBe('won');
    expect(one.customer_name).toBeUndefined();
  });

  it('lets a newer quoted deal beat an older won deal', async () => {
    const db = createSupabaseMock({
      tables: {
        inquiries: [inquiry({ id: 'inq-newer' })],
        employees: [],
        recurring_customers: [],
        deals: [
          {
            id: 'deal-won',
            inquiry_id: 'inq-newer',
            stage: 'won',
            created_at: '2026-10-01T00:00:00.000Z',
          },
          {
            id: 'deal-quote',
            inquiry_id: 'inq-newer',
            stage: 'quoted',
            created_at: '2026-10-21T00:00:00.000Z',
          },
        ],
      },
    });

    const rows = await inquiriesService(db).findAll({ procurementScope: scope });
    expect(rows.find((item: any) => item.id === 'inq-newer')?.linked_deal_stage).toBe(
      'quoted',
    );
    expect(rows.find((item: any) => item.id === 'inq-newer')?.display_stage).toBe(
      'quoted',
    );
  });

  it('uses one normalized status rule when no linked deal exists', async () => {
    const db = createSupabaseMock({
      tables: {
        inquiries: [
          inquiry({
            id: 'inq-po',
            status: 'confirmed',
            inquiry_type: 'Purchase_Order',
          }),
          inquiry({
            id: 'inq-confirmed',
            status: 'confirmed',
            inquiry_type: 'inquiry',
          }),
        ],
        employees: [],
        recurring_customers: [],
        deals: [],
      },
    });

    const rows = await inquiriesService(db).findAll({ procurementScope: scope });
    expect(rows.find((item: any) => item.id === 'inq-po')?.display_stage).toBe(
      'won',
    );
    expect(
      rows.find((item: any) => item.id === 'inq-confirmed')?.display_stage,
    ).toBe('quoted');
  });
});
