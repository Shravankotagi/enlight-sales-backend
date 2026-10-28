-- Open tonnage reviews for Price Ready inquiries whose commercial weight changed.
-- Additive and safe to rerun. Run after supabase-inquiry-line-pricing.sql.
--
-- Rollback:
-- DROP INDEX IF EXISTS idx_inquiries_tonnage_review_open;
-- ALTER TABLE inquiries DROP COLUMN IF EXISTS tonnage_review_open;
-- ALTER TABLE inquiries DROP COLUMN IF EXISTS tonnage_review;

ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS tonnage_review_open boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tonnage_review jsonb;

CREATE INDEX IF NOT EXISTS idx_inquiries_tonnage_review_open
  ON inquiries (procurement_employee_id)
  WHERE tonnage_review_open = true;

NOTIFY pgrst, 'reload schema';
