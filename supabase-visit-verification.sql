-- Customer visit phone verification.
-- Apply in Supabase. Do not run this from the app.
--
-- Rollback:
--   DROP TABLE IF EXISTS visit_phone_verifications;
--   ALTER TABLE customer_visits
--     DROP COLUMN IF EXISTS phone_verified,
--     DROP COLUMN IF EXISTS phone_verified_at,
--     DROP COLUMN IF EXISTS location_source,
--     DROP COLUMN IF EXISTS visit_latitude,
--     DROP COLUMN IF EXISTS visit_longitude,
--     DROP COLUMN IF EXISTS preferred_make_other,
--     DROP COLUMN IF EXISTS customer_type_other;

CREATE TABLE IF NOT EXISTS visit_phone_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  locked boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  verification_token_hash text,
  token_expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visit_phone_verifications_phone
  ON visit_phone_verifications (phone, created_at DESC);

ALTER TABLE customer_visits
  ADD COLUMN IF NOT EXISTS phone_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS location_source text,
  ADD COLUMN IF NOT EXISTS visit_latitude numeric,
  ADD COLUMN IF NOT EXISTS visit_longitude numeric,
  ADD COLUMN IF NOT EXISTS preferred_make_other text,
  ADD COLUMN IF NOT EXISTS customer_type_other text;

-- Service-role clients bypass RLS. This table is not granted to anon or authenticated.
REVOKE ALL ON TABLE visit_phone_verifications FROM anon, authenticated;
