-- KRA 6: Create crm_sync_log table for tracking Zoho Bigin CRM syncs
CREATE TABLE IF NOT EXISTS crm_sync_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  salesperson_phone TEXT NOT NULL,
  customer_name TEXT,
  activity_type TEXT NOT NULL,
  summary TEXT,
  zoho_contact_id TEXT,
  zoho_deal_id TEXT,
  zoho_note_id TEXT,
  sync_status TEXT DEFAULT 'pending',
  error_message TEXT,
  payload JSONB,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_sync_log_phone ON crm_sync_log(salesperson_phone);
CREATE INDEX IF NOT EXISTS idx_crm_sync_log_customer ON crm_sync_log(customer_name);
CREATE INDEX IF NOT EXISTS idx_crm_sync_log_status ON crm_sync_log(sync_status);
