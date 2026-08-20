create table if not exists public.vendor_purchase_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  product_service_id uuid not null references public.products_services(id) on delete restrict,
  vendor_sku text,
  purchase_price numeric(14,2) not null default 0,
  min_order_quantity numeric(14,3) not null default 1,
  lead_time_days integer not null default 0,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, vendor_id, product_service_id)
);

create index if not exists idx_vendor_purchase_items_vendor on public.vendor_purchase_items(business_id, vendor_id, is_active);
create index if not exists idx_vendor_purchase_items_product on public.vendor_purchase_items(business_id, product_service_id, is_active);

alter table public.vendor_purchase_items enable row level security;
alter table public.vendor_purchase_items force row level security;

drop policy if exists vendor_purchase_items_select on public.vendor_purchase_items;
drop policy if exists vendor_purchase_items_insert on public.vendor_purchase_items;
drop policy if exists vendor_purchase_items_update on public.vendor_purchase_items;
drop policy if exists vendor_purchase_items_delete on public.vendor_purchase_items;

create policy vendor_purchase_items_select on public.vendor_purchase_items
for select to authenticated
using (mm_private.is_org_member(mm_private.business_org(business_id)));

create policy vendor_purchase_items_insert on public.vendor_purchase_items
for insert to authenticated
with check (mm_private.has_business_permission(business_id,'vendors.manage',auth.uid()));

create policy vendor_purchase_items_update on public.vendor_purchase_items
for update to authenticated
using (mm_private.has_business_permission(business_id,'vendors.manage',auth.uid()))
with check (mm_private.has_business_permission(business_id,'vendors.manage',auth.uid()));

create policy vendor_purchase_items_delete on public.vendor_purchase_items
for delete to authenticated
using (mm_private.has_business_permission(business_id,'vendors.manage',auth.uid()));

create or replace function public.validate_vendor_purchase_item()
returns trigger language plpgsql security definer set search_path = public, mm_private
as $$
begin
  if not exists (
    select 1 from public.vendors v
    where v.id = new.vendor_id and v.business_id = new.business_id and v.is_active
  ) then
    raise exception 'Vendor does not belong to this business or is inactive';
  end if;

  if not exists (
    select 1 from public.products_services p
    where p.id = new.product_service_id
      and p.business_id = new.business_id
      and p.is_active
      and p.purchase_enabled
  ) then
    raise exception 'Item is not available for purchase in this business';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_vendor_purchase_item on public.vendor_purchase_items;
create trigger trg_validate_vendor_purchase_item
before insert or update on public.vendor_purchase_items
for each row execute function public.validate_vendor_purchase_item();

create or replace function public.touch_vendor_purchase_items_updated_at()
returns trigger language plpgsql security definer set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_vendor_purchase_items_updated_at on public.vendor_purchase_items;
create trigger trg_vendor_purchase_items_updated_at
before update on public.vendor_purchase_items
for each row execute function public.touch_vendor_purchase_items_updated_at();

revoke all on function public.validate_vendor_purchase_item() from public, anon, authenticated;
revoke all on function public.touch_vendor_purchase_items_updated_at() from public, anon, authenticated;
