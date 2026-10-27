/**
 * Regression: a procurement user with view-only inquiry permission could
 * still save a base price.
 * Issue: <add GitHub issue link>
 */
import { ForbiddenException } from '@nestjs/common';
import { InquiriesController } from '../modules/inquiries/inquiries.controller';
import { matchesProcurementScope } from '../modules/inquiries/inquiries.service';
import {
  canFillBasePrices,
  resolveProcurementPermissions,
} from '../modules/inquiries/procurement-permissions';

const scope = { ids: ['person'], includeUnassignedPool: false };

function inquiry(pricingStatus = 'awaiting_price') {
  return {
    id: 'inq-1',
    procurement_number: 'PR-30011',
    procurement_employee_id: 'person',
    status: 'review',
    pricing_status: pricingStatus,
    created_at: '2026-10-20T00:00:00.000Z',
    inquiry_type: 'inquiry',
    source_channel: 'dashboard',
  };
}

function controllerFor(
  row: any,
  employeeRow: any,
  extra: { saveProcurement?: jest.Mock; deleteInquiry?: jest.Mock; sendQuotation?: jest.Mock } = {},
) {
  const saveProcurement = extra.saveProcurement || jest.fn(async () => ({ pricing_status: 'price_ready' }));
  const inquiries = new InquiriesController(
    {
      findOne: async () => row,
      deleteInquiry: extra.deleteInquiry,
      sendQuotation: extra.sendQuotation,
    } as any,
    {
      getAccessibleProcurementIds: async () => scope,
      getAccessibleSalespersonIds: async () => null,
      findById: async () => employeeRow,
    } as any,
    { saveProcurement } as any,
  );
  return { inquiries, saveProcurement };
}

describe('procurement inquiry ACL', () => {
  it('does not let a view-only user fill prices when that sub-option stays checked', () => {
    const permissions = resolveProcurementPermissions({
      role: 'procurement_person',
      permissions: {
        'inquiries.view': true,
        'inquiries.edit': false,
        'inquiries.fill_base_prices': true,
      },
    });
    expect(canFillBasePrices(permissions)).toBe(false);
  });

  it('keeps the person template when stored permissions are empty', () => {
    const permissions = resolveProcurementPermissions({
      role: 'procurement_person',
      permissions: null,
    });
    expect(canFillBasePrices(permissions)).toBe(true);
    expect(permissions['inquiries.manage']).toBe(false);
    expect(permissions['inquiries.delete']).toBe(false);
    expect(permissions['inquiries.send_quote']).toBe(false);
  });

  it('refuses a view-only base-price save and still lets an empty permissions row save', async () => {
    const viewOnly = controllerFor(inquiry(), {
      id: 'person',
      role: 'procurement_person',
      permissions: {
        'inquiries.view': true,
        'inquiries.edit': false,
        'inquiries.fill_base_prices': true,
      },
    });
    await expect(
      viewOnly.inquiries.saveProcurementPricing(
        { role: 'procurement_person', id: 'person' },
        'inq-1',
        { lines: [{ line_key: 'a' }] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(viewOnly.saveProcurement).not.toHaveBeenCalled();

    const open = controllerFor(inquiry(), {
      id: 'person',
      role: 'procurement_person',
      permissions: null,
    });
    await open.inquiries.saveProcurementPricing(
      { role: 'procurement_person', id: 'person' },
      'inq-1',
      { lines: [{ line_key: 'a' }] },
    );
    expect(open.saveProcurement).toHaveBeenCalled();
  });

  it('refuses delete without inquiries.delete and allows a manager whose permissions are empty', async () => {
    const deleteInquiry = jest.fn(async () => ({ ok: true }));
    const denied = controllerFor(
      inquiry(),
      {
        id: 'mgr',
        role: 'procurement_manager',
        permissions: { 'inquiries.view': true, 'inquiries.delete': false },
      },
      { deleteInquiry },
    );
    await expect(
      denied.inquiries.deleteInquiry({ role: 'procurement_manager', id: 'mgr' }, 'inq-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deleteInquiry).not.toHaveBeenCalled();

    const allowed = controllerFor(
      inquiry(),
      { id: 'mgr', role: 'procurement_manager', permissions: null },
      { deleteInquiry },
    );
    await allowed.inquiries.deleteInquiry(
      { role: 'procurement_manager', id: 'mgr' },
      'inq-1',
    );
    expect(deleteInquiry).toHaveBeenCalled();
  });

  it('sends a quotation only when inquiries.send_quote is on', async () => {
    const sendQuotation = jest.fn(async () => ({ ok: true }));
    const denied = controllerFor(
      inquiry('price_ready'),
      { id: 'person', role: 'procurement_person', permissions: null },
      { sendQuotation },
    );
    await expect(
      denied.inquiries.sendQuotation(
        { role: 'procurement_person', id: 'person' },
        'inq-1',
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sendQuotation).not.toHaveBeenCalled();

    const allowed = controllerFor(
      inquiry('price_ready'),
      {
        id: 'person',
        role: 'procurement_person',
        permissions: { 'inquiries.view': true, 'inquiries.send_quote': true },
      },
      { sendQuotation },
    );
    await allowed.inquiries.sendQuotation(
      { role: 'procurement_person', id: 'person' },
      'inq-1',
      {},
    );
    expect(sendQuotation).toHaveBeenCalled();
  });

  it('shows only a stamped inquiry when neither scope flag is on', () => {
    const stamped = {
      ids: ['person'],
      includeUnassignedPool: false,
      salespersonPhones: ['9800000001'],
      stampedOnly: true,
    };
    expect(
      matchesProcurementScope(
        { procurement_employee_id: null, salesperson_phone: '919800000001', status: 'new' },
        stamped,
      ),
    ).toBe(false);
    expect(
      matchesProcurementScope(
        { procurement_employee_id: 'person', status: 'won' },
        stamped,
      ),
    ).toBe(true);
  });
});
