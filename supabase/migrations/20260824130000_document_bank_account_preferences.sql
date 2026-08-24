-- Document bank-account preferences for invoice/estimate/receipt output.
-- Safe to run after the equivalent live schema has already been applied.

alter table public.business_document_preferences
  add column if not exists show_bank_details boolean not null default false;

create table if not exists public.business_document_bank_accounts (
  business_id uuid not null references public.businesses(id) on delete cascade,
  document_type text not null check (document_type in ('invoice','quotation','receipt')),
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (business_id, document_type, bank_account_id)
);

create index if not exists idx_business_document_bank_accounts_business_doc
  on public.business_document_bank_accounts(business_id, document_type, display_order);

alter table public.business_document_bank_accounts enable row level security;

-- Avoid organization_members recursion: permission helpers are SECURITY DEFINER.
drop policy if exists business_document_bank_accounts_member_select on public.business_document_bank_accounts;
drop policy if exists business_document_bank_accounts_settings_manage on public.business_document_bank_accounts;

create policy business_document_bank_accounts_member_select
  on public.business_document_bank_accounts
  for select to authenticated
  using (mm_private.has_business_permission(business_id, 'settings.manage'));

create policy business_document_bank_accounts_settings_manage
  on public.business_document_bank_accounts
  for all to authenticated
  using (mm_private.has_business_permission(business_id, 'settings.manage'))
  with check (
    mm_private.has_business_permission(business_id, 'settings.manage')
    and exists (
      select 1
      from public.bank_accounts ba
      where ba.id = business_document_bank_accounts.bank_account_id
        and ba.business_id = business_document_bank_accounts.business_id
    )
  );
