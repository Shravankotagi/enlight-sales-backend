import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

@Injectable()
export class InquiriesService {
  private readonly logger = new Logger(InquiriesService.name);

  constructor(private supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async findAll(filters?: {
    status?: string;
    from?: string;
    to?: string;
    salespersonPhone?: string;
  }) {
    try {
      let query = this.supabase
        .from('inquiries')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters?.from) {
        const fromDate = filters.from.includes('T')
          ? filters.from
          : `${filters.from}T00:00:00.000Z`;
        query = query.gte('created_at', fromDate);
      }
      if (filters?.to) {
        const toDate = filters.to.includes('T')
          ? filters.to
          : `${filters.to}T23:59:59.999Z`;
        query = query.lte('created_at', toDate);
      }

      if (filters?.salespersonPhone) {
        const cleanDigits = filters.salespersonPhone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;
        query = query.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12},sender_phone.eq.${p10},sender_phone.eq.${p12}`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (error) {
      this.logger.error('Error in findAll:', error);
      throw error;
    }
  }

  async findReviewQueue(salespersonPhone?: string) {
    try {
      let query = this.supabase
        .from('inquiries')
        .select('*')
        .in('status', ['review', 'needs_review', 'pending', 'auto_created'])
        .order('created_at', { ascending: false });

      if (salespersonPhone) {
        const cleanDigits = salespersonPhone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;
        query = query.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12},sender_phone.eq.${p10},sender_phone.eq.${p12}`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (error) {
      this.logger.error('Error in findReviewQueue:', error);
      throw error;
    }
  }

  async updateStatus(id: string, status: string) {
    try {
      const { data, error } = await this.supabase
        .from('inquiries')
        .update({ status })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      this.logger.error(`Error in updateStatus for id ${id}:`, error);
      throw error;
    }
  }

  async getStats(salespersonPhone?: string) {
    try {
      let query = this.supabase
        .from('inquiries')
        .select(
          'status, source_channel, created_at, salesperson_phone, sender_phone',
        );

      if (salespersonPhone) {
        const cleanDigits = salespersonPhone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;
        query = query.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12},sender_phone.eq.${p10},sender_phone.eq.${p12}`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;

      return {
        total: data?.length || 0,
        pending: data?.filter((i) => i.status === 'pending').length || 0,
        processed: data?.filter((i) => i.status === 'processed').length || 0,
        review:
          data?.filter((i) => ['review', 'needs_review'].includes(i.status))
            .length || 0,
        by_channel: {
          whatsapp:
            data?.filter((i) => i.source_channel === 'whatsapp').length || 0,
        },
      };
    } catch (error) {
      this.logger.error('Error in getStats:', error);
      throw error;
    }
  }

  async createInquiry(data: any, salespersonPhone?: string) {
    const now = new Date().toISOString();
    const payload = {
      sender_name: data.sender_name || data.customer_name || 'Web Customer',
      sender_phone:
        data.sender_phone || data.customer_phone || salespersonPhone || '',
      salesperson_phone: salespersonPhone || '910000000000',
      raw_text: data.raw_text || data.requirement || '',
      inquiry_type: data.inquiry_type || 'Product Requirement',
      status: data.status || 'review',
      overall_confidence: Number(data.overall_confidence) || 0.95,
      source_channel: 'web_dashboard',
      created_at: now,
    };

    const { data: created, error } = await this.supabase
      .from('inquiries')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    // Log to kra_logs (KRA 4)
    await this.supabase.from('kra_logs').insert({
      kra_number: 4,
      salesperson_phone: salespersonPhone || '910000000000',
      customer_name: payload.sender_name,
      action: 'inquiry_logged',
      details: `Logged inquiry: ${payload.inquiry_type} - "${payload.raw_text.substring(0, 50)}"`,
      created_at: now,
    });

    return created;
  }

  async sendQuotation(id: string, payload: any) {
    try {
      // 1. Fetch inquiry
      const { data: inquiry, error: inqErr } = await this.supabase
        .from('inquiries')
        .select('*')
        .eq('id', id)
        .single();

      if (inqErr) throw inqErr;

      const customerEmail = payload.customer_email || 'customer@example.com';
      const customerName =
        payload.customer_name || inquiry.customer_name || 'Valued Customer';
      const details = payload.details || {};
      const resendApiKey = process.env.RESEND_API_KEY;

      let emailSent = false;
      let emailNotice = '';

      if (resendApiKey) {
        try {
          const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; background: #ffffff;">
              <div style="text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 16px;">
                <h2 style="color: #1e3a8a; margin: 0;">ENLIGHT METALS PRIVATE LIMITED</h2>
                <p style="color: #64748b; font-size: 12px; margin-top: 4px;">Official Commercial Quotation & Material Proposal</p>
              </div>
              <div style="margin-top: 20px;">
                <p style="font-size: 14px; color: #334155;">Dear <strong>${customerName}</strong>,</p>
                <p style="font-size: 13px; color: #475569;">Thank you for your inquiry. Please find below our official price quotation for your steel requirements:</p>
                
                <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px;">
                  <thead>
                    <tr style="background: #0f172a; color: #ffffff;">
                      <th style="padding: 10px; text-align: left;">Product</th>
                      <th style="padding: 10px; text-align: left;">Spec / Form</th>
                      <th style="padding: 10px; text-align: right;">Qty (MT)</th>
                      <th style="padding: 10px; text-align: right;">Rate (₹/MT)</th>
                      <th style="padding: 10px; text-align: right;">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style="border-bottom: 1px solid #cbd5e1;">
                      <td style="padding: 10px; font-weight: bold; color: #0f172a;">${details.productType || 'Steel Material'}</td>
                      <td style="padding: 10px; color: #475569;">${details.productForm || 'Coil'} (${details.thickness || ''} ${details.width || ''})</td>
                      <td style="padding: 10px; text-align: right; font-weight: bold; color: #2563eb;">${details.quantityTons || 30} MT</td>
                      <td style="padding: 10px; text-align: right;">₹${Number(details.unitPrice || 62000).toLocaleString('en-IN')}</td>
                      <td style="padding: 10px; text-align: right; font-weight: bold; color: #059669;">₹${Number(details.totalAmount || 1860000).toLocaleString('en-IN')}</td>
                    </tr>
                  </tbody>
                </table>

                <div style="margin-top: 20px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 12px; color: #334155;">
                  <p style="margin: 4px 0;"><strong>Payment Terms:</strong> ${details.paymentTerms || '30 Days Credit'}</p>
                  <p style="margin: 4px 0;"><strong>Delivery Address:</strong> ${details.deliveryLocation || 'Warehouse'}</p>
                  <p style="margin: 4px 0;"><strong>Validity:</strong> 7 Days from date of issuance</p>
                </div>

                <p style="margin-top: 24px; font-size: 12px; color: #64748b; text-align: center;">
                  To confirm this order, please issue your Purchase Order (PO) or reply to this email.
                </p>
              </div>
            </div>
          `;

          const resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Enlight Metals Sales <sales@enlightmetals.com>',
              to: [customerEmail],
              subject: `Official Price Quotation for ${customerName} - Enlight Metals`,
              html: htmlContent,
            }),
          });

          const resendData = await resendRes.json();
          if (resendRes.ok) {
            emailSent = true;
            emailNotice = `Live email dispatched to ${customerEmail} via Resend! (ID: ${resendData.id})`;
          } else {
            this.logger.warn('Resend API call error:', resendData);
            emailNotice = `Quotation logged! Resend notice: ${resendData.message || 'Check RESEND_API_KEY domain verification.'}`;
          }
        } catch (rErr) {
          this.logger.error('Resend fetch exception:', rErr);
          emailNotice =
            'Quotation logged! Add valid RESEND_API_KEY in backend .env to send live emails.';
        }
      } else {
        emailNotice =
          'Quotation generated & recorded! Add RESEND_API_KEY in backend .env to dispatch live emails.';
      }

      // Update inquiry status to quoted
      await this.supabase
        .from('inquiries')
        .update({ status: 'quoted' })
        .eq('id', id);

      return {
        success: true,
        email_sent: emailSent,
        message: emailNotice,
        inquiry_id: id,
      };
    } catch (error) {
      this.logger.error(`Error in sendQuotation for id ${id}:`, error);
      throw error;
    }
  }
}
