import { Injectable, Logger } from '@nestjs/common';
import { matchBooksCatalog, BooksCatalog } from './books-catalog';
import { buildDraftInvoicePatch } from './dispatch-template';

export type BooksParty = { id: string; name: string };

export type BooksGateway = {
  configured: boolean;
  readOnly: boolean;
  lookup(): Promise<BooksCatalog>;
  ensureVendor(name: string): Promise<BooksParty>;
  ensureCustomer(name: string): Promise<BooksParty>;
  findOrCreateProject(input: {
    name: string;
    budget: number;
  }): Promise<{ id: string }>;
  createBill(input: {
    vendorId: string;
    customerId: string;
    projectId: string;
    billNumber: string;
    billDate: string;
    accountId: string;
    gstTaxId: string;
    tdsTaxId: string | null;
    quantityMt: number;
    vendorRate: number;
    description: string;
    customFields: Array<{ customfield_id: string; value: string }>;
  }): Promise<{ id: string }>;
  approveBill(billId: string): Promise<void>;
  createDraftInvoice(input: {
    billId: string;
    customerId: string;
    quantityMt: number;
    sellingRatePerMt: number;
    description: string;
    referenceNumber: string;
  }): Promise<{ id: string }>;
};

type ZohoList<T> = { [key: string]: T[] | undefined };

@Injectable()
export class ZohoBooksClient implements BooksGateway {
  private readonly logger = new Logger(ZohoBooksClient.name);
  private accessToken = '';
  private tokenExpiresAt = 0;

  get configured(): boolean {
    return Boolean(
      process.env.ZOHO_BOOKS_CLIENT_ID &&
      process.env.ZOHO_BOOKS_CLIENT_SECRET &&
      process.env.ZOHO_BOOKS_REFRESH_TOKEN &&
      process.env.ZOHO_BOOKS_ORG_ID,
    );
  }

  get readOnly(): boolean {
    return process.env.ZOHO_BOOKS_READ_ONLY === 'true';
  }

  private accountsUrl(): string {
    return (
      process.env.ZOHO_BOOKS_ACCOUNTS_URL || 'https://accounts.zoho.in'
    ).replace(/\/$/, '');
  }

