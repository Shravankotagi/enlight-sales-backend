// Issue: <add GitHub issue link>
// Customer type Other is stored with the typed type.
import { KraService } from '../modules/kra/kra.service';
import * as visitOtp from '../modules/kra/visit-verification';

function createHarness() {
  const tables: Record<string, any[]> = {
    visit_phone_verifications: [],
    customer_visits: [],
  };
  let nextId = 1;
  const supabase = {
    from(table: string) {
      const rows = tables[table] || (tables[table] = []);
      return {
        select() {
          return {
            eq(_column: string, value: string) {
              return Promise.resolve({
                data: rows.filter((row) => row.phone === value),
                error: null,
              });
            },
            ilike() {
              throw new Error('lookup skipped');
            },
          };
        },
        insert(row: any) {
          const stored = {
            id: `${table}-${nextId++}`,
            created_at: new Date().toISOString(),
            ...row,
          };
          rows.push(stored);
          const result = { data: stored, error: null };
          return Object.assign(Promise.resolve(result), {
            select: () => ({ single: async () => result }),
          });
        },
        update(patch: any) {
          return {
            eq(_column: string, value: string) {
              const row = rows.find((item) => item.id === value);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  const service = new KraService(
    { getAdminClient: () => supabase } as any,
    { logActivity: () => undefined } as any,
  );
  return { service, tables };
}

function isoDaysFromToday(days: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function validVisit(token: string, overrides: Record<string, unknown> = {}) {
  return {
    customer_name: 'Acme',
    person_met: 'Ravi',
    designation: 'Buyer',
    contact_phone: '9822012345',
    email: 'ravi@acme.com',
    location: 'Pune',
    location_source: 'gps',
    visit_latitude: 18.52,
    visit_longitude: 73.85,
    customer_type: 'OEM',
    visit_type: 'First Visit',
    outcome: 'positive',
    customer_probability: 'Hot',
    product_details: 'HR Coil',
    monthly_consumption: '50 MT',
    preferred_make: ['TATA'],
    payment_terms: '30 Days',
    delivery_location: 'Chakan',
    next_purchase_expected: '2026-11-01',
    current_requirement: '10 MT',
    follow_up_action: 'Send quote',
    follow_up_date: isoDaysFromToday(7),
    remarks: 'Discussed rates',
    visited_at: '2026-10-15T10:00:00.000Z',
    gps_photo_url: 'data:image/jpeg;base64,abc',
    gps_latitude: 18.52,
    gps_longitude: 73.86,
    verification_token: token,
    ...overrides,
  };
}

describe('customer type Other', () => {
  beforeEach(() => {
    jest.spyOn(visitOtp, 'generateVisitOtp').mockReturnValue('123456');
    jest.spyOn(visitOtp, 'sendVisitOtpWhatsApp').mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects Other without the typed type', async () => {
    const { service, tables } = createHarness();
    await expect(
      service.createVisit(
        validVisit('token', {
          customer_type: 'Other',
          customer_type_other: ' ',
        }),
        '919822011111',
      ),
    ).rejects.toThrow('Enter the other customer type.');
    expect(tables.customer_visits).toHaveLength(0);
  });

  it('keeps the typed type on the visit row and drops it for a listed type', async () => {
    const { service, tables } = createHarness();
    await service.requestVisitOtp('9822012345');
    tables.visit_phone_verifications[0].created_at = new Date(
      Date.now() - 120000,
    ).toISOString();
    const verified = await service.verifyVisitOtp('9822012345', '123456');
    const created = await service.createVisit(
      validVisit(verified.verification_token, {
        customer_type: 'Other',
        customer_type_other: 'Contractor',
      }),
      '919822011111',
    );

    expect(created.customer_type).toBe('Other');
    expect(created.customer_type_other).toBe('Contractor');
    expect(tables.customer_visits[0].customer_type_other).toBe('Contractor');

    await service.requestVisitOtp('9822012346');
    tables.visit_phone_verifications[1].created_at = new Date(
      Date.now() - 120000,
    ).toISOString();
    const second = await service.verifyVisitOtp('9822012346', '123456');
    const listed = await service.createVisit(
      validVisit(second.verification_token, {
        contact_phone: '9822012346',
        customer_type: 'OEM',
        customer_type_other: 'Contractor',
      }),
      '919822011111',
    );
    expect(listed.customer_type).toBe('OEM');
    expect(listed.customer_type_other).toBeNull();
  });
});
