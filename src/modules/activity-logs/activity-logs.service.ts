import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

export interface ActivityLogInput {
  salesperson_name?: string;
  salesperson_phone?: string;
  description: string;
  module: 'Inquiries' | 'Orders' | 'Visits' | 'Complaints' | string;
  customer_name?: string;
  timestamp?: string;
}

@Injectable()
export class ActivityLogsService {
  private readonly logger = new Logger(ActivityLogsService.name);
  private supabase = this.supabaseService.getClient();

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Log an activity in a non-blocking, fire-and-forget manner.
   * Failures are logged to warning and will never block caller operations.
   */
  logActivity(data: ActivityLogInput): void {
    try {
      const payload = {
        timestamp: data.timestamp || new Date().toISOString(),
        salesperson_name: data.salesperson_name || 'Sales Team',
        salesperson_phone: data.salesperson_phone || null,
        description: data.description,
        module: data.module,
        customer_name: data.customer_name || null,
      };

      Promise.resolve(this.supabase.from('activity_logs').insert(payload))
        .then(({ error }) => {
          if (error) {
            this.logger.warn(
              `Non-blocking activity log insert warning: ${error.message}`,
            );
          }
        })
        .catch((err: any) => {
          this.logger.warn(
            `Non-blocking activity log insert error: ${err?.message}`,
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
        const phoneFilter = accessiblePhones
          .map((p) => `salesperson_phone.ilike.%${p}%`)
          .join(',');
        q = q.or(`${phoneFilter},salesperson_phone.is.null`);
      }

      if (query.from) {
        q = q.gte('timestamp', query.from);
      }
      if (query.to) {
        q = q.lte('timestamp', query.to);
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

      return {
        data: data || [],
        total: data ? data.length : 0,
      };
    } catch (err: any) {
      this.logger.error('Error fetching activity logs:', err);
      return { data: [], total: 0 };
    }
  }
}
