-- Non-breaking indexes for the live dashboard and list queries.
-- Safe to run more than once. Does not change tables, policies, or stored rows.

CREATE INDEX IF NOT EXISTS idx_deals_inquiry_id
  ON deals(inquiry_id);

CREATE INDEX IF NOT EXISTS idx_inquiries_status_created_at
  ON inquiries(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inquiries_sender_phone
  ON inquiries(sender_phone);

CREATE INDEX IF NOT EXISTS idx_complaints_reported_by
  ON complaints(reported_by);

CREATE INDEX IF NOT EXISTS idx_complaints_reported_at
  ON complaints(reported_at DESC);

CREATE INDEX IF NOT EXISTS idx_complaints_created_at
  ON complaints(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp
  ON activity_logs(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_salesperson_phone
  ON activity_logs(salesperson_phone);

CREATE INDEX IF NOT EXISTS idx_activity_logs_module_timestamp
  ON activity_logs(module, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_recurring_customers_active_owner
  ON recurring_customers(is_active, assigned_salesperson_phone);
