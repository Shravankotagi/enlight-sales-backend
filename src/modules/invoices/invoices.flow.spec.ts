import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import {
  asSupabaseService,
  createSupabaseMock,
} from '../../test-utils/supabase.mock';
import {
  accountsRequestAllowed,
  can,
} from '../../common/access/invoice-access';
import {
  buildDraftInvoicePatch,
  kgToMt,
  parseDispatchTemplate,
} from './dispatch-template';
import { matchBooksCatalog } from './books-catalog';

const template = `Purchase From : Tata Steel
Sale To : ABC Fabricators
Delivery As Per : PO-98765
DO : DO-1 | SO : Amit
Grade : E250 | Size : 12mm
Weight (kg) : 25000
Vehicle No : MH01AB1234 | Driver : 9822012345
Transport : VRL
Dispatch : Bhiwandi`;

const files = [
  {
    kind: 'vendor_bill',
    extracted: { billNumber: 'B-1', vendorRate: 40000, billDate: '2026-10-01' },
  },
  {
    kind: 'weighment_slip',
    extracted: { netKg: 25000, vehicleNumber: 'MH01AB1234', pieces: 10 },
  },
  {
    kind: 'lorry_receipt',
    extracted: { lrNumber: 'LR-9', transporter: 'VRL' },
  },
  { kind: 'customer_po', extracted: {} },
];

const deal = {
  id: 'deal-1',
  stage: 'won',
  po_number: 'PO-98765',
  po_date: '2026-10-01',
  total_amount: 100000,
  delivery_location: 'Gandhinagar, Gujarat',
  deal_items: [{ sku_text: 'HR Coil', dimensions: 'E250 12mm', rate: 52000 }],
};

function books(overrides: Record<string, unknown> = {}) {
  const calls = { bills: 0, drafts: [] as any[], billRate: 0 };
  const gateway = {
    configured: true,
    readOnly: false,
    lookup: async () => ({
      accountId: 'acc',
      gstTaxId: 'gst',
      tdsTaxId: 'tds',
      fields: {
        'DC To': '1',
        'Sale To': '2',
        'Vehicle Number': '3',
        'LR Number': '4',
      },
      missing: [],
    }),
    ensureVendor: async (name: string) => ({ id: 'vendor', name }),
    ensureCustomer: async (name: string) => ({ id: 'customer', name }),
    findOrCreateProject: async () => ({ id: 'project' }),
    createBill: async (input: any) => {
      calls.bills += 1;
      calls.billRate = input.vendorRate;
      return { id: 'bill-1' };
    },
    approveBill: async () => undefined,
    createDraftInvoice: async (input: any) => {
      calls.drafts.push(input);
      return { id: 'inv-1' };
    },
    ...overrides,
    calls,
  };
  return gateway;
}

function service(gateway = books(), extraDeals = [deal]) {
  const db = createSupabaseMock({
    tables: {
      deals: extraDeals,
      dispatch_packages: [],
      dispatch_package_files: [],
    },
  });
  return {
    db,
    gateway,
    api: new InvoicesService(
      asSupabaseService(db.client),
      gateway as any,
      {
        extract: async () => {
          throw new Error('extractor should not run');
        },
      } as any,
    ),
  };
}

const accounts = { role: 'accounts', id: 'acc-1' };

describe('invoice access', () => {
  it('lets accounts open invoices and chat, and blocks other business routes', () => {
    expect(accountsRequestAllowed(accounts, 'GET', '/invoices')).toBe(true);
    expect(accountsRequestAllowed(accounts, 'GET', '/chat/sessions')).toBe(
      true,
    );
    expect(accountsRequestAllowed(accounts, 'GET', '/customers')).toBe(false);
    expect(accountsRequestAllowed(accounts, 'GET', '/inquiries')).toBe(false);
    expect(accountsRequestAllowed(accounts, 'GET', '/orders')).toBe(false);
    expect(
      accountsRequestAllowed({ role: 'salesperson' }, 'GET', '/customers'),
    ).toBe(true);
  });

  it('lets a permissions map override the role', () => {
    expect(
      can(
        { role: 'salesperson', permissions: { 'invoices.view': true } },
        'invoices.view',
      ),
    ).toBe(true);
    expect(
      can(
        { role: 'accounts', permissions: { 'invoices.view': false } },
        'invoices.view',
      ),
    ).toBe(false);
    expect(
      can(
        { role: 'accounts', permissions: { 'customers.view': true } },
        'customers.view',
      ),
    ).toBe(true);
  });
});

