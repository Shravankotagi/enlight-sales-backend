-- Enlight Sales OS: Pricing Module Tables
-- Run this in Supabase SQL Editor before deploying backend

-- Rate sheets
create table if not exists rate_sheets (
  id uuid default gen_random_uuid() primary key,
  date date not null default current_date,
  locked_at timestamptz,
  locked_by text,
  created_by text not null,
  created_at timestamptz default now()
);

-- Rate sheet items
create table if not exists rate_sheet_items (
  id uuid default gen_random_uuid() primary key,
  rate_sheet_id uuid references rate_sheets(id) on delete cascade,
  sku_text text not null,
  category text,
  price_per_kg numeric,
  price_per_mt numeric,
  created_at timestamptz default now()
);

-- Floor margins
create table if not exists floor_margins (
  id uuid default gen_random_uuid() primary key,
  category text not null unique,
  floor_pct numeric not null default 5,
  effective_from date not null default current_date,
  set_by text not null,
  created_at timestamptz default now()
);

-- Seed default floor margins
insert into floor_margins (category, floor_pct, set_by)
values 
  ('HR Coil', 5, 'EMP000'),
  ('MS Sheet', 4, 'EMP000'),
  ('MS Flat', 5, 'EMP000'),
  ('TMT Bars', 3, 'EMP000'),
  ('Structural', 4, 'EMP000')
on conflict (category) do nothing;

-- Enable RLS (optional, using service role from backend so this is read-only guide)
-- alter table rate_sheets enable row level security;
-- alter table rate_sheet_items enable row level security;
-- alter table floor_margins enable row level security;
