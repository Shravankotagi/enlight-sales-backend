import {
  CustomersService,
  cleanLegalSuffixes,
  cleanPhone,
  cleanGst,
  calculateStringSimilarity,
} from './customers.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../../test-utils/supabase.mock';
import { ConflictException } from '@nestjs/common';

describe('Customers cross-verification & duplicate prevention', () => {
  it('normalizes legal suffixes, phones, and GSTIN correctly', () => {
    expect(cleanLegalSuffixes('PQR Steel Industries Pvt. Ltd.')).toBe(
      'pqr steel industries',
    );
    expect(cleanLegalSuffixes('Vardhman Steels Limited')).toBe(
      'vardhman steels',
    );
    expect(cleanLegalSuffixes('Alpha Metals LLP')).toBe('alpha metals');
    expect(cleanPhone('+91 98765-43210')).toBe('9876543210');
    expect(cleanPhone('09876543210')).toBe('9876543210');
    expect(cleanGst(' 29abcde1234f1z5 ')).toBe('29ABCDE1234F1Z5');
  });

  it('calculates string similarity and detects >80% similar variations', () => {
    const sim = calculateStringSimilarity('Meru industry', 'Meru Industries');
    expect(sim).toBeGreaterThan(0.8);

    const diff = calculateStringSimilarity('Tata Steel', 'ABC Polymers');
    expect(diff).toBeLessThan(0.5);
  });

  it('detects high similarity (>80%) when customer name is similar to another salesperson customer', async () => {
    const db = createSupabaseMock({
      tables: {
        recurring_customers: [
          {
            id: 'c-meru',
            customer_name: 'Meru Industries',
            customer_phone: '912027119308',
            customer_gst: null,
            assigned_salesperson_phone: '919822000004',
            is_active: true,
          },
        ],
        employees: [
          {
            id: 'emp-yash',
            name: 'Yash Dalmia',
            phone: '919822000004',
            is_active: true,
          },
        ],
      },
    });

    const service = new CustomersService(
      asSupabaseService(db.client),
      {} as any,
    );

    // Caller is a different salesperson attempting to add "Meru industry"
    const check = await service.findCustomerConflict(
      'Meru industry',
      '9826293745',
      undefined,
      '9826293745',
    );

    expect(check.conflict).toBe(true);
    expect(check.conflictType).toBe('similar');
    expect(check.reason).toContain('Meru Industries');
    expect(check.reason).toContain('Yash Dalmia');
    expect(check.reason).toContain('Kindly contact your admin');

    // Attempting to create should throw ConflictException with conflictType similar
    await expect(
      service.createCustomer(
        {
          customer_name: 'Meru industry',
          contact_person: 'Shravan',
          customer_phone: '9826293745',
          customer_address: 'Pune',
        },
        { phone: '919826293745', role: 'salesperson' },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('detects company-wide conflict when customer is assigned to another salesperson', async () => {
    const db = createSupabaseMock({
      tables: {
        recurring_customers: [
          {
            id: 'c-1',
            customer_name: 'PQR Steel Industries Pvt Ltd',
            customer_phone: '919876543210',
            customer_gst: '29ABCDE1234F1Z5',
            assigned_salesperson_phone: '919111111111',
            is_active: true,
          },
        ],
        employees: [
          {
            id: 'emp-1',
            name: 'Ravi Kumar',
            phone: '919111111111',
            is_active: true,
          },
        ],
      },
    });

    const service = new CustomersService(
      asSupabaseService(db.client),
      {} as any,
    );

    // Caller is a different salesperson: 9822222222
    const checkByName = await service.findCustomerConflict(
      'PQR Steel Industries',
      '9999999999',
      undefined,
      '9822222222',
    );
    expect(checkByName.conflict).toBe(true);
    expect(checkByName.isOwnCustomer).toBe(false);
    expect(checkByName.reason).toContain('Ravi Kumar');

    // Trying to create it should throw ConflictException
    await expect(
      service.createCustomer(
        {
          customer_name: 'PQR Steel Industries',
          contact_person: 'Amit',
          customer_phone: '9999999999',
          customer_address: 'Chakan, Pune',
        },
        { phone: '919822222222', role: 'salesperson' },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('detects conflict by phone number even if name differs slightly', async () => {
    const db = createSupabaseMock({
      tables: {
        recurring_customers: [
          {
            id: 'c-2',
            customer_name: 'Beta Steels',
            customer_phone: '919876543210',
            customer_gst: null,
            assigned_salesperson_phone: '919111111111',
            is_active: true,
          },
        ],
        employees: [
          {
            id: 'emp-1',
            name: 'Ravi Kumar',
            phone: '919111111111',
            is_active: true,
          },
        ],
      },
    });

    const service = new CustomersService(
      asSupabaseService(db.client),
      {} as any,
    );

    const checkByPhone = await service.findCustomerConflict(
      'Different Name LLC',
      '9876543210',
      undefined,
      '9822222222',
    );
    expect(checkByPhone.conflict).toBe(true);
    expect(checkByPhone.reason).toContain('Beta Steels');
  });

  it('allows claiming an unassigned customer from the pool', async () => {
    const db = createSupabaseMock({
      tables: {
        recurring_customers: [
          {
            id: 'c-unassigned',
            customer_name: 'Orphan Steels',
            customer_phone: '919876500000',
            customer_gst: null,
            assigned_salesperson_phone: 'unassigned',
            is_active: true,
          },
        ],
        employees: [],
      },
    });

    const service = new CustomersService(
      asSupabaseService(db.client),
      {} as any,
    );

    const created = await service.createCustomer(
      {
        customer_name: 'Orphan Steels Pvt Ltd',
        contact_person: 'Suresh',
        customer_phone: '9876500000',
        customer_address: 'Bhosari, Pune',
      },
      { phone: '919833333333', role: 'salesperson' },
    );

    expect(created.id).toBe('c-unassigned');
    expect(created.assigned_salesperson_phone).toBe('919833333333');
  });

  it('creates a brand new customer when no conflict exists', async () => {
    const db = createSupabaseMock({
      tables: {
        recurring_customers: [],
        employees: [],
      },
    });

    const service = new CustomersService(
      asSupabaseService(db.client),
      {} as any,
    );

    const created = await service.createCustomer(
      {
        customer_name: 'Unique Steel Works',
        contact_person: 'Mahesh',
        customer_phone: '9876512345',
        customer_address: 'Hadapsar, Pune',
        customer_email: 'mahesh@uniquesteel.com',
        customer_gst: '27ABCDE1234F1Z5',
      },
      { phone: '919844444444', role: 'salesperson' },
    );

    expect(created.customer_name).toBe('Unique Steel Works');
    expect(created.assigned_salesperson_phone).toBe('919844444444');
    expect(created.notes).toContain('Email: mahesh@uniquesteel.com');
  });
});
