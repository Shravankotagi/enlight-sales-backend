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
}
