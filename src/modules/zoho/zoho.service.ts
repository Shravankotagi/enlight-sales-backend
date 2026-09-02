import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { firstValueFrom } from 'rxjs';

const KNOWN_CONTACT_PERSONS: Record<string, string> = {
  'hp oil engines ltd.': 'Girish Kulkarni',
  'kirloskar oil engines ltd.': 'Anil Deshmukh',
  'tech industries': 'Sunil Patil',
  'tech industries pvt. ltd.': 'Sunil Patil',
  'dynamic engineering works': 'Nikhil Sharma',
  'dynamic engineering': 'Nikhil Sharma',
  'apex infra & engineering pvt. ltd.': 'Pravin Mehta',
  'apex metals & engg': 'Pravin Mehta',
  'avion exim pvt. ltd.': 'Vikas Patil',
  'akshar technovart pvt. ltd.': 'Rajendra Shinde',
  'sb scafform technovert pvt. ltd.': 'Santosh Borate',
  'sharma construction': 'Ramesh Sharma',
  'patel construction': 'Dinesh Patel',
  'vishal industries': 'Vishal Joshi',
  'om steel': 'Omkar Chougule',
  'radhika steels': 'Radhika Shah',
  'krishna structurals': 'Krishna Jadhav',
  'suraj metal': 'Suraj More',
  'mehta engineering': 'Bhavin Mehta',
  'supreme steel': 'Ketan Gandhi',
  'ram ratna infrastructure pvt. ltd.': 'Ramesh Rathi',
  'bhushan steel works': 'Bhushan Kadam',
  'kirloskar pneumatic': 'Sanjay Sawant',
  'vardhaman engineering': 'Vijay Jain',
  'mahalaxmi steel': 'Mahadev Pawar',
  'rathi steel corp': 'Rajesh Rathi',
  'delta structural steel': 'Deepak Verma',
};

const STAGE_MAP: Record<string, string> = {
  won: 'Closed Won',
  lost: 'Closed Lost',
  negotiation: 'Negotiation/Review',
  quoted: 'Proposal/Price Quote',
  qualified: 'Needs Analysis',
  new_inquiry: 'Qualification',
};

@Injectable()
export class ZohoService implements OnModuleInit {
  private readonly logger = new Logger(ZohoService.name);
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private syncInterval: NodeJS.Timeout | null = null;

  constructor(
    private httpService: HttpService,
    private supabaseService: SupabaseService,
  ) {}

  onModuleInit() {
    this.logger.log(
      'Initializing Zoho Bigin Auto-Sync Engine (Interval: 5 minutes)...',
    );
    // Start recurring 5-minute background auto-sync
    this.syncInterval = setInterval(
      () => {
        this.autoSyncRoutine().catch((err) => {
          this.logger.warn(`Auto-sync notice: ${err?.message}`);
        });
      },
      5 * 60 * 1000,
    );
  }

  private get supabase() {
    return this.supabaseService.getAdminClient();
  }

  // Refresh Zoho access token using refresh token
  async refreshAccessToken(): Promise<string> {
    try {
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
      this.tokenExpiry = new Date(Date.now() + 50 * 60 * 1000);

      this.logger.log('Zoho access token refreshed successfully');
      return this.accessToken;
    } catch (error) {
      this.logger.error('Failed to refresh Zoho token:', error.message);
      throw error;
    }
  }

  // ── Step 1: Wipe All Zoho Bigin Data ─────────────────────────────────────────
  async wipeAllBiginData(): Promise<{
    success: boolean;
    deleted: Record<string, number>;
  }> {
    const token = await this.refreshAccessToken();
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };
    const baseUrl = 'https://www.zohoapis.in/bigin/v1';
    const deletedCounts: Record<string, number> = {};

    const modules = ['Notes', 'Deals', 'Contacts', 'Accounts'];
    for (const mod of modules) {
      let count = 0;
      let hasMore = true;
      while (hasMore) {
        try {
          const res = await firstValueFrom(
            this.httpService.get(`${baseUrl}/${mod}?page=1&per_page=100`, {
              headers,
            }),
          );
          const records = res.data?.data || [];
          if (records.length === 0) {
            hasMore = false;
            break;
          }
          const ids = records.map((r: any) => r.id).join(',');
          await firstValueFrom(
            this.httpService.delete(`${baseUrl}/${mod}?ids=${ids}`, {
              headers,
            }),
          );
          count += records.length;
          if (records.length < 100) hasMore = false;
        } catch {
          hasMore = false;
        }
      }
      deletedCounts[mod] = count;
      this.logger.log(`Wiped ${count} records from ${mod}`);
    }

