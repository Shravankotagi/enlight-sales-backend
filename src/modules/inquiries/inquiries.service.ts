import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

@Injectable()
export class InquiriesService {
  private readonly logger = new Logger(InquiriesService.name);

  constructor(private supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async findAll(filters?: {
    status?: string;
    from?: string;
    to?: string;
    salespersonPhone?: string;
  }) {
    try {
      let query = this.supabase
        .from('inquiries')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters?.status) query = query.eq('status', filters.status);
      if (filters?.from) query = query.gte('created_at', filters.from);
      if (filters?.to) query = query.lte('created_at', filters.to);

      if (filters?.salespersonPhone) {
        const cleanDigits = filters.salespersonPhone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;
        query = query.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12},sender_phone.eq.${p10},sender_phone.eq.${p12}`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (error) {
      this.logger.error('Error in findAll:', error);
      throw error;
    }
  }

  async findReviewQueue(salespersonPhone?: string) {
    try {
      let query = this.supabase
        .from('inquiries')
        .select('*')
        .in('status', ['review', 'needs_review', 'pending', 'auto_created'])
        .order('created_at', { ascending: false });

      if (salespersonPhone) {
        const cleanDigits = salespersonPhone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;
        query = query.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12},sender_phone.eq.${p10},sender_phone.eq.${p12}`,
        );
      }

      const { data, error } = await query;
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

  async getStats(salespersonPhone?: string) {
    try {
      let query = this.supabase
        .from('inquiries')
        .select(
          'status, source_channel, created_at, salesperson_phone, sender_phone',
        );

      if (salespersonPhone) {
        const cleanDigits = salespersonPhone.replace(/\D/g, '');
        const p10 = cleanDigits.slice(-10);
        const p12 = '91' + p10;
        query = query.or(
          `salesperson_phone.eq.${p10},salesperson_phone.eq.${p12},sender_phone.eq.${p10},sender_phone.eq.${p12}`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;

      return {
        total: data?.length || 0,
        pending: data?.filter((i) => i.status === 'pending').length || 0,
        processed: data?.filter((i) => i.status === 'processed').length || 0,
        review:
          data?.filter((i) => ['review', 'needs_review'].includes(i.status))
            .length || 0,
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
