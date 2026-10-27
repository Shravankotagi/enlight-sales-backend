-- Salesperson to procurement-person routing, and a procurement number
-- that is not derived from the inquiry id.
-- Apply in the Supabase SQL editor after supabase-procurement-acl.sql.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS assigned_procurement_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_assigned_procurement
  ON employees (assigned_procurement_employee_id);

ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS procurement_number text;

CREATE SEQUENCE IF NOT EXISTS procurement_number_seq START WITH 10001;

UPDATE inquiries
SET procurement_number = 'PR-' || lpad(nextval('procurement_number_seq')::text, 5, '0')
WHERE procurement_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inquiries_procurement_number
  ON inquiries (procurement_number);

SELECT setval(
  'procurement_number_seq',
  GREATEST(
    10000,
    COALESCE(
      (SELECT MAX(CAST(substring(procurement_number from 4) AS integer))
       FROM inquiries
       WHERE procurement_number ~ '^PR-[0-9]+$'),
      10000
    )
  )
);

NOTIFY pgrst, 'reload schema';
