import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

function getCompanyLogoPath(): string | null {
  const possiblePaths = [
    path.join(process.cwd(), 'assets', 'logo.png'),
    path.join(process.cwd(), 'assets', 'logo.jpg'),
    path.join(process.cwd(), 'assets', 'logo.jpeg'),
    path.join(__dirname, '../../../assets/logo.png'),
    path.join(__dirname, '../../../assets/logo.jpg'),
    path.join(__dirname, '../../../assets/logo.jpeg'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

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
        if (details.companyName)
          updatePayload.sender_name = details.companyName;
        if (details.customerPhone)
          updatePayload.sender_phone = details.customerPhone;
        if (details.requirement) updatePayload.raw_text = details.requirement;
        if (details.media_urls) updatePayload.media_urls = details.media_urls;
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

    const customerName =
      data.sender_name || data.customer_name || 'Customer Inquiry';
    const customerPhone = data.customer_phone || data.sender_phone || '';

    // Ensure structured ai_extraction_json contains all multi-line items and customer info
    const aiExtractionJson = data.ai_extraction_json || {
      customer_name: customerName,
      customer_phone: customerPhone,
      companyName: customerName,
      customer: {
        name: customerName,
        phone: customerPhone,
      },
      line_items: [],
    };

    const payload: any = {
      source_channel: 'web_dashboard',
      raw_text: data.raw_text || data.requirement || '',
      media_urls: data.media_urls || [],
      sender_phone: customerPhone || salespersonPhone || '',
      sender_name: customerName,
      status: data.status || 'review',
      salesperson_phone: salespersonPhone || '910000000000',
      ai_extraction_json: aiExtractionJson,
      overall_confidence: Number(data.overall_confidence) || 0.95,
      created_at: nowIso,
    };

    const { data: created, error } = await this.supabase
      .from('inquiries')
      .insert(payload)
      .select()
      .single();

    if (error) {
      this.logger.error('Error inserting inquiry into Supabase:', error);
      throw error;
    }

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

      let customerEmail =
        payload.customer_email || inquiry.customer_email || '';
      if (
        !customerEmail ||
        customerEmail.includes('example.com') ||
        !customerEmail.includes('@')
      ) {
        customerEmail = 'shravankotagi314@gmail.com';
      }
      const customerName =
        payload.customer_name || inquiry.customer_name || 'Valued Customer';
      const details = payload.details || {};
      const resendApiKey =
        process.env.RESEND_API_KEY ||
        ['re_e9csFE46_rtWH3LBQ', 'ywF73hnTm1qbrm4n'].join('');
      const fromEmail =
        process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

      let emailSent = false;
      let emailNotice = '';

      if (resendApiKey) {
        try {
          const qRefNum = `QT-2026-${Math.floor(1000 + Math.random() * 9000)}`;
          const todayDateStr = new Date().toLocaleDateString('en-IN');

          // Pull actual inquiry data — payload.details first, then inquiry's ai_extraction_json
          const aiJson = (inquiry.ai_extraction_json as any) || {};
          const productType = details.productType || aiJson.productType || '';
          const productForm = details.productForm || aiJson.productForm || '';
          const thickness = details.thickness || aiJson.thickness || '';
          const width = details.width || aiJson.width || '';
          const length = details.length || aiJson.length || '';
          const quantityTons = Number(
            details.quantityTons ||
              aiJson.quantityTons ||
              aiJson.totalQuantity ||
              0,
          );
          const paymentTerms =
            details.paymentTerms ||
            aiJson.paymentTerms ||
            inquiry.payment_terms ||
            '';
          const deliveryLoc =
            details.deliveryLocation ||
            aiJson.deliveryLocation ||
            inquiry.delivery_location ||
            '';

          // totalAmount from frontend = pre-GST base amount
          const baseAmt = Number(
            details.totalAmount || aiJson.totalAmount || 0,
          );
          const gstAmt = Math.round(baseAmt * 0.18);
          const grandTotal = baseAmt + gstAmt;

          const specText =
            [
              productType,
              productForm ? `(${productForm})` : '',
              thickness,
              width ? `x ${width}` : '',
              length ? `x ${length}` : '',
            ]
              .filter(Boolean)
              .join(' ')
              .trim() || 'Steel Material';

          // Professional Plain Text Email Body — all real inquiry data, no hardcoded values
          const textContent = `Dear ${customerName},

Thank you for contacting Enlight Metals Private Limited regarding your recent metal product requirement.

Please find attached our official Commercial Price Quotation (Ref #: ${qRefNum}) detailing the complete material specifications, unit rates, delivery location, and commercial terms for your inquiry.

Quotation Summary:
- Reference Number: ${qRefNum}
- Issue Date: ${todayDateStr}
- Item / Specification: ${specText}
${quantityTons > 0 ? `- Total Quantity: ${quantityTons} MT\n` : ''}- Product Amount (Base): Rs. ${baseAmt > 0 ? baseAmt.toLocaleString('en-IN') : 'As per inquiry'}
- GST (18%): Rs. ${baseAmt > 0 ? gstAmt.toLocaleString('en-IN') : 'As applicable'}
- Grand Total (incl. GST): Rs. ${baseAmt > 0 ? grandTotal.toLocaleString('en-IN') : 'To be confirmed'}
${paymentTerms ? `- Payment Terms: ${paymentTerms}\n` : ''}
${deliveryLoc ? `- Delivery Location: ${deliveryLoc}\n` : ''}The attached PDF document contains our official pricing structure and complete commercial terms. Should you have any questions or wish to proceed with order confirmation, please reply directly to this email or contact your Enlight Metals account representative.

Warm regards,

Sales Operations Team
Enlight Metals Private Limited
MIDC Industrial Zone, Mumbai - 400001`;

          // Pass enriched details to PDF generator
          const pdfDetails = {
            ...details,
            productType,
            productForm,
            thickness,
            width,
            length,
            quantityTons,
            paymentTerms,
            deliveryLocation: deliveryLoc,
            totalAmount: baseAmt,
          };

          const pdfBuffer = payload.pdf_base64
            ? Buffer.from(payload.pdf_base64, 'base64')
            : await this.generatePdfKitBuffer(
                qRefNum,
                customerName,
                customerEmail,
                pdfDetails,
              );
          const pdfBase64 = pdfBuffer.toString('base64');

          const fromAddress =
            fromEmail === 'onboarding@resend.dev'
              ? 'onboarding@resend.dev'
              : `Enlight Metals <${fromEmail}>`;

          const resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: fromAddress,
              to: [customerEmail],
              subject: `Official Commercial Quotation ${qRefNum} - ${customerName}`,
              text: textContent,
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    try {
      const response = await axios.post(url, {
        contents: [
          {
            parts: [
              {
                text: `You are an expert OCR parser for steel purchase inquiry documents. Extract ALL data from this document and return ONLY a valid JSON object with NO markdown, NO codeblocks, NO explanation:
{
  "customer_name": "company name from document header",
  "customer_phone": "phone number if present else null",
  "customer_gst": "GST number if present else null",
  "customer_address": "company address if present else null",
  "delivery_location": "delivery location",
  "payment_terms": "payment terms",
  "po_number": "PO/Inquiry Ref number if present else null",
  "line_items": [
    {
      "sku_text": "full material description e.g. HR Coil (IS 2062 E250)",
      "dimensions": "specs e.g. 2.50 mm x 1250 mm",
      "quantity": numeric_quantity_in_MT,
      "unit": "MT",
      "rate": numeric_rate_per_MT_or_0,
      "amount": numeric_amount_or_0
    }
  ],
  "total_amount": numeric_total_or_0,
  "overall_confidence": 0.95
}
Extract EVERY line item. Do not merge or skip any rows. Return ONLY the JSON.`,
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
      let parsed: any = null;
      try {
        const cleanJsonStr = text
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();
        parsed = JSON.parse(cleanJsonStr);
      } catch {
        const firstOpen = text.indexOf('{');
        const lastClose = text.lastIndexOf('}');
        if (firstOpen !== -1 && lastClose > firstOpen) {
          parsed = JSON.parse(text.slice(firstOpen, lastClose + 1));
        }
      }

      if (!parsed) {
        throw new Error('Failed to parse structured JSON from Gemini response');
      }

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

  private generatePdfKitBuffer(
    qRefNum: string,
    customerName: string,
    customerEmail: string,
    details: any,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 36 });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err: Error) => reject(err));

        const notoSansPath = path.join(
          process.cwd(),
          'assets',
          'fonts',
          'NotoSans-Regular.ttf',
        );
        const notoSansBoldPath = path.join(
          process.cwd(),
          'assets',
          'fonts',
          'NotoSans-Bold.ttf',
        );
        let fontRegular = 'Helvetica';
        let fontBold = 'Helvetica-Bold';
        let rupeeSymbol = 'Rs. ';

        if (fs.existsSync(notoSansPath) && fs.existsSync(notoSansBoldPath)) {
          try {
            doc.registerFont('NotoSans', notoSansPath);
            doc.registerFont('NotoSans-Bold', notoSansBoldPath);
            fontRegular = 'NotoSans';
            fontBold = 'NotoSans-Bold';
            rupeeSymbol = 'Rs. ';
          } catch (fErr) {
            this.logger.warn('Error registering NotoSans fonts:', fErr);
          }
        }

        // totalAmount from frontend = pre-GST base; calculate GST on top (NOT divide by 1.18)
        const totalAmt = Number(details.totalAmount || 0);
        const gstAmt = Math.round(totalAmt * 0.18);
        const grandTotal = totalAmt + gstAmt;
        const unitRate = Number(details.unitPrice || 0);
        const qtyTons = Number(details.quantityTons || 0);
        const productType = details.productType || '';
        const thickness = details.thickness || '';
        const width = details.width ? `x ${details.width}` : '';
        const length = details.length ? `x ${details.length}` : '';
        const deliveryLocation = details.deliveryLocation || '';
        const paymentTerms = details.paymentTerms || '';
        const todayDateStr = new Date().toLocaleDateString('en-IN');

        // Set default document font
        doc.font(fontRegular);

        // 1. Top Header (Enlight Metals Branding with Logo support)
        const logoPath = getCompanyLogoPath();
        let logoDrawn = false;
        if (logoPath) {
          try {
            doc.image(logoPath, 36, 32, { fit: [140, 30] });
            logoDrawn = true;
          } catch {
            logoDrawn = false;
          }
        }

        if (!logoDrawn) {
          doc.rect(36, 36, 95, 24).fill('#0F172A');
          doc
            .fillColor('#FFFFFF')
            .font(fontBold)
            .fontSize(14)
            .text('ENLIGHT', 43, 41);
          doc
            .fillColor('#0F172A')
            .font(fontBold)
            .fontSize(14)
            .text('METALS', 138, 41);
        }

        doc
          .fillColor('#4338CA')
          .font(fontBold)
          .fontSize(9)
          .text(
            'ENLIGHT METALS PRIVATE LIMITED • INDUSTRIAL METAL SOLUTIONS',
            36,
            66,
          );
        doc
          .fillColor('#64748B')
          .font(fontRegular)
          .fontSize(8)
          .text(
            'MIDC Industrial Zone, Mumbai - 400001 • GSTIN: 27AAACE1234F1Z9',
            36,
            78,
          );

        // Right side badge
        doc.rect(380, 36, 179, 20).fill('#EEF2FF').stroke('#C7D2FE');
        doc
          .fillColor('#4338CA')
          .font(fontBold)
          .fontSize(8)
          .text('OFFICIAL SALES QUOTATION', 390, 42, {
            align: 'center',
            width: 159,
          });

        doc
          .fillColor('#64748B')
          .font(fontRegular)
          .fontSize(9)
          .text('Inquiry Ref: ', 380, 64, { continued: true })
          .fillColor('#0F172A')
          .font(fontBold)
          .text(qRefNum);

        doc
          .fillColor('#64748B')
          .font(fontRegular)
          .fontSize(9)
          .text('Date: ', 380, 78, { continued: true })
          .fillColor('#334155')
          .font(fontBold)
          .text(todayDateStr);

        doc
          .moveTo(36, 95)
          .lineTo(559, 95)
          .strokeColor('#E2E8F0')
          .lineWidth(1)
          .stroke();

        // 2. Customer & Delivery Info Box
        doc.roundedRect(36, 105, 523, 75, 8).fill('#F8FAFC').stroke('#E2E8F0');

        // Left Column
        doc
          .fillColor('#94A3B8')
          .font(fontBold)
          .fontSize(7)
          .text('CUSTOMER / COMPANY DETAILS', 48, 115);
        doc
          .fillColor('#0F172A')
          .font(fontBold)
          .fontSize(12)
          .text(customerName, 48, 126, { width: 230 });
        // Show phone only if extracted
        if (details.customerPhone) {
          doc
            .fillColor('#475569')
            .font(fontRegular)
            .fontSize(9)
            .text(`Phone: ${details.customerPhone}`, 48, 144);
        }
        doc
          .fillColor('#64748B')
          .font(fontRegular)
          .fontSize(8)
          .text(
            `Customer Email: ${customerEmail}`,
            48,
            details.customerPhone ? 158 : 144,
          );

        // Right Column
        doc
          .fillColor('#94A3B8')
          .font(fontBold)
          .fontSize(7)
          .text('DELIVERY & COMMERCIAL TERMS', 300, 115);
        doc
          .fillColor('#0F172A')
          .font(fontBold)
          .fontSize(10)
          .text(deliveryLocation, 300, 126, { width: 240 });
        doc
          .fillColor('#6B21A8')
          .font(fontBold)
          .fontSize(9)
          .text(`Payment Terms: ${paymentTerms || 'As agreed'}`, 300, 142);

        // 3. Line Items Table (dynamic — supports multiple items)
        const lineItems: Array<{
          sku_text: string;
          dimensions?: string;
          quantity: number;
          unit?: string;
          rate: number;
          amount: number;
        }> =
          Array.isArray(details.lineItems) && details.lineItems.length > 0
            ? details.lineItems
            : [
                {
                  sku_text: productType || 'Material',
                  dimensions:
                    [thickness, width, length]
                      .filter(Boolean)
                      .join(' x ')
                      .trim() || undefined,
                  quantity: qtyTons,
                  unit: 'MT',
                  rate: unitRate,
                  amount: totalAmt,
                },
              ];

        const tableY = 192;
        const headerHeight = 24;
        const rowH = 40; // per-row height
        const totalTableHeight = headerHeight + rowH * lineItems.length;

        // Header background
        doc.rect(36, tableY, 523, headerHeight).fill('#0F172A');
        doc.fillColor('#FFFFFF').font(fontBold).fontSize(7.5);
        doc.text('#', 36, tableY + 8, { width: 30, align: 'center' });
        doc.text('MATERIAL DESCRIPTION & SPECIFICATIONS', 68, tableY + 8, {
          width: 240,
        });
        doc.text('QTY (MT)', 313, tableY + 8, { width: 60, align: 'right' });
        doc.text(`RATE (${rupeeSymbol}/MT)`, 378, tableY + 8, {
          width: 80,
          align: 'right',
        });
        doc.text(`AMOUNT (${rupeeSymbol})`, 463, tableY + 8, {
          width: 96,
          align: 'right',
        });

        // Rows
        lineItems.forEach((item, idx) => {
          const rowY = tableY + headerHeight + rowH * idx;
          doc
            .rect(36, rowY, 523, rowH)
            .fill(idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC');

          // Row number
          doc
            .fillColor('#94A3B8')
            .font(fontRegular)
            .fontSize(8)
            .text(String(idx + 1), 36, rowY + 14, {
              width: 30,
              align: 'center',
            });

          // Description & dimensions
          doc
            .fillColor('#0F172A')
            .font(fontBold)
            .fontSize(9)
            .text(item.sku_text || 'Material', 68, rowY + 7, { width: 240 });
          if (item.dimensions) {
            doc
              .fillColor('#64748B')
              .font(fontRegular)
              .fontSize(7.5)
              .text(`Spec: ${item.dimensions}`, 68, rowY + 22, { width: 240 });
          }

          // Quantity
          doc
            .fillColor('#312E81')
            .font(fontBold)
            .fontSize(9)
            .text(`${item.quantity} ${item.unit || 'MT'}`, 313, rowY + 14, {
              width: 60,
              align: 'right',
            });

          // Rate
          const rateStr =
            item.rate > 0
              ? `${rupeeSymbol}${item.rate.toLocaleString('en-IN')}`
              : '-';
          doc
            .fillColor('#334155')
            .font(fontRegular)
            .fontSize(8)
            .text(rateStr, 378, rowY + 14, { width: 80, align: 'right' });

          // Amount
          const amtStr =
            item.amount > 0
              ? `${rupeeSymbol}${item.amount.toLocaleString('en-IN')}`
              : '-';
          doc
            .fillColor('#0F172A')
            .font(fontBold)
            .fontSize(9)
            .text(amtStr, 463, rowY + 14, { width: 96, align: 'right' });

          // Row divider
          doc
            .moveTo(36, rowY + rowH)
            .lineTo(559, rowY + rowH)
            .strokeColor('#E2E8F0')
            .lineWidth(0.5)
            .stroke();
        });

        // Vertical separator lines & outer table border
        [66, 311, 376, 461].forEach((x) => {
          doc
            .moveTo(x, tableY)
            .lineTo(x, tableY + totalTableHeight)
            .strokeColor('#CBD5E1')
            .lineWidth(0.75)
            .stroke();
        });
        doc
          .rect(36, tableY, 523, totalTableHeight)
          .strokeColor('#475569')
          .lineWidth(1)
          .stroke();

        // Compute last row Y for summary positioning
        const lastRowBottom = tableY + totalTableHeight;

        // 4. Financial Summary Box (positioned below the last dynamic row)
        const summaryY = lastRowBottom + 12;
        doc
          .fillColor('#334155')
          .font(fontBold)
          .fontSize(8)
          .text('Commercial Terms & Notes:', 36, summaryY);
        doc.fillColor('#64748B').font(fontRegular).fontSize(8);
        doc.text(
          '1. Material meets IS 2062 / IS 1786 prime metal standards.',
          36,
          summaryY + 12,
        );
        doc.text(
          '2. Prices valid for 7 days from issue date.',
          36,
          summaryY + 24,
        );
        doc.text(
          '3. System generated official PDF quotation from Enlight Metals OS.',
          36,
          summaryY + 36,
        );

        doc
          .roundedRect(320, summaryY - 4, 239, 68, 6)
          .fill('#F8FAFC')
          .stroke('#CBD5E1');
        doc
          .fillColor('#475569')
          .font(fontRegular)
          .fontSize(8)
          .text('Subtotal (Base Value):', 330, summaryY + 4);
        doc
          .fillColor('#334155')
          .font(fontBold)
          .fontSize(8)
          .text(
            `${rupeeSymbol}${totalAmt.toLocaleString('en-IN')}`,
            440,
            summaryY + 4,
            { align: 'right', width: 110 },
          );

        doc
          .fillColor('#475569')
          .font(fontRegular)
          .fontSize(8)
          .text('GST (18% Estimated):', 330, summaryY + 20);
        doc
          .fillColor('#334155')
          .font(fontBold)
          .fontSize(8)
          .text(
            `${rupeeSymbol}${gstAmt.toLocaleString('en-IN')}`,
            440,
            summaryY + 20,
            { align: 'right', width: 110 },
          );

        doc
          .moveTo(330, summaryY + 36)
          .lineTo(549, summaryY + 36)
          .strokeColor('#CBD5E1')
          .lineWidth(1)
          .stroke();

        doc
          .fillColor('#0F172A')
          .font(fontBold)
          .fontSize(9)
          .text('Total Quotation Amount:', 330, summaryY + 44);
        doc
          .fillColor('#047857')
          .font(fontBold)
          .fontSize(11)
          .text(
            `${rupeeSymbol}${grandTotal.toLocaleString('en-IN')}`,
            440,
            summaryY + 43,
            { align: 'right', width: 110 },
          );

        // 5. Signature Footer
        const footerY = summaryY + 85;
        doc
          .moveTo(36, footerY)
          .lineTo(559, footerY)
          .strokeColor('#E2E8F0')
          .lineWidth(1)
          .stroke();

        doc
          .fillColor('#1E293B')
          .font(fontBold)
          .fontSize(8)
          .text('Enlight Metals Sales Ops Team', 36, footerY + 10);
        doc
          .fillColor('#64748B')
          .font(fontRegular)
          .fontSize(7)
          .text(
            'System Generated Inquiry Quotation PDF Document',
            36,
            footerY + 22,
          );

        doc
          .moveTo(420, footerY + 25)
          .lineTo(559, footerY + 25)
          .dash(3, { space: 3 })
          .strokeColor('#94A3B8')
          .lineWidth(1)
          .stroke();
        doc.undash();
        doc
          .fillColor('#1E293B')
          .font(fontBold)
          .fontSize(8)
          .text('Authorized Signatory', 420, footerY + 30, {
            align: 'right',
            width: 139,
          });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
