-- Historical inquiries picked up pricing_status = 'awaiting_price' from the
-- column default. Clear that default and restore rows created before the
-- procurement pricing workflow. Rows with saved line prices are left alone.
-- Apply in the Supabase SQL editor. Safe to rerun.

ALTER TABLE inquiries ALTER COLUMN pricing_status DROP DEFAULT;

UPDATE inquiries
SET pricing_status = NULL
WHERE created_at < TIMESTAMPTZ '2026-10-15 00:00:00+05:30'
  AND pricing_status = 'awaiting_price'
  AND NOT EXISTS (
    SELECT 1
    FROM inquiry_line_pricing AS priced
    WHERE priced.inquiry_id = inquiries.id
  );

NOTIFY pgrst, 'reload schema';
