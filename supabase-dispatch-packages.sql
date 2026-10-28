-- Draft invoice dispatch packages.
-- Apply in the Supabase project used by feature/invoice. Do not run this from the app.
--
-- Rollback:
--   DROP TABLE IF EXISTS dispatch_package_files;
--   DROP TABLE IF EXISTS dispatch_packages;

CREATE TABLE IF NOT EXISTS dispatch_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL,
  hold_reason text,
  template_text text,
  parsed jsonb NOT NULL DEFAULT '{}'::jsonb,
  deal_id uuid,
  zoho_project_id text,
  zoho_bill_id text,
  zoho_invoice_id text,
  vendor_bill_number text,
  vehicle_number text,
  customer_po text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_packages_status
  ON dispatch_packages (status, created_at DESC);

CREATE TABLE IF NOT EXISTS dispatch_package_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES dispatch_packages (id) ON DELETE CASCADE,
  kind text NOT NULL,
  file_name text,
  mime text,
  content_base64 text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_package_files_package
  ON dispatch_package_files (package_id);

-- Service-role clients bypass RLS. No policy is granted to the anon key,
-- so file bytes stay on the server.
ALTER TABLE dispatch_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_package_files ENABLE ROW LEVEL SECURITY;