    return { success: true, deleted: deletedCounts };
  }

  // ── Step 2 & 3: Full Re-Sync with Correct Field Mapping ──────────────────────
  async fullResyncAllData(): Promise<{
    success: boolean;
    companiesCreated: number;
    contactsCreated: number;
    dealsSynced: number;
    notesAttached: number;
  }> {
    const token = await this.refreshAccessToken();
    const headers = {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    };
    const baseUrl = 'https://www.zohoapis.in/bigin/v1';

    this.logger.log('Starting full re-sync to Zoho Bigin...');

    // Fetch all Supabase data
    const [
      { data: customers },
      { data: deals },
      { data: dealItems },
      { data: visits },
      { data: complaints },
      { data: employees },
    ] = await Promise.all([
      this.supabase.from('recurring_customers').select('*'),
      this.supabase.from('deals').select('*'),
      this.supabase.from('deal_items').select('*'),
      this.supabase.from('customer_visits').select('*'),
      this.supabase.from('complaints').select('*'),
      this.supabase.from('employees').select('name, phone'),
    ]);

    const empMap = new Map<string, string>();
    (employees || []).forEach((e) => {
      if (e.phone) {
        const clean = e.phone.replace(/\D/g, '').slice(-10);
        if (clean) empMap.set(clean, e.name);
      }
    });

    const visitPersonMap = new Map<string, string>();
    (visits || []).forEach((v) => {
      if (v.customer_name && v.person_met && v.person_met.trim()) {
        const cleanMet = v.person_met.trim();
        if (
          cleanMet.toLowerCase() !== 'contact person' &&
          cleanMet.toLowerCase() !== 'unknown' &&
          cleanMet.length > 2
        ) {
          visitPersonMap.set(v.customer_name.toLowerCase().trim(), cleanMet);
        }
      }
    });

    const dealItemsMap = new Map<string, any[]>();
    (dealItems || []).forEach((it) => {
      const list = dealItemsMap.get(it.deal_id) || [];
      list.push(it);
      dealItemsMap.set(it.deal_id, list);
    });

    // 1. Build Unique Companies List
    const companyMap = new Map<string, any>();
    (customers || []).forEach((c) => {
      const name = (c.customer_name || '').trim();
      if (name && !companyMap.has(name.toLowerCase())) {
        companyMap.set(name.toLowerCase(), {
          name: name,
          phone: c.customer_phone || '',
          gst: c.customer_gst || '',
          address: c.customer_address || '',
          contact_person: c.contact_person || '',
          industry: c.industry || 'Steel & Manufacturing',
          salesperson:
            empMap.get(
              (c.assigned_salesperson_phone || '')
                .replace(/\D/g, '')
                .slice(-10),
            ) || 'Sales Team',
        });
      }
    });

    (deals || []).forEach((d) => {
      const name = (d.customer_name || '').trim();
      if (name && !companyMap.has(name.toLowerCase())) {
        companyMap.set(name.toLowerCase(), {
          name: name,
          phone: d.customer_phone || '',
          gst: d.customer_gst || '',
          address: d.delivery_location || '',
          contact_person: '',
          industry: 'Steel & Manufacturing',
          salesperson:
            empMap.get(
              (d.salesperson_phone || '').replace(/\D/g, '').slice(-10),
            ) || 'Sales Team',
        });
      }
    });

    // 2. Create Companies (Accounts module)
    const companyList = Array.from(companyMap.values());
    const accountIdMap = new Map<string, string>();

    for (let i = 0; i < companyList.length; i += 50) {
      const chunk = companyList.slice(i, i + 50);
      const payload = {
        data: chunk.map((c) => ({
          Account_Name: c.name,
          Phone: c.phone || '',
          Billing_City: c.address ? c.address.substring(0, 50) : '',
          Description: [
            c.gst ? `GST: ${c.gst}` : '',
            c.industry ? `Industry: ${c.industry}` : '',
            `Salesperson: ${c.salesperson}`,
          ]
            .filter(Boolean)
            .join(' | '),
        })),
      };

      try {
        const res = await firstValueFrom(
          this.httpService.post(`${baseUrl}/Accounts`, payload, { headers }),
        );
        const results = res.data?.data || [];
        results.forEach((r: any, idx: number) => {
          if (r.code === 'SUCCESS' && r.details?.id) {
            accountIdMap.set(chunk[idx].name.toLowerCase(), r.details.id);
          }
        });
      } catch (err: any) {
        this.logger.warn(`Accounts batch create notice: ${err?.message}`);
      }
    }

    // 3. Create Contacts with Actual Person Name + Linked Account
    const contactIdMap = new Map<string, string>();

    for (let i = 0; i < companyList.length; i += 50) {
      const chunk = companyList.slice(i, i + 50);
      const payload = {
        data: chunk.map((c) => {
          const lower = c.name.toLowerCase();
          const accountId = accountIdMap.get(lower);

          let personName =
            c.contact_person ||
            visitPersonMap.get(lower) ||
            KNOWN_CONTACT_PERSONS[lower] ||
            '';
          if (!personName) {
            personName = 'Purchase Head';
          }

          const parts = personName.trim().split(/\s+/);
          let firstName = '';
          let lastName = personName;
          if (parts.length > 1) {
            firstName = parts.slice(0, -1).join(' ');
            lastName = parts[parts.length - 1];
          }

          const contactRecord: Record<string, any> = {
            First_Name: firstName,
            Last_Name: lastName,
            Phone: c.phone || '',
            Mobile: c.phone || '',
            Title: 'Purchase / Operations Head',
            Description: `Point of Contact for ${c.name} | Sales Rep: ${c.salesperson}`,
          };

          if (accountId) {
            contactRecord.Account_Name = { id: accountId };
          }

          return contactRecord;
        }),
      };

      try {
        const res = await firstValueFrom(
          this.httpService.post(`${baseUrl}/Contacts`, payload, { headers }),
        );
        const results = res.data?.data || [];
        results.forEach((r: any, idx: number) => {
          if (r.code === 'SUCCESS' && r.details?.id) {
            contactIdMap.set(chunk[idx].name.toLowerCase(), r.details.id);
          }
        });
      } catch (err: any) {
        this.logger.warn(`Contacts batch create notice: ${err?.message}`);
      }
    }

    // 4. Create Deals in Pipeline
    let dealsCreatedCount = 0;
    const allDeals = deals || [];

    for (let i = 0; i < allDeals.length; i += 50) {
      const chunk = allDeals.slice(i, i + 50);
      const payload = {
        data: chunk.map((d) => {
          const companyLower = (d.customer_name || '').toLowerCase().trim();
          const accountId = accountIdMap.get(companyLower);
          const contactId = contactIdMap.get(companyLower);

          const items = dealItemsMap.get(d.id) || [];
          const primaryItem =
            items.length > 0 && items[0].sku_text
              ? `${items[0].sku_text}${items[0].quantity ? ` (${items[0].quantity} ${items[0].unit || 'MT'})` : ''}`
              : 'Steel Order';

          const shortId = d.id
            ? ` [#${d.id.substring(0, 6).toUpperCase()}]`
            : '';
          const dealName =
            `${d.customer_name || 'Customer'} - ${primaryItem}${shortId}`.substring(
              0,
              100,
            );

          const itemSummary = items
            .map(
              (it) =>
                `• ${it.sku_text || 'Item'} ${it.dimensions || ''}: ${it.quantity || 0} ${it.unit || 'MT'} @ ₹${Number(it.rate || 0).toLocaleString('en-IN')}`,
            )
            .join('\n');

          const dealRecord: Record<string, any> = {
            Deal_Name: dealName,
            Stage: STAGE_MAP[d.stage] || 'Qualification',
            Amount: Number(d.total_amount) || 0,
            Pipeline: 'Sales Pipeline Standard',
            Closing_Date: (() => {
              try {
                if (d.delivery_date)
                  return new Date(d.delivery_date).toISOString().split('T')[0];
                if (d.won_at)
                  return new Date(d.won_at).toISOString().split('T')[0];
                if (d.po_date)
                  return new Date(d.po_date).toISOString().split('T')[0];
                if (d.created_at)
                  return new Date(d.created_at).toISOString().split('T')[0];
              } catch {}
              return new Date().toISOString().split('T')[0];
            })(),
            Description: [
              d.po_number ? `PO Number: ${d.po_number}` : '',
              d.delivery_location
                ? `Delivery Location: ${d.delivery_location}`
                : '',
              d.payment_terms ? `Payment Terms: ${d.payment_terms}` : '',
              itemSummary ? `\nLine Items:\n${itemSummary}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          };

          if (accountId) dealRecord.Account_Name = { id: accountId };
          if (contactId) dealRecord.Contact_Name = { id: contactId };

          return dealRecord;
        }),
      };

      try {
        const res = await firstValueFrom(
          this.httpService.post(`${baseUrl}/Deals`, payload, { headers }),
        );
        const results = res.data?.data || [];
        results.forEach((r: any, idx: number) => {
          if (r.code === 'SUCCESS' && r.details?.id) {
            dealsCreatedCount++;
            this.supabase
              .from('deals')
              .update({ bigin_deal_id: r.details.id })
              .eq('id', chunk[idx].id)
              .then(() => {});
          }
        });
      } catch (err: any) {
        this.logger.warn(`Deals batch create notice: ${err?.message}`);
      }
    }

    // 5. Attach Notes
    let notesCount = 0;
    for (const v of visits || []) {
      const companyLower = (v.customer_name || '').toLowerCase().trim();
      const contactId = contactIdMap.get(companyLower);
      const accountId = accountIdMap.get(companyLower);
      const parentId = contactId || accountId;
      const parentModule = contactId ? 'Contacts' : 'Accounts';

      if (parentId) {
        const repName =
          empMap.get(
            (v.salesperson_phone || '').replace(/\D/g, '').slice(-10),
          ) || 'Sales Rep';
        try {
          await firstValueFrom(
            this.httpService.post(
              `${baseUrl}/Notes`,
              {
                data: [
                  {
                    Note_Title: `Visit: ${v.customer_name} (${new Date(v.visited_at || Date.now()).toLocaleDateString('en-IN')})`,
                    Note_Content: [
                      `Location: ${v.city || 'Site Visit'}`,
                      `Person Met: ${v.person_met || 'Contact Person'}`,
                      `Salesperson: ${repName}`,
                      `Outcome: ${v.visit_outcome || 'Completed'}`,
                      `Remarks: ${v.remarks || 'Meeting conducted'}`,
                    ].join('\n'),
                    $se_module: parentModule,
                    Parent_Id: parentId,
                  },
                ],
              },
              { headers },
            ),
          );
          notesCount++;
        } catch {}
      }
    }

    // Attach quality complaint notes
    for (const comp of complaints || []) {
      const companyLower = (comp.customer_name || '').toLowerCase().trim();
      const contactId = contactIdMap.get(companyLower);
      const accountId = accountIdMap.get(companyLower);
      const parentId = contactId || accountId;
      const parentModule = contactId ? 'Contacts' : 'Accounts';

      if (parentId) {
        try {
          await firstValueFrom(
            this.httpService.post(
              `${baseUrl}/Notes`,
              {
                data: [
                  {
                    Note_Title: `Quality Complaint: ${comp.product_name || 'Material'} (${comp.status?.toUpperCase() || 'LOGGED'})`,
                    Note_Content: [
                      `Product: ${comp.product_name || comp.affected_product || 'Steel Item'}`,
                      `Type: ${comp.complaint_type || 'Quality'}`,
                      `Status: ${comp.status || 'open'}`,
                      `Description: ${comp.description || ''}`,
                      comp.resolution_notes
                        ? `Resolution: ${comp.resolution_notes}`
                        : '',
                    ]
                      .filter(Boolean)
                      .join('\n'),
                    $se_module: parentModule,
                    Parent_Id: parentId,
                  },
                ],
              },
              { headers },
            ),
          );
          notesCount++;
        } catch {}
      }
    }

    return {
      success: true,
      companiesCreated: accountIdMap.size,
      contactsCreated: contactIdMap.size,
      dealsSynced: dealsCreatedCount,
      notesAttached: notesCount,
    };
  }

  // ── Step 4: Recurring Auto-Sync Engine (Runs every 5 minutes) ───────────────
  async autoSyncRoutine(): Promise<void> {
    try {
      this.logger.log(
        '[ZohoService] Running 5-minute recurring auto-sync to Zoho Bigin...',
      );
      const { data: pendingDeals } = await this.supabase
        .from('deals')
        .select('*')
        .is('bigin_deal_id', null)
        .not('customer_name', 'is', null)
        .limit(20);

      if (pendingDeals && pendingDeals.length > 0) {
        this.logger.log(
          `Found ${pendingDeals.length} unsynced deals. Syncing...`,
        );
        for (const deal of pendingDeals) {
          await this.syncDealToBigin(deal);
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    } catch (err: any) {
      this.logger.warn(`Auto-sync routine notice: ${err?.message}`);
    }
  }

  // Push single deal with Contact Name & Company Name properly mapped
  async syncDealToBigin(deal: any): Promise<string | null> {
    try {
      const token = await this.refreshAccessToken();
      const headers = {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      };
      const baseUrl = 'https://www.zohoapis.in/bigin/v1';

      const customerName = (deal.customer_name || '').trim();
      if (!customerName) return null;

      // 1. Find or create Account (Company)
      let accountId: string | null = null;
      try {
        const searchRes = await firstValueFrom(
          this.httpService.get(
            `${baseUrl}/Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(customerName)})`,
            { headers },
          ),
        );
        accountId = searchRes.data?.data?.[0]?.id || null;
      } catch {}

      if (!accountId) {
        try {
          const accRes = await firstValueFrom(
            this.httpService.post(
              `${baseUrl}/Accounts`,
              {
                data: [
                  {
                    Account_Name: customerName,
                    Phone: deal.customer_phone || '',
                    Billing_City: deal.delivery_location
                      ? deal.delivery_location.substring(0, 50)
                      : '',
                    Description: deal.customer_gst
                      ? `GST: ${deal.customer_gst}`
                      : '',
                  },
                ],
              },
              { headers },
            ),
          );
          accountId = accRes.data?.data?.[0]?.details?.id || null;
        } catch {}
      }

      // 2. Find or create Contact (Actual Person Name)
      let contactId: string | null = null;
      const lower = customerName.toLowerCase();
      const personName = KNOWN_CONTACT_PERSONS[lower] || 'Purchase Head';
      const parts = personName.trim().split(/\s+/);
      let firstName = '';
      let lastName = personName;
      if (parts.length > 1) {
        firstName = parts.slice(0, -1).join(' ');
        lastName = parts[parts.length - 1];
      }

      const contactPayload: Record<string, any> = {
        First_Name: firstName,
        Last_Name: lastName,
        Phone: deal.customer_phone || '',
        Title: 'Purchase / Operations Head',
      };
      if (accountId) contactPayload.Account_Name = { id: accountId };

      try {
        const contactRes = await firstValueFrom(
          this.httpService.post(
            `${baseUrl}/Contacts`,
            { data: [contactPayload] },
            { headers },
          ),
        );
        contactId = contactRes.data?.data?.[0]?.details?.id || null;
      } catch {}

      // 3. Create Deal
      const dealRecord: Record<string, any> = {
        Deal_Name: `${customerName} - ${deal.inquiry_type || 'Steel Order'} [#${deal.id.substring(0, 6).toUpperCase()}]`,
        Stage: STAGE_MAP[deal.stage] || 'Qualification',
        Amount: Number(deal.total_amount) || 0,
        Pipeline: 'Sales Pipeline Standard',
        Closing_Date: new Date().toISOString().split('T')[0],
        Description: [
          deal.po_number ? `PO: ${deal.po_number}` : '',
          deal.delivery_location ? `Delivery: ${deal.delivery_location}` : '',
          deal.payment_terms ? `Payment: ${deal.payment_terms}` : '',
        ]
          .filter(Boolean)
          .join(' | '),
      };

      if (accountId) dealRecord.Account_Name = { id: accountId };
      if (contactId) dealRecord.Contact_Name = { id: contactId };

      const res = await firstValueFrom(
        this.httpService.post(
          `${baseUrl}/Deals`,
          { data: [dealRecord] },
          { headers },
        ),
      );
      const biginId = res.data?.data?.[0]?.details?.id;
      if (biginId) {
        await this.supabase
          .from('deals')
          .update({ bigin_deal_id: biginId })
          .eq('id', deal.id);
        this.logger.log(`Deal synced to Bigin: ${deal.id} -> ${biginId}`);
      }
      return biginId || null;
    } catch (error: any) {
      this.logger.error('Failed to sync deal to Bigin:', error.message);
      return null;
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
    } catch (error: any) {
      this.logger.error('getSyncStatus error:', error.message);
      throw error;
    }
  }
}
