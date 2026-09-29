-- Global locale foundation: BCP-47 locale on the business and user profile.
-- Locale is intentionally free-form so new languages/regions can be added without schema changes.
alter table public.businesses
  add column if not exists locale text not null default 'en-US';

alter table public.user_profiles
  alter column locale set default 'en-US';

-- Business-scoped export audit trail. File contents are generated client-side from RLS-protected data.
create table if not exists public.data_export_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  export_format text not null check (export_format in ('xlsx','csv')),
  scope text not null default 'business_data',
  status text not null default 'started' check (status in ('started','completed','failed')),
  sheet_count integer not null default 0,
  error_summary text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists data_export_logs_business_created_idx
  on public.data_export_logs(business_id, created_at desc);

alter table public.data_export_logs enable row level security;

drop policy if exists data_export_logs_member_select on public.data_export_logs;
drop policy if exists data_export_logs_member_insert on public.data_export_logs;

create policy data_export_logs_member_select
on public.data_export_logs
for select to authenticated
using (exists (
  select 1 from public.businesses b
  where b.id = data_export_logs.business_id
    and mm_private.is_org_member(b.organization_id)
));

create policy data_export_logs_member_insert
on public.data_export_logs
for insert to authenticated
with check (exists (
  select 1 from public.businesses b
  where b.id = data_export_logs.business_id
    and mm_private.is_org_member(b.organization_id)
    and data_export_logs.requested_by = auth.uid()
));
