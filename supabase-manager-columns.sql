-- Migration: Add manager assignment columns to employees table
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES employees(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS manager_phone text;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
