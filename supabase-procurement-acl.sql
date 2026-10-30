-- Procurement ACL. Additive only: existing rows stay unchanged.
-- Run this in Supabase BEFORE deploying backend code that selects these columns.
ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS procurement_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS procurement_assigned_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_inquiries_procurement_employee ON inquiries(procurement_employee_id);

-- Stored for the ACL UI. Not enforced; role rules live in application code.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS permissions jsonb;

NOTIFY pgrst, 'reload schema';
