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

  async findOne(id: string, salespersonPhone?: string) {
    try {
      const { data: customer, error } = await this.supabase
        .from('recurring_customers')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;

      let dealsQuery = this.supabase
        .from('deals')
        .select('*, deal_items(*)')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('created_at', { ascending: false })
        .limit(10);
      if (salespersonPhone) {
        dealsQuery = dealsQuery.eq('salesperson_phone', salespersonPhone);
      }

      let visitsQuery = this.supabase
        .from('customer_visits')
        .select('*')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('visited_at', { ascending: false })
        .limit(5);
      if (salespersonPhone) {
        visitsQuery = visitsQuery.eq('salesperson_phone', salespersonPhone);
      }

      let paymentsQuery = this.supabase
        .from('payment_tracking')
        .select('*')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('created_at', { ascending: false });
      if (salespersonPhone) {
        paymentsQuery = paymentsQuery.eq('salesperson_phone', salespersonPhone);
      }

      const complaintsQuery = this.supabase
        .from('complaints')
        .select('*')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('reported_at', { ascending: false });

      const [dealsRes, visitsRes, paymentsRes, complaintsRes] =
        await Promise.all([
          dealsQuery,
          visitsQuery,
          paymentsQuery,
          complaintsQuery,
        ]);

      const deals = dealsRes.data || [];
      const visits = visitsRes.data || [];
      const payments = paymentsRes.data || [];
      const complaints = complaintsRes.data || [];

      const latestDeal = deals.length > 0 ? deals[0] : null;
      const effectiveLastOrderDate = latestDeal
        ? latestDeal.won_at || latestDeal.created_at
        : customer.last_order_date;

      return {
        ...customer,
        last_order_date: effectiveLastOrderDate,
        deals,
        visits,
        payments,
        complaints,
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

      let dealsQuery = this.supabase
        .from('deals')
        .select('customer_name, created_at, won_at, stage')
        .order('created_at', { ascending: false });

      if (salespersonPhone) {
        const cleanDigits = salespersonPhone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;
        dealsQuery = dealsQuery.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12}`,
        );
      }

      const { data: allDeals } = await dealsQuery;
      const safeAllDeals = allDeals || [];

      const results = (customers || []).map((customer) => {
        const custKey = (customer.customer_name || '').toLowerCase().trim();
        const customerDeals = safeAllDeals.filter((d) => {
          const dKey = (d.customer_name || '').toLowerCase().trim();
          return dKey.includes(custKey) || custKey.includes(dKey);
        });

        const latestDeal = customerDeals.length > 0 ? customerDeals[0] : null;
        const effectiveLastOrderStr = latestDeal
          ? latestDeal.won_at || latestDeal.created_at
          : customer.last_order_date;

        const lastOrderDate = effectiveLastOrderStr
          ? new Date(effectiveLastOrderStr)
          : null;
        const daysSinceOrder = lastOrderDate
          ? Math.max(
              0,
              Math.floor(
                (now.getTime() - lastOrderDate.getTime()) /
                  (1000 * 60 * 60 * 24),
              ),
            )
          : null;

        const hasOrderThisMonth = customerDeals.some(
          (d) =>
            d.created_at >= monthStart || (d.won_at && d.won_at >= monthStart),
        );

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
          last_order_date: effectiveLastOrderStr,
          has_order_this_month: hasOrderThisMonth,
          days_since_order: daysSinceOrder,
          churn_risk: churnRisk,
        };
      });

      return results.sort((a, b) => {
        const riskOrder: Record<string, number> = {
          high: 0,
          medium: 1,
          low: 2,
        };
        return (riskOrder[a.churn_risk] ?? 2) - (riskOrder[b.churn_risk] ?? 2);
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

      const reorderList = (
        await Promise.all(
          (customers || []).map(async (customer: any) => {
            const { data: deals } = await this.supabase
              .from('deals')
              .select('created_at, won_at')
              .ilike('customer_name', `%${customer.customer_name}%`)
              .order('created_at', { ascending: false })
              .limit(1);

            const latestDeal = deals && deals.length > 0 ? deals[0] : null;
            const effectiveLastOrderStr = latestDeal
              ? latestDeal.won_at || latestDeal.created_at
              : customer.last_order_date;

            const lastOrder = effectiveLastOrderStr
              ? new Date(effectiveLastOrderStr)
              : null;
            const avgFrequency = customer.avg_order_frequency_days || 30;
            const predictedDate = lastOrder
              ? new Date(
                  lastOrder.getTime() + avgFrequency * 24 * 60 * 60 * 1000,
                )
              : null;
            const daysUntilReorder = predictedDate
              ? Math.floor(
                  (predictedDate.getTime() - now.getTime()) /
                    (1000 * 60 * 60 * 24),
                )
              : null;

            return {
              ...customer,
              last_order_date: effectiveLastOrderStr,
              predicted_reorder_date: predictedDate?.toISOString() || null,
              days_until_reorder: daysUntilReorder,
              is_overdue: daysUntilReorder !== null && daysUntilReorder < 0,
              is_due_soon:
                daysUntilReorder !== null &&
                daysUntilReorder >= 0 &&
                daysUntilReorder <= 7,
            };
          }),
        )
      )
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
        const cleanDigits = salespersonPhone.replace(/\D/g, '');
        const last10 = cleanDigits.slice(-10);
        query = query.or(
          `salesperson_phone.eq.${salespersonPhone},salesperson_phone.eq.91${last10},salesperson_phone.eq.${last10}`,
        );
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

          const contactName = (c.contact_person || c.contact_name || '').trim();
          const email = (c.customer_email || c.email || '').trim();
          const industry = (c.industry || c.segment || '').trim();

          const notesParts = [
            contactName ? `Contact: ${contactName}` : '',
            email ? `Email: ${email}` : '',
            industry ? `Industry: ${industry}` : '',
          ]
            .filter(Boolean)
            .join(' | ');

          return {
            customer_name: (
              c.customer_name ||
              c.company_name ||
              c.name ||
              ''
            ).trim(),
            customer_phone: cleanPhone,
            customer_gst:
              (c.customer_gst || c.gstin || c.gst || '').trim() || null,
            customer_address:
              (c.address || c.customer_address || c.city || '').trim() || null,
            assigned_salesperson_phone: assignedPhone,
            notes: notesParts || 'Bulk imported client',
            is_active: true,
            avg_order_frequency_days: 30,
          };
        })
        .filter((c) => c.customer_name.length > 0);

      if (formattedClients.length === 0) {
        throw new Error('No valid company/customer names found in file');
      }

      // Query existing customers to safely split into update vs insert
      const { data: existingCustomers } = await this.supabase
        .from('recurring_customers')
        .select('id, customer_name');

      const existingMap = new Map<string, string>(
        (existingCustomers || []).map((c) => [
          c.customer_name.toLowerCase(),
          c.id,
        ]),
      );

      const toUpdate: any[] = [];
      const toInsert: any[] = [];

      for (const client of formattedClients) {
        const existingId = existingMap.get(client.customer_name.toLowerCase());
        if (existingId) {
          toUpdate.push({ id: existingId, ...client });
        } else {
          toInsert.push(client);
        }
      }

      let insertedCount = 0;
      if (toInsert.length > 0) {
        const { data: insertedData, error: insertError } = await this.supabase
          .from('recurring_customers')
          .insert(toInsert)
          .select();

        if (insertError) {
          this.logger.error('Error inserting imported clients:', insertError);
          throw insertError;
        }
        insertedCount = insertedData?.length || toInsert.length;
      }

      for (const updateItem of toUpdate) {
        const { error: updateError } = await this.supabase
          .from('recurring_customers')
          .update(updateItem)
          .eq('id', updateItem.id);

        if (updateError) {
          this.logger.warn(
            `Error updating client ${updateItem.customer_name}:`,
            updateError.message,
          );
        }
      }

      const totalCount = insertedCount + toUpdate.length;
      return { count: totalCount };
    } catch (error: any) {
      this.logger.error('Error in importClients:', error);
      throw error;
    }
  }
}
