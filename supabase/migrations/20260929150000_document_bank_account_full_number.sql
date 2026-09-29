alter table public.bank_accounts
  add column if not exists account_number text;

comment on column public.bank_accounts.account_number is
  'Full business bank account number used only when the business explicitly selects bank details for customer-facing documents.';

create index if not exists bank_accounts_business_account_number_idx
  on public.bank_accounts(business_id)
  where is_active = true and account_number is not null;