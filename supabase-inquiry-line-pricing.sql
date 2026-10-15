-- Persisted procurement and sales pricing for existing inquiries.
-- Additive and safe to rerun. Run after supabase-procurement-acl.sql.

ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS pricing_status text,
  ADD COLUMN IF NOT EXISTS procurement_note text,
  ADD COLUMN IF NOT EXISTS decline_sent_at timestamptz;

ALTER TABLE inquiries DROP CONSTRAINT IF EXISTS inquiries_pricing_status_check;
ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_pricing_status_check
  CHECK (
    pricing_status IS NULL
    OR pricing_status IN ('awaiting_price', 'price_ready', 'unavailable', 'sales_priced')
  );

CREATE INDEX IF NOT EXISTS idx_inquiries_pricing_status ON inquiries(pricing_status);

CREATE TABLE IF NOT EXISTS inquiry_line_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  line_key text NOT NULL,
  sku_text text,
  quantity numeric,
  unit text,
  procurement_base_price_per_mt numeric,
  procurement_line_note text,
  line_status text NOT NULL DEFAULT 'needs_price',
  sales_base_price_per_mt numeric,
  transport_per_mt numeric,
  loading_per_mt numeric,
  margin_per_mt numeric,
  rate_per_mt numeric,
  taxable_amount numeric,
  cgst_amount numeric,
  sgst_amount numeric,
  igst_amount numeric,
  final_amount numeric,
  priced_by uuid,
  sales_priced_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inquiry_id, line_key),
  CONSTRAINT inquiry_line_pricing_status_check
    CHECK (line_status IN ('needs_price', 'priced', 'cannot_price')),
  CONSTRAINT inquiry_line_pricing_non_negative_check
    CHECK (
      (procurement_base_price_per_mt IS NULL OR procurement_base_price_per_mt >= 0)
      AND (sales_base_price_per_mt IS NULL OR sales_base_price_per_mt >= 0)
      AND (transport_per_mt IS NULL OR transport_per_mt >= 0)
      AND (loading_per_mt IS NULL OR loading_per_mt >= 0)
      AND (margin_per_mt IS NULL OR margin_per_mt >= 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_inquiry_line_pricing_inquiry
  ON inquiry_line_pricing(inquiry_id);

NOTIFY pgrst, 'reload schema';
