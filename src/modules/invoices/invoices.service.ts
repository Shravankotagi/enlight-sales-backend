import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import {
  canUseInvoice,
  INVOICE_KEYS,
} from '../../common/access/invoice-access';
import { BooksCatalog } from './books-catalog';
import { BooksGateway } from './zoho-books.client';
import { DispatchDocumentExtractor } from './dispatch-document.extractor';
import {
  buildDraftInvoicePatch,
  idempotencyKey,
  kgToMt,
  missingTemplateFields,
  parseDispatchTemplate,
  poKey,
  SlipReading,
  vehiclesMatch,
  weightsMatch,
} from './dispatch-template';

export type DispatchFile = {
  kind:
    'vendor_bill' | 'weighment_slip' | 'lorry_receipt' | 'customer_po' | string;
  name?: string;
  mime?: string;
  content_base64?: string;
  extracted?: SlipReading;
};

type Actor = {
  role?: string;
  permissions?: Record<string, boolean> | null;
  id?: string;
  phone?: string;
};

const PUBLIC_COLUMNS =
  'id, status, hold_reason, customer_po, vehicle_number, vendor_bill_number, deal_id, zoho_project_id, zoho_bill_id, zoho_invoice_id, parsed, created_at, updated_at';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly books: BooksGateway,
    private readonly extractor: DispatchDocumentExtractor,
  ) {}

  private db() {
    return this.supabaseService.getAdminClient();
  }

  private assert(actor: Actor, key: string) {
    if (!canUseInvoice(actor, key)) {
      throw new ForbiddenException('You cannot use invoices.');
    }
  }

  async list(actor: {
    role?: string;
    permissions?: Record<string, boolean> | null;
  }) {
    this.assert(actor, INVOICE_KEYS.view);
    const { data, error } = await this.db()
      .from('dispatch_packages')
      .select(PUBLIC_COLUMNS)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async submit(
    actor: Actor,
    body: { template?: string; files?: DispatchFile[] },
  ) {
    this.assert(actor, INVOICE_KEYS.create);
    const template = parseDispatchTemplate(body.template || '');
    const files = Array.isArray(body.files) ? body.files : [];
    const readings = await this.readings(files);
    const slip = readings.weighment_slip || {};
    const bill = readings.vendor_bill || {};
    const lr = readings.lorry_receipt || {};
    const reasons = missingTemplateFields(template);

    if (!slip.netKg && !slip.vehicleNumber)
      reasons.push('Weighment slip is missing.');
    else {
      if (!weightsMatch(template.weightKg, slip.netKg ?? null)) {
        reasons.push('Weight does not match the weighment slip.');
      }
      if (!vehiclesMatch(template.vehicleNumber, slip.vehicleNumber)) {
        reasons.push('Vehicle number does not match the weighment slip.');
      }
    }
    if (!bill.billNumber) reasons.push('Vendor bill number is missing.');
    if (bill.vendorRate == null) reasons.push('Vendor rate is missing.');
    if (!lr.lrNumber) reasons.push('LR number is missing.');

    const deal = template.poNumber
      ? await this.findWonDeal(template.poNumber)
      : null;
    if (!deal) reasons.push('No won deal for this PO.');
    const line = deal
      ? matchLine(deal.deal_items || [], template.grade, template.size)
      : null;
    if (deal && !line) reasons.push('No deal line for this grade and size.');

    const sellingRate = line ? Number(line.rate) : null;
    const netKg = slip.netKg ?? template.weightKg;
    const quantityMt = netKg != null ? kgToMt(netKg) : null;
    const key = idempotencyKey(
      bill.billNumber,
      slip.vehicleNumber || template.vehicleNumber,
      template.poNumber,
    );
    const existing = await this.findByKey(key);

    if (existing?.zoho_bill_id) return this.publicRow(existing);

    const parsed = {
      template,
      slip,
      bill,
      lr,
      selling_rate_per_mt: sellingRate,
      vendor_rate: bill.vendorRate ?? null,
      quantity_mt: quantityMt,
      description: [
        template.grade,
        template.size,
        slip.pieces ? `${slip.pieces} pcs` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      reference_number: deal
        ? `${template.poNumber} - ${deal.po_date || ''}`.trim()
        : template.poNumber,
      sales_officer: template.salesOfficer,
      destination: deal?.delivery_location || template.dispatchLocation,
    };

    if (reasons.length) {
      return this.save({
        existing,
        key,
        actor,
        template: body.template || '',
        files,
        status: 'held',
        holdReason: reasons.join(' '),
        parsed,
        dealId: deal?.id || null,
        billNumber: bill.billNumber || null,
        vehicle: slip.vehicleNumber || template.vehicleNumber,
        po: template.poNumber,
      });
    }

    if (!this.books.configured) {
      return this.save({
        existing,
        key,
        actor,
        template: body.template || '',
        files,
        status: 'failed',
        holdReason: 'Zoho Books is not configured.',
        parsed,
        dealId: deal?.id || null,
        billNumber: bill.billNumber || null,
        vehicle: slip.vehicleNumber || template.vehicleNumber,
        po: template.poNumber,
      });
    }

    if (this.books.readOnly) {
      return this.save({
        existing,
        key,
        actor,
        template: body.template || '',
        files,
        status: 'held',
        holdReason: 'Zoho Books is read only.',
        parsed,
        dealId: deal?.id || null,
        billNumber: bill.billNumber || null,
        vehicle: slip.vehicleNumber || template.vehicleNumber,
        po: template.poNumber,
      });
    }

    const catalog = await this.books.lookup();
    if (catalog.missing.length) {
      return this.save({
        existing,
        key,
        actor,
        template: body.template || '',
        files,
        status: 'held',
        holdReason: `Zoho Books is missing ${catalog.missing.join(', ')}.`,
        parsed,
        dealId: deal?.id || null,
        billNumber: bill.billNumber || null,
        vehicle: slip.vehicleNumber || template.vehicleNumber,
        po: template.poNumber,
      });
    }

    const vendor = await this.books.ensureVendor(template.purchaseFrom);
    const customer = await this.books.ensureCustomer(template.saleTo);
    const project = await this.books.findOrCreateProject({
      name: template.poNumber.startsWith('PO-')
        ? template.poNumber
        : `PO-${template.poNumber}`,
      budget: Number(deal?.total_amount) || 0,
    });
    const zohoBill = await this.books.createBill({
      vendorId: vendor.id,
      customerId: customer.id,
      projectId: project.id,
      billNumber: bill.billNumber || '',
      billDate: bill.billDate || new Date().toISOString().slice(0, 10),
      accountId: catalog.accountId || '',
      gstTaxId: catalog.gstTaxId || '',
      tdsTaxId: catalog.tdsTaxId,
      quantityMt: quantityMt || 0,
      vendorRate: Number(bill.vendorRate),
      description: parsed.description,
      customFields: customFields(
        catalog,
        template,
        lr.lrNumber || '',
        slip.vehicleNumber || template.vehicleNumber,
      ),
    });

    return this.save({
      existing,
      key,
      actor,
      template: body.template || '',
      files,
      status: 'bill_pending_approval',
      holdReason: null,
      parsed: { ...parsed, customer_id: customer.id },
      dealId: deal?.id || null,
      billNumber: bill.billNumber || null,
      vehicle: slip.vehicleNumber || template.vehicleNumber,
      po: template.poNumber,
      projectId: project.id,
      billId: zohoBill.id,
    });
  }

  async approve(actor: Actor, id: string) {
    this.assert(actor, INVOICE_KEYS.approve);
    const row = await this.findById(id);
    if (!row) throw new NotFoundException('Dispatch package not found');
    if (row.status !== 'bill_pending_approval' || !row.zoho_bill_id) {
      throw new BadRequestException('This bill is not waiting for approval.');
    }
    if (this.books.readOnly || !this.books.configured) {
      throw new BadRequestException('Zoho Books is not accepting writes.');
    }
    const parsed = row.parsed || {};
    const patch = buildDraftInvoicePatch({
      quantityMt: Number(parsed.quantity_mt),
      sellingRatePerMt: Number(parsed.selling_rate_per_mt),
      description: String(parsed.description || ''),
    });
    await this.books.approveBill(row.zoho_bill_id);
    const invoice = await this.books.createDraftInvoice({
      billId: row.zoho_bill_id,
      customerId: String(parsed.customer_id || ''),
      quantityMt: patch.line_items[0].quantity,
      sellingRatePerMt: patch.line_items[0].rate,
      description: patch.line_items[0].description,
      referenceNumber: String(parsed.reference_number || ''),
    });
    const { data, error } = await this.db()
      .from('dispatch_packages')
      .update({
        status: 'draft_created',
        hold_reason: null,
        zoho_invoice_id: invoice.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(PUBLIC_COLUMNS);
    if (error) throw new BadRequestException(error.message);
    return Array.isArray(data) ? data[0] : data;
  }

  private async readings(files: DispatchFile[]) {
    const out: Record<string, SlipReading> = {};
    for (const file of files) {
      out[file.kind] = file.extracted || (await this.extractor.extract(file));
    }
    return out;
  }

  private async findWonDeal(poNumber: string) {
    const { data, error } = await this.db()
      .from('deals')
      .select(
        'id, po_number, generated_po_number, reference_po_number, po_date, customer_name, total_amount, stage, delivery_location, deal_items(*)',
      );
    if (error) throw new BadRequestException(error.message);
    const wanted = poKey(poNumber);
    return (data || []).find((deal: any) => {
      const stage = String(deal.stage || '').toLowerCase();
      if (stage !== 'won') return false;
      return [
        deal.po_number,
        deal.generated_po_number,
        deal.reference_po_number,
      ].some((value) => poKey(value) === wanted);
    });
  }

  private async findByKey(key: string) {
    const { data } = await this.db()
      .from('dispatch_packages')
      .select('*')
      .eq('idempotency_key', key)
      .maybeSingle();
    return data;
  }

  private async findById(id: string) {
    const { data } = await this.db()
      .from('dispatch_packages')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return data;
  }

  private async save(input: {
    existing: any;
    key: string;
    actor: Actor;
    template: string;
    files: DispatchFile[];
    status: string;
    holdReason: string | null;
    parsed: Record<string, unknown>;
    dealId: string | null;
    billNumber: string | null;
    vehicle: string;
    po: string;
    projectId?: string;
    billId?: string;
  }) {
    const now = new Date().toISOString();
    const row = {
      idempotency_key: input.key,
      status: input.status,
      hold_reason: input.holdReason,
      template_text: input.template,
      parsed: input.parsed,
      deal_id: input.dealId,
      zoho_project_id:
        input.projectId || input.existing?.zoho_project_id || null,
      zoho_bill_id: input.billId || input.existing?.zoho_bill_id || null,
      vendor_bill_number: input.billNumber,
      vehicle_number: input.vehicle,
      customer_po: input.po,
      created_by: input.actor?.id || input.actor?.phone || null,
      updated_at: now,
    };
    let saved: any;
    if (input.existing?.id) {
      const { data, error } = await this.db()
        .from('dispatch_packages')
        .update(row)
        .eq('id', input.existing.id)
        .select(PUBLIC_COLUMNS);
      if (error) throw new BadRequestException(error.message);
      saved = Array.isArray(data) ? data[0] : data;
    } else {
      const { data, error } = await this.db()
        .from('dispatch_packages')
        .insert({ ...row, id: crypto.randomUUID(), created_at: now })
        .select(PUBLIC_COLUMNS);
      if (error) throw new BadRequestException(error.message);
      saved = Array.isArray(data) ? data[0] : data;
    }
    if (saved?.id && input.files.length && !input.existing?.id) {
      await this.db()
        .from('dispatch_package_files')
        .insert(
          input.files.map((file) => ({
            id: crypto.randomUUID(),
            package_id: saved.id,
            kind: file.kind,
            file_name: file.name || file.kind,
            mime: file.mime || null,
            content_base64: file.content_base64 || null,
          })),
        );
    }
    return this.publicRow(saved);
  }

  private publicRow(row: any) {
    if (!row) return row;
    const copy = { ...row };
    delete copy.template_text;
    delete copy.content_base64;
    return copy;
  }
}

function matchLine(items: any[], grade: string, size: string) {
  const gradeKey = grade.toLowerCase();
  const sizeKey = size.toLowerCase();
  return items.find((item) => {
    const text =
      `${item.sku_text || ''} ${item.dimensions || ''} ${item.grade || ''}`.toLowerCase();
    return text.includes(gradeKey) && text.includes(sizeKey);
  });
}

function customFields(
  catalog: BooksCatalog,
  template: { saleTo: string; dispatchLocation: string },
  lrNumber: string,
  vehicle: string,
) {
  const values: Record<string, string> = {
    'DC To': template.dispatchLocation,
    'Sale To': template.saleTo,
    'Vehicle Number': vehicle,
    'LR Number': lrNumber,
  };
  return Object.entries(catalog.fields).map(([label, customfield_id]) => ({
    customfield_id,
    value: values[label] || '',
  }));
}
