-- Enlight Sales OS Chatbot — Phase 2 Row-Level Security (RLS) Migration
-- Enables Row-Level Security on operational tables and defines policies for salesperson, manager, and admin roles.

-- 1. Enable RLS on deals
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS deals_role_policy ON deals;

CREATE POLICY deals_role_policy ON deals
  FOR ALL
  USING (
    -- Admin has full access
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'admin'
    OR
    -- Salesperson sees own deals
    (salesperson_phone = (current_setting('request.jwt.claims', true)::jsonb ->> 'phone'))
    OR
    (employee_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'employee_id'))
    OR
    -- Manager sees deals for self + subordinates
    (salesperson_phone IN (
      SELECT phone FROM employees 
      WHERE reports_to_employee_id IS NOT NULL 
        AND reports_to_employee_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'employee_id')
    ))
  );

-- 2. Enable RLS on deal_items
ALTER TABLE deal_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_items_role_policy ON deal_items;

CREATE POLICY deal_items_role_policy ON deal_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM deals d 
      WHERE d.id = deal_items.deal_id
    )
  );

-- 3. Enable RLS on recurring_customers
ALTER TABLE recurring_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recurring_customers_role_policy ON recurring_customers;

CREATE POLICY recurring_customers_role_policy ON recurring_customers
  FOR ALL
  USING (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'admin'
    OR
    (assigned_salesperson_phone = (current_setting('request.jwt.claims', true)::jsonb ->> 'phone'))
    OR
    (assigned_salesperson_phone IN (
      SELECT phone FROM employees 
      WHERE reports_to_employee_id IS NOT NULL 
        AND reports_to_employee_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'employee_id')
    ))
  );

-- 4. Enable RLS on payment_tracking
ALTER TABLE payment_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_tracking_role_policy ON payment_tracking;

CREATE POLICY payment_tracking_role_policy ON payment_tracking
  FOR ALL
  USING (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'admin'
    OR
    (salesperson_phone = (current_setting('request.jwt.claims', true)::jsonb ->> 'phone'))
    OR
    (salesperson_phone IN (
      SELECT phone FROM employees 
      WHERE reports_to_employee_id IS NOT NULL 
        AND reports_to_employee_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'employee_id')
    ))
  );
