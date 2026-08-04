import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(private supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async findAll(salespersonPhone?: string) {
    try {
      let query = this.supabase
        .from('recurring_customers')
        .select('*')
        .order('customer_name', { ascending: true });

      if (salespersonPhone) {
        query = query.eq('assigned_salesperson_phone', salespersonPhone);
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
      // Get customer
      const { data: customer, error } = await this.supabase
        .from('recurring_customers')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;

      // Get deals for this customer
      const { data: deals } = await this.supabase
        .from('deals')
        .select('*, deal_items(*)')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('created_at', { ascending: false })
        .limit(10);

      // Get visits for this customer
      const { data: visits } = await this.supabase
        .from('customer_visits')
        .select('*')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('visited_at', { ascending: false })
        .limit(5);

      // Get payments
      const { data: payments } = await this.supabase
        .from('payment_tracking')
        .select('*')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('created_at', { ascending: false });

      // Get complaints
      const { data: complaints } = await this.supabase
        .from('complaints')
        .select('*')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('reported_at', { ascending: false });

      return {
        ...customer,
        deals: deals || [],
        visits: visits || [],
        payments: payments || [],
        complaints: complaints || [],
      };
    } catch (error) {
      this.logger.error(`Error in findOne for id ${id}:`, error);
      throw error;
    }
  }

  async getChurnRisk(salespersonPhone?: string) {
    try {
      let query = this.supabase
        .from('recurring_customers')
        .select('*')
        .eq('is_active', true);

      if (salespersonPhone) {
        query = query.eq('assigned_salesperson_phone', salespersonPhone);
      }

      const { data: customers, error } = await query;

      if (error) throw error;

      const now = new Date();
      const monthStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      ).toISOString();

      const results = await Promise.all(
        (customers || []).map(async (customer) => {
          const { data: deals } = await this.supabase
            .from('deals')
            .select('id')
            .ilike('customer_name', `%${customer.customer_name}%`)
            .gte('created_at', monthStart);

          const hasOrderThisMonth = deals && deals.length > 0;
          const lastOrderDate = customer.last_order_date
            ? new Date(customer.last_order_date)
            : null;
          const daysSinceOrder = lastOrderDate
            ? Math.floor(
                (now.getTime() - lastOrderDate.getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : null;

          let churnRisk = 'low';
          if (!hasOrderThisMonth) {
            if (daysSinceOrder && daysSinceOrder > 45) {
              churnRisk = 'high';
            } else if (daysSinceOrder && daysSinceOrder > 30) {
              churnRisk = 'medium';
            }
          }

          return {
            ...customer,
            has_order_this_month: hasOrderThisMonth,
            days_since_order: daysSinceOrder,
            churn_risk: churnRisk,
          };
        }),
      );

      return results.sort((a, b) => {
        const riskOrder = { high: 0, medium: 1, low: 2 };
        return riskOrder[a.churn_risk] - riskOrder[b.churn_risk];
      });
    } catch (error) {
      this.logger.error('Error in getChurnRisk:', error);
      throw error;
    }
  }

  async getReorderQueue(salespersonPhone?: string) {
    try {
      const now = new Date();
      let query = this.supabase
        .from('recurring_customers')
        .select('*')
        .eq('is_active', true);

      if (salespersonPhone) {
        query = query.eq('assigned_salesperson_phone', salespersonPhone);
      }

      const { data: customers, error } = await query;
      if (error) throw error;

      const reorderList = (customers || [])
        .map((customer: any) => {
          const lastOrder = customer.last_order_date
            ? new Date(customer.last_order_date)
            : null;
          const avgFrequency = customer.avg_order_frequency_days || 30;
          const predictedDate = lastOrder
            ? new Date(lastOrder.getTime() + avgFrequency * 24 * 60 * 60 * 1000)
            : null;
          const daysUntilReorder = predictedDate
            ? Math.floor(
                (predictedDate.getTime() - now.getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : null;

          return {
            ...customer,
            predicted_reorder_date: predictedDate?.toISOString() || null,
            days_until_reorder: daysUntilReorder,
            is_overdue: daysUntilReorder !== null && daysUntilReorder < 0,
            is_due_soon:
              daysUntilReorder !== null &&
              daysUntilReorder >= 0 &&
              daysUntilReorder <= 7,
          };
        })
        .filter(
          (c: any) =>
            c.days_until_reorder !== null && c.days_until_reorder <= 14,
        )
        .sort(
          (a: any, b: any) =>
            (a.days_until_reorder || 0) - (b.days_until_reorder || 0),
        );

      return reorderList;
    } catch (error) {
      this.logger.error('Error in getReorderQueue:', error);
      throw error;
    }
  }

  async getLossAnalytics(salespersonPhone?: string) {
    try {
      const now = new Date();
      const threeMonthsAgo = new Date(
        now.getFullYear(),
        now.getMonth() - 3,
        1,
      ).toISOString();

      let query = this.supabase
        .from('deals')
        .select('lost_reason, total_amount, customer_name, created_at')
        .eq('stage', 'lost')
        .gte('created_at', threeMonthsAgo);

      if (salespersonPhone) {
        query = query.eq('salesperson_phone', salespersonPhone);
      }

      const { data: lostDeals, error } = await query;
      if (error) throw error;

      const byReason = (lostDeals || []).reduce((acc: any, deal: any) => {
        const reason = deal.lost_reason || 'Unknown';
        if (!acc[reason]) acc[reason] = { count: 0, value: 0 };
        acc[reason].count++;
        acc[reason].value += deal.total_amount || 0;
        return acc;
      }, {});

      return {
        total_lost: lostDeals?.length || 0,
        total_lost_value:
          lostDeals?.reduce(
            (sum: number, d: any) => sum + (d.total_amount || 0),
            0,
          ) || 0,
        by_reason: Object.entries(byReason)
          .map(([reason, data]: [string, any]) => ({ reason, ...data }))
          .sort((a, b) => b.count - a.count),
        recent_losses: (lostDeals || []).slice(0, 5),
      };
    } catch (error) {
      this.logger.error('Error in getLossAnalytics:', error);
      throw error;
    }
  }

  async importClients(clients: any[], defaultSalespersonPhone?: string) {
    try {
      if (!clients || !Array.isArray(clients) || clients.length === 0) {
        throw new Error('No client records provided for import');
      }

      const formattedClients = clients
        .map((c) => {
          const assignedPhone =
            c.assigned_salesperson_phone ||
            c.salesperson_phone ||
            defaultSalespersonPhone ||
            null;

          const cleanPhone =
            c.customer_phone || c.phone
              ? String(c.customer_phone || c.phone).replace(/\D/g, '')
              : null;

          return {
            customer_name: (
              c.customer_name ||
              c.company_name ||
              c.name ||
              ''
            ).trim(),
            contact_person:
              (c.contact_person || c.contact_name || '').trim() || null,
            customer_phone: cleanPhone,
            customer_email: (c.customer_email || c.email || '').trim() || null,
            address: (c.address || c.city || '').trim() || null,
            customer_gst:
              (c.customer_gst || c.gstin || c.gst || '').trim() || null,
            industry: (c.industry || c.segment || 'General').trim(),
            assigned_salesperson_phone: assignedPhone,
            is_active: true,
            avg_order_frequency_days: 30,
          };
        })
        .filter((c) => c.customer_name.length > 0);

      if (formattedClients.length === 0) {
        throw new Error('No valid company/customer names found in file');
      }

      // Upsert into recurring_customers
      const { data, error } = await this.supabase
        .from('recurring_customers')
        .upsert(formattedClients, {
          onConflict: 'customer_name',
          ignoreDuplicates: false,
        })
        .select();

      if (error) {
        this.logger.warn(
          'Upsert error, trying individual insert:',
          error.message,
        );
        const { data: insertData, error: insertError } = await this.supabase
          .from('recurring_customers')
          .insert(formattedClients)
          .select();

        if (insertError) throw insertError;
        return {
          count: insertData?.length || formattedClients.length,
          data: insertData,
        };
      }

      return { count: data?.length || formattedClients.length, data };
    } catch (error: any) {
      this.logger.error('Error in importClients:', error);
      throw error;
    }
  }
}
