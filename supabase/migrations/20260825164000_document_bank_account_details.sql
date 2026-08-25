alter table public.bank_accounts
  add column if not exists account_holder_name text,
  add column if not exists ifsc_code text,
  add column if not exists branch_name text,
  add column if not exists account_type text,
  add column if not exists is_primary boolean not null default false;

create index if not exists bank_accounts_business_primary_idx
  on public.bank_accounts(business_id, is_primary)
  where is_active = true;
