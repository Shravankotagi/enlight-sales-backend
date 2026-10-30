import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  calculateSalesLine,
  deriveProcurementLines,
  procurementStatus,
  sourceItemFor,
  sourceLines,
  StoredPricingLine,
} from './inquiry-pricing.util';
import {
  getCompanyLogoBuffer,
  quotationEmailHtml,
} from './quotation-email-html';

@Injectable()
export class InquiryPricingService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly activityLogsService: ActivityLogsService,
  ) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async linesFor(inquiryId: string) {
    const { data, error } = await this.supabase
      .from('inquiry_line_pricing')
      .select('*')
      .eq('inquiry_id', inquiryId);
    if (error) throw error;
    return data || [];
  }

  async saveProcurement(inquiry: any, body: any, employee: any) {
    const submitted = Array.isArray(body?.lines)
      ? body.lines
      : sourceLines(inquiry);
    const existing = await this.linesFor(inquiry.id);
    const next = deriveProcurementLines(existing, submitted);
    await this.upsert(inquiry.id, next, { priced_by: employee?.id || null });
    const status = procurementStatus(next);
    const statusUpdate: Record<string, unknown> = {
      pricing_status: status,
      procurement_note: body?.note || null,
      tonnage_review_open: false,
      tonnage_review: null,
    };
    let { error: statusError } = await this.supabase
      .from('inquiries')
      .update(statusUpdate)
      .eq('id', inquiry.id);
    if (statusError && /tonnage_review/i.test(statusError.message || '')) {
      delete statusUpdate.tonnage_review_open;
      delete statusUpdate.tonnage_review;
      const retry = await this.supabase
        .from('inquiries')
        .update(statusUpdate)
        .eq('id', inquiry.id);
      statusError = retry.error;
    }
    if (statusError) throw new Error(statusError.message);
    this.activityLogsService.logActivity({
      module: 'Inquiries',
      description: `Procurement saved prices for inquiry ${inquiry.id}`,
      salesperson_phone: employee?.phone,
      salesperson_name: employee?.name,
      action_type: 'procurement_pricing_saved',
      entity_id: inquiry.id,
      entity_type: 'inquiry',
      change_detail: { status, lines: next.length },
    });
    return { pricing_status: status, lines: next };
  }

  async saveSales(inquiry: any, body: any, employee: any) {
    const existing = await this.linesFor(inquiry.id);
    const submitted = Array.isArray(body?.lines) ? body.lines : [];
    const delivery =
      inquiry.delivery_location ||
      inquiry.ai_extraction_json?.delivery_location ||
      '';
    const baseLines = existing.length
      ? existing
      : sourceLines(inquiry).map((line) => ({
          ...line,
          line_status: 'needs_price' as const,
        }));
    const next = baseLines.map((line: StoredPricingLine, index: number) => {
      const update = submitted.find(
        (item: any) => item.line_key === line.line_key,
      );
      if (!update || line.line_status === 'cannot_price') return line;
      const priced = calculateSalesLine(
        {
          ...line,
          sales_base_price_per_mt:
            update.base_price_per_mt ??
            line.sales_base_price_per_mt ??
            line.procurement_base_price_per_mt,
          transport_per_mt: update.transport_per_mt,
          loading_per_mt: update.loading_per_mt,
          credit_per_mt: update.credit_per_mt,
          margin_per_mt: update.margin_per_mt,
        },
        delivery,
        sourceItemFor(inquiry, line, index),
      );
      return {
        ...priced,
        procurement_base_price_per_mt:
          line.procurement_base_price_per_mt ?? null,
        line_status:
          Number(priced.sales_base_price_per_mt) > 0
            ? 'priced'
            : line.line_status,
      };
    });
    await this.upsert(inquiry.id, next, {
      sales_priced_by: employee?.id || null,
    });
    const stage = String(inquiry?.status || '')
      .toLowerCase()
      .trim();
    const update: Record<string, string> = { pricing_status: 'sales_priced' };
    if (!['negotiation', 'on_hold', 'hold', 'won', 'lost'].includes(stage)) {
      update.status = 'quoted';
    }
    const { error: statusError } = await this.supabase
      .from('inquiries')
      .update(update)
      .eq('id', inquiry.id);
    if (statusError) throw new Error(statusError.message);
    if (update.status === 'quoted') {
      const { error: dealError } = await this.supabase
        .from('deals')
        .update({ stage: 'quoted' })
        .eq('inquiry_id', inquiry.id)
        .in('stage', ['new_inquiry', 'review', 'qualified']);
      if (dealError) throw new Error(dealError.message);
    }
    this.activityLogsService.logActivity({
      module: 'Inquiries',
      description: `Sales saved prices for inquiry ${inquiry.id}`,
      salesperson_phone: employee?.phone,
      action_type: 'sales_pricing_saved',
      entity_id: inquiry.id,
      entity_type: 'inquiry',
    });
    return { pricing_status: 'sales_priced', lines: next };
  }

  private isValidEmail(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    );
  }

  private customerEmailFrom(inquiry: any): string {
    const raw =
      inquiry?.customer_email ||
      inquiry?.ai_extraction_json?.customer_email ||
      inquiry?.ai_extraction_json?.customerEmail ||
      '';
    const email = String(raw).trim().toLowerCase();
    return this.isValidEmail(email) ? email : '';
  }

  private senderEmailFrom(employee: any): string {
    const email = String(employee?.email || '')
      .trim()
      .toLowerCase();
    return this.isValidEmail(email) ? email : '';
  }

  private async resolveDeclineSenderEmail(employee: any): Promise<string> {
    const direct = this.senderEmailFrom(employee);
    if (direct) return direct;

    const id = String(employee?.id || '').trim();
    if (id) {
      const { data } = await this.supabase
        .from('employees')
        .select('email')
        .eq('id', id)
        .maybeSingle();
      const email = this.senderEmailFrom(data);
      if (email) return email;
    }

    const code = String(employee?.employee_id || '').trim();
    if (code && code !== id) {
      const { data } = await this.supabase
        .from('employees')
        .select('email')
        .eq('employee_id', code)
        .maybeSingle();
      const email = this.senderEmailFrom(data);
      if (email) return email;
    }

    const phone = String(employee?.phone || '')
      .replace(/\D/g, '')
      .slice(-10);
    if (!phone) return '';
    const { data } = await this.supabase
      .from('employees')
      .select('email, phone')
      .ilike('phone', `%${phone}`)
      .limit(5);
    const row = (data || []).find(
      (emp: any) =>
        String(emp?.phone || '')
          .replace(/\D/g, '')
          .slice(-10) === phone,
    );
    return this.senderEmailFrom(row);
  }

  private declineSubject(inquiry: any): string {
    const customer =
      inquiry?.customer_name ||
      inquiry?.sender_name ||
      inquiry?.ai_extraction_json?.customer_name ||
      'Customer';
    return `Enlight Metals - Quotation Update for ${customer}`;
  }

  private declineLogoAttachment() {
    const logo = getCompanyLogoBuffer();
    if (!logo) return undefined;
    return [
      {
        filename: 'enlight-logo.png',
        content: logo.toString('base64'),
        content_id: 'enlight-logo',
      },
    ];
  }

  private declineCc(
    senderEmail: string,
    customerEmail: string,
    requestedCc?: unknown,
  ): string[] {
    const fixedCc = ['dj@enlightmetals.com', 'vedant@enlightmetals.com'];
    const normalizedCustomer = customerEmail.trim().toLowerCase();
    const recipients =
      requestedCc === undefined
        ? [senderEmail, ...fixedCc].filter(Boolean)
        : requestedCc;
    if (
      !Array.isArray(recipients) ||
      recipients.some((email) => typeof email !== 'string')
    ) {
      throw new BadRequestException(
        'CC recipients must be an array of email addresses.',
      );
    }
    const normalized = recipients
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    if (normalized.some((email) => !this.isValidEmail(email))) {
      throw new BadRequestException(
        'CC recipients must contain valid email addresses.',
      );
    }
    const withFixed = [
      ...normalized,
      ...fixedCc.filter((email) => !normalized.includes(email)),
    ];
    return Array.from(
      new Set(withFixed.filter((email) => email !== normalizedCustomer)),
    );
  }

  private materialLabel(line: any): string {
    const name = String(line?.sku_text || line?.description || '').trim();
    const dimensions = String(line?.dimensions || line?.spec || '').trim();
    const titled = [
      name || 'the requested material',
      dimensions ? `(${dimensions})` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const quantity =
      line?.quantity != null && String(line.quantity).trim() !== ''
        ? `${line.quantity} ${line.unit || 'MT'}`
        : '';
    return quantity ? `${titled}, ${quantity}` : titled;
  }

  async declinePreview(inquiry: any, lines: any[], employee?: any) {
    if (
      !lines.length ||
      lines.some((line) => line.line_status !== 'cannot_price')
    ) {
      throw new ForbiddenException(
        'A decline email is available only when every line is unavailable.',
      );
    }
    const customer =
      inquiry.customer_name ||
      inquiry.sender_name ||
      inquiry.ai_extraction_json?.customer_name ||
      'Customer';
    const listed = lines
      .map((line) => `- ${this.materialLabel(line)}`)
      .join('\n');
    const customerEmail = this.customerEmailFrom(inquiry);
    const senderEmail = await this.resolveDeclineSenderEmail(employee);
    return {
      subject: this.declineSubject(inquiry),
      body: `Dear ${customer},\n\nThank you for your inquiry. We are unable to offer the following material at this time, as it is not available with us:\n\n${listed}\n\nPlease let us know if you would like us to look at an alternative specification.\n\nWarm regards,\nEnlight Metals`,
      customer_email: customerEmail,
      sender_email: 'quotations@enlightmetals.com',
      employee_email: senderEmail,
      cc: this.declineCc(senderEmail, customerEmail),
    };
  }

  async sendDecline(
    inquiry: any,
    lines: any[],
    employee: any,
    payload: any = {},
  ) {
    const preview = await this.declinePreview(inquiry, lines, employee);
    const senderEmail = await this.resolveDeclineSenderEmail(employee);
    const customerEmail = String(
      payload?.customer_email || preview.customer_email || '',
    )
      .trim()
      .toLowerCase();
    if (!this.isValidEmail(customerEmail)) {
      throw new BadRequestException(
        'Please provide a valid customer email address to send the decline.',
      );
    }
    const subject =
      String(payload?.email_subject || '').trim() || preview.subject;
    const body = String(payload?.email_body || '').trim() || preview.body;
    const cc = this.declineCc(senderEmail, customerEmail, payload?.cc);
    let sent = false;
    const apiKey = process.env.RESEND_API_KEY || '';
    if (apiKey) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Enlight Metals <quotations@enlightmetals.com>',
          to: [customerEmail],
          cc,
          subject,
          text: body,
          html: quotationEmailHtml(body),
          attachments: this.declineLogoAttachment(),
        }),
      });
      sent = response.ok;
    }
    const ai = {
      ...(inquiry.ai_extraction_json || {}),
      customer_email: customerEmail,
    };
    await this.supabase
      .from('inquiries')
      .update({
        decline_sent_at: new Date().toISOString(),
        ai_extraction_json: ai,
      })
      .eq('id', inquiry.id);
    this.activityLogsService.logActivity({
      module: 'Inquiries',
      description: `Decline email ${sent ? 'sent' : 'recorded'} for inquiry ${inquiry.id}`,
      salesperson_phone: employee?.phone,
      action_type: 'inquiry_declined',
      entity_id: inquiry.id,
      entity_type: 'inquiry',
    });
    return {
      ...preview,
      subject,
      body,
      customer_email: customerEmail,
      cc,
      sent,
    };
  }

  private async upsert(
    inquiryId: string,
    lines: any[],
    actor: { priced_by?: string | null; sales_priced_by?: string | null },
  ) {
    const rows = lines.map((line) => ({
      inquiry_id: inquiryId,
      line_key: line.line_key,
      sku_text: line.sku_text || null,
      quantity: line.quantity ?? null,
      unit: line.unit || null,
      procurement_base_price_per_mt: line.procurement_base_price_per_mt ?? null,
      procurement_line_note:
        line.procurement_line_note || line.line_note || null,
      line_status: line.line_status || 'needs_price',
      sales_base_price_per_mt: line.sales_base_price_per_mt ?? null,
      transport_per_mt: line.transport_per_mt ?? null,
      loading_per_mt: line.loading_per_mt ?? null,
      credit_per_mt: line.credit_per_mt ?? null,
      margin_per_mt: line.margin_per_mt ?? null,
      rate_per_mt: line.rate_per_mt ?? null,
      taxable_amount: line.taxable_amount ?? null,
      cgst_amount: line.cgst_amount ?? null,
      sgst_amount: line.sgst_amount ?? null,
      igst_amount: line.igst_amount ?? null,
      final_amount: line.final_amount ?? null,
      priced_by: actor.priced_by ?? line.priced_by ?? null,
      sales_priced_by: actor.sales_priced_by ?? line.sales_priced_by ?? null,
      updated_at: new Date().toISOString(),
    }));
    const write = (payload: any[]) =>
      this.supabase
        .from('inquiry_line_pricing')
        .upsert(payload, { onConflict: 'inquiry_id,line_key' });
    let { error } = await write(rows);
    if (error && /credit_per_mt/i.test(error.message || '')) {
      const retryRows = rows.map((row) => {
        const copy = { ...row };
        delete (copy as any).credit_per_mt;
        return copy;
      });
      ({ error } = await write(retryRows));
    }
    if (error) throw new Error(error.message || 'Could not save line prices');
  }
}
