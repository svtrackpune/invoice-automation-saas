-- Workspace accounting separation / payment routing hardening.
-- Additive only: existing invoices, receipts, bank accounts and customer flows remain intact.

alter table public.accounts
  add column if not exists account_subtype text;

update public.accounts
set account_subtype = case
  when code='1000' then 'cash'
  when code='1010' then 'bank'
  else account_subtype
end
where account_subtype is null and code in ('1000','1010');

alter table public.accounts
  drop constraint if exists accounts_account_subtype_check;
alter table public.accounts
  add constraint accounts_account_subtype_check
  check (account_subtype is null or account_subtype in ('cash','bank'));

comment on column public.accounts.account_subtype is
  'Settlement subtype used to distinguish valid customer deposit accounts from other asset heads. cash and bank are the supported inbound settlement types.';

create table if not exists public.business_payment_method_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  payment_method public.payment_method not null,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, payment_method),
  check (payment_method in ('bank_transfer','upi','cheque','payment_gateway'))
);

create index if not exists business_payment_method_accounts_business_idx
  on public.business_payment_method_accounts(business_id, payment_method, is_active);

alter table public.business_payment_method_accounts enable row level security;

drop policy if exists business_payment_method_accounts_member_select on public.business_payment_method_accounts;
drop policy if exists business_payment_method_accounts_manage on public.business_payment_method_accounts;

create policy business_payment_method_accounts_member_select
  on public.business_payment_method_accounts
  for select to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id=business_id and mm_private.is_org_member(b.organization_id)
  ));

create policy business_payment_method_accounts_manage
  on public.business_payment_method_accounts
  for all to authenticated
  using (mm_private.has_business_permission(business_id,'settings.manage'))
  with check (mm_private.has_business_permission(business_id,'settings.manage'));

create or replace function public.assert_payment_method_bank_scope()
returns trigger
language plpgsql
set search_path=public,mm_private
as $$
declare v_business uuid;
begin
  select business_id into v_business
  from public.bank_accounts
  where id=new.bank_account_id and is_active=true;
  if v_business is null or v_business<>new.business_id then
    raise exception 'Bank account does not belong to this business or is inactive';
  end if;
  new.updated_at:=now();
  return new;
end;
$$;

drop trigger if exists trg_payment_method_bank_scope on public.business_payment_method_accounts;
create trigger trg_payment_method_bank_scope
before insert or update on public.business_payment_method_accounts
for each row execute function public.assert_payment_method_bank_scope();

-- Ensure every selected real bank account has a distinct ledger account.
-- Existing generic 1010 Bank accounts are preserved; new linked ledgers are created only when needed.
create or replace function public.ensure_bank_account_ledger(p_business_id uuid,p_bank_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,mm_private
as $$
declare
  ba public.bank_accounts%rowtype;
  v_account uuid;
  v_code text;
  v_n integer := 1;
begin
  if not (mm_private.has_business_permission(p_business_id,'settings.manage') or mm_private.has_business_permission(p_business_id,'payments.receive')) then
    raise exception 'Access denied';
  end if;

  select * into ba
  from public.bank_accounts
  where id=p_bank_account_id and business_id=p_business_id and is_active=true
  for update;
  if ba.id is null then raise exception 'Bank account not found or inactive'; end if;

  if ba.linked_account_id is not null then
    if exists(select 1 from public.accounts where id=ba.linked_account_id and business_id=p_business_id and is_active=true) then
      return ba.linked_account_id;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('bank-ledger-account:'||p_business_id::text));
  loop
    v_code:='1010-'||lpad(v_n::text,4,'0');
    exit when not exists(select 1 from public.accounts where business_id=p_business_id and code=v_code);
    v_n:=v_n+1;
  end loop;

  insert into public.accounts(
    business_id,code,name,account_type,normal_balance,parent_account_id,is_system,is_active,description,account_subtype
  ) values (
    p_business_id,
    v_code,
    coalesce(nullif(trim(ba.name),''),'Bank Account'),
    'asset','debit',
    (select id from public.accounts where business_id=p_business_id and code='1010' and is_active order by created_at limit 1),
    false,true,
    'Ledger linked to bank account '||coalesce(ba.institution_name,'')||case when ba.account_last4 is not null then ' ••••'||ba.account_last4 else '' end,
    'bank'
  ) returning id into v_account;

  update public.bank_accounts
  set linked_account_id=v_account, updated_at=now()
  where id=ba.id;

  return v_account;
