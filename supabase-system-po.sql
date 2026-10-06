-- System PO allocation and provenance.
--
-- Run this migration in the Supabase SQL editor before deploying the
-- application changes. Existing legacy PO values are preserved; new orders
-- receive sequential values in the form EM/PO/N.

begin;

alter table if exists deals
  add column if not exists reference_po_number text,
  add column if not exists generated_po_number text,
  add column if not exists po_source text,
  add column if not exists po_status text,
  add column if not exists po_generated_at timestamptz,
  add column if not exists po_confirmed_at timestamptz;

alter table if exists inquiries
  add column if not exists reference_po_number text,
  add column if not exists generated_po_number text,
  add column if not exists po_source text,
  add column if not exists po_status text,
  add column if not exists po_generated_at timestamptz,
  add column if not exists po_confirmed_at timestamptz;

create sequence if not exists system_po_number_seq
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no maxvalue
  cache 1;

create table if not exists po_number_allocations (
  id uuid default gen_random_uuid() primary key,
  po_number text not null,
  normalized_po_number text not null unique,
  allocation_kind text not null default 'system_generated',
  reservation_token text,
  deal_id uuid references deals(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

create index if not exists idx_po_number_allocations_reservation
  on po_number_allocations(reservation_token)
  where reservation_token is not null;

create index if not exists idx_deals_generated_po_number
  on deals(generated_po_number)
  where generated_po_number is not null;

create index if not exists idx_deals_reference_po_number
  on deals(reference_po_number)
  where reference_po_number is not null;

create index if not exists idx_inquiries_reference_po_number
  on inquiries(reference_po_number)
  where reference_po_number is not null;

-- Seed the registry with existing values so a new edit cannot accidentally
-- reuse an existing canonical PO. Duplicate legacy values are retained in
-- the business tables; one registry row is enough to reserve the value.
insert into po_number_allocations (
  po_number,
  normalized_po_number,
  allocation_kind,
  deal_id,
  claimed_at
)
select
  source_po.po_number,
  lower(btrim(source_po.po_number)),
  'legacy',
  source_po.deal_id,
  now()
from (
  select po_number, id as deal_id
  from deals
  where po_number is not null
    and btrim(po_number) <> ''
  union
  select po_number, null::uuid as deal_id
  from inquiries
  where po_number is not null
    and btrim(po_number) <> ''
) source_po
on conflict (normalized_po_number) do nothing;

-- Start after any existing EM/PO/N allocation. If no such value exists the
-- sequence remains at its declared first value, so the first new PO is
-- exactly EM/PO/1.
do $$
declare
  max_system_po bigint;
begin
  select max((substring(po_number from '^EM/PO/([0-9]+)$'))::bigint)
    into max_system_po
  from po_number_allocations
  where po_number ~ '^EM/PO/[0-9]+$';

  if max_system_po is not null and max_system_po > 0 then
    perform setval('system_po_number_seq', max_system_po, true);
  end if;
end
$$;

create or replace function allocate_system_po(
  p_reservation_token text default null,
  p_deal_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_po text;
  candidate_po text;
  candidate_number bigint;
  max_system_number bigint;
begin
  -- Serialize generated-number selection. User-edited PO claims still remain
  -- protected by the registry unique constraint and the retry below.
  perform pg_advisory_xact_lock(hashtext('enlight-system-po-allocator'));

  -- Check after taking the lock so concurrent retries with the same token
  -- remain idempotent and return the first reservation.
  if p_reservation_token is not null and btrim(p_reservation_token) <> '' then
    select po_number
      into existing_po
    from po_number_allocations
    where reservation_token = p_reservation_token
    order by created_at asc
    limit 1;

    if existing_po is not null then
      return existing_po;
    end if;
  end if;

  loop
    -- Reuse the lowest free number. Existing abandoned reservations, claimed
    -- system POs, user-edited values, and legacy seeded values all remain
    -- occupied because they are present in the registry.
    select coalesce(
      max((substring(po_number from '^EM/PO/([0-9]+)$'))::bigint),
      0
    ) + 1
      into max_system_number
    from po_number_allocations
    where po_number ~ '^EM/PO/[0-9]+$';

    select candidate.n
      into candidate_number
    from generate_series(1, max_system_number) as candidate(n)
    where not exists (
      select 1
      from po_number_allocations allocation
      where allocation.normalized_po_number =
        lower('EM/PO/' || candidate.n::text)
    )
    order by candidate.n
    limit 1;

    candidate_po := 'EM/PO/' || candidate_number::text;

    begin
      insert into po_number_allocations (
        po_number,
        normalized_po_number,
        allocation_kind,
        reservation_token,
        deal_id
      )
      values (
        candidate_po,
        lower(candidate_po),
        'system_generated',
        nullif(btrim(p_reservation_token), ''),
        p_deal_id
      );

      return candidate_po;
    exception
      when unique_violation then
        -- A concurrent manual claim may have occupied the candidate after
        -- the availability lookup. Recompute and retry without exposing a
        -- collision.
        null;
    end;
  end loop;
end;
$$;

create or replace function check_po_availability(
  p_po_number text,
  p_reservation_token text default null,
  p_deal_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_value text := lower(btrim(coalesce(p_po_number, '')));
  allocation_row po_number_allocations%rowtype;
begin
  if normalized_value = '' then
    return jsonb_build_object(
      'available', false,
      'reason', 'PO number cannot be blank'
    );
  end if;

  select *
    into allocation_row
  from po_number_allocations
  where normalized_po_number = normalized_value
  limit 1;

  if allocation_row.id is null then
    return jsonb_build_object(
      'available', true,
      'po_number', btrim(p_po_number)
    );
  end if;

  if (
    p_reservation_token is not null
    and allocation_row.reservation_token = p_reservation_token
  ) or (
    p_deal_id is not null
    and allocation_row.deal_id = p_deal_id
  ) then
    return jsonb_build_object(
      'available', true,
      'po_number', allocation_row.po_number
    );
  end if;

  return jsonb_build_object(
    'available', false,
    'po_number', allocation_row.po_number,
    'reason', 'PO number is already allocated'
  );
end;
$$;

create or replace function claim_po_number(
  p_po_number text,
  p_reservation_token text default null,
  p_deal_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_value text := lower(btrim(coalesce(p_po_number, '')));
  allocation_row po_number_allocations%rowtype;
begin
  if normalized_value = '' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'PO number cannot be blank'
    );
  end if;

  select *
    into allocation_row
  from po_number_allocations
  where normalized_po_number = normalized_value
  for update;

  if allocation_row.id is not null then
    if (
      p_reservation_token is not null
      and allocation_row.reservation_token = p_reservation_token
    ) or (
      p_deal_id is not null
      and allocation_row.deal_id = p_deal_id
    ) then
      update po_number_allocations
      set deal_id = coalesce(p_deal_id, deal_id),
          claimed_at = coalesce(claimed_at, now())
      where id = allocation_row.id;

      return jsonb_build_object(
        'claimed', true,
        'po_number', allocation_row.po_number
      );
    end if;

    return jsonb_build_object(
      'claimed', false,
      'conflict', true,
      'po_number', allocation_row.po_number,
      'reason', 'PO number is already allocated'
    );
  end if;

  insert into po_number_allocations (
    po_number,
    normalized_po_number,
    allocation_kind,
    reservation_token,
    deal_id,
    claimed_at
  )
  values (
    btrim(p_po_number),
    normalized_value,
    'user_edit',
    nullif(btrim(p_reservation_token), ''),
    p_deal_id,
    now()
  );

  return jsonb_build_object(
    'claimed', true,
    'po_number', btrim(p_po_number)
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'claimed', false,
      'conflict', true,
      'reason', 'PO number is already allocated'
    );
end;
$$;

create or replace function release_po_reservation(
  p_reservation_token text,
  p_po_number text default null,
  p_deal_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  allocation_row po_number_allocations%rowtype;
begin
  if nullif(btrim(coalesce(p_reservation_token, '')), '') is null then
    return jsonb_build_object(
      'released', false,
      'reason', 'Reservation token is required'
    );
  end if;

  select *
    into allocation_row
  from po_number_allocations
  where reservation_token = btrim(p_reservation_token)
    and allocation_kind = 'system_generated'
    and claimed_at is null
    and (
      p_po_number is null
      or normalized_po_number = lower(btrim(p_po_number))
    )
    and (
      (p_deal_id is null and deal_id is null)
      or (p_deal_id is not null and deal_id = p_deal_id)
    )
  for update;

  if allocation_row.id is null then
    return jsonb_build_object(
      'released', false,
      'reason', 'No matching unclaimed PO reservation found'
    );
  end if;

  delete from po_number_allocations
  where id = allocation_row.id;

  return jsonb_build_object(
    'released', true,
    'po_number', allocation_row.po_number
  );
end;
$$;

grant execute on function allocate_system_po(text, uuid) to service_role;
grant execute on function check_po_availability(text, text, uuid) to service_role;
grant execute on function claim_po_number(text, text, uuid) to service_role;
grant execute on function release_po_reservation(text, text, uuid) to service_role;

commit;
