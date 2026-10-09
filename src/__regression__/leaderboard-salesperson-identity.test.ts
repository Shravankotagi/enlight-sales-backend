/**
 * Regression: Admin leaderboard showed "Unknown" for most salespersons because
 * report rows were keyed by raw phone strings that did not match the
 * employees table format.
 * Issue: <add GitHub issue link>
 *
 * Expected: every row resolves to the employee name across phone formats,
 * then falls back to employee ID, then phone, never "Unknown".
 */
import { ReportsService } from '../modules/reports/reports.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../test-utils/supabase.mock';

const emptyActivity = {
  customer_visits: [],
  complaints: [],
  kra_logs: [],
  payment_tracking: [],
  recurring_customers: [],
};

const report = async (tables: Record<string, any[]>) => {
  const db = createSupabaseMock({ tables: { ...emptyActivity, ...tables } });
  const service = new ReportsService(asSupabaseService(db.client));
  const result: any = await service.getSalespersonReport(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
  );
  return result.salespersons as any[];
};

describe('leaderboard salesperson identity', () => {
  it('resolves names when deals and employees store phones in different formats', async () => {
    const rows = await report({
      employees: [
        { name: 'Akruti', phone: '+91 98765-43210', role: 'salesperson' },
        { name: 'Rishabh', phone: '919812345678', role: 'salesperson' },
      ],
      deals: [
        {
          salesperson_phone: '9876543210',
          stage: 'won',
          inquiry_type: 'order',
        },
        {
          salesperson_phone: '+91 98123 45678',
          stage: 'won',
          inquiry_type: 'order',
        },
      ],
    });

    expect(rows.map((r) => r.name).sort()).toEqual(['Akruti', 'Rishabh']);
    expect(rows.every((r) => /^\d{10}$/.test(r.salesperson_phone))).toBe(true);
  });

  it('merges activity from mixed phone formats into a single row', async () => {
    const rows = await report({
      employees: [{ name: 'Akruti', phone: '9876543210', role: 'salesperson' }],
      deals: [
        {
          salesperson_phone: '91-98765-43210',
          stage: 'won',
          inquiry_type: 'order',
        },
        {
          salesperson_phone: '9876543210',
          stage: 'quoted',
          inquiry_type: 'inquiry',
        },
      ],
      customer_visits: [{ salesperson_phone: '+91 98765 43210' }],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Akruti',
      deals: { total: 2, won: 1 },
      visits: { total: 1 },
    });
  });

  it('falls back to employee ID, then phone, instead of "Unknown"', async () => {
    const rows = await report({
      employees: [
        {
          name: '',
          phone: '9000000001',
          employee_id: 'EMP-7',
          role: 'salesperson',
        },
      ],
      deals: [
        {
          salesperson_phone: '9000000001',
          stage: 'won',
          inquiry_type: 'order',
        },
        {
          salesperson_phone: '9000000002',
          stage: 'won',
          inquiry_type: 'order',
        },
      ],
    });

    const names = Object.fromEntries(
      rows.map((r) => [r.salesperson_phone, r.name]),
    );
    expect(names['9000000001']).toBe('EMP-7');
    expect(names['9000000002']).toBe('9000000002');
    expect(rows.some((r) => r.name === 'Unknown')).toBe(false);
  });
});
