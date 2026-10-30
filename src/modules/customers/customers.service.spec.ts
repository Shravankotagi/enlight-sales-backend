import { BadRequestException, ConflictException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../../test-utils/supabase.mock';

const employee = { phone: '919876543210', name: 'Ada' };
const valid = {
  customer_name: 'PQR Steel',
  contact_person: 'Ravi',
  customer_phone: '9876543210',
  customer_address: 'Pune',
};

function serviceWith(tables: Record<string, any[]> = {}) {
  const db = createSupabaseMock({ tables });
  const service = new CustomersService(asSupabaseService(db.client), {} as any);
  return { db, service };
}

describe('CustomersService createCustomer', () => {
  it('rejects a missing required field', async () => {
    const { service } = serviceWith();
    await expect(
      service.createCustomer({ ...valid, customer_name: ' ' }, employee),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores a GST value that is not a GSTIN', async () => {
    const { service } = serviceWith();
    const created = await service.createCustomer(
      { ...valid, customer_gst: 'NOTGST' },
      employee,
    );
    expect(created.customer_gst).toBe('NOTGST');
  });

  it('returns 409 when an active customer already has that name', async () => {
    const { service } = serviceWith({
      recurring_customers: [
        {
          customer_name: 'pqr steel',
          is_active: true,
          assigned_salesperson_phone: '918000000000',
        },
      ],
    });
    await expect(
      service.createCustomer(valid, employee),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('inserts the customer under the logged-in phone', async () => {
    const { db, service } = serviceWith();
    const created = await service.createCustomer(
      {
        ...valid,
        customer_email: 'a@b.co',
        customer_gst: '29ABCDE1234F1Z5',
      },
      employee,
    );

    expect(created.assigned_salesperson_phone).toBe(employee.phone);
    expect(created.customer_phone).toBe('919876543210');
    expect(created.customer_gst).toBe('29ABCDE1234F1Z5');
    expect(created.notes).toBe('Email: a@b.co | [State: Karnataka (29)]');
    expect(db.store.kra_logs).toHaveLength(2);
    expect(db.store.activity_logs[0].description).toBe(
      'New customer PQR Steel added',
    );
    expect(db.store.activity_logs[0].module).toBe('Customers');
  });
});
