import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private supabaseService: SupabaseService,
    private httpService: HttpService,
  ) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  async getTodayRateSheet() {
    try {
      const today = new Date().toISOString().split('T')[0];

      // 1. Try to find today's sheet first
      const { data: todayData } = await this.supabase
        .from('rate_sheets')
        .select('*, rate_sheet_items(*)')
        .eq('date', today)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (todayData) return todayData;

      // 2. Fallback: return the most recent rate sheet (rates persist until admin updates)
      const { data: latestData, error } = await this.supabase
        .from('rate_sheets')
        .select('*, rate_sheet_items(*)')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) return null;
      return latestData;
    } catch {
      return null;
    }
  }

  async createRateSheet(items: any[], createdBy: string) {
    const today = new Date().toISOString().split('T')[0];

    // Check if a sheet already exists for today
    const { data: existing } = await this.supabase
      .from('rate_sheets')
      .select('id')
      .eq('date', today)
      .limit(1)
      .single();

    let sheetId: string;

    if (existing?.id) {
      // Reuse existing sheet - update items
      sheetId = existing.id;
      await this.supabase
        .from('rate_sheet_items')
        .delete()
        .eq('rate_sheet_id', sheetId);
    } else {
      // Create a new sheet for today
      const { data: sheet, error } = await this.supabase
        .from('rate_sheets')
        .insert({ date: today, created_by: createdBy })
        .select()
        .single();
      if (error) throw error;
      sheetId = sheet.id;
    }

    if (items.length > 0) {
      await this.supabase
        .from('rate_sheet_items')
        .insert(items.map((item) => ({ rate_sheet_id: sheetId, ...item })));

      this.broadcastRateSheetToSalespersons(items, today);
    }

    return this.getTodayRateSheet();
  }

  async lockRateSheet(id: string, lockedBy: string) {
    const { data, error } = await this.supabase
      .from('rate_sheets')
      .update({ locked_at: new Date().toISOString(), locked_by: lockedBy })
      .eq('id', id)
      .select('*, rate_sheet_items(*)')
      .single();

    if (error) throw error;

    if (data && data.rate_sheet_items) {
      this.broadcastRateSheetToSalespersons(
        data.rate_sheet_items,
        data.date || new Date().toISOString().split('T')[0],
      );
    }

    return data;
  }

  async updateRateSheet(id: string, items: any[], updatedBy: string) {
    // 1. Unlock the sheet (clear locked_at and locked_by)
    const { error: sheetError } = await this.supabase
      .from('rate_sheets')
      .update({
        locked_at: null,
        locked_by: null,
        created_by: updatedBy,
      })
      .eq('id', id);

    if (sheetError) throw sheetError;

    // 2. Delete old items
    const { error: deleteError } = await this.supabase
      .from('rate_sheet_items')
      .delete()
      .eq('rate_sheet_id', id);

    if (deleteError) throw deleteError;

    // 3. Insert new items
    if (items.length > 0) {
      const { error: insertError } = await this.supabase
        .from('rate_sheet_items')
        .insert(items.map((item) => ({ rate_sheet_id: id, ...item })));

      if (insertError) throw insertError;
    }

    return this.getTodayRateSheet();
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

  private async broadcastRateSheetToSalespersons(
    items: any[],
    dateStr: string,
  ) {
    try {
      const { data: salespersons } = await this.supabase
        .from('employees')
        .select('phone, name')
        .eq('role', 'salesperson')
        .eq('is_active', true);

      if (!salespersons || salespersons.length === 0) return;

      const formattedItems = items
        .map(
          (i) =>
            `• *${i.category || 'Product'}* (${i.grade || 'Standard'}${i.dimensions ? ` ${i.dimensions}` : ''}): *₹${Number(i.price_per_mt || i.price || 0).toLocaleString('en-IN')} / MT*`,
        )
        .join('\n');

      const message =
        ` *OFFICIAL RATE SHEET FINALIZED & UPDATED!*\n\n` +
        ` Date: *${dateStr}*\n\n` +
        `${formattedItems}\n\n` +
        `All new customer inquiries & bot calculations are now updated to these rates! `;

      const token = process.env.WHATSAPP_TOKEN;
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

      if (!token || !phoneId) return;

      for (const sp of salespersons) {
        if (!sp.phone) continue;
        const cleanPhone = sp.phone.replace(/\D/g, '');
        try {
          await firstValueFrom(
            this.httpService.post(
              `https://graph.facebook.com/v18.0/${phoneId}/messages`,
              {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanPhone,
                type: 'text',
                text: { body: message },
              },
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              },
            ),
          );
        } catch (err) {
          this.logger.warn(
            `Failed to send rate sheet broadcast to ${sp.name}:`,
            err.message,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        'Error in broadcastRateSheetToSalespersons:',
        error.message,
      );
    }
  }
}
