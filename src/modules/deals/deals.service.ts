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
      let query = this.supabase
        .from('deals')
        .select(
          `
          *,
          deal_items (*)
        `,
        )
        .neq('inquiry_type', 'unknown')
        .order('created_at', { ascending: false });

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
        query = query.gte('created_at', filters.from);
      }
      if (filters?.to) {
        const toEnd = filters.to.includes('T')
          ? filters.to
          : `${filters.to}T23:59:59.999Z`;
        query = query.lte('created_at', toEnd);
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

  async createOrder(data: any, salespersonPhone?: string) {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const poNumber = data.po_number || `PO-${todayStr}-${randomNum}`;
    const now = new Date().toISOString();

    const dealPayload = {
      customer_name: data.customer_name,
      salesperson_phone: salespersonPhone || '910000000000',
      customer_phone: data.customer_phone || '',
      stage: 'won',
      won_at: now,
      po_number: poNumber,
      po_date: data.po_date || now.split('T')[0],
      total_amount: Number(data.total_amount) || 0,
      delivery_location: data.delivery_location || '',
      delivery_date: data.delivery_date || null,
      inquiry_type: 'inquiry',
      created_at: now,
    };

    const { data: deal, error } = await this.supabase
      .from('deals')
      .insert(dealPayload)
      .select()
      .single();

    if (error) throw error;

    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      for (const item of data.items) {
        await this.supabase.from('deal_items').insert({
          deal_id: deal.id,
          sku_text: item.sku_text || item.product_name || 'Steel Material',
          quantity: Number(item.quantity) || null,
          unit: item.unit || 'MT',
          rate: Number(item.rate) || null,
          amount: Number(item.amount) || null,
          created_at: now,
        });
      }
    }

    // Log KRA 1 achievement
    await this.supabase.from('kra_logs').insert({
      kra_number: 1,
      salesperson_phone: salespersonPhone || '910000000000',
      customer_name: data.customer_name,
      action: 'order_created',
      details: `Created order ${poNumber} for ${data.customer_name} (₹${data.total_amount})`,
      created_at: now,
    });

    return deal;
  }
}
