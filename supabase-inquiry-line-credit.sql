-- Add Credit (rupees per MT) to inquiry line pricing.
-- Additive and safe to rerun. Apply in Supabase; do not run from the app.

ALTER TABLE inquiry_line_pricing
  ADD COLUMN IF NOT EXISTS credit_per_mt numeric;

ALTER TABLE inquiry_line_pricing DROP CONSTRAINT IF EXISTS inquiry_line_pricing_non_negative_check;
ALTER TABLE inquiry_line_pricing
  ADD CONSTRAINT inquiry_line_pricing_non_negative_check
  CHECK (
    (procurement_base_price_per_mt IS NULL OR procurement_base_price_per_mt >= 0)
    AND (sales_base_price_per_mt IS NULL OR sales_base_price_per_mt >= 0)
    AND (transport_per_mt IS NULL OR transport_per_mt >= 0)
    AND (loading_per_mt IS NULL OR loading_per_mt >= 0)
    AND (credit_per_mt IS NULL OR credit_per_mt >= 0)
    AND (margin_per_mt IS NULL OR margin_per_mt >= 0)
  );

NOTIFY pgrst, 'reload schema';
