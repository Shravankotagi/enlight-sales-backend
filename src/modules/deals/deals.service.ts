import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

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
      // For won deals (Orders tab), sort by won_at; for others, sort by created_at
      const isWonQuery = filters?.stage === 'won';

      let query = this.supabase
        .from('deals')
        .select(
          `
          *,
          deal_items (*)
        `,
        )
        .neq('inquiry_type', 'unknown')
        .order(isWonQuery ? 'won_at' : 'created_at', { ascending: false });

      if (filters?.stage) {
        query = query.eq('stage', filters.stage);
      }
      if (filters?.salesperson_phone) {
        const cleanDigits = filters.salesperson_phone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;
        query = query.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12},customer_phone.eq.${p10},customer_phone.eq.${p12},salesperson_phone.is.null`,
        );
      }
      if (filters?.from) {
        // For won deals: filter by won_at (when deal was actually won/received by bot)
        // For other deals: filter by created_at
        const dateField = isWonQuery ? 'won_at' : 'created_at';
        query = query.gte(dateField, filters.from);
      }
      if (filters?.to) {
        const toEnd = filters.to.includes('T')
          ? filters.to
          : `${filters.to}T23:59:59.999Z`;
        const dateField = isWonQuery ? 'won_at' : 'created_at';
        query = query.lte(dateField, toEnd);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (error) {
      this.logger.error('Error in findAll:', error);
      throw error;
    }
  }

  async findOne(id: string) {
    try {
      const { data, error } = await this.supabase
        .from('deals')
        .select('*, deal_items(*)')
        .eq('id', id)
        .single();
      if (error) throw error;

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

  async updateStage(id: string, stage: string, lostReason?: string) {
    try {
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
            .eq('customer_name', data.customer_name)
            .limit(1);
          if (byCust && byCust.length > 0) {
            existingRecord = byCust[0];
          }
        }

        if (existingRecord) {
          await this.supabase
            .from('payment_tracking')
            .update({
              due_date: dueDateStr,
              invoice_amount: data.total_amount || undefined,
              deal_id: data.id,
              credit_period_days: 30,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingRecord.id);
        } else {
          await this.supabase.from('payment_tracking').insert({
            salesperson_phone: data.salesperson_phone,
            customer_name: data.customer_name,
            invoice_amount: data.total_amount || 0,
            outstanding: data.total_amount || 0,
            status: 'pending',
            due_date: dueDateStr,
            deal_id: data.id,
            credit_period_days: 30,
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

      const summary = stages.map((stage) => ({
        stage,
        count: data?.filter((d) => d.stage === stage).length || 0,
        total_value:
          data
            ?.filter((d) => d.stage === stage)
            .reduce((sum, d) => sum + (d.total_amount || 0), 0) || 0,
      }));

      return summary;
    } catch (error) {
      this.logger.error('Error in getPipelineSummary:', error);
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
          acc[stage] = data?.filter((d) => d.stage === stage) || [];
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

      const customerName = data.customer_name?.trim() || 'Valued Customer';
      const customerPhone = data.customer_phone || '';
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

      // 1. Try to find existing deal to update
      let dealId = data.deal_id || null;
      let existingDeal: any = null;

      if (dealId) {
        const { data: d } = await this.supabase
          .from('deals')
          .select('*')
          .eq('id', dealId)
          .single();
        if (d) existingDeal = d;
      } else if (data.inquiry_id) {
        const { data: d } = await this.supabase
          .from('deals')
          .select('*')
          .eq('inquiry_id', data.inquiry_id)
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
            inquiry_id: data.inquiry_id || null,
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
          sku_text: item.sku_text || item.product_name || 'Material',
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

      return savedDeal;
    } catch (error) {
      this.logger.error('Error in processPo:', error);
      throw error;
    }
  }

  async createOrder(data: any, salespersonPhone?: string) {
    return this.processPo(data, salespersonPhone);
  }
}
