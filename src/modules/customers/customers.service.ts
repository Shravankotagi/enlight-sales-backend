import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { phoneInList } from '../employees/employees.service';

function buildMultiFieldOrFilter(
  salespersonPhones?: string[] | string,
  fieldNames: string[] = ['salesperson_phone'],
): string | null {
  if (!salespersonPhones) return null;
  const list = Array.isArray(salespersonPhones)
    ? salespersonPhones
    : [salespersonPhones];
  const parts: string[] = [];
  for (const phone of list) {
    if (!phone) continue;
    const clean = phone.replace(/\D/g, '');
    const p10 = clean.slice(-10);
    const p12 = '91' + p10;
    for (const field of fieldNames) {
      parts.push(`${field}.eq.${p10}`, `${field}.eq.${p12}`);
    }
  }
  return parts.length > 0 ? parts.join(',') : null;
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(private supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async findAll(salespersonPhone?: string[] | string) {
    try {
      if (Array.isArray(salespersonPhone) && salespersonPhone.length === 0) {
        return [];
      }

      let query = this.supabase
        .from('recurring_customers')
        .select('*')
        .order('customer_name', { ascending: true });

      if (salespersonPhone) {
        const orFilter = buildMultiFieldOrFilter(salespersonPhone, [
          'assigned_salesperson_phone',
        ]);
        if (orFilter) query = query.or(orFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (error) {
      this.logger.error('Error in findAll:', error);
      throw error;
    }
  }

  async findOne(id: string, salespersonPhone?: string[] | string) {
    try {
      const { data: customer, error } = await this.supabase
        .from('recurring_customers')
        .select('*')
        .eq('id', id)
        .single();
      if (error || !customer) {
        throw new NotFoundException('Customer not found');
      }

      if (salespersonPhone) {
        const allowedList = Array.isArray(salespersonPhone)
          ? salespersonPhone
          : [salespersonPhone];
        if (
          !customer.assigned_salesperson_phone ||
          !phoneInList(customer.assigned_salesperson_phone, allowedList)
        ) {
          throw new ForbiddenException(
            'Access Denied: You do not have permission to view this customer.',
          );
        }
      }

      let dealsQuery = this.supabase
        .from('deals')
        .select('*, deal_items(*)')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('created_at', { ascending: false })
        .limit(10);
      if (salespersonPhone) {
        const dealsOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (dealsOr) dealsQuery = dealsQuery.or(dealsOr);
      }

      let visitsQuery = this.supabase
        .from('customer_visits')
        .select('*')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('visited_at', { ascending: false })
        .limit(5);
      if (salespersonPhone) {
        const visitsOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (visitsOr) visitsQuery = visitsQuery.or(visitsOr);
      }

      let paymentsQuery = this.supabase
        .from('payment_tracking')
        .select('*')
        .ilike('customer_name', `%${customer.customer_name}%`)
        .order('created_at', { ascending: false });
      if (salespersonPhone) {
        const paymentsOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (paymentsOr) paymentsQuery = paymentsQuery.or(paymentsOr);
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

      const wonDeals = deals.filter((d) => d.stage === 'won');
      const latestWonDeal = wonDeals.length > 0 ? wonDeals[0] : null;
      const effectiveLastOrderDate = latestWonDeal
        ? latestWonDeal.won_at || latestWonDeal.created_at
        : customer.last_order_date || null;

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

  async getChurnRisk(salespersonPhone?: string[] | string) {
    try {
      if (Array.isArray(salespersonPhone) && salespersonPhone.length === 0) {
        return [];
      }

      let query = this.supabase
        .from('recurring_customers')
        .select('*')
        .eq('is_active', true);

      if (salespersonPhone) {
        const orFilter = buildMultiFieldOrFilter(salespersonPhone, [
          'assigned_salesperson_phone',
        ]);
        if (orFilter) query = query.or(orFilter);
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
        .select('customer_name, customer_phone, created_at, won_at, stage')
        .order('created_at', { ascending: false });

      if (salespersonPhone) {
        const dealsOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (dealsOr) dealsQuery = dealsQuery.or(dealsOr);
      }

      let visitsQuery = this.supabase
        .from('customer_visits')
        .select(
          'customer_name, person_met, contact_phone, created_at, visited_at',
        )
        .order('visited_at', { ascending: false });

      if (salespersonPhone) {
        const visitsOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (visitsOr) visitsQuery = visitsQuery.or(visitsOr);
      }

      const [{ data: allDeals }, { data: allVisits }] = await Promise.all([
        dealsQuery,
        visitsQuery,
      ]);
      const safeAllDeals = allDeals || [];
      const safeAllVisits = allVisits || [];

      const normalize = (str?: string) =>
        (str || '')
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]/g, '');

      // Existing customer normalized name set
      const existingNameSet = new Set(
        (customers || []).map((c) => normalize(c.customer_name)),
      );

      // Synthesize missing customer profiles from deals and visits
      const extraCustomersMap = new Map<string, any>();

      for (const deal of safeAllDeals) {
        if (!deal.customer_name || !deal.customer_name.trim()) continue;
        const norm = normalize(deal.customer_name);
        if (
          norm &&
          !existingNameSet.has(norm) &&
          !extraCustomersMap.has(norm)
        ) {
          extraCustomersMap.set(norm, {
            id: `virtual-deal-${norm}`,
            customer_name: deal.customer_name.trim(),
            contact_person: null,
            customer_phone: deal.customer_phone || null,
            customer_gst: null,
            avg_order_frequency_days: 30,
            is_active: true,
            created_at: deal.created_at,
          });
        }
      }

      for (const visit of safeAllVisits) {
        if (!visit.customer_name || !visit.customer_name.trim()) continue;
        const norm = normalize(visit.customer_name);
        if (
          norm &&
          !existingNameSet.has(norm) &&
          !extraCustomersMap.has(norm)
        ) {
          extraCustomersMap.set(norm, {
            id: `virtual-visit-${norm}`,
            customer_name: visit.customer_name.trim(),
            contact_person: visit.person_met || null,
            customer_phone: visit.contact_phone || null,
            customer_gst: null,
            avg_order_frequency_days: 30,
            is_active: true,
            created_at: visit.visited_at || visit.created_at,
          });
        }
      }

      const combinedCustomers = [
        ...(customers || []),
        ...Array.from(extraCustomersMap.values()),
      ];

      const results = combinedCustomers.map((customer) => {
        const custKeyNorm = normalize(customer.customer_name);
        const customerWonDeals = safeAllDeals.filter((d) => {
          if (d.stage !== 'won') return false;
          const dKeyNorm = normalize(d.customer_name);
          return dKeyNorm === custKeyNorm;
        });

        const latestWonDeal =
          customerWonDeals.length > 0 ? customerWonDeals[0] : null;
        const effectiveLastOrderStr = latestWonDeal
          ? latestWonDeal.won_at || latestWonDeal.created_at
          : customer.last_order_date || null;

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

        const hasOrderThisMonth = customerWonDeals.some(
          (d) =>
            d.created_at >= monthStart || (d.won_at && d.won_at >= monthStart),
        );

        const daysSinceCreated = customer.created_at
          ? Math.floor(
              (now.getTime() - new Date(customer.created_at).getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : 0;

        const avgFreq = customer.avg_order_frequency_days || 30;

        let churnRisk = 'low';
        if (!hasOrderThisMonth) {
          if (daysSinceOrder !== null) {
            if (daysSinceOrder > avgFreq + 15) {
              churnRisk = 'high';
            } else if (daysSinceOrder > avgFreq) {
              churnRisk = 'medium';
            }
          } else {
            // Newly onboarded customers (within 30 days) are New Prospects -> Low Risk
            // Registered > 30 days ago without any order -> High Risk
            if (daysSinceCreated > 30) {
              churnRisk = 'high';
            } else {
              churnRisk = 'low';
            }
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

  async getReorderQueue(salespersonPhone?: string[] | string) {
    try {
      if (Array.isArray(salespersonPhone) && salespersonPhone.length === 0) {
        return [];
      }

      const now = new Date();
      let query = this.supabase
        .from('recurring_customers')
        .select('*')
        .eq('is_active', true);

      if (salespersonPhone) {
        const orFilter = buildMultiFieldOrFilter(salespersonPhone, [
          'assigned_salesperson_phone',
        ]);
        if (orFilter) query = query.or(orFilter);
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
              .eq('stage', 'won')
              .order('created_at', { ascending: false })
              .limit(1);

            const latestWonDeal = deals && deals.length > 0 ? deals[0] : null;
            const effectiveLastOrderStr = latestWonDeal
              ? latestWonDeal.won_at || latestWonDeal.created_at
              : customer.last_order_date || null;

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

  async getLossAnalytics(salespersonPhone?: string[] | string) {
    try {
      if (Array.isArray(salespersonPhone) && salespersonPhone.length === 0) {
        return {
          total_lost: 0,
          total_lost_value: 0,
          by_reason: [],
          recent_lost: [],
        };
      }

      const now = new Date();
      const threeMonthsAgo = new Date(
        now.getFullYear(),
        now.getMonth() - 3,
        1,
      ).toISOString();

      let query = this.supabase
        .from('deals')
        .select(
          'id, deal_number, lost_reason, total_amount, customer_name, created_at',
        )
        .eq('stage', 'lost')
        .gte('created_at', threeMonthsAgo);

      let logsQuery = this.supabase
        .from('kra_logs')
        .select('*')
        .eq('kra_type', 'deal_lost')
        .gte('created_at', threeMonthsAgo);

      if (salespersonPhone) {
        const dealsOr = buildMultiFieldOrFilter(salespersonPhone, [
          'salesperson_phone',
        ]);
        if (dealsOr) {
          query = query.or(dealsOr);
          logsQuery = logsQuery.or(dealsOr);
        }
      }

      const [{ data: lostDeals }, { data: lostLogs }] = await Promise.all([
        query,
        logsQuery,
      ]);

      const primaryLostDeals = (lostDeals || []).map((d) => ({
        id: d.id,
        deal_number:
          d.deal_number ||
          (d.id ? `DEAL-${d.id.substring(0, 6).toUpperCase()}` : undefined),
        customer_name: d.customer_name,
        lost_reason: d.lost_reason || 'Not specified',
        total_amount: d.total_amount || 0,
        created_at: d.created_at,
      }));

      // Add kra_logs ONLY if no corresponding deal exists for that customer & amount (prevents double-counting)
      const orphanLogs = (lostLogs || [])
        .filter((l) => {
          const lAmount = Number(l.value || 0);
          const lName = (l.customer_name || '').toLowerCase().trim();
          const matchInDeals = primaryLostDeals.some((d) => {
            const dName = (d.customer_name || '').toLowerCase().trim();
            return (
              (dName.includes(lName) || lName.includes(dName)) &&
              (lAmount === 0 ||
                Math.abs(Number(d.total_amount) - lAmount) < 100)
            );
          });
          return !matchInDeals;
        })
        .map((l) => ({
          id: l.id,
          deal_number: undefined,
          customer_name: l.customer_name,
          lost_reason:
            l.description?.match(/Reason:\s*([^|]+)/)?.[1]?.trim() ||
            l.notes ||
            'Price / Commercials',
          total_amount: l.value || 0,
          created_at: l.created_at,
        }));

      // Deduplicate log records by customer + date (within 60 seconds) or exact amount
      const combinedLosses: any[] = [];
      for (const item of [...primaryLostDeals, ...orphanLogs]) {
        const itemDateStr = new Date(item.created_at)
          .toISOString()
          .slice(0, 10);
        const itemName = (item.customer_name || '').toLowerCase().trim();
        const isDuplicate = combinedLosses.some((existing) => {
          const existingDateStr = new Date(existing.created_at)
            .toISOString()
            .slice(0, 10);
          const existingName = (existing.customer_name || '')
            .toLowerCase()
            .trim();
          return (
            existingName === itemName &&
            existingDateStr === itemDateStr &&
            Math.abs(
              Number(existing.total_amount) - Number(item.total_amount),
            ) < 100
          );
        });
        if (!isDuplicate) {
          combinedLosses.push(item);
        }
      }

      const byReason = combinedLosses.reduce((acc: any, deal: any) => {
        const reason = deal.lost_reason || 'Unknown';
        if (!acc[reason]) acc[reason] = { count: 0, value: 0 };
        acc[reason].count++;
        acc[reason].value += Number(deal.total_amount || 0);
        return acc;
      }, {});

      return {
        total_lost: combinedLosses.length,
        total_lost_value: combinedLosses.reduce(
          (sum: number, d: any) => sum + (Number(d.total_amount) || 0),
          0,
        ),
        by_reason: Object.entries(byReason)
          .map(([reason, data]: [string, any]) => ({ reason, ...data }))
          .sort((a, b) => b.count - a.count),
        recent_losses: combinedLosses.slice(0, 5),
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
