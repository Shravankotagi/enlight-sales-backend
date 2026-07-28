import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ZohoService {
  private readonly logger = new Logger(ZohoService.name);
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(
    private httpService: HttpService,
    private supabaseService: SupabaseService,
  ) {}

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  // Refresh Zoho access token using refresh token
  async refreshAccessToken(): Promise<string> {
    try {
      // Check if current token is still valid
      if (
        this.accessToken &&
        this.tokenExpiry &&
        new Date() < this.tokenExpiry
      ) {
        return this.accessToken;
      }

      this.logger.log('Refreshing Zoho access token...');

      const params = new URLSearchParams({
        refresh_token: process.env.ZOHO_REFRESH_TOKEN || '',
        client_id: process.env.ZOHO_CLIENT_ID || '',
        client_secret: process.env.ZOHO_CLIENT_SECRET || '',
        grant_type: 'refresh_token',
      });

      const response = await firstValueFrom(
        this.httpService.post(
          'https://accounts.zoho.in/oauth/v2/token',
          params.toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
        ),
      );

      this.accessToken = response.data.access_token;
      // Token expires in 1 hour — set expiry to 55 minutes
      this.tokenExpiry = new Date(Date.now() + 55 * 60 * 1000);

      this.logger.log('Zoho access token refreshed successfully');
      return this.accessToken;
    } catch (error) {
      this.logger.error('Failed to refresh Zoho token:', error.message);
      throw error;
    }
  }

  // Push a deal to Zoho Bigin
  async syncDealToBigin(deal: any): Promise<string | null> {
    try {
      const token = await this.refreshAccessToken();

      // Step 1: Create contact first
      let contactId = '1384628000000465653'; // default sample contact

      if (deal.customer_name) {
        const contact = {
          data: [
            {
              Last_Name: deal.customer_name,
              Phone: deal.customer_phone || '',
              Description: deal.customer_gst ? `GST: ${deal.customer_gst}` : '',
              $layout_id: '1384628000000000171',
            },
          ],
        };

        try {
          const contactRes = await firstValueFrom(
            this.httpService.post(
              'https://www.zohoapis.in/bigin/v1/Contacts',
              contact,
              {
                headers: {
                  Authorization: `Zoho-oauthtoken ${token}`,
                  'Content-Type': 'application/json',
                },
              },
            ),
          );
          const newContactId = contactRes.data?.data?.[0]?.details?.id;
          if (newContactId) {
            contactId = newContactId;
            this.logger.log(`Contact created in Bigin: ${contactId}`);
          }
        } catch (contactError) {
          this.logger.warn(
            'Could not create contact, using default:',
            contactError.message,
          );
        }
      }

      // Step 2: Create deal with contact
      const biginDeal = {
        data: [
          {
            Deal_Name: `${deal.customer_name || 'Unknown'} — ${deal.inquiry_type || 'Inquiry'}`,
            Stage: this.mapStageToBigin(deal.stage),
            Amount: deal.total_amount || 0,
            Contact_Name: { id: contactId },
            Pipeline: 'Sales Pipeline Standard',
            Layout: { id: '1384628000000000173' },
            Description: [
              deal.po_number ? `PO: ${deal.po_number}` : '',
              deal.customer_name ? `Customer: ${deal.customer_name}` : '',
              deal.customer_phone ? `Phone: ${deal.customer_phone}` : '',
              deal.customer_gst ? `GST: ${deal.customer_gst}` : '',
              deal.payment_terms ? `Payment: ${deal.payment_terms}` : '',
            ]
              .filter(Boolean)
              .join(' | '),
            Closing_Date: (() => {
              try {
                if (deal.delivery_date) {
                  const d = new Date(deal.delivery_date);
                  if (!isNaN(d.getTime())) {
                    return d.toISOString().split('T')[0];
                  }
                }
              } catch {}
              return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                .toISOString()
                .split('T')[0];
            })(),
          },
        ],
      };

      const response = await firstValueFrom(
        this.httpService.post(
          'https://www.zohoapis.in/bigin/v1/Deals',
          biginDeal,
          {
            headers: {
              Authorization: `Zoho-oauthtoken ${token}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const biginId = response.data?.data?.[0]?.details?.id;
      this.logger.log(`Deal synced to Bigin: ${biginId}`);

      // Update deal in Supabase with Bigin ID
      if (biginId && deal.id) {
        const { error } = await this.supabase
          .from('deals')
          .update({ bigin_deal_id: biginId })
          .eq('id', deal.id);

        if (error) throw error;
      }

      return biginId;
    } catch (error) {
      this.logger.error('Failed to sync deal to Bigin:', error.message);
      this.logger.error(
        'Bigin error response:',
        JSON.stringify(error.response?.data),
      );
      return null;
    }
  }

  // Map internal stage to Bigin stage
  private mapStageToBigin(stage: string): string {
    const stageMap: Record<string, string> = {
      new_inquiry: 'Qualification',
      qualified: 'Needs Analysis',
      quoted: 'Value Proposition',
      negotiation: 'Negotiation/Review',
      won: 'Closed Won',
      lost: 'Closed Lost',
    };
    return stageMap[stage] || 'Qualification';
  }

  // Sync all pending deals to Bigin
  async syncAllPendingDeals(): Promise<{
    synced: number;
    failed: number;
  }> {
    try {
      // Get deals without bigin_deal_id
      const { data: deals, error } = await this.supabase
        .from('deals')
        .select('*')
        .is('bigin_deal_id', null)
        .not('customer_name', 'is', null)
        .limit(50);

      if (error) throw error;
      if (!deals || deals.length === 0) {
        this.logger.log('No pending deals to sync');
        return { synced: 0, failed: 0 };
      }

      this.logger.log(`Syncing ${deals.length} deals to Bigin...`);

      let synced = 0;
      let failed = 0;

      for (const deal of deals) {
        const biginId = await this.syncDealToBigin(deal);
        if (biginId) {
          synced++;
        } else {
          failed++;
        }
        // Rate limiting — wait 200ms between calls
        await new Promise((r) => setTimeout(r, 200));
      }

      this.logger.log(`Sync complete: ${synced} synced, ${failed} failed`);
      return { synced, failed };
    } catch (error) {
      this.logger.error('syncAllPendingDeals error:', error.message);
      throw error;
    }
  }

  // Get sync status
  async getSyncStatus(): Promise<{
    total_deals: number;
    synced_to_bigin: number;
    pending_sync: number;
  }> {
    try {
      const [totalResult, syncedResult] = await Promise.all([
        this.supabase.from('deals').select('id', { count: 'exact' }),
        this.supabase
          .from('deals')
          .select('id', { count: 'exact' })
          .not('bigin_deal_id', 'is', null),
      ]);

      if (totalResult.error) throw totalResult.error;
      if (syncedResult.error) throw syncedResult.error;

      const total = totalResult.count || 0;
      const synced = syncedResult.count || 0;

      return {
        total_deals: total,
        synced_to_bigin: synced,
        pending_sync: total - synced,
      };
    } catch (error) {
      this.logger.error('getSyncStatus error:', error.message);
      throw error;
    }
  }

  // Add contact to Bigin
  async syncContactToBigin(customerName: string, phone: string, gst?: string) {
    try {
      const token = await this.refreshAccessToken();

      const contact = {
        data: [
          {
            Last_Name: customerName,
            Phone: phone,
            Description: gst ? `GST: ${gst}` : '',
          },
        ],
      };

      const response = await firstValueFrom(
        this.httpService.post(
          'https://www.zohoapis.in/bigin/v1/Contacts',
          contact,
          {
            headers: {
              Authorization: `Zoho-oauthtoken ${token}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const contactId = response.data?.data?.[0]?.details?.id;
      this.logger.log(`Contact synced to Bigin: ${contactId}`);
      return contactId;
    } catch (error) {
      this.logger.error('syncContactToBigin error:', error.message);
      return null;
    }
  }
}