  private apiBase(): string {
    return (
      process.env.ZOHO_BOOKS_API_BASE || 'https://www.zohoapis.in/books/v3'
    ).replace(/\/$/, '');
  }

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt)
      return this.accessToken;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.ZOHO_BOOKS_CLIENT_ID || '',
      client_secret: process.env.ZOHO_BOOKS_CLIENT_SECRET || '',
      refresh_token: process.env.ZOHO_BOOKS_REFRESH_TOKEN || '',
    });
    const response = await fetch(`${this.accountsUrl()}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!response.ok || !json.access_token) {
      throw new Error('Zoho Books token refresh failed');
    }
    this.accessToken = json.access_token;
    this.tokenExpiresAt =
      Date.now() + Math.max((json.expires_in || 3600) - 60, 30) * 1000;
    return this.accessToken;
  }

  private async request<T>(
    method: string,
    path: string,
    payload?: unknown,
  ): Promise<T> {
    if (method !== 'GET' && this.readOnly) {
      throw new Error('Zoho Books is read only');
    }
    const token = await this.token();
    const org = process.env.ZOHO_BOOKS_ORG_ID;
    const joiner = path.includes('?') ? '&' : '?';
    const response = await fetch(
      `${this.apiBase()}${path}${joiner}organization_id=${encodeURIComponent(org || '')}`,
      {
        method,
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          'Content-Type': 'application/json',
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      },
    );
    const json = (await response.json()) as T & { message?: string };
    if (!response.ok) {
      this.logger.warn(`Zoho Books ${method} ${path} failed`);
      throw new Error(json.message || 'Zoho Books request failed');
    }
    return json;
  }

  async lookup(): Promise<BooksCatalog> {
    const [accounts, taxes, fields] = await Promise.all([
      this.request<ZohoList<{ account_id: string; account_name: string }>>(
        'GET',
        '/chartofaccounts',
      ),
      this.request<
        ZohoList<{ tax_id: string; tax_name: string; tax_percentage: number }>
      >('GET', '/settings/taxes'),
      this.request<ZohoList<{ customfield_id: string; label: string }>>(
        'GET',
        '/settings/customfields?entity=bill',
      ),
    ]);
    return matchBooksCatalog({
      accounts: accounts.chartofaccounts || [],
      taxes: taxes.taxes || [],
      fields: fields.customfields || fields.fields || [],
    });
  }

  private async ensureContact(
    name: string,
    type: 'vendor' | 'customer',
  ): Promise<BooksParty> {
    const listed = await this.request<{
      contacts?: Array<{
        contact_id: string;
        contact_name: string;
        contact_type: string;
      }>;
    }>('GET', `/contacts?contact_name=${encodeURIComponent(name)}`);
    const existing = (listed.contacts || []).find(
      (row) => row.contact_name?.toLowerCase() === name.toLowerCase(),
    );
    if (existing)
      return { id: existing.contact_id, name: existing.contact_name };
    const created = await this.request<{ contact?: { contact_id: string } }>(
      'POST',
      '/contacts',
      {
        contact_name: name,
        contact_type: type,
      },
    );
    if (!created.contact?.contact_id)
      throw new Error(`Zoho Books could not save ${type}`);
    return { id: created.contact.contact_id, name };
  }

  ensureVendor(name: string): Promise<BooksParty> {
    return this.ensureContact(name, 'vendor');
  }

  ensureCustomer(name: string): Promise<BooksParty> {
    return this.ensureContact(name, 'customer');
  }

  async findOrCreateProject(input: {
    name: string;
    budget: number;
  }): Promise<{ id: string }> {
    const listed = await this.request<{
      projects?: Array<{ project_id: string; project_name: string }>;
    }>('GET', `/projects?project_name=${encodeURIComponent(input.name)}`);
    const existing = (listed.projects || []).find(
      (row) => row.project_name === input.name,
    );
    if (existing) return { id: existing.project_id };
    const created = await this.request<{ project?: { project_id: string } }>(
      'POST',
      '/projects',
      {
        project_name: input.name,
        billing_type: 'fixed_cost',
        budget_amount: input.budget,
      },
    );
    if (!created.project?.project_id)
      throw new Error('Zoho Books could not save the project');
    return { id: created.project.project_id };
  }

  async createBill(input: {
    vendorId: string;
    customerId: string;
    projectId: string;
    billNumber: string;
    billDate: string;
    accountId: string;
    gstTaxId: string;
    tdsTaxId: string | null;
    quantityMt: number;
    vendorRate: number;
    description: string;
    customFields: Array<{ customfield_id: string; value: string }>;
  }): Promise<{ id: string }> {
    const created = await this.request<{ bill?: { bill_id: string } }>(
      'POST',
      '/bills',
      {
        vendor_id: input.vendorId,
        bill_number: input.billNumber,
        date: input.billDate,
        tds_tax_id: input.tdsTaxId || undefined,
        custom_fields: input.customFields,
        line_items: [
          {
            account_id: input.accountId,
            description: input.description,
            quantity: input.quantityMt,
            rate: input.vendorRate,
            tax_id: input.gstTaxId,
            is_billable: true,
            customer_id: input.customerId,
            project_id: input.projectId,
          },
        ],
      },
    );
    if (!created.bill?.bill_id)
      throw new Error('Zoho Books could not save the bill');
    return { id: created.bill.bill_id };
  }

  async approveBill(billId: string): Promise<void> {
    await this.request('POST', `/bills/${encodeURIComponent(billId)}/approve`);
  }

  async createDraftInvoice(input: {
    billId: string;
    customerId: string;
    quantityMt: number;
    sellingRatePerMt: number;
    description: string;
    referenceNumber: string;
  }): Promise<{ id: string }> {
    const created = await this.request<{ invoice?: { invoice_id: string } }>(
      'POST',
      `/bills/${encodeURIComponent(input.billId)}/createinvoice`,
    );
    const invoiceId = created.invoice?.invoice_id;
    if (!invoiceId) throw new Error('Zoho Books could not create the invoice');
    const patch = buildDraftInvoicePatch({
      quantityMt: input.quantityMt,
      sellingRatePerMt: input.sellingRatePerMt,
      description: input.description,
    });
    await this.request('PUT', `/invoices/${encodeURIComponent(invoiceId)}`, {
      customer_id: input.customerId,
      reference_number: input.referenceNumber,
      ...patch,
    });
    return { id: invoiceId };
  }
}
