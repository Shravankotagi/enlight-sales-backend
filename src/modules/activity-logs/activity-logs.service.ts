import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

export interface ActivityLogInput {
  salesperson_name?: string;
  salesperson_phone?: string;
  description: string;
  module:
    | 'Inquiries'
    | 'Orders'
    | 'Visits'
    | 'Complaints'
    | 'Customers'
    | string;
  customer_name?: string;
  timestamp?: string;
  source?: string;
  action_type?: string;
  entity_id?: string;
  entity_type?: string;
  change_detail?: any;
}

@Injectable()
export class ActivityLogsService {
  private readonly logger = new Logger(ActivityLogsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  /**
   * Log an activity in a non-blocking, fire-and-forget manner.
   * Failures are logged to warning and will never block caller operations.
   */
  logActivity(data: ActivityLogInput): void {
    try {
      let normalizedModule = data.module || 'General';
      const lowerMod = String(normalizedModule).toLowerCase();
      if (lowerMod.includes('inquir')) normalizedModule = 'Inquiries';
      else if (lowerMod.includes('order') || lowerMod.includes('deal'))
        normalizedModule = 'Orders';
      else if (lowerMod.includes('visit')) normalizedModule = 'Visits';
      else if (lowerMod.includes('complaint')) normalizedModule = 'Complaints';
      else if (lowerMod.includes('customer')) normalizedModule = 'Customers';

      const cleanPhone = data.salesperson_phone
        ? String(data.salesperson_phone).replace(/\D/g, '')
        : null;

      Promise.resolve()
        .then(async () => {
          try {
            let salespersonName = data.salesperson_name;
            if (
              (!salespersonName || salespersonName === 'Sales Team') &&
              cleanPhone
            ) {
              const last10 = cleanPhone.slice(-10);
              const { data: emp } = await this.supabase
                .from('employees')
                .select('name')
                .or(
                  `phone.eq.${cleanPhone},phone.eq.${last10},phone.eq.91${last10},phone.eq.+91${last10}`,
                )
                .limit(1)
                .single();
              if (emp && emp.name) {
                salespersonName = emp.name;
              }
            }

            const payload = {
              timestamp: data.timestamp || new Date().toISOString(),
              salesperson_name: salespersonName || 'Sales Team',
              salesperson_phone: cleanPhone,
              actor_phone: cleanPhone,
              actor_name: salespersonName || 'Sales Team',
              description: data.description,
              module: normalizedModule,
              customer_name: data.customer_name || null,
              source: data.source || 'dashboard',
              action_type: data.action_type || 'activity',
              entity_id: data.entity_id || null,
              entity_type: data.entity_type || null,
              change_detail: data.change_detail || {},
            };

            const { error } = await this.supabase
              .from('activity_logs')
              .insert(payload);
            if (error) {
              this.logger.warn(
                `Non-blocking activity log insert warning: ${error.message}`,
              );
            }
          } catch (innerErr: any) {
            this.logger.warn(
              `Non-blocking activity log insert error: ${innerErr?.message}`,
            );
          }
        })
        .catch((err: any) => {
          this.logger.warn(
            `Non-blocking activity log task error: ${err?.message}`,
          );
        });
    } catch (err: any) {
      this.logger.warn(`Non-blocking activity log exception: ${err?.message}`);
    }
  }

  /**
   * Retrieve activity logs with filters and RBAC.
   */
  async getActivityLogs(
    query: {
      from?: string;
      to?: string;
      module?: string;
      search?: string;
      limit?: number;
    },
    accessiblePhones?: string[] | null,
  ) {
    try {
      let q = this.supabase
        .from('activity_logs')
        .select('*')
        .order('timestamp', { ascending: false });

      if (accessiblePhones && accessiblePhones.length > 0) {
        const parts: string[] = [];
        for (const phone of accessiblePhones) {
          if (!phone || typeof phone !== 'string') continue;
          const clean = phone.replace(/\D/g, '');
          const p10 = clean.slice(-10);
          if (!p10) continue;
          const p12 = '91' + p10;
          parts.push(
            `salesperson_phone.ilike.%${p10}%`,
            `salesperson_phone.ilike.%${p12}%`,
          );
        }
        if (parts.length > 0) {
          q = q.or(`${parts.join(',')},salesperson_phone.is.null`);
        }
      }

      if (query.from) {
        const fromIso = query.from.includes('T')
          ? query.from
          : `${query.from}T00:00:00.000Z`;
        q = q.gte('timestamp', fromIso);
      }
      if (query.to) {
        const toIso = query.to.includes('T')
          ? query.to
          : `${query.to}T23:59:59.999Z`;
        q = q.lte('timestamp', toIso);
      }

      if (query.module && query.module !== 'All' && query.module !== 'all') {
        q = q.ilike('module', query.module);
      }

      if (query.search && query.search.trim()) {
        const term = query.search.trim();
        q = q.or(
          `customer_name.ilike.%${term}%,salesperson_name.ilike.%${term}%,description.ilike.%${term}%`,
        );
      }

      const limit = query.limit ? Math.min(Number(query.limit), 500) : 200;
      q = q.limit(limit);

      const { data, error } = await q;
      if (error) throw error;

      return data || [];
    } catch (err: any) {
      this.logger.error('Error fetching activity logs:', err);
      return [];
    }
  }
}
