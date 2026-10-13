import { ReportsService } from './reports.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../../test-utils/supabase.mock';

const SP_A = '9200000001';
const SP_B = '9200000002';

const tables = () => ({
  employees: [
    { name: 'Asha', phone: SP_A, employee_id: 'EMP-A', role: 'salesperson' },
    { name: 'Bhavin', phone: SP_B, employee_id: 'EMP-B', role: 'salesperson' },
  ],
  deals: [
    {
      salesperson_phone: SP_A,
      stage: 'won',
      inquiry_type: 'order',
      total_amount: 1000,
      created_at: '2026-10-05T10:00:00.000Z',
    },
    {
      salesperson_phone: SP_A,
      stage: 'won',
      inquiry_type: 'order',
      total_amount: 2000,
      created_at: '2026-09-20T10:00:00.000Z',
    },
    {
      salesperson_phone: SP_B,
      stage: 'quoted',
      inquiry_type: 'inquiry',
      created_at: '2026-10-06T10:00:00.000Z',
    },
  ],
  customer_visits: [
    { salesperson_phone: SP_A, visited_at: '2026-10-07T10:00:00.000Z' },
    { salesperson_phone: SP_A, visited_at: '2026-08-07T10:00:00.000Z' },
  ],
  complaints: [],
  kra_logs: [],
  payment_tracking: [],
  recurring_customers: [],
});

const createService = () => {
  const db = createSupabaseMock({ tables: tables() });
  return { db, service: new ReportsService(asSupabaseService(db.client)) };
};

const byPhone = (result: any, phone: string) =>
  result.salespersons.find((s: any) => s.salesperson_phone === phone);

describe('ReportsService.getSalespersonReport date ranges', () => {
  it('applies an inclusive from/to range to every activity table', async () => {
    const { db, service } = createService();

    const result: any = await service.getSalespersonReport(
      undefined,
      undefined,
      '2026-10-05',
      '2026-10-11',
    );

    expect(byPhone(result, SP_A).deals.total).toBe(1);
    expect(byPhone(result, SP_A).visits.total).toBe(1);
    expect(byPhone(result, SP_B).deals.total).toBe(1);
    expect(db.calls.map((c) => c.table)).toEqual(
      expect.arrayContaining([
        'deals',
        'customer_visits',
        'complaints',
        'kra_logs',
        'payment_tracking',
      ]),
    );
  });

  it('treats a date-only "to" as the end of that day', async () => {
    const { service } = createService();

    const result: any = await service.getSalespersonReport(
      undefined,
      undefined,
      '2026-10-07',
      '2026-10-07',
    );

    expect(byPhone(result, SP_A).visits.total).toBe(1);
  });

  it('uses the whole calendar month when only month/year are given', async () => {
    const { service } = createService();

    const result: any = await service.getSalespersonReport(8, 2026);

    expect(byPhone(result, SP_A).deals.total).toBe(1);
    expect(byPhone(result, SP_A).deals.won).toBe(1);
  });

  it('returns everything for all-time', async () => {
    const { service } = createService();

    const result: any = await service.getSalespersonReport(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );

    expect(byPhone(result, SP_A).deals.total).toBe(2);
    expect(byPhone(result, SP_A).visits.total).toBe(2);
  });

  it('scopes the report strictly to the allowed phones', async () => {
    const { service } = createService();

    const result: any = await service.getSalespersonReport(
      undefined,
      undefined,
      undefined,
      undefined,
      [SP_B],
      true,
    );

    expect(result.salespersons.map((s: any) => s.salesperson_phone)).toEqual([
      SP_B,
    ]);
  });
});