end;
$$;

revoke execute on function public.ensure_bank_account_ledger(uuid,uuid) from public,anon;
grant execute on function public.ensure_bank_account_ledger(uuid,uuid) to authenticated;

create or replace function public.configure_cash_and_carry(
  p_business_id uuid,
  p_enabled boolean,
  p_upi_bank_account_id uuid default null
)
returns void
language plpgsql
security definer
set search_path=public,mm_private
as $$
begin
  if not mm_private.has_business_permission(p_business_id,'settings.manage') then
    raise exception 'Access denied';
  end if;

  if p_upi_bank_account_id is not null then
    perform public.ensure_bank_account_ledger(p_business_id,p_upi_bank_account_id);
    insert into public.business_payment_method_accounts(business_id,payment_method,bank_account_id,is_active)
    values(p_business_id,'upi',p_upi_bank_account_id,true)
    on conflict(business_id,payment_method)
    do update set bank_account_id=excluded.bank_account_id,is_active=true,updated_at=now();
  else
    delete from public.business_payment_method_accounts
    where business_id=p_business_id and payment_method='upi';
  end if;

  insert into public.business_settings(business_id,cash_bill_enabled)
  values(p_business_id,p_enabled)
  on conflict(business_id)
  do update set cash_bill_enabled=excluded.cash_bill_enabled,updated_at=now();
end;
$$;

revoke execute on function public.configure_cash_and_carry(uuid,boolean,uuid) from public,anon;
grant execute on function public.configure_cash_and_carry(uuid,boolean,uuid) to authenticated;

-- Cash & Carry must identify the customer by mobile number. Reuse the workspace customer when possible.
create or replace function public.get_or_create_cash_customer_by_phone(p_business_id uuid,p_phone text)
returns uuid
language plpgsql
security definer
set search_path=public,mm_private
as $$
declare
  v_phone text:=trim(coalesce(p_phone,''));
  v_id uuid;
begin
  if not mm_private.has_business_permission(p_business_id,'customers.manage') then
    raise exception 'Access denied';
  end if;
  if v_phone='' then raise exception 'Customer mobile number is required'; end if;

  select id into v_id
  from public.customers
  where business_id=p_business_id and is_active=true and phone=v_phone
  order by created_at
  limit 1;

  if v_id is null then
    insert into public.customers(
      business_id,display_name,legal_name,email,phone,tax_id,tax_type,billing_address,shipping_address,
      credit_limit,payment_terms_days,notes,metadata,is_active,payment_reminders_enabled,reminder_days_before_due,
      default_discount_type,default_discount_value,relationship_type,product_reminder_after_days,service_recurring,
      service_recurring_interval,service_auto_invoice_days_before,service_reminder_after_days,notify_customer,
      notify_owner,product_reminder_after_unit,service_reminder_after_unit
    ) values(
      p_business_id,'Cash Customer · '||v_phone,'Cash Customer · '||v_phone,null,v_phone,null,'N/A','{}'::jsonb,'{}'::jsonb,0,0,
      'Counter customer identified by mobile number.','{"system":"cash_bill","source":"mobile"}'::jsonb,true,false,0,'none',0,'both',0,
      false,'monthly',0,0,false,false,'days','days'
    ) returning id into v_id;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.get_or_create_cash_customer_by_phone(uuid,text) from public,anon;
grant execute on function public.get_or_create_cash_customer_by_phone(uuid,text) to authenticated;

