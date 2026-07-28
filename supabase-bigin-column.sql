-- Run in Supabase SQL Editor
alter table deals
  add column if not exists bigin_deal_id text,
  add column if not exists lost_reason text;

create index if not exists idx_deals_bigin_id 
  on deals(bigin_deal_id);
