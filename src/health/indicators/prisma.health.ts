import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { SupabaseService } from 'src/infrastructure/supabase/supabase.service';

@Injectable()
export class SupabaseHealthIndicator extends HealthIndicator {
  constructor(private readonly supabaseService: SupabaseService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const { error } = await this.supabaseService
        .getAdminClient()
        .from('employees')
        .select('id')
        .limit(1);

      if (error) {
        throw error;
      }

      return this.getStatus(key, true);
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null
            ? JSON.stringify(e)
            : String(e);

      return this.getStatus(key, false, {
        message,
      });
    }
  }
}
