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
        query = query.eq('customer_phone', filters.salesperson_phone);
      }
      if (filters?.from) {
        query = query.gte('created_at', filters.from);
      }
      if (filters?.to) {
        query = query.lte('created_at', filters.to);
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
}
