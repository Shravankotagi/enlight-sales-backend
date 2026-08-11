-- Migration: Add deal_number column to deals table
ALTER TABLE deals ADD COLUMN IF NOT EXISTS deal_number TEXT;
CREATE INDEX IF NOT EXISTS idx_deals_deal_number ON deals(deal_number);

-- Populate existing deals with short Deal IDs based on their UUID
UPDATE deals 
SET deal_number = 'DEAL-' || upper(substring(id::text, 1, 6))
WHERE deal_number IS NULL;
