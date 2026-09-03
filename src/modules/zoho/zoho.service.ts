import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { firstValueFrom } from 'rxjs';

function cleanPhone(p?: string): string {
  if (!p) return '';
  const digits = String(p).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

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

const REVERSE_STAGE_MAP: Record<string, string> = {
  'Closed Won': 'won',
  'Closed Lost': 'lost',
  'Negotiation/Review': 'negotiation',
  'Proposal/Price Quote': 'quoted',
  Qualification: 'new_inquiry',
  'Needs Analysis': 'qualified',
};

@Injectable()
export class ZohoService implements OnModuleInit {
  private readonly logger = new Logger(ZohoService.name);
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly processedWebhookEvents = new Set<string>();

  constructor(
    private httpService: HttpService,
    private supabaseService: SupabaseService,
  ) {}

  onModuleInit() {
    this.logger.log(
      'Initializing Zoho Bigin Auto-Sync Engine (Interval: 5 minutes)...',
    );
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
    } catch (error: any) {
      this.logger.error('Failed to refresh Zoho token:', error.message);
      throw error;
    }
  }

  // Helper for Zoho API headers
  private async getAuthHeaders() {
    const token = await this.refreshAccessToken();
    return {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    };
  }

  // ── Phase 1: Full Initial Pull & Mapping Engine ───────────────────────────
  async pullInitialSyncFromBigin(): Promise<{
    success: boolean;
    usersImported: number;
    companiesImported: number;
    contactsImported: number;
    dealsImported: number;
    errors: string[];
  }> {
    const baseUrl = 'https://www.zohoapis.in/bigin/v1';
    const headers = await this.getAuthHeaders();
    const results = {
      success: true,
      usersImported: 0,
      companiesImported: 0,
      contactsImported: 0,
      dealsImported: 0,
      errors: [] as string[],
    };

    this.logger.log('[ZohoSync] Starting Phase 1 Full Pull from Zoho Bigin...');

    // ── 1. Pull Users (Salespersons & Managers) ─────────────────────────────
    const empNameToPhoneMap = new Map<string, string>();
    try {
      const userRes = await firstValueFrom(
        this.httpService.get(`${baseUrl}/users?type=AllUsers`, { headers }),
      ).catch(() => ({ data: { users: [] } }));
      const biginUsers = userRes.data?.users || [];

      for (const u of biginUsers) {
        try {
          const fullName = (
            u.full_name || `${u.first_name || ''} ${u.last_name || ''}`
          ).trim();
          const phone = cleanPhone(u.phone || u.mobile);
          const email = (u.email || '').toLowerCase().trim();
          const roleRaw = (u.role?.name || u.profile?.name || '').toLowerCase();

          let appRole = 'salesperson';
          if (roleRaw.includes('admin')) appRole = 'admin';
          else if (roleRaw.includes('manager') || roleRaw.includes('lead'))
            appRole = 'sales_manager';

          if (fullName && phone) {
            empNameToPhoneMap.set(fullName.toLowerCase(), phone);
          }
          if (fullName && u.id) {
            empNameToPhoneMap.set(u.id, phone || fullName);
          }

          if (fullName) {
            // Check existing employee
            const { data: existingEmp } = await this.supabase
              .from('employees')
              .select('id, phone')
              .or(`email.eq.${email || 'none'},name.ilike.${fullName}`)
              .limit(1);

            if (existingEmp && existingEmp.length > 0) {
              await this.supabase
                .from('employees')
                .update({
                  name: fullName,
                  role: appRole,
                  is_active: u.status === 'active',
                  zoho_user_id: u.id,
                })
                .eq('id', existingEmp[0].id);
              if (existingEmp[0].phone) {
                empNameToPhoneMap.set(
                  fullName.toLowerCase(),
                  cleanPhone(existingEmp[0].phone),
                );
              }
            } else {
              // Auto-create new salesperson / manager account from Zoho Bigin
              const newEmpId = `EMP${String(Math.floor(100 + Math.random() * 900))}`;
              const formattedPhone = phone
                ? phone.length === 10
                  ? `91${phone}`
                  : phone
                : null;

              await this.supabase.from('employees').insert({
                employee_id: newEmpId,
                name: fullName,
                phone: formattedPhone,
                email: email || null,
                role: appRole,
                is_active: u.status === 'active',
                zoho_user_id: u.id,
              });

              if (phone) {
                empNameToPhoneMap.set(
                  fullName.toLowerCase(),
                  cleanPhone(phone),
                );
              }
            }
            results.usersImported++;
          }
        } catch (uErr: any) {
          results.errors.push(`User ${u.full_name}: ${uErr.message}`);
        }
      }
    } catch (err: any) {
      this.logger.warn(`Users pull notice: ${err.message}`);
    }

    // Default Salesperson Phone fallback
    const defaultRepPhone =
      empNameToPhoneMap.get('max') ||
      empNameToPhoneMap.get('yash dalmia') ||
      '918262937458';

    // ── 2. Pull Accounts (Companies) with Company Owner Mapping (Image 1) ───
    try {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const accRes = await firstValueFrom(
          this.httpService.get(
            `${baseUrl}/Accounts?page=${page}&per_page=100`,
            { headers },
          ),
        );
        const accounts = accRes.data?.data || [];
        if (accounts.length === 0) break;

        for (const acc of accounts) {
          try {
            const companyName = (acc.Account_Name || '').trim();
            if (!companyName) continue;

            const phone = acc.Phone || '';
            const address = acc.Billing_City || acc.Billing_Street || '';
            const industry = acc.Industry || 'Steel & Manufacturing';
            const gst = (acc.Description || '').match(
              /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/i,
            )?.[0];

            // ── Company Owner Mapping (Core Requirement 1) ──
            const ownerName = (acc.Owner?.name || '').toLowerCase().trim();
            const ownerId = acc.Owner?.id || '';
            const explicitOwnerPhone =
              empNameToPhoneMap.get(ownerName) ||
              empNameToPhoneMap.get(ownerId);
            const assignedPhone = explicitOwnerPhone || defaultRepPhone;

            // Check if customer already exists in DB
            const { data: existingCust } = await this.supabase
              .from('recurring_customers')
              .select('id, customer_name, assigned_salesperson_phone')
              .ilike('customer_name', companyName)
              .limit(1);

            if (!existingCust || existingCust.length === 0) {
              await this.supabase.from('recurring_customers').insert({
                customer_name: companyName,
                customer_phone: phone || null,
                customer_address: address || null,
                customer_gst: gst || null,
                assigned_salesperson_phone: assignedPhone,
                industry: industry,
                is_active: true,
                avg_order_frequency_days: 30,
              });
              results.companiesImported++;
            } else {
              // Update details while protecting existing salesperson assignment
              const updateData: Record<string, any> = {
                updated_at: new Date().toISOString(),
              };
              if (phone) updateData.customer_phone = phone;
              if (address) updateData.customer_address = address;
              if (gst) updateData.customer_gst = gst;

              // Only update assigned rep if customer is unassigned or has an explicit non-fallback owner
              if (
                !existingCust[0].assigned_salesperson_phone &&
                assignedPhone
              ) {
                updateData.assigned_salesperson_phone = assignedPhone;
              } else if (
                explicitOwnerPhone &&
                cleanPhone(existingCust[0].assigned_salesperson_phone) !==
                  cleanPhone(explicitOwnerPhone)
              ) {
                updateData.assigned_salesperson_phone = explicitOwnerPhone;
              }

              await this.supabase
                .from('recurring_customers')
                .update(updateData)
                .eq('id', existingCust[0].id);
              results.companiesImported++;
            }
          } catch (accErr: any) {
            results.errors.push(
              `Company ${acc.Account_Name}: ${accErr.message}`,
            );
          }
        }

        hasMore = accRes.data?.info?.more_records === true;
        page++;
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err: any) {
      this.logger.error(`Accounts pull error: ${err.message}`);
      results.errors.push(`Accounts error: ${err.message}`);
    }

    // ── 3. Pull Contacts & Visits Mapping (Image 2) ─────────────────────────
    try {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const conRes = await firstValueFrom(
          this.httpService.get(
            `${baseUrl}/Contacts?page=${page}&per_page=100`,
            { headers },
          ),
        );
        const contacts = conRes.data?.data || [];
        if (contacts.length === 0) break;

        for (const c of contacts) {
          try {
            const personMet = (
              c.Full_Name || `${c.First_Name || ''} ${c.Last_Name || ''}`
            ).trim();
            const companyName = (
              c.Account_Name?.name ||
              c.Company_Name ||
              ''
            ).trim();
            const contactPhone = c.Mobile || c.Phone || '';
            const ownerName = (c.Owner?.name || '').toLowerCase().trim();
            const repPhone =
              empNameToPhoneMap.get(ownerName) || defaultRepPhone;

            if (companyName && personMet) {
              // Update contact_person on customer
              await this.supabase
                .from('recurring_customers')
                .update({ contact_person: personMet })
                .ilike('customer_name', companyName);

              // Record in customer_visits if valid met person
              if (
                personMet.toLowerCase() !== 'purchase head' &&
                personMet.toLowerCase() !== 'contact person'
              ) {
                const { data: existingVisit } = await this.supabase
                  .from('customer_visits')
                  .select('id')
                  .ilike('customer_name', companyName)
                  .eq('person_met', personMet)
                  .limit(1);

                if (!existingVisit || existingVisit.length === 0) {
                  await this.supabase.from('customer_visits').insert({
                    customer_name: companyName,
                    person_met: personMet,
                    contact_no: contactPhone || null,
                    salesperson_phone: repPhone,
                    remarks: `Contact Synced from Zoho Bigin`,
                    visited_at: new Date().toISOString(),
                  });
                }
              }
              results.contactsImported++;
            }
          } catch (cErr: any) {
            results.errors.push(`Contact ${c.Last_Name}: ${cErr.message}`);
          }
        }

        hasMore = conRes.data?.info?.more_records === true;
        page++;
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err: any) {
      this.logger.error(`Contacts pull error: ${err.message}`);
      results.errors.push(`Contacts error: ${err.message}`);
    }

    // ── 4. Pull Deals ───────────────────────────────────────────────────────
    try {
      const dealRes = await firstValueFrom(
        this.httpService.get(`${baseUrl}/Deals?per_page=100`, { headers }),
      ).catch(() => ({ data: { data: [] } }));
      const biginDeals = dealRes.data?.data || [];

      for (const d of biginDeals) {
        try {
          const dealId = d.id;
          const dealName = d.Deal_Name || '';
          const custName = (
            d.Contact_Name?.name ||
            d.Account_Name?.name ||
            dealName.split('-')[0]
          ).trim();
          if (!custName) continue;

          const dbStage = REVERSE_STAGE_MAP[d.Stage] || 'new_inquiry';
          const amount = Number(d.Amount) || 0;
          const ownerName = (d.Owner?.name || '').toLowerCase().trim();
          const repPhone = empNameToPhoneMap.get(ownerName) || defaultRepPhone;

          const { data: existingDeal } = await this.supabase
            .from('deals')
            .select('id')
            .or(`bigin_deal_id.eq.${dealId},customer_name.ilike.${custName}`)
            .limit(1);

          if (!existingDeal || existingDeal.length === 0) {
            await this.supabase.from('deals').insert({
              customer_name: custName,
              stage: dbStage,
              total_amount: amount,
              bigin_deal_id: dealId,
              salesperson_phone: repPhone,
              inquiry_type: 'inquiry',
              status: 'needs_review',
            });
            results.dealsImported++;
          } else {
            await this.supabase
              .from('deals')
              .update({
                stage: dbStage,
                total_amount: amount,
                bigin_deal_id: dealId,
              })
              .eq('id', existingDeal[0].id);
            results.dealsImported++;
          }
        } catch (dErr: any) {
          results.errors.push(`Deal ${d.Deal_Name}: ${dErr.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Deals pull error: ${err.message}`);
      results.errors.push(`Deals error: ${err.message}`);
    }

    this.logger.log(
      `[ZohoSync] Initial pull complete: ${results.companiesImported} companies, ${results.contactsImported} contacts, ${results.dealsImported} deals`,
    );

    return results;
  }

  // ── Phase 2: Real-time Webhook Event Processing ───────────────────────────
  async processBiginWebhookEvent(payload: any): Promise<void> {
    const eventType = payload?.event || payload?.event_type || 'unknown';
    const entityType = payload?.module || payload?.entity_type || 'unknown';
    const data = payload?.data || payload;
    const entityId = data?.id || payload?.id;

    const eventKey = `${eventType}_${entityType}_${entityId}_${data?.Modified_Time || Date.now()}`;
    if (this.processedWebhookEvents.has(eventKey)) {
      this.logger.log(
        `[ZohoWebhook] Skipped duplicate event (Idempotency): ${eventKey}`,
      );
      return;
    }
    this.processedWebhookEvents.add(eventKey);
    // Keep deduplication set bounded
    if (this.processedWebhookEvents.size > 2000) {
      this.processedWebhookEvents.clear();
    }

    this.logger.log(
      `[ZohoWebhook] Processing ${eventType} on ${entityType} (${entityId})`,
    );

    try {
      const isDelete = eventType.toLowerCase().includes('delete');

      if (entityType.toLowerCase() === 'accounts') {
        const companyName = (data.Account_Name || '').trim();
        if (isDelete) {
          await this.supabase
            .from('recurring_customers')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .or(
              `zoho_account_id.eq.${entityId},customer_name.ilike.${companyName || 'none'}`,
            );
        } else if (companyName) {
          const ownerName = (data.Owner?.name || '').toLowerCase().trim();
          let repPhone = '918262937458';

          if (ownerName) {
            const { data: emps } = await this.supabase
              .from('employees')
              .select('phone')
              .ilike('name', `%${ownerName}%`)
              .limit(1);
            if (emps && emps[0]?.phone) repPhone = cleanPhone(emps[0].phone);
          }

          const { data: existing } = await this.supabase
            .from('recurring_customers')
            .select('id, assigned_salesperson_phone')
            .ilike('customer_name', companyName)
            .limit(1);

          if (!existing || existing.length === 0) {
            await this.supabase.from('recurring_customers').insert({
              customer_name: companyName,
              customer_phone: data.Phone || null,
              customer_address: data.Billing_City || null,
              assigned_salesperson_phone: repPhone,
              industry: data.Industry || 'Steel & Manufacturing',
              is_active: true,
              avg_order_frequency_days: 30,
              zoho_account_id: String(entityId),
            });
          } else {
            const updatePayload: Record<string, any> = {
              customer_phone: data.Phone || undefined,
              customer_address: data.Billing_City || undefined,
              is_active: true,
              zoho_account_id: String(entityId),
              updated_at: new Date().toISOString(),
            };
            if (!existing[0].assigned_salesperson_phone) {
              updatePayload.assigned_salesperson_phone = repPhone;
            }
            await this.supabase
              .from('recurring_customers')
              .update(updatePayload)
              .eq('id', existing[0].id);
          }
        }
      } else if (entityType.toLowerCase() === 'contacts') {
        const personMet = (
          data.Full_Name || `${data.First_Name || ''} ${data.Last_Name || ''}`
        ).trim();
        const companyName = (
          data.Account_Name?.name ||
          data.Company_Name ||
          ''
        ).trim();

        if (companyName && personMet) {
          await this.supabase
            .from('recurring_customers')
            .update({ contact_person: isDelete ? null : personMet })
            .ilike('customer_name', companyName);
        }
      } else if (entityType.toLowerCase() === 'deals') {
        if (isDelete) {
          await this.supabase
            .from('deals')
            .delete()
            .eq('bigin_deal_id', String(entityId));
        } else {
          const dealName = data.Deal_Name || '';
          const custName = (
            data.Contact_Name?.name ||
            data.Account_Name?.name ||
            dealName.split('-')[0]
          ).trim();
          if (custName) {
            const dbStage = REVERSE_STAGE_MAP[data.Stage] || 'new_inquiry';
            const amount = Number(data.Amount) || 0;

            await this.supabase
              .from('deals')
              .update({
                stage: dbStage,
                total_amount: amount,
              })
              .or(
                `bigin_deal_id.eq.${entityId},customer_name.ilike.${custName}`,
              );
          }
        }
      } else if (entityType.toLowerCase() === 'users') {
        const fullName = (
          data.full_name || `${data.first_name || ''} ${data.last_name || ''}`
        ).trim();
        const phone = cleanPhone(data.phone || data.mobile);
        const email = (data.email || '').toLowerCase().trim();
        const roleRaw = (
          data.role?.name ||
          data.profile?.name ||
          ''
        ).toLowerCase();

        let appRole = 'salesperson';
        if (roleRaw.includes('admin')) appRole = 'admin';
        else if (roleRaw.includes('manager') || roleRaw.includes('lead'))
          appRole = 'sales_manager';

        if (eventType === 'user_deactivated' || isDelete) {
          await this.supabase
            .from('employees')
            .update({ is_active: false })
            .or(`zoho_user_id.eq.${entityId},email.eq.${email || 'none'}`);
        } else if (fullName) {
          const { data: existingEmp } = await this.supabase
            .from('employees')
            .select('id')
            .or(
              `zoho_user_id.eq.${entityId},email.eq.${email || 'none'},name.ilike.${fullName}`,
            )
            .limit(1);

          if (existingEmp && existingEmp.length > 0) {
            await this.supabase
              .from('employees')
              .update({
                name: fullName,
                role: appRole,
                is_active: data.status === 'active',
                zoho_user_id: String(entityId),
              })
              .eq('id', existingEmp[0].id);
          } else {
            const newEmpId = `EMP${String(Math.floor(100 + Math.random() * 900))}`;
            const formattedPhone = phone
              ? phone.length === 10
                ? `91${phone}`
                : phone
              : null;

            await this.supabase.from('employees').insert({
              employee_id: newEmpId,
              name: fullName,
              phone: formattedPhone,
              email: email || null,
              role: appRole,
              is_active: data.status === 'active',
              zoho_user_id: String(entityId),
            });
          }
        }
      }

      // Log to activity_logs
      await this.supabase.from('activity_logs').insert({
        source: 'zoho_webhook',
        module: 'crm_sync',
        action_type: eventType,
        entity_type: entityType,
        entity_id: String(entityId),
        description: `Zoho Bigin Webhook processed: ${eventType} for ${entityType}`,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      this.logger.error(
        `[ZohoWebhook] Failed to process webhook event: ${err.message}`,
      );
    }
  }

  // ── Phase 3: Outbound Visit Sync to Bigin Contacts (Image 2) ──────────────
  async syncVisitToBiginContact(visit: {
    customer_name: string;
    person_met?: string;
    contact_no?: string;
    remarks?: string;
    salesperson_name?: string;
    salesperson_phone?: string;
    visited_at?: string;
  }): Promise<string | null> {
    try {
      const token = await this.refreshAccessToken();
      const headers = {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      };
      const baseUrl = 'https://www.zohoapis.in/bigin/v1';

      const companyName = (visit.customer_name || '').trim();
      if (!companyName) return null;

      // 1. Find or create Account (Company)
      let accountId: string | null = null;
      try {
        const searchRes = await firstValueFrom(
          this.httpService.get(
            `${baseUrl}/Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(companyName)})`,
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
                    Account_Name: companyName,
                    Phone: visit.contact_no || '',
                    Description: `Salesperson: ${visit.salesperson_name || 'Sales Team'}`,
                  },
                ],
              },
              { headers },
            ),
          );
          accountId = accRes.data?.data?.[0]?.details?.id || null;
        } catch {}
      }

      // 2. Create/Update Contact with Person Met Name (Core Requirement 2)
      const personName =
        visit.person_met && visit.person_met.trim().length > 2
          ? visit.person_met.trim()
          : KNOWN_CONTACT_PERSONS[companyName.toLowerCase()] || 'Purchase Head';

      const parts = personName.split(/\s+/);
      let firstName = '';
      let lastName = personName;
      if (parts.length > 1) {
        firstName = parts.slice(0, -1).join(' ');
        lastName = parts[parts.length - 1];
      }

      const contactPayload: Record<string, any> = {
        First_Name: firstName,
        Last_Name: lastName,
        Phone: visit.contact_no || '',
        Mobile: visit.contact_no || '',
        Title: 'Purchase / Operations Head',
        Description: `Visit Logged by ${visit.salesperson_name || 'Salesperson'} on ${new Date(visit.visited_at || Date.now()).toLocaleDateString('en-IN')}`,
      };

      if (accountId) contactPayload.Account_Name = { id: accountId };

      let contactId: string | null = null;
      try {
        const conRes = await firstValueFrom(
          this.httpService.post(
            `${baseUrl}/Contacts`,
            { data: [contactPayload] },
            { headers },
          ),
        );
        contactId = conRes.data?.data?.[0]?.details?.id || null;
      } catch {}

      // 3. Attach Visit Note to Contact & Company
      const parentId = contactId || accountId;
      const parentModule = contactId ? 'Contacts' : 'Accounts';

      if (parentId) {
        await firstValueFrom(
          this.httpService.post(
            `${baseUrl}/Notes`,
            {
              data: [
                {
                  Note_Title: `📍 Customer Visit - ${new Date(visit.visited_at || Date.now()).toLocaleDateString('en-IN')}`,
                  Note_Content: [
                    `Company: ${companyName}`,
                    `Person Met: ${personName}`,
                    `Contact Phone: ${visit.contact_no || 'N/A'}`,
                    `Salesperson: ${visit.salesperson_name || 'Sales Team'}`,
                    visit.remarks
                      ? `Discussion & Remarks: ${visit.remarks}`
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
        ).catch(() => null);
      }

      this.logger.log(
        `[ZohoSync] Visit synced to Bigin: ${personName} @ ${companyName}`,
      );
      return contactId || accountId;
    } catch (err: any) {
      this.logger.error(
        `[ZohoSync] Failed to sync visit to Bigin: ${err.message}`,
      );
      return null;
    }
  }

  // ── Wipe All Zoho Bigin Data ──────────────────────────────────────────────
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

  // ── Full Re-Sync with Correct Field Mapping ───────────────────────────────
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
      { data: visits },
      { data: employees },
    ] = await Promise.all([
      this.supabase.from('recurring_customers').select('*'),
      this.supabase.from('deals').select('*'),
      this.supabase.from('customer_visits').select('*'),
      this.supabase.from('employees').select('name, phone'),
    ]);

    const empMap = new Map<string, string>();
    (employees || []).forEach((e) => {
      if (e.phone) {
        const clean = cleanPhone(e.phone);
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
            empMap.get(cleanPhone(c.assigned_salesperson_phone)) ||
            'Sales Team',
        });
      }
    });

    const accountIdMap = new Map<string, string>();
    for (const [key, company] of companyMap.entries()) {
      try {
        const res = await firstValueFrom(
          this.httpService.post(
            `${baseUrl}/Accounts`,
            {
              data: [
                {
                  Account_Name: company.name,
                  Phone: company.phone,
                  Billing_City: company.address
                    ? company.address.substring(0, 50)
                    : '',
                  Industry: company.industry,
                  Description: [
                    company.gst ? `GST: ${company.gst}` : '',
                    `Salesperson: ${company.salesperson}`,
                  ]
                    .filter(Boolean)
                    .join(' | '),
                },
              ],
            },
            { headers },
          ),
        );
        const accId = res.data?.data?.[0]?.details?.id;
        if (accId) accountIdMap.set(key, accId);
      } catch {}
    }

    // 2. Create Contacts with Person Met mapping
    const contactIdMap = new Map<string, string>();
    for (const [key, company] of companyMap.entries()) {
      const accountId = accountIdMap.get(key);
      const lower = key.toLowerCase();
      const personName =
        visitPersonMap.get(lower) ||
        company.contact_person ||
        KNOWN_CONTACT_PERSONS[lower] ||
        'Purchase Head';

      const parts = personName.trim().split(/\s+/);
      let firstName = '';
      let lastName = personName;
      if (parts.length > 1) {
        firstName = parts.slice(0, -1).join(' ');
        lastName = parts[parts.length - 1];
      }

      try {
        const contactPayload: Record<string, any> = {
          First_Name: firstName,
          Last_Name: lastName,
          Phone: company.phone,
          Mobile: company.phone,
          Title: 'Purchase / Operations Head',
        };
        if (accountId) contactPayload.Account_Name = { id: accountId };

        const res = await firstValueFrom(
          this.httpService.post(
            `${baseUrl}/Contacts`,
            { data: [contactPayload] },
            { headers },
          ),
        );
        const conId = res.data?.data?.[0]?.details?.id;
        if (conId) contactIdMap.set(key, conId);
      } catch {}
    }

    // 3. Create Deals
    let dealsCreatedCount = 0;
    for (const deal of deals || []) {
      const custName = (deal.customer_name || '').trim();
      const accountId = accountIdMap.get(custName.toLowerCase());
      const contactId = contactIdMap.get(custName.toLowerCase());

      try {
        const dealRecord: Record<string, any> = {
          Deal_Name: `${custName} - ${deal.inquiry_type || 'Steel Order'} [#${deal.id.substring(0, 6).toUpperCase()}]`,
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
          dealsCreatedCount++;
        }
      } catch {}
    }

    return {
      success: true,
      companiesCreated: accountIdMap.size,
      contactsCreated: contactIdMap.size,
      dealsSynced: dealsCreatedCount,
      notesAttached: 0,
    };
  }

  // ── Recurring Auto-Sync Engine (Runs every 5 minutes) ──────────────────────
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
      const headers = await this.getAuthHeaders();
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

      // 2. Find or create Contact
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
