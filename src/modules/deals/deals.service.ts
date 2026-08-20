import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { phoneInList } from '../employees/employees.service';

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(private supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async findAll(filters?: {
    stage?: string;
    salesperson_phone?: string;
    from?: string;
    to?: string;
  }) {
    try {
      let query = this.supabase
        .from('deals')
        .select(
          `
          *,
          deal_items (*)
        `,
        )
        .order('created_at', { ascending: false });

      if (filters?.stage) {
        if (filters.stage === 'new_inquiry') {
          query = query.or(
            'stage.eq.new_inquiry,stage.eq.review,stage.is.null',
          );
        } else {
          query = query.eq('stage', filters.stage);
        }
      }

      if (filters?.salesperson_phone) {
        const cleanDigits = filters.salesperson_phone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;
        query = query.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12}`,
        );
      }
      if (filters?.from) {
        const fromIso = filters.from.includes('T')
          ? filters.from
          : `${filters.from}T00:00:00.000Z`;
        const fromDateOnly = filters.from.split('T')[0];
        query = query.or(
          `won_at.gte.${fromIso},created_at.gte.${fromIso},po_date.gte.${fromDateOnly}`,
        );
      }
      if (filters?.to) {
        const toEnd = filters.to.includes('T')
          ? filters.to
          : `${filters.to}T23:59:59.999Z`;
        const toDateOnly = filters.to.split('T')[0];
        query = query.or(
          `won_at.lte.${toEnd},created_at.lte.${toEnd},po_date.lte.${toDateOnly}`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;

      const lightweightDeals = (data || []).map((d: any) => {
        const hasMedia = Boolean(
          d.inquiry_id ||
            d.po_number ||
            (Array.isArray(d.media_urls) && d.media_urls.length > 0),
        );
        return {
          ...d,
          has_media: hasMedia,
          media_urls: hasMedia ? ['attached_document'] : [],
        };
      });

      return lightweightDeals;
    } catch (error) {
      this.logger.error('Error in findAll:', error);
      throw error;
    }
  }

  async findOne(id: string, accessiblePhones?: string[] | null) {
    try {
      const { data, error } = await this.supabase
        .from('deals')
        .select('*, deal_items(*)')
        .eq('id', id)
        .single();
      if (error || !data) {
        throw new NotFoundException('Deal not found');
      }

      if (accessiblePhones && accessiblePhones.length > 0) {
        if (
          !data.salesperson_phone ||
          !phoneInList(data.salesperson_phone, accessiblePhones)
        ) {
          throw new ForbiddenException(
            'Access Denied: You do not have permission to view this deal.',
          );
        }
      }

      // Enrich with media_urls from inquiries if available
      if (data) {
        if (data.inquiry_id) {
          const { data: inq } = await this.supabase
            .from('inquiries')
            .select('media_urls')
            .eq('id', data.inquiry_id)
            .limit(1)
            .single();
          if (inq && inq.media_urls) {
            data.media_urls = inq.media_urls;
          }
        }

        const hasValidMedia =
          Array.isArray(data.media_urls) &&
          data.media_urls.length > 0 &&
          data.media_urls.some(
            (u: any) =>
              typeof u === 'string' &&
              (u.startsWith('data:') || u.startsWith('http')),
          );

        if (!hasValidMedia) {
          const { data: allMediaInqs } = await this.supabase
            .from('inquiries')
            .select(
              'id, sender_name, media_urls, raw_text, ai_extraction_json, created_at',
            )
            .not('media_urls', 'is', null)
            .order('created_at', { ascending: false })
            .limit(100);

          const dName = (data.customer_name || '').toLowerCase().trim();
          const dPo = (data.po_number || '').toLowerCase().trim();
          const dClean = dName.replace(/[^a-z0-9]/g, ' ');
          const dWords = dClean
            .split(/\s+/)
            .filter(
              (w) =>
                w.length >= 3 &&
                ![
                  'pvt',
                  'ltd',
                  'private',
                  'limited',
                  'enterprises',
                  'steels',
                  'steel',
                ].includes(w),
            );

          const matched = (allMediaInqs || []).find((mi: any) => {
            if (!Array.isArray(mi.media_urls) || mi.media_urls.length === 0)
              return false;
            const sName = (mi.sender_name || '').toLowerCase().trim();
            const custJsonName = (
              mi.ai_extraction_json?.customer?.name ||
              mi.ai_extraction_json?.companyName ||
              ''
            )
              .toLowerCase()
              .trim();
            const rawTxt = (mi.raw_text || '').toLowerCase();
            const poJson = (mi.ai_extraction_json?.po_number || '')
              .toLowerCase()
              .trim();

            if (dPo && poJson && (poJson.includes(dPo) || dPo.includes(poJson)))
              return true;
            if (dPo && rawTxt && rawTxt.includes(dPo)) return true;
            if (
              custJsonName &&
              (custJsonName.includes(dName) || dName.includes(custJsonName))
            )
              return true;
            if (sName && (sName.includes(dName) || dName.includes(sName)))
              return true;
            if (dWords.length > 0 && dWords.some((w) => rawTxt.includes(w)))
              return true;

            return false;
          });

          if (matched && matched.media_urls) {
            data.media_urls = matched.media_urls;
          }
        }
      }

      // Enrich with actual customer phone from recurring_customers
      // (deals.customer_phone stores salesperson phone, not customer phone)
      if (data && data.customer_name) {
        const { data: custData } = await this.supabase
          .from('recurring_customers')
          .select('customer_phone, customer_gst, contact_person')
          .ilike('customer_name', `%${data.customer_name}%`)
          .limit(1)
          .single();
        if (custData) {
          data.customer_phone = custData.customer_phone;
          data.customer_gst = data.customer_gst || custData.customer_gst;
          data.contact_person = custData.contact_person;
        }
      }

      return data;
    } catch (error) {
      this.logger.error(`Error in findOne for id ${id}:`, error);
      throw error;
    }
  }

  async updateStage(
    id: string,
    stage: string,
    lostReason?: string,
    accessiblePhones?: string[] | null,
  ) {
    try {
      const { data: existingDeal, error: fetchErr } = await this.supabase
        .from('deals')
        .select('id, salesperson_phone')
        .eq('id', id)
        .single();
      if (fetchErr || !existingDeal) {
        throw new NotFoundException('Deal not found');
      }

      if (accessiblePhones && accessiblePhones.length > 0) {
        if (
          !existingDeal.salesperson_phone ||
          !phoneInList(existingDeal.salesperson_phone, accessiblePhones)
        ) {
          throw new ForbiddenException(
            'Access Denied: You do not have permission to update this deal.',
          );
        }
      }

      const updateData: any = { stage };
      if (stage === 'lost' && lostReason) {
        updateData.lost_reason = lostReason;
      }
      if (stage === 'won') {
        updateData.won_at = new Date().toISOString();
      } else {
        updateData.won_at = null;
      }
      const { data, error } = await this.supabase
        .from('deals')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      // Automatically create or update payment tracking record when a deal is marked WON
      if (stage === 'won' && data) {
        const wonDate = data.won_at ? new Date(data.won_at) : new Date();
        const dueDate = new Date(wonDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        const dueDateStr = dueDate.toISOString().split('T')[0];

        // Try to find matching payment record by deal_id first, then by customer_name
        let existingRecord = null;
        const { data: byDeal } = await this.supabase
          .from('payment_tracking')
          .select('id')
          .eq('deal_id', data.id)
          .limit(1);

        if (byDeal && byDeal.length > 0) {
          existingRecord = byDeal[0];
        } else {
          const { data: byCust } = await this.supabase
            .from('payment_tracking')
            .select('id')
            .ilike('customer_name', `%${data.customer_name}%`)
            .limit(1);
          if (byCust && byCust.length > 0) {
            existingRecord = byCust[0];
          }
        }

        if (existingRecord) {
          await this.supabase
            .from('payment_tracking')
            .update({
              total_deal_amount: data.total_amount || 0,
              pending_amount: data.total_amount || 0,
              due_date: dueDateStr,
              deal_id: data.id,
              salesperson_phone: data.salesperson_phone || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingRecord.id);
        } else {
          await this.supabase.from('payment_tracking').insert({
            deal_id: data.id,
            customer_name: data.customer_name,
            total_deal_amount: data.total_amount || 0,
            paid_amount: 0,
            pending_amount: data.total_amount || 0,
            status: 'pending',
            due_date: dueDateStr,
            salesperson_phone: data.salesperson_phone || null,
            created_at: new Date().toISOString(),
          });
        }
      }

      // Trigger background sync to Zoho Bigin so Web App updates reflect in Bigin immediately
      const botUrl =
        process.env.BOT_SERVICE_URL ||
        'https://enlight-sales-bot-production.up.railway.app';
      fetch(`${botUrl}/webhook/admin/bigin-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: 'enlight_admin_2024' }),
      }).catch((err) =>
        this.logger.error('Bigin auto-sync notice:', err.message),
      );

      return data;
    } catch (error) {
      this.logger.error(`Error in updateStage for id ${id}:`, error);
      throw error;
    }
  }

  async getPipelineSummary() {
    try {
      const stages = [
        'new_inquiry',
        'qualified',
        'quoted',
        'negotiation',
        'won',
        'lost',
      ];

      const { data, error } = await this.supabase
        .from('deals')
        .select('stage, total_amount, id');

      if (error) throw error;

      const summary = stages.map((stage) => {
        const stageDeals = (data || []).filter((d: any) =>
          stage === 'new_inquiry'
            ? d.stage === 'new_inquiry' || d.stage === 'review' || !d.stage
            : d.stage === stage,
        );
        return {
          stage,
          count: stageDeals.length || 0,
          total_value:
            stageDeals.reduce(
              (sum: number, d: any) => sum + (d.total_amount || 0),
              0,
            ) || 0,
        };
      });

      return summary;
    } catch (error) {
      this.logger.error('Error in getPipelineSummary:', error);
      throw error;
    }
  }

  async createOrder(data: any, salespersonPhone?: string) {
    try {
      const wonAt = data.won_at || new Date().toISOString();
      const insertPayload: any = {
        customer_name: data.customer_name,
        stage: 'won',
        inquiry_type: 'purchase_order',
        po_number: data.po_number || null,
        po_date: data.po_date || null,
        total_amount: Number(data.total_amount || 0),
        won_at: wonAt,
        delivery_location: data.delivery_location || null,
        delivery_date: data.delivery_date || null,
        payment_terms: data.payment_terms || null,
        notes: data.notes || null,
        created_at: new Date().toISOString(),
      };

      if (salespersonPhone) {
        insertPayload.salesperson_phone = salespersonPhone;
      }
      insertPayload.customer_phone = data.customer_phone || null;

      const { data: deal, error: dealError } = await this.supabase
        .from('deals')
        .insert(insertPayload)
        .select()
        .single();

      if (dealError) throw dealError;

      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        const itemRows = data.items.map((item: any) => ({
          deal_id: deal.id,
          sku_text: item.sku_text,
          dimensions: item.dimensions || null,
          quantity: Number(item.quantity || 0),
          unit: item.unit || 'MT',
          rate: Number(item.rate || 0),
          amount: Number(item.amount || item.quantity * item.rate || 0),
          created_at: new Date().toISOString(),
        }));

        const { error: itemsError } = await this.supabase
          .from('deal_items')
          .insert(itemRows);

        if (itemsError) {
          this.logger.error('Error inserting deal items:', itemsError);
        }
      }

      return deal;
    } catch (error) {
      this.logger.error('Error in createOrder:', error);
      throw error;
    }
  }

  async getKanbanBoard() {
    try {
      const { data, error } = await this.supabase
        .from('deals')
        .select('*, deal_items(*)')
        .not('stage', 'in', '("won","lost")')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const stages = ['new_inquiry', 'qualified', 'quoted', 'negotiation'];

      const board = stages.reduce(
        (acc, stage) => {
          acc[stage] =
            data?.filter((d) =>
              stage === 'new_inquiry'
                ? d.stage === 'new_inquiry' || d.stage === 'review' || !d.stage
                : d.stage === stage,
            ) || [];
          return acc;
        },
        {} as Record<string, any[]>,
      );

      return board;
    } catch (error) {
      this.logger.error('Error in getKanbanBoard:', error);
      throw error;
    }
  }

  async processPo(data: any, salespersonPhone?: string) {
    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const todayStr = nowIso.slice(0, 10).replace(/-/g, '');
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      const poNumber = data.po_number?.trim() || `PO-${todayStr}-${randomNum}`;
      const poDate = data.po_date || nowIso.split('T')[0];

      const customerName = data.customer_name?.trim() || null;
      const customerPhone = data.customer_phone || null;
      const phone =
        salespersonPhone || data.salesperson_phone || '910000000000';

      const lineItems = data.line_items || data.items || [];
      let totalAmount = Number(data.total_amount) || 0;
      if (
        totalAmount <= 0 &&
        Array.isArray(lineItems) &&
        lineItems.length > 0
      ) {
        totalAmount = lineItems.reduce(
          (sum: number, item: any) =>
            sum +
            (Number(item.amount) ||
              Math.round(Number(item.quantity || 0) * Number(item.rate || 0))),
          0,
        );
      }

      const deliveryLocation = data.delivery_location || '';
      const paymentTerms = data.payment_terms || '';

      // 1. If media_urls are provided without inquiry_id, save attachment in inquiries table so it's permanently stored & viewable
      let inquiryId = data.inquiry_id || null;
      if (
        !inquiryId &&
        Array.isArray(data.media_urls) &&
        data.media_urls.length > 0
      ) {
        try {
          const { data: newInq } = await this.supabase
            .from('inquiries')
            .insert({
              source_channel: 'purchase_order',
              raw_text: `[PO Document Attached: ${poNumber}] ${customerName} - Original PO Document`,
              media_urls: data.media_urls,
              customer_name: customerName,
              customer_phone: customerPhone,
              salesperson_phone: phone,
              status: 'confirmed',
              inquiry_type: 'purchase_order',
              created_at: nowIso,
            })
            .select()
            .single();
          if (newInq) {
            inquiryId = newInq.id;
          }
        } catch (inqErr: any) {
          this.logger.warn(
            'Non-blocking inquiry media save notice:',
            inqErr?.message,
          );
        }
      }

      // 2. Try to find existing deal to update
      let dealId = data.deal_id || null;
      let existingDeal: any = null;

      if (dealId) {
        const { data: d } = await this.supabase
          .from('deals')
          .select('*')
          .eq('id', dealId)
          .single();
        if (d) existingDeal = d;
      } else if (inquiryId) {
        const { data: d } = await this.supabase
          .from('deals')
          .select('*')
          .eq('inquiry_id', inquiryId)
          .limit(1);
        if (d && d.length > 0) {
          existingDeal = d[0];
          dealId = existingDeal.id;
        }
      } else if (customerName) {
        // Find most recent active deal in pipeline for this customer
        const { data: d } = await this.supabase
          .from('deals')
          .select('*')
          .ilike('customer_name', customerName)
          .not('stage', 'in', '("won","lost")')
          .order('created_at', { ascending: false })
          .limit(1);
        if (d && d.length > 0) {
          existingDeal = d[0];
          dealId = existingDeal.id;
        }
      }

      let savedDeal: any;

      if (existingDeal) {
        // Update existing deal with new negotiated PO figures & mark WON
        const { data: updated, error: updErr } = await this.supabase
          .from('deals')
          .update({
            inquiry_id: inquiryId || existingDeal.inquiry_id,
            stage: 'won',
            won_at: nowIso,
            po_number: poNumber,
            po_date: poDate,
            total_amount: totalAmount,
            delivery_location:
              deliveryLocation || existingDeal.delivery_location,
            payment_terms: paymentTerms || existingDeal.payment_terms,
            inquiry_type: 'purchase_order',
            status: 'auto_created',
            updated_at: nowIso,
          })
          .eq('id', dealId)
          .select()
          .single();

        if (updErr) throw updErr;
        savedDeal = updated;
      } else {
        // Create brand new Won Deal
        const { data: created, error: createErr } = await this.supabase
          .from('deals')
          .insert({
            inquiry_id: inquiryId || null,
            customer_name: customerName,
            salesperson_phone: phone,
            customer_phone: customerPhone,
            stage: 'won',
            won_at: nowIso,
            po_number: poNumber,
            po_date: poDate,
            total_amount: totalAmount,
            delivery_location: deliveryLocation,
            payment_terms: paymentTerms,
            inquiry_type: 'purchase_order',
            status: 'auto_created',
            overall_confidence: Number(data.overall_confidence) || 0.98,
            created_at: nowIso,
          })
          .select()
          .single();

        if (createErr) throw createErr;
        savedDeal = created;
        dealId = savedDeal.id;
      }

      // 2. Replace / Update line items with exact PO values
      if (Array.isArray(lineItems) && lineItems.length > 0) {
        await this.supabase.from('deal_items').delete().eq('deal_id', dealId);

        const dealItemsToInsert = lineItems.map((item: any) => ({
          deal_id: dealId,
          sku_text:
            item.sku_text || item.product_name || item.description || null,
          dimensions: item.dimensions || null,
          quantity: Number(item.quantity) || null,
          unit: item.unit || 'MT',
          rate: Number(item.rate) || null,
          amount:
            Number(item.amount) ||
            (Number(item.quantity) && Number(item.rate)
              ? Number(item.quantity) * Number(item.rate)
              : null),
          confidence: Number(item.confidence) || 0.98,
          created_at: nowIso,
        }));

        await this.supabase.from('deal_items').insert(dealItemsToInsert);
      }

      // 3. If linked to an inquiry, update the inquiry status
      if (savedDeal.inquiry_id) {
        await this.supabase
          .from('inquiries')
          .update({ status: 'confirmed' })
          .eq('id', savedDeal.inquiry_id);
      }

      // 4. Automatically create / update Payment Tracking record
      try {
        let creditDays = 30;
        const termsStr = String(paymentTerms).toLowerCase();
        const daysMatch = termsStr.match(/(\d+)\s*(?:days|day)/);
        if (daysMatch) {
          creditDays = parseInt(daysMatch[1], 10);
        } else if (
          termsStr.includes('advance') ||
          termsStr.includes('immediate') ||
          termsStr.includes('cash')
        ) {
          creditDays = 0;
        }

        const poDateTime = new Date(poDate).getTime() || now.getTime();
        const dueDate = new Date(poDateTime + creditDays * 24 * 60 * 60 * 1000);
        const dueDateStr = dueDate.toISOString().split('T')[0];

        const { data: existingPay } = await this.supabase
          .from('payment_tracking')
          .select('id')
          .eq('deal_id', dealId)
          .limit(1);

        if (existingPay && existingPay.length > 0) {
          await this.supabase
            .from('payment_tracking')
            .update({
              invoice_amount: totalAmount,
              outstanding: totalAmount,
              due_date: dueDateStr,
              credit_period_days: creditDays,
              customer_name: customerName,
              salesperson_phone: phone,
              updated_at: nowIso,
            })
            .eq('id', existingPay[0].id);
        } else {
          await this.supabase.from('payment_tracking').insert({
            deal_id: dealId,
            salesperson_phone: phone,
            customer_name: customerName,
            invoice_amount: totalAmount,
            outstanding: totalAmount,
            status: 'pending',
            due_date: dueDateStr,
            credit_period_days: creditDays,
            created_at: nowIso,
          });
        }
      } catch (payErr: any) {
        this.logger.warn(
          'Non-blocking payment tracking notice:',
          payErr?.message,
        );
      }

      // 5. Log to kra_logs for KRA 1 (Final Sales Achievement with exact PO Value)
      try {
        await this.supabase.from('kra_logs').insert({
          kra_number: 1,
          kra_type: 'order_created',
          description: `PO Received: ${poNumber} - ${customerName} (₹${totalAmount.toLocaleString('en-IN')}) - Deal Won 🎉`,
          salesperson_phone: phone,
          customer_name: customerName,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          created_at: nowIso,
        });
      } catch (kraErr: any) {
        this.logger.warn('Non-blocking KRA log notice:', kraErr?.message);
      }

      // 6. Automatically resolve any open follow-up tasks for this customer & update last_order_date
      try {
        await this.supabase
          .from('followup_tasks')
          .update({
            status: 'resolved',
            resolved_at: nowIso,
            resolution_notes: `Order placed: PO #${poNumber} (₹${totalAmount.toLocaleString('en-IN')}) 🎉`,
          })
          .ilike('customer_name', `%${customerName}%`)
          .eq('status', 'pending');

        await this.supabase
          .from('recurring_customers')
          .update({
            last_order_date: poDate || nowIso.split('T')[0],
            updated_at: nowIso,
          })
          .ilike('customer_name', `%${customerName}%`);
      } catch (fErr: any) {
        this.logger.warn(
          'Non-blocking follow-up resolution notice:',
          fErr?.message,
        );
      }

      return savedDeal;
    } catch (error) {
      this.logger.error('Error in processPo:', error);
      throw error;
    }
  }

  async deleteDeal(id: string, accessiblePhones?: string[] | null) {
    try {
      this.logger.log(`Deleting deal ${id} and all associated records...`);

      // 1. Fetch deal to inspect details and check access
      const { data: deal, error: fetchErr } = await this.supabase
        .from('deals')
        .select('id, inquiry_id, po_number, customer_name, salesperson_phone')
        .eq('id', id)
        .single();
      if (fetchErr || !deal) {
        throw new NotFoundException('Deal not found');
      }

      if (accessiblePhones && accessiblePhones.length > 0) {
        if (
          !deal.salesperson_phone ||
          !phoneInList(deal.salesperson_phone, accessiblePhones)
        ) {
          throw new ForbiddenException(
            'Access Denied: You do not have permission to delete this deal.',
          );
        }
      }

      // 2. Delete deal_items
      await this.supabase.from('deal_items').delete().eq('deal_id', id);

      // 3. Delete payment_tracking records for this deal
      await this.supabase.from('payment_tracking').delete().eq('deal_id', id);

      // 4. Delete followup_tasks for this deal if any
      try {
        await this.supabase.from('followup_tasks').delete().eq('deal_id', id);
      } catch (err: any) {
        this.logger.warn(
          `Non-blocking followup_tasks cleanup: ${err?.message}`,
        );
      }

      // 5. Delete corresponding kra_logs if PO/deal specific
      if (deal?.po_number) {
        try {
          await this.supabase
            .from('kra_logs')
            .delete()
            .ilike('description', `%${deal.po_number}%`);
        } catch (err: any) {
          this.logger.warn(`Non-blocking kra_logs cleanup: ${err?.message}`);
        }
      }

      // 6. Delete the deal itself
      const { error } = await this.supabase.from('deals').delete().eq('id', id);

      if (error) throw error;

      this.logger.log(`Deal ${id} successfully deleted.`);
      return { success: true, message: 'Deal deleted successfully', id };
    } catch (error) {
      this.logger.error(`Error deleting deal ${id}:`, error);
      throw error;
    }
  }
}
