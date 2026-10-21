import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  calculateSalesLine,
  deriveProcurementLines,
  procurementStatus,
  sourceLines,
  StoredPricingLine,
} from './inquiry-pricing.util';

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
    const submitted = Array.isArray(body?.lines) ? body.lines : sourceLines(inquiry);
    const existing = await this.linesFor(inquiry.id);
    const next = deriveProcurementLines(existing, submitted);
    await this.upsert(inquiry.id, next, { priced_by: employee?.id || null });
    const status = procurementStatus(next);
    await this.supabase
      .from('inquiries')
      .update({
        pricing_status: status,
        procurement_note: body?.note || null,
      })
      .eq('id', inquiry.id);
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
    const next = baseLines.map((line: StoredPricingLine) => {
      const update = submitted.find((item: any) => item.line_key === line.line_key);
      if (!update || line.line_status === 'cannot_price') return line;
      const priced = calculateSalesLine(
        {
          ...line,
          sales_base_price_per_mt:
            update.base_price_per_mt ?? line.sales_base_price_per_mt ?? line.procurement_base_price_per_mt,
          transport_per_mt: update.transport_per_mt,
          loading_per_mt: update.loading_per_mt,
          credit_per_mt: update.credit_per_mt,
          margin_per_mt: update.margin_per_mt,
        },
        delivery,
      );
      return {
        ...priced,
        procurement_base_price_per_mt: line.procurement_base_price_per_mt ?? null,
        line_status:
          Number(priced.sales_base_price_per_mt) > 0 ? 'priced' : line.line_status,
      };
    });
    await this.upsert(inquiry.id, next, { sales_priced_by: employee?.id || null });
    const stage = String(inquiry?.status || '').toLowerCase().trim();
    const update: Record<string, string> = { pricing_status: 'sales_priced' };
    if (!['negotiation', 'on_hold', 'hold', 'won', 'lost'].includes(stage)) {
      update.status = 'quoted';
    }
    await this.supabase.from('inquiries').update(update).eq('id', inquiry.id);
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

  declinePreview(inquiry: any, lines: any[]) {
    if (!lines.length || lines.some((line) => line.line_status !== 'cannot_price')) {
      throw new ForbiddenException(
        'A decline email is available only when every line is unavailable.',
      );
    }
    const customer =
      inquiry.customer_name ||
      inquiry.sender_name ||
      inquiry.ai_extraction_json?.customer_name ||
      'Customer';
    return {
      subject: 'Update on your material inquiry',
      body: `Dear ${customer},\n\nThank you for your inquiry. We are unable to offer the requested material at this time.\n\nPlease let us know if you would like us to look at an alternative specification.\n\nRegards,\nEnlight Metals`,
    };
  }

  async sendDecline(inquiry: any, lines: any[], employee: any) {
    const preview = this.declinePreview(inquiry, lines);
    const to =
      inquiry.customer_email ||
      inquiry.ai_extraction_json?.customer_email ||
      inquiry.ai_extraction_json?.customerEmail;
    let sent = false;
    const apiKey = process.env.RESEND_API_KEY || '';
    if (apiKey && to) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Enlight Metals <quotations@enlightmetals.com>',
          to: [to],
          subject: preview.subject,
          text: preview.body,
        }),
      });
      sent = response.ok;
    }
    await this.supabase
      .from('inquiries')
      .update({ decline_sent_at: new Date().toISOString() })
      .eq('id', inquiry.id);
    this.activityLogsService.logActivity({
      module: 'Inquiries',
      description: `Decline email ${sent ? 'sent' : 'recorded'} for inquiry ${inquiry.id}`,
      salesperson_phone: employee?.phone,
      action_type: 'inquiry_declined',
      entity_id: inquiry.id,
      entity_type: 'inquiry',
    });
    return { ...preview, sent };
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
      procurement_line_note: line.procurement_line_note || line.line_note || null,
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
    const { error } = await this.supabase
      .from('inquiry_line_pricing')
      .upsert(rows, { onConflict: 'inquiry_id,line_key' });
    if (error) throw error;
  }
}
