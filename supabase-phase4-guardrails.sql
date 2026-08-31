-- Enlight Sales OS Chatbot - Phase 4 Guardrails, Safety & Spend Cap Migration

-- 1. Create daily_llm_usage table to track daily token usage and estimated USD spend
CREATE TABLE IF NOT EXISTS daily_llm_usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  usage_date date NOT NULL UNIQUE DEFAULT CURRENT_DATE,
  total_prompt_tokens integer DEFAULT 0,
  total_completion_tokens integer DEFAULT 0,
  total_embedding_tokens integer DEFAULT 0,
  estimated_cost_usd numeric(10, 6) DEFAULT 0.0,
  alert_sent boolean DEFAULT false,
  cap_exceeded boolean DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

-- 2. Enable RLS on daily_llm_usage
ALTER TABLE daily_llm_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_llm_usage_admin_policy ON daily_llm_usage;

CREATE POLICY daily_llm_usage_admin_policy ON daily_llm_usage
  FOR ALL
  USING ((current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'admin');