-- Tighten inbound customer payments: only explicit Cash/Bank settlement ledgers are valid.
create or replace function public.record_customer_payment(p_business_id uuid,p_customer_id uuid,p_invoice_id uuid,p_amount numeric,p_method public.payment_method,p_account_id uuid,p_reference text default null,p_gateway_transaction_id text default null,p_payment_date date default current_date,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public,mm_private as $$
declare inv public.invoices%rowtype; v_payment uuid; v_receipt uuid; v_entry uuid; v_ar uuid; v_credit_acct uuid; v_number text; v_allocated numeric; v_excess numeric; v_total numeric;
begin
 if not mm_private.has_business_permission(p_business_id,'payments.receive') then raise exception 'Access denied'; end if;
 if p_amount<=0 then raise exception 'Payment amount must be greater than zero'; end if;
 perform public.assert_accounting_period_open(p_business_id,p_payment_date);
 select * into inv from public.invoices where id=p_invoice_id and business_id=p_business_id and customer_id=p_customer_id for update;
 if inv.id is null then raise exception 'Invoice not found'; end if;
 if inv.status='void' then raise exception 'Cannot pay a void invoice'; end if;
 if inv.journal_entry_id is null then perform public.post_invoice(inv.id,null); select * into inv from public.invoices where id=inv.id for update; end if;
 if not exists(select 1 from public.accounts where id=p_account_id and business_id=p_business_id and is_active and account_subtype in ('cash','bank')) then raise exception 'Deposit account must be Cash or Bank. Inventory, Furniture & Fixtures and other non-settlement accounts are not valid customer deposit accounts.'; end if;
 select id into v_ar from public.accounts where business_id=p_business_id and code='1100' and is_active;
 if v_ar is null then raise exception 'Accounts receivable account is missing'; end if;
 v_allocated:=least(p_amount,greatest(inv.balance_due,0)); v_excess:=greatest(p_amount-v_allocated,0);
 if v_excess>0 then
  insert into public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description)
  select p_business_id,'2150','Customer Credits','liability','credit',true,true,'Customer overpayments and unapplied credits'
  where not exists(select 1 from public.accounts where business_id=p_business_id and code='2150');
 end if;
 select id into v_credit_acct from public.accounts where business_id=p_business_id and code='2150' and is_active;
 insert into public.payments(business_id,direction,customer_id,invoice_id,account_id,amount,currency_code,payment_date,method,reference,gateway_transaction_id,notes,created_by)
 values(p_business_id,'inbound',p_customer_id,p_invoice_id,p_account_id,p_amount,inv.currency_code,p_payment_date,p_method,p_reference,p_gateway_transaction_id,p_notes,auth.uid()) returning id into v_payment;
 if v_allocated>0 then insert into public.payment_allocations(business_id,payment_id,invoice_id,amount) values(p_business_id,v_payment,p_invoice_id,v_allocated); end if;
 if v_excess>0 then insert into public.customer_credit_ledger(business_id,customer_id,payment_id,entry_type,amount,currency_code,description,created_by) values(p_business_id,p_customer_id,v_payment,'overpayment',v_excess,inv.currency_code,'Unapplied customer overpayment',auth.uid()); end if;
 perform pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));
 insert into public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated)
 values(p_business_id,(select coalesce(max(entry_number),0)+1 from public.journal_entries where business_id=p_business_id),p_payment_date,'Payment received for invoice '||inv.invoice_number,'payment',v_payment,'posted',now(),auth.uid(),auth.uid(),inv.currency_code,p_amount,p_amount,true) returning id into v_entry;
 insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id) values(v_entry,p_account_id,'Customer payment',p_amount,0,inv.currency_code,'customer',p_customer_id);
 if v_allocated>0 then insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id) values(v_entry,v_ar,'Receivable settlement',0,v_allocated,inv.currency_code,'customer',p_customer_id); end if;
 if v_excess>0 then insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id) values(v_entry,v_credit_acct,'Customer credit',0,v_excess,inv.currency_code,'customer',p_customer_id); end if;
 perform public.validate_journal_entry_balance(v_entry); update public.payments set journal_entry_id=v_entry where id=v_payment;
 select coalesce(sum(pa.amount),0) into v_total from public.payment_allocations pa where pa.invoice_id=inv.id;
 update public.invoices set amount_paid=v_total,balance_due=greatest(total-v_total,0),status=case when v_total>=total then 'paid'::invoice_status when v_total>0 and due_date<current_date then 'overdue'::invoice_status when v_total>0 then 'partially_paid'::invoice_status when due_date<current_date then 'overdue'::invoice_status else 'sent'::invoice_status end,updated_at=now() where id=inv.id;
 v_number:=public.next_document_number(p_business_id,'receipt');
 insert into public.receipts(business_id,customer_id,payment_id,receipt_number,receipt_date,amount,currency_code,payment_method,reference_number,notes,created_by) values(p_business_id,p_customer_id,v_payment,v_number,p_payment_date,p_amount,inv.currency_code,p_method::text,p_reference,p_notes,auth.uid()) returning id into v_receipt;
 return v_receipt;
end; $$;

revoke execute on function public.record_customer_payment(uuid,uuid,uuid,numeric,public.payment_method,uuid,text,text,date,text) from public,anon;
grant execute on function public.record_customer_payment(uuid,uuid,uuid,numeric,public.payment_method,uuid,text,text,date,text) to authenticated;
