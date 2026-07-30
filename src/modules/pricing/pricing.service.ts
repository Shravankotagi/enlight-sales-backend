import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(private supabaseService: SupabaseService) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async getTodayRateSheet() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await this.supabase
        .from('rate_sheets')
        .select('*, rate_sheet_items(*)')
        .eq('date', today)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) return null;
      return data;
    } catch {
      return null;
    }
  }

  async createRateSheet(items: any[], createdBy: string) {
    const today = new Date().toISOString().split('T')[0];
    const { data: sheet, error } = await this.supabase
      .from('rate_sheets')
      .insert({ date: today, created_by: createdBy })
      .select()
      .single();

    if (error) throw error;

    if (items.length > 0) {
      await this.supabase
        .from('rate_sheet_items')
        .insert(items.map((item) => ({ rate_sheet_id: sheet.id, ...item })));
    }

    return this.getTodayRateSheet();
  }

  async lockRateSheet(id: string, lockedBy: string) {
    const { data, error } = await this.supabase
      .from('rate_sheets')
      .update({ locked_at: new Date().toISOString(), locked_by: lockedBy })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getFloorMargins() {
    const { data, error } = await this.supabase
      .from('floor_margins')
      .select('*')
      .order('category', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async updateFloorMargin(id: string, floorPct: number, setBy: string) {
    const { data, error } = await this.supabase
      .from('floor_margins')
      .update({
        floor_pct: floorPct,
        set_by: setBy,
        effective_from: new Date().toISOString().split('T')[0],
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async checkMargin(
    skuText: string,
    quotedPrice: number,
    rateSheetPrice: number,
  ) {
    const { data: margins } = await this.supabase
      .from('floor_margins')
      .select('*');
    const lowerSku = skuText.toLowerCase();
    const matchedMargin = (margins || []).find((m: any) =>
      lowerSku.includes(m.category.toLowerCase().split(' ')[0]),
    );
    const floorPct = matchedMargin?.floor_pct || 5;
    const marginPct =
      rateSheetPrice > 0
        ? ((quotedPrice - rateSheetPrice) / rateSheetPrice) * 100
        : 0;
    return {
      approved: marginPct >= floorPct,
      margin_pct: Math.round(marginPct * 100) / 100,
      floor_pct: floorPct,
    };
  }

  async getHistory() {
    const { data, error } = await this.supabase
      .from('rate_sheets')
      .select('*, rate_sheet_items(*)')
      .order('date', { ascending: false })
      .limit(10);
    if (error) throw error;
    return data || [];
  }
}
