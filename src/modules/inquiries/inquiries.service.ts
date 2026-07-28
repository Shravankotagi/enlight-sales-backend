import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

@Injectable()
export class InquiriesService {
  private readonly logger = new Logger(InquiriesService.name);

  constructor(private supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async findAll(filters?: { status?: string; from?: string; to?: string }) {
    try {
      let query = this.supabase
        .from('inquiries')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters?.status) query = query.eq('status', filters.status);
      if (filters?.from) query = query.gte('created_at', filters.from);
      if (filters?.to) query = query.lte('created_at', filters.to);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (error) {
      this.logger.error('Error in findAll:', error);
      throw error;
    }
  }

  async findReviewQueue() {
    try {
      const { data, error } = await this.supabase
        .from('inquiries')
        .select('*')
        .eq('status', 'review')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    } catch (error) {
      this.logger.error('Error in findReviewQueue:', error);
      throw error;
    }
  }

  async updateStatus(id: string, status: string) {
    try {
      const { data, error } = await this.supabase
        .from('inquiries')
        .update({ status })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      this.logger.error(`Error in updateStatus for id ${id}:`, error);
      throw error;
    }
  }

  async getStats() {
    try {
      const { data, error } = await this.supabase
        .from('inquiries')
        .select('status, source_channel, created_at');
      if (error) throw error;

      return {
        total: data?.length || 0,
        pending: data?.filter((i) => i.status === 'pending').length || 0,
        processed: data?.filter((i) => i.status === 'processed').length || 0,
        review: data?.filter((i) => i.status === 'review').length || 0,
        by_channel: {
          whatsapp:
            data?.filter((i) => i.source_channel === 'whatsapp').length || 0,
        },
      };
    } catch (error) {
      this.logger.error('Error in getStats:', error);
      throw error;
    }
  }
}
