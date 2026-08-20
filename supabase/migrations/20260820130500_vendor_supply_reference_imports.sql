-- Vendor supply reference mappings.
-- This is intentionally separate from vendor_purchase_items: these mappings describe
-- what a supplier deals in, without imposing price, MOQ, lead time, or purchase terms.
create table if not exists public.vendor_supply_mappings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  product_service_id uuid references public.products_services(id) on delete set null,
  item_name text not null,
  source_type text not null default 'manual' check (source_type in ('catalog','manual','csv','xlsx','txt','image')),
  source_name text,
  source_reference text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_supply_mappings_name_nonempty check (length(trim(item_name)) > 0)
);

create index if not exists vendor_supply_mappings_vendor_idx
  on public.vendor_supply_mappings(business_id,vendor_id,is_active,created_at desc);

create unique index if not exists vendor_supply_mappings_vendor_name_uq
  on public.vendor_supply_mappings(business_id,vendor_id,lower(trim(item_name)))
  where is_active;

alter table public.vendor_supply_mappings enable row level security;

drop policy if exists vendor_supply_mappings_select on public.vendor_supply_mappings;
drop policy if exists vendor_supply_mappings_insert on public.vendor_supply_mappings;
drop policy if exists vendor_supply_mappings_update on public.vendor_supply_mappings;
drop policy if exists vendor_supply_mappings_delete on public.vendor_supply_mappings;

create policy vendor_supply_mappings_select on public.vendor_supply_mappings
  for select to authenticated
  using (mm_private.is_org_member(mm_private.business_org(business_id)));

create policy vendor_supply_mappings_insert on public.vendor_supply_mappings
  for insert to authenticated
  with check (
    mm_private.has_business_permission(business_id,'vendors.manage')
    or mm_private.has_business_permission(business_id,'purchases.manage')
  );

create policy vendor_supply_mappings_update on public.vendor_supply_mappings
  for update to authenticated
  using (
    mm_private.has_business_permission(business_id,'vendors.manage')
    or mm_private.has_business_permission(business_id,'purchases.manage')
  )
  with check (
    mm_private.has_business_permission(business_id,'vendors.manage')
    or mm_private.has_business_permission(business_id,'purchases.manage')
  );

create policy vendor_supply_mappings_delete on public.vendor_supply_mappings
  for delete to authenticated
  using (
    mm_private.has_business_permission(business_id,'vendors.manage')
    or mm_private.has_business_permission(business_id,'purchases.manage')
  );

create or replace function public.set_vendor_supply_mapping_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists vendor_supply_mappings_updated_at on public.vendor_supply_mappings;
create trigger vendor_supply_mappings_updated_at
before update on public.vendor_supply_mappings
for each row execute function public.set_vendor_supply_mapping_updated_at();
