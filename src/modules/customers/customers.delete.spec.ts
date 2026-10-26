import { BadRequestException } from '@nestjs/common';
import { CustomersService, customerRecordsMatch } from './customers.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../../test-utils/supabase.mock';

describe('customer delete', () => {
  it('matches the same company and ignores a different one', () => {
    expect(
      customerRecordsMatch(
        'ABC Fabricators',
        '919876543210',
        'ABC Fabricators Pvt Ltd',
        null,
      ),
    ).toBe(true);
    expect(
      customerRecordsMatch(
        'ABC',
        '919876543210',
        'ABC Fabricators',
        '910000000000',
      ),
    ).toBe(false);
  });

  it('deletes the customer and related rows, and leaves other customers', async () => {
    const db = createSupabaseMock({
      tables: {
        recurring_customers: [
          {
            id: 'c1',
            customer_name: 'ABC Fabricators',
            customer_phone: '919876543210',
          },
        ],
        deals: [
          {
            id: 'd1',
            customer_name: 'ABC Fabricators Pvt Ltd',
            customer_phone: '9876543210',
            inquiry_id: 'inq1',
          },
          {
            id: 'd2',
            customer_name: 'Other Mills',
            customer_phone: '919000000000',
            inquiry_id: 'inq2',
          },
        ],
        deal_items: [
          { id: 'item1', deal_id: 'd1' },
          { id: 'item2', deal_id: 'd2' },
        ],
        inquiries: [
          {
            id: 'inq1',
            sender_name: 'ABC Fabricators',
            sender_phone: '9876543210',
          },
          {
            id: 'inq2',
            sender_name: 'Other Mills',
            sender_phone: '9000000000',
          },
        ],
        inquiry_items: [
          { id: 'ii1', inquiry_id: 'inq1' },
          { id: 'ii2', inquiry_id: 'inq2' },
        ],
        customer_visits: [
          {
            id: 'v1',
            customer_name: 'ABC Fabricators',
            contact_no: '9876543210',
          },
          { id: 'v2', customer_name: 'Other Mills', contact_no: '9000000000' },
        ],
        complaints: [
          { id: 'comp1', customer_name: 'ABC Fabricators' },
          { id: 'comp2', customer_name: 'Other Mills' },
        ],
        complaint_attachments: [{ id: 'att1', complaint_id: 'comp1' }],
        payment_tracking: [],
        followup_tasks: [],
        kra_logs: [{ id: 'k1', customer_name: 'ABC Fabricators' }],
        activity_logs: [],
      },
    });
    const service = new CustomersService(
      asSupabaseService(db.client),
      {} as any,
    );

    await service.deleteCustomer('c1');

    expect(db.store.recurring_customers).toEqual([]);
    expect(db.store.deals.map((row) => row.id)).toEqual(['d2']);
    expect(db.store.deal_items.map((row) => row.id)).toEqual(['item2']);
    expect(db.store.inquiries.map((row) => row.id)).toEqual(['inq2']);
    expect(db.store.inquiry_items.map((row) => row.id)).toEqual(['ii2']);
    expect(db.store.customer_visits.map((row) => row.id)).toEqual(['v2']);
    expect(db.store.complaints.map((row) => row.id)).toEqual(['comp2']);
    expect(db.store.complaint_attachments).toEqual([]);
    expect(db.store.kra_logs).toEqual([]);
  });

  it('rejects a virtual customer id', async () => {
    const db = createSupabaseMock({ tables: { recurring_customers: [] } });
    const service = new CustomersService(
      asSupabaseService(db.client),
      {} as any,
    );
    await expect(
      service.deleteCustomer('virtual-deal-ABC'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
