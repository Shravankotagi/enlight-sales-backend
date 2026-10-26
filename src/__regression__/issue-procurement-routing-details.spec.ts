/**
 * Regression: salesperson inquiries route to their procurement person,
 * each inquiry gets its own procurement number, and procurement detail
 * keeps the product lines.
 * Issue: <add GitHub issue link>
 */
import { InquiriesService } from '../modules/inquiries/inquiries.service';
import { EmployeesService } from '../modules/employees/employees.service';
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

describe('procurement routing and inquiry detail', () => {
  it('gives a mapped salesperson inquiry a procurement owner and a PR number', async () => {
    const db = createSupabaseMock({
      tables: {
        inquiries: [{ id: 'old', procurement_number: 'PR-10001' }],
        employees: [
          {
            id: 'sp-1',
            role: 'salesperson',
            phone: '919811111111',
            is_active: true,
            assigned_procurement_employee_id: 'proc-1',
          },
        ],
        recurring_customers: [],
      },
    });
    const created = await inquiriesService(db).createInquiry(
      {
        raw_text: 'Need HR Coil',
        customer_name: 'Alpha Metals',
        ai_extraction_json: {
          customer_name: 'Alpha Metals',
          line_items: [{ sku_text: 'HR Coil', quantity: 12, unit: 'MT' }],
        },
      },
      '919811111111',
    );

    expect(created.procurement_employee_id).toBe('proc-1');
    expect(created.procurement_number).toBe('PR-10002');
    expect(created.procurement_number).not.toContain(String(created.id));
    expect(String(created.procurement_number).startsWith('INQ-')).toBe(false);
    expect(created.pricing_status).toBe('awaiting_price');
  });

  it('clears the default awaiting price on inquiries created before the cutoff', async () => {
    const db = createSupabaseMock({
      tables: {
        inquiries: [
          {
            id: 'old',
            status: 'won',
            created_at: '2026-09-01T00:00:00.000Z',
            pricing_status: 'awaiting_price',
            inquiry_type: 'inquiry',
            source_channel: 'web_dashboard',
            raw_text: 'Old order',
          },
          {
            id: 'kept',
            status: 'review',
            created_at: '2026-09-02T00:00:00.000Z',
            pricing_status: 'price_ready',
            inquiry_type: 'inquiry',
            source_channel: 'web_dashboard',
            raw_text: 'Already priced',
          },
        ],
        deals: [],
        employees: [],
        recurring_customers: [],
      },
    });
    const rows = await inquiriesService(db).findAll({});
    expect(
      rows.find((row: any) => row.id === 'old')?.pricing_status,
    ).toBeNull();
    expect(rows.find((row: any) => row.id === 'kept')?.pricing_status).toBe(
      'price_ready',
    );
  });

  it('keeps product lines for procurement and customer identity for sales', async () => {
    const row = {
      id: 'inq-1',
      status: 'review',
      procurement_employee_id: 'proc-1',
      procurement_number: 'PR-10041',
      customer_name: 'Alpha Metals',
      customer_phone: '919000000000',
      raw_text: 'Need coil for Alpha Metals',
      delivery_location: 'Pune, Maharashtra',
      ai_extraction_json: {
        customer_name: 'Alpha Metals',
        delivery_location: 'Pune, Maharashtra',
        line_items: [
          {
            sku_text: 'HR Coil',
            original_quantity: 12,
            quantity: 1,
            original_unit: 'MT',
            unit: 'KG',
          },
        ],
      },
    };
    const db = createSupabaseMock({
      tables: {
        inquiries: [row],
        deals: [],
        employees: [],
        recurring_customers: [],
      },
    });
    const service = inquiriesService(db);

    const procurement = await service.findOne('inq-1', null, {
      ids: ['proc-1'],
      includeUnassignedPool: false,
    });
    expect(procurement.customer_name).toBeUndefined();
    expect(procurement.raw_text).toBeUndefined();
    expect(procurement.delivery_location).toBe('Pune, Maharashtra');
    expect(procurement.procurement_number).toBe('PR-10041');
    expect(procurement.ai_extraction_json.line_items[0].original_quantity).toBe(
      12,
    );
    expect(procurement.ai_extraction_json.customer_name).toBeUndefined();

    const sales = await service.findOne('inq-1', null, null);
    expect(sales.customer_name).toBe('Alpha Metals');
    expect(sales.ai_extraction_json.line_items[0].sku_text).toBe('HR Coil');
  });

  it('stamps open inquiries when a salesperson is assigned to a procurement person', async () => {
    const db = createSupabaseMock({
      tables: {
        employees: [
          {
            id: 'proc-1',
            role: 'procurement_person',
            phone: '919800000001',
            name: 'Priya',
            employee_id: 'EMP010',
            is_active: true,
          },
          {
            id: 'sp-1',
            role: 'salesperson',
            phone: '919811111111',
            name: 'Akruti',
            employee_id: 'EMP011',
            is_active: true,
          },
          {
            id: 'mgr',
            role: 'procurement_manager',
            phone: '919822222222',
            name: 'Manav',
            employee_id: 'EMP012',
            is_active: true,
          },
        ],
        inquiries: [
          {
            id: 'open-1',
            salesperson_phone: '919811111111',
            procurement_employee_id: null,
            status: 'review',
          },
          {
            id: 'owned',
            salesperson_phone: '919811111111',
            procurement_employee_id: 'other',
            status: 'review',
          },
          {
            id: 'won',
            salesperson_phone: '09811111111',
            procurement_employee_id: null,
            status: 'won',
          },
          {
            id: 'by-employee',
            salesperson_phone: null,
            employee_id: 'sp-1',
            procurement_employee_id: null,
            status: 'processed',
          },
        ],
      },
    });
    const service = new EmployeesService(asSupabaseService(db.client));
    await service.update('proc-1', {
      role: 'procurement_person',
      manager_id: 'mgr',
      assigned_salesperson_ids: ['sp-1'],
    });

    expect(
      db.store.employees.find((row) => row.id === 'sp-1')
        ?.assigned_procurement_employee_id,
    ).toBe('proc-1');
    expect(
      db.store.inquiries.find((row) => row.id === 'open-1')
        ?.procurement_employee_id,
    ).toBe('proc-1');
    expect(
      db.store.inquiries.find((row) => row.id === 'owned')
        ?.procurement_employee_id,
    ).toBe('other');
    expect(
      db.store.inquiries.find((row) => row.id === 'won')
        ?.procurement_employee_id,
    ).toBe('proc-1');
    expect(
      db.store.inquiries.find((row) => row.id === 'by-employee')
        ?.procurement_employee_id,
    ).toBe('proc-1');
  });

  it('includes unassigned inquiries for a person assigned salespeople', async () => {
    const db = createSupabaseMock({
      tables: {
        inquiries: [
          {
            id: 'won',
            status: 'won',
            procurement_employee_id: null,
            salesperson_phone: '09811111111',
            inquiry_type: 'inquiry',
            source_channel: 'web_dashboard',
            raw_text: 'Won coil',
            created_at: '2026-08-01T00:00:00.000Z',
          },
          {
            id: 'by-employee',
            status: 'processed',
            procurement_employee_id: null,
            employee_id: 'sp-1',
            inquiry_type: 'inquiry',
            source_channel: 'web_dashboard',
            raw_text: 'Processed coil',
            created_at: '2026-08-02T00:00:00.000Z',
          },
          {
            id: 'other-owner',
            status: 'review',
            procurement_employee_id: 'other',
            salesperson_phone: '919811111111',
            inquiry_type: 'inquiry',
            source_channel: 'web_dashboard',
            raw_text: 'Owned elsewhere',
            created_at: '2026-08-03T00:00:00.000Z',
          },
          {
            id: 'stranger',
            status: 'review',
            procurement_employee_id: null,
            salesperson_phone: '919999999999',
            inquiry_type: 'inquiry',
            source_channel: 'web_dashboard',
            raw_text: 'Someone else',
            created_at: '2026-08-04T00:00:00.000Z',
          },
        ],
        employees: [],
        deals: [],
        recurring_customers: [],
      },
    });
    const rows = await inquiriesService(db).findAll({
      procurementScope: {
        ids: ['proc-1'],
        includeUnassignedPool: false,
        salespersonPhones: ['9811111111'],
        salespersonEmployeeIds: ['sp-1'],
      },
    });
    expect(rows.map((row: any) => row.id).sort()).toEqual(
      ['by-employee', 'won'].sort(),
    );
  });
});