describe('dispatch template and books catalog', () => {
  it('reads the standard dispatch message and converts kg to MT', () => {
    const parsed = parseDispatchTemplate(template);
    expect(parsed.poNumber).toBe('PO-98765');
    expect(parsed.weightKg).toBe(25000);
    expect(parsed.vehicleNumber).toBe('MH01AB1234');
    expect(kgToMt(25000)).toBe(25);
    expect(
      buildDraftInvoicePatch({
        quantityMt: 25,
        sellingRatePerMt: 52000,
        description: 'E250',
      }).line_items[0].rate,
    ).toBe(52000);
  });

  it('names the Zoho records the bill needs', () => {
    const catalog = matchBooksCatalog({
      accounts: [{ account_id: 'a', account_name: 'Inventory Asset' }],
      taxes: [
        { tax_id: 'g', tax_name: 'GST 18', tax_percentage: 18 },
        { tax_id: 't', tax_name: 'TDS', tax_percentage: 0.1 },
      ],
      fields: [
        { customfield_id: '1', label: 'DC To' },
        { customfield_id: '2', label: 'Sale To' },
        { customfield_id: '3', label: 'Vehicle Number' },
        { customfield_id: '4', label: 'LR Number' },
      ],
    });
    expect(catalog.missing).toEqual([]);
    expect(
      matchBooksCatalog({ accounts: [], taxes: [], fields: [] }).missing,
    ).toContain('Inventory Asset');
  });
});

describe('InvoicesService', () => {
  it('holds a package when the slip or the PO does not match, and does not call Zoho', async () => {
    const { api, gateway } = service();
    const mismatch = await api.submit(accounts, {
      template,
      files: files.map((file) =>
        file.kind === 'weighment_slip'
          ? { ...file, extracted: { netKg: 1000, vehicleNumber: 'MH01AB9999' } }
          : file,
      ),
    });
    expect(mismatch.status).toBe('held');
    expect(mismatch.hold_reason).toMatch(/Weight/);
    expect(gateway.calls.bills).toBe(0);

    const unknown = await api.submit(accounts, {
      template: template.replace('PO-98765', 'PO-000'),
      files: files.map((file) =>
        file.kind === 'vendor_bill'
          ? { ...file, extracted: { ...file.extracted, billNumber: 'B-2' } }
          : file,
      ),
    });
    expect(unknown.status).toBe('held');
    expect(unknown.hold_reason).toMatch(/won deal/);
    expect(gateway.calls.bills).toBe(0);
  });

  it('creates one pending bill and, after approval, a draft at the PO rate per MT', async () => {
    const { api, gateway } = service();
    const created = await api.submit(accounts, { template, files });
    expect(created.status).toBe('bill_pending_approval');
    expect(gateway.calls.billRate).toBe(40000);
    const again = await api.submit(accounts, { template, files });
    expect(again.zoho_bill_id).toBe('bill-1');
    expect(gateway.calls.bills).toBe(1);

    await expect(api.approve(accounts, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const held = await api.submit(accounts, {
      template: template.replace('PO-98765', 'PO-111'),
      files: files.map((file) =>
        file.kind === 'vendor_bill'
          ? { ...file, extracted: { ...file.extracted, billNumber: 'B-3' } }
          : file,
      ),
    });
    await expect(api.approve(accounts, held.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(gateway.calls.drafts).toHaveLength(0);

    const draft = await api.approve(accounts, created.id);
    expect(draft.status).toBe('draft_created');
    expect(gateway.calls.drafts[0].quantityMt).toBe(25);
    expect(gateway.calls.drafts[0].sellingRatePerMt).toBe(52000);
  });

  it('does not write to Zoho in read-only mode', async () => {
    const gateway = books({
      readOnly: true,
      createBill: async () => {
        throw new Error('wrote');
      },
    });
    const { api } = service(gateway);
    const row = await api.submit(accounts, { template, files });
    expect(row.status).toBe('held');
    expect(row.hold_reason).toMatch(/read only/);
  });

  it('refuses a salesperson', async () => {
    const { api } = service();
    await expect(api.list({ role: 'salesperson' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
