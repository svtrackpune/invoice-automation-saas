-- Document bank-detail preferences.
-- A business may have multiple bank accounts; document settings select the account(s)
-- to display per document type instead of assuming one business-level account.

alter table public.business_document_preferences
  add column if not exists show_bank_details boolean not null default false;

create table if not exists public.business_document_bank_accounts (
  business_id uuid not null references public.businesses(id) on delete cascade,
  document_type text not null check (document_type = any (array['invoice','quotation','receipt']::text[])),
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (business_id, document_type, bank_account_id)
);

create index if not exists business_document_bank_accounts_account_idx
  on public.business_document_bank_accounts(bank_account_id);

alter table public.business_document_bank_accounts enable row level security;

create policy "business members can read document bank accounts"
  on public.business_document_bank_accounts
  for select
  to public
  using (
    exists (
      select 1
      from public.businesses b
      join public.organization_members om on om.organization_id = b.organization_id
      where b.id = business_document_bank_accounts.business_id
        and om.user_id = auth.uid()
        and om.is_active = true
    )
  );

create policy "business admins can manage document bank accounts"
  on public.business_document_bank_accounts
  for all
  to public
  using (
    exists (
      select 1
      from public.businesses b
      join public.organization_members om on om.organization_id = b.organization_id
      where b.id = business_document_bank_accounts.business_id
        and om.user_id = auth.uid()
        and om.is_active = true
        and om.role = any (array['owner'::member_role,'admin'::member_role])
    )
  )
  with check (
    exists (
      select 1
      from public.businesses b
      join public.organization_members om on om.organization_id = b.organization_id
      where b.id = business_document_bank_accounts.business_id
        and om.user_id = auth.uid()
        and om.is_active = true
        and om.role = any (array['owner'::member_role,'admin'::member_role])
    )
  );
