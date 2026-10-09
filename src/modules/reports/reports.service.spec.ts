import { ReportsService, normalizeReportPhone } from './reports.service';

describe('ReportsService salesperson identity and scoring', () => {
  it('normalizes phone formats consistently', () => {
    expect(normalizeReportPhone('+91 98765-43210')).toBe('9876543210');
    expect(normalizeReportPhone('9876543210')).toBe('9876543210');
  });

  it('resolves employee names and aggregates mixed phone formats for the score', async () => {
    const rows: Record<string, any[]> = {
      deals: [
        {
          salesperson_phone: '91-98765-43210',
          customer_name: 'Acme Metals',
          stage: 'won',
          total_amount: 100000,
          inquiry_type: 'inquiry',
        },
      ],
      customer_visits: [{ salesperson_phone: '+91 98765 43210' }],
      complaints: [],
      kra_logs: [],
      payment_tracking: [
        {
          salesperson_phone: '9876543210',
          status: 'collected',
          invoice_amount: 1000,
        },
      ],
      recurring_customers: [],
      employees: [
        {
          name: 'Akruti',
          phone: '+91 98765-43210',
          employee_id: 'EMP-001',
          role: 'salesperson',
        },
      ],
    };

    const service = new ReportsService({
      getAdminClient: () => ({
        from: (table: string) => {
          const query = {
            select: () => query,
            neq: () => query,
            eq: () => query,
            gte: () => query,
            lte: () => query,
            then: (resolve: (value: { data: any[]; error: null }) => unknown) =>
              Promise.resolve({ data: rows[table] || [], error: null }).then(
                resolve,
              ),
          };
          return query;
        },
      }),
    } as any) as ReportsService;

    const result = (await service.getSalespersonReport(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    )) as { salespersons: any[] };
    const salesperson = result.salespersons[0];

    expect(salesperson).toMatchObject({
      salesperson_phone: '9876543210',
      name: 'Akruti',
      employee_id: 'EMP-001',
      deals: { total: 1, won: 1 },
      visits: { total: 1 },
      payments: { collected: 1 },
      kra_score: 10,
    });
  });

  it('falls back to the employee ID when the employee name is unavailable', async () => {
    const rows: Record<string, any[]> = {
      deals: [
        {
          salesperson_phone: '9876543210',
          stage: 'won',
          inquiry_type: 'inquiry',
        },
      ],
      customer_visits: [],
      complaints: [],
      kra_logs: [],
      payment_tracking: [],
      recurring_customers: [],
      employees: [
        {
          name: '',
          phone: '9876543210',
          employee_id: 'EMP-002',
          role: 'salesperson',
        },
      ],
    };

    const service = new ReportsService({
      getAdminClient: () => ({
        from: (table: string) => {
          const query = {
            select: () => query,
            neq: () => query,
            eq: () => query,
            gte: () => query,
            lte: () => query,
            then: (resolve: (value: { data: any[]; error: null }) => unknown) =>
              Promise.resolve({ data: rows[table] || [], error: null }).then(
                resolve,
              ),
          };
          return query;
        },
      }),
    } as any) as ReportsService;

    const result = (await service.getSalespersonReport(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    )) as { salespersons: any[] };

    expect(result.salespersons[0].name).toBe('EMP-002');
  });
});
