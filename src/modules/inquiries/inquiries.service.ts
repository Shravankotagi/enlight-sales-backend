import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
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

  async updateStatus(id: string, status: string, details?: any) {
    try {
      const updatePayload: any = { status };
      if (details) {
        if (details.companyName) updatePayload.sender_name = details.companyName;
        if (details.customerPhone) updatePayload.sender_phone = details.customerPhone;
        if (details.requirement) updatePayload.raw_text = details.requirement;
        updatePayload.ai_extraction_json = details;
      }

      const { data, error } = await this.supabase
        .from('inquiries')
        .update(updatePayload)
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
    const now = new Date();
    const nowIso = now.toISOString();

    if (data && typeof data === 'object') {
      delete data.inquiry_type;
    }

    const payload: any = {
      sender_name: data.sender_name || data.customer_name || 'Web Customer',
      sender_phone:
        data.sender_phone || data.customer_phone || salespersonPhone || '',
      salesperson_phone: salespersonPhone || '910000000000',
      raw_text: data.raw_text || data.requirement || '',
      status: data.status || 'review',
      overall_confidence: Number(data.overall_confidence) || 0.95,
      source_channel: 'web_dashboard',
      ai_extraction_json: {
        inquiry_type: data.inquiry_type || 'Product Requirement',
        customer: {
          name: data.sender_name || data.customer_name || 'Web Customer',
          phone: data.sender_phone || data.customer_phone || '',
        },
      },
      created_at: nowIso,
    };

    delete payload.inquiry_type;

    const { data: created, error } = await this.supabase
      .from('inquiries')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    // Log to kra_logs (KRA 4) safely without blocking inquiry creation
    try {
      await this.supabase.from('kra_logs').insert({
        kra_number: 4,
        kra_type: 'inquiry_logged',
        description: `Logged inquiry: "${payload.raw_text.substring(0, 50)}"`,
        salesperson_phone: salespersonPhone || '910000000000',
        customer_name: payload.sender_name,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        created_at: nowIso,
      });
    } catch (kraErr: any) {
      this.logger.warn('Non-blocking kra_logs insert notice:', kraErr?.message);
    }

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
      const fromEmail =
        process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

      let emailSent = false;
      let emailNotice = '';

      if (resendApiKey) {
        try {
          const qRefNum = `QT-2026-${Math.floor(1000 + Math.random() * 9000)}`;
          const todayDateStr = new Date().toLocaleDateString('en-IN');
          const totalAmt = Number(details.totalAmount || 1860000);
          const gstAmt = Math.round(totalAmt * 0.18);
          const grandTotalAmt = Math.round(totalAmt * 1.18);
          const unitRateStr = Number(details.unitPrice || 62000).toLocaleString(
            'en-IN',
          );
          const totalAmtStr = totalAmt.toLocaleString('en-IN');

          const htmlContent = `
            <div style="font-family: Arial, Helvetica, sans-serif; max-width: 680px; margin: 0 auto; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
              <div style="background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); padding: 24px; text-align: center; color: #ffffff;">
                <h1 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.5px;">ENLIGHT METALS PRIVATE LIMITED</h1>
                <p style="margin: 4px 0 0 0; font-size: 12px; color: #93c5fd; text-transform: uppercase; letter-spacing: 1px;">Authorized B2B Metal Distributor &amp; Steel Processor</p>
                <div style="margin-top: 12px; display: inline-block; background: #2563eb; color: #ffffff; padding: 4px 14px; border-radius: 20px; font-size: 11px; font-weight: bold;">
                  OFFICIAL COMMERCIAL PRICE QUOTATION
                </div>
              </div>

              <div style="padding: 24px;">
                <table style="width: 100%; font-size: 12px; color: #334155; margin-bottom: 20px; border-bottom: 2px dashed #e2e8f0; padding-bottom: 16px;">
                  <tr>
                    <td style="width: 50%; vertical-align: top;">
                      <p style="margin: 0 0 4px 0; color: #64748b; font-size: 10px; font-weight: bold; text-transform: uppercase;">QUOTATION TO (CUSTOMER)</p>
                      <p style="margin: 0; font-size: 15px; font-weight: bold; color: #0f172a;">${customerName}</p>
                      <p style="margin: 2px 0 0 0; color: #475569;">Email: ${customerEmail}</p>
                      <p style="margin: 2px 0 0 0; color: #475569;">Phone: ${details.customerPhone || 'As registered'}</p>
                    </td>
                    <td style="width: 50%; text-align: right; vertical-align: top;">
                      <p style="margin: 0 0 4px 0; color: #64748b; font-size: 10px; font-weight: bold; text-transform: uppercase;">QUOTATION DETAILS</p>
                      <p style="margin: 0; font-size: 13px; font-weight: bold; color: #2563eb;">Ref #: ${qRefNum}</p>
                      <p style="margin: 2px 0 0 0; color: #475569;">Date: ${todayDateStr}</p>
                      <p style="margin: 2px 0 0 0; color: #059669; font-weight: bold;">Validity: 7 Days</p>
                    </td>
                  </tr>
                </table>

                <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px; border: 1px solid #cbd5e1;">
                  <thead>
                    <tr style="background: #0f172a; color: #ffffff; font-size: 11px; text-transform: uppercase;">
                      <th style="padding: 10px; border-right: 1px solid #334155; text-align: left; width: 18%;">Quantity</th>
                      <th style="padding: 10px; border-right: 1px solid #334155; text-align: left; width: 42%;">Material Description</th>
                      <th style="padding: 10px; border-right: 1px solid #334155; text-align: right; width: 20%;">Unit Rate</th>
                      <th style="padding: 10px; text-align: right; width: 20%;">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style="background: #ffffff; border-bottom: 1px solid #e2e8f0;">
                      <td style="padding: 12px 10px; border-right: 1px solid #e2e8f0; font-weight: bold; color: #1e40af;">
                        ${details.quantityTons || 30} MT
                        <span style="display: block; font-size: 10px; color: #64748b; font-weight: normal;">(${details.quantityUnits || 350} nos)</span>
                      </td>
                      <td style="padding: 12px 10px; border-right: 1px solid #e2e8f0;">
                        <div style="font-weight: bold; color: #0f172a; font-size: 13px;">${details.productType || 'Steel Material'}</div>
                        <div style="font-size: 11px; color: #475569; margin-top: 4px;">
                          Form: <strong style="color: #6b21a8;">${details.productForm || 'Coil'}</strong> | Spec: ${details.thickness || '2.0 mm'} ${details.width ? `x ${details.width}` : ''} ${details.length ? `x ${details.length}` : ''}
                        </div>
                      </td>
                      <td style="padding: 12px 10px; border-right: 1px solid #e2e8f0; text-align: right; font-weight: bold; color: #334155;">
                        ₹${unitRateStr}/MT
                      </td>
                      <td style="padding: 12px 10px; text-align: right; font-weight: 900; color: #047857; font-size: 14px;">
                        ₹${totalAmtStr}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr style="background: #f8fafc; font-weight: bold;">
                      <td style="padding: 10px; border-right: 1px solid #e2e8f0; border-top: 2px solid #cbd5e1;">Total: ${details.quantityTons || 30} MT</td>
                      <td colSpan="2" style="padding: 10px; border-right: 1px solid #e2e8f0; border-top: 2px solid #cbd5e1; text-align: right; text-transform: uppercase; color: #475569;">Subtotal Amount:</td>
                      <td style="padding: 10px; border-top: 2px solid #cbd5e1; text-align: right; color: #047857; font-size: 14px;">₹${totalAmtStr}</td>
                    </tr>
                    <tr style="background: #f1f5f9; font-weight: bold;">
                      <td colSpan="3" style="padding: 10px; border-right: 1px solid #e2e8f0; text-align: right; text-transform: uppercase; color: #475569;">GST @ 18%:</td>
                      <td style="padding: 10px; text-align: right; color: #334155;">₹${gstAmt.toLocaleString('en-IN')}</td>
                    </tr>
                    <tr style="background: #e0f2fe; font-weight: 900;">
                      <td colSpan="3" style="padding: 12px 10px; border-right: 1px solid #bae6fd; text-align: right; text-transform: uppercase; color: #0369a1; font-size: 12px;">Grand Total (Incl. GST):</td>
                      <td style="padding: 12px 10px; text-align: right; color: #0369a1; font-size: 15px;">₹${grandTotalAmt.toLocaleString('en-IN')}</td>
                    </tr>
                  </tfoot>
                </table>

                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; font-size: 11px; color: #334155;">
                  <p style="margin: 0 0 4px 0;"><strong>Payment Terms:</strong> ${details.paymentTerms || '30 Days Credit'}</p>
                  <p style="margin: 0;"><strong>Delivery Address:</strong> ${details.deliveryLocation || 'Warehouse'}</p>
                </div>

                </div>
              </div>
            </div>
          `;

          const pdfStream = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
6 0 obj << /Length 1200 >> stream
BT /F1 18 Tf 50 740 Td (ENLIGHT METALS PRIVATE LIMITED) Tj ET
BT /F2 10 Tf 50 722 Td (Authorized B2B Metal Distributor & Steel Processor) Tj ET
BT /F1 12 Tf 50 690 Td (OFFICIAL COMMERCIAL PRICE QUOTATION) Tj ET
BT /F2 10 Tf 50 670 Td (Ref #: ${qRefNum}) Tj ET
BT /F2 10 Tf 380 670 Td (Date: ${todayDateStr}) Tj ET
BT /F1 11 Tf 50 640 Td (QUOTATION TO: ${customerName}) Tj ET
BT /F2 10 Tf 50 625 Td (Email: ${customerEmail}) Tj ET

BT /F1 10 Tf 50 585 Td (QTY) Tj ET
BT /F1 10 Tf 120 585 Td (MATERIAL DESCRIPTION) Tj ET
BT /F1 10 Tf 340 585 Td (UNIT RATE) Tj ET
BT /F1 10 Tf 460 585 Td (AMOUNT (RS)) Tj ET

BT /F2 10 Tf 50 565 Td (${details.quantityTons || 30} MT) Tj ET
BT /F1 10 Tf 120 565 Td (${details.productType || 'Steel Material'}) Tj ET
BT /F2 9 Tf 120 550 Td (Form: ${details.productForm || 'Coil'} | Spec: ${details.thickness || '2.0 mm'} ${details.width ? 'x ' + details.width : ''}) Tj ET
BT /F2 10 Tf 340 565 Td (Rs. ${unitRateStr} / MT) Tj ET
BT /F1 10 Tf 460 565 Td (Rs. ${totalAmtStr}) Tj ET

BT /F2 10 Tf 300 510 Td (Subtotal Amount:) Tj ET
BT /F2 10 Tf 460 510 Td (Rs. ${totalAmtStr}) Tj ET
BT /F2 10 Tf 300 490 Td (GST @ 18%:) Tj ET
BT /F2 10 Tf 460 490 Td (Rs. ${gstAmt.toLocaleString('en-IN')}) Tj ET
BT /F1 11 Tf 300 465 Td (Grand Total:) Tj ET
BT /F1 11 Tf 460 465 Td (Rs. ${grandTotalAmt.toLocaleString('en-IN')}) Tj ET

BT /F1 10 Tf 50 420 Td (COMMERCIAL TERMS & CONDITIONS) Tj ET
BT /F2 10 Tf 50 400 Td (Payment Terms: ${details.paymentTerms || '30 Days Credit'}) Tj ET
BT /F2 10 Tf 50 380 Td (Delivery Location: ${details.deliveryLocation || 'Warehouse'}) Tj ET
BT /F2 10 Tf 50 360 Td (Validity: 7 Days from date of issuance) Tj ET

BT /F2 9 Tf 150 300 Td (This is an officially generated commercial price quotation document.) Tj ET
endstream endobj
xref
0 7
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000252 00000 n 
0000000319 00000 n 
0000000381 00000 n 
trailer << /Size 7 /Root 1 0 R >>
startxref
1650
%%EOF`;

          const pdfBase64 = Buffer.from(pdfStream).toString('base64');

          const resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: `Enlight Metals <${fromEmail}>`,
              to: [customerEmail],
              subject: `Official Commercial Quotation ${qRefNum} - ${customerName}`,
              html: htmlContent,
              attachments: [
                {
                  filename: `Official_Quotation_${qRefNum}.pdf`,
                  content: pdfBase64,
                },
              ],
            }),
          });

          const resendData = await resendRes.json();
          if (resendRes.ok) {
            emailSent = true;
            emailNotice = `Live email & PDF Quotation (${qRefNum}.pdf) dispatched to ${customerEmail} via Resend!`;
          } else {
            this.logger.warn('Resend API call error:', resendData);
            emailNotice = `Resend Notice: ${resendData.message || 'Check recipient email or domain verification.'}`;
          }
        } catch (rErr: any) {
          this.logger.error('Resend fetch exception:', rErr);
          emailNotice = `Quotation logged! ${rErr.message || 'Add valid RESEND_API_KEY to send live emails.'}`;
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
    } catch (err) {
      this.logger.error('Error in sendQuotation:', err);
      throw err;
    }
  }

  async parseDocumentWithGemini(fileBase64: string, mimeType: string) {
    const apiKey =
      process.env.GEMINI_PAID_API_KEY || process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      throw new Error(
        'GEMINI_PAID_API_KEY is not configured in backend environment variables',
      );
    }
    const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

    try {
      const response = await axios.post(url, {
        contents: [
          {
            parts: [
              {
                text: `You are an expert OCR document parser for steel inquiry purchase orders. Extract fields from this document image and return ONLY a valid JSON object with no markdown formatting or codeblocks:
{
  "customer_name": "company or customer name",
  "contact_phone": "10-digit phone number if present",
  "requirement": "detailed material specification, quantity in MT, rate if present, and delivery location"
}`,
              },
              {
                inline_data: {
                  mime_type: mimeType || 'image/jpeg',
                  data: cleanBase64,
                },
              },
            ],
          },
        ],
      });

      const text =
        response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleanJsonStr = text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(cleanJsonStr);

      return {
        success: true,
        data: parsed,
      };
    } catch (err: any) {
      this.logger.error(
        'Gemini vision document extraction failed:',
        err?.response?.data || err.message,
      );
      return {
        success: false,
        error: err.message,
      };
    }
  }
}
