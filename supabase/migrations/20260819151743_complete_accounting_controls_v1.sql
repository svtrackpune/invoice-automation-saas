-- Moneymatters accounting controls v1
-- Idempotent migration matching the live Supabase migration 20260819151743.

create table if not exists public.customer_credit_ledger (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
 customer_id uuid not null references public.customers(id), payment_id uuid references public.payments(id), credit_note_id uuid references public.credit_notes(id), refund_id uuid,
 entry_type text not null check (entry_type in ('overpayment','credit_note','application','refund','adjustment','writeoff_reversal')),
 amount numeric(18,2) not null check (amount <> 0), currency_code char(3) not null, description text, created_by uuid, created_at timestamptz not null default now()
);
create index if not exists customer_credit_ledger_business_customer_idx on public.customer_credit_ledger(business_id,customer_id,created_at);

create table if not exists public.customer_refunds (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade, customer_id uuid not null references public.customers(id), payment_id uuid references public.payments(id), credit_note_id uuid references public.credit_notes(id),
 refund_date date not null default current_date, amount numeric(18,2) not null check(amount>0), currency_code char(3) not null, method text not null, account_id uuid not null references public.accounts(id), reference text, reason text,
 journal_entry_id uuid references public.journal_entries(id), status text not null default 'posted' check(status in ('draft','posted','void')), created_by uuid, created_at timestamptz not null default now()
);
create index if not exists customer_refunds_business_customer_idx on public.customer_refunds(business_id,customer_id,refund_date);

create table if not exists public.write_offs (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade, customer_id uuid references public.customers(id), vendor_id uuid references public.vendors(id), invoice_id uuid references public.invoices(id), bill_id uuid references public.bills(id),
 writeoff_date date not null default current_date, amount numeric(18,2) not null check(amount>0), currency_code char(3) not null, reason text not null, expense_account_id uuid references public.accounts(id), liability_or_receivable_account_id uuid references public.accounts(id), journal_entry_id uuid references public.journal_entries(id), status text not null default 'posted' check(status in ('draft','posted','void')), created_by uuid, created_at timestamptz not null default now(),
 check ((customer_id is not null) <> (vendor_id is not null)), check ((invoice_id is not null) or (bill_id is not null))
);
create index if not exists write_offs_business_date_idx on public.write_offs(business_id,writeoff_date);

create table if not exists public.debit_notes (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade, customer_id uuid references public.customers(id), vendor_id uuid references public.vendors(id), invoice_id uuid references public.invoices(id), bill_id uuid references public.bills(id),
 debit_note_number text not null, debit_note_date date not null, reason text not null, currency_code char(3) not null, subtotal numeric(18,2) not null default 0, tax_total numeric(18,2) not null default 0, total numeric(18,2) not null default 0,
 status text not null default 'draft' check(status in ('draft','posted','void')), journal_entry_id uuid references public.journal_entries(id), notes text, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check ((customer_id is not null) <> (vendor_id is not null)), check ((invoice_id is not null) or (bill_id is not null)), unique(business_id,debit_note_number)
);
create table if not exists public.debit_note_items (
 id uuid primary key default gen_random_uuid(), debit_note_id uuid not null references public.debit_notes(id) on delete cascade, product_service_id uuid references public.products_services(id), description text not null, quantity numeric(18,4) not null default 1, unit_price numeric(18,2) not null default 0, tax_rate_id uuid references public.tax_rates(id), tax_amount numeric(18,2) not null default 0, line_total numeric(18,2) not null default 0, sort_order integer not null default 0
);
create index if not exists debit_note_items_note_idx on public.debit_note_items(debit_note_id,sort_order);

create table if not exists public.reconciliation_items (
 id uuid primary key default gen_random_uuid(), reconciliation_id uuid not null references public.reconciliations(id) on delete cascade, bank_transaction_id uuid not null references public.bank_transactions(id) on delete cascade, cleared boolean not null default false, cleared_amount numeric(18,2) not null default 0,
 match_type text not null default 'manual' check(match_type in ('matched','created','transfer','manual','ignored')), matched_payment_id uuid references public.payments(id), matched_account_id uuid references public.accounts(id), notes text, created_at timestamptz not null default now(), unique(reconciliation_id,bank_transaction_id)
);
create index if not exists reconciliation_items_reconciliation_idx on public.reconciliation_items(reconciliation_id,cleared);

create table if not exists public.fx_rates (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade, rate_date date not null, currency_code char(3) not null, base_currency_code char(3) not null, rate numeric(20,10) not null check(rate>0), source text, created_at timestamptz not null default now(), unique(business_id,rate_date,currency_code,base_currency_code)
);

create or replace function public.customer_credit_balance(p_business_id uuid,p_customer_id uuid)
returns numeric language sql stable security definer set search_path=public,mm_private as $$ select coalesce(sum(amount),0) from public.customer_credit_ledger where business_id=p_business_id and customer_id=p_customer_id; $$;

create or replace function public.assert_accounting_period_open(p_business_id uuid,p_date date)
returns void language plpgsql security definer set search_path=public,mm_private as $$ begin if exists(select 1 from public.accounting_periods where business_id=p_business_id and p_date between period_start and period_end and status='closed') then raise exception 'Accounting period is closed for %',p_date; end if; end; $$;

create or replace function public.guard_journal_period()
returns trigger language plpgsql set search_path=public,mm_private as $$ begin if tg_op='INSERT' then perform public.assert_accounting_period_open(new.business_id,new.entry_date); elsif tg_op='UPDATE' and (new.entry_date<>old.entry_date or new.business_id<>old.business_id) then perform public.assert_accounting_period_open(new.business_id,new.entry_date); end if; return new; end; $$;
drop trigger if exists trg_journal_period_guard on public.journal_entries;
create trigger trg_journal_period_guard before insert or update on public.journal_entries for each row execute function public.guard_journal_period();

-- Core customer-payment upgrade: partial payments remain allocated to the invoice; excess cash becomes customer credit.
create or replace function public.record_customer_payment(p_business_id uuid,p_customer_id uuid,p_invoice_id uuid,p_amount numeric,p_method payment_method,p_account_id uuid,p_reference text default null,p_gateway_transaction_id text default null,p_payment_date date default current_date,p_notes text default null)
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
 if not exists(select 1 from public.accounts where id=p_account_id and business_id=p_business_id and is_active) then raise exception 'Payment account is invalid'; end if;
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

create or replace function public.refund_customer_credit(p_business_id uuid,p_customer_id uuid,p_amount numeric,p_account_id uuid,p_method text,p_reference text default null,p_reason text default null,p_refund_date date default current_date)
returns uuid language plpgsql security definer set search_path=public,mm_private as $$
declare v_balance numeric; v_refund uuid; v_entry uuid; v_credit_acct uuid; v_currency char(3);
begin
 if not mm_private.has_business_permission(p_business_id,'payments.receive') then raise exception 'Access denied'; end if;
 if p_amount<=0 then raise exception 'Refund amount must be greater than zero'; end if;
 perform public.assert_accounting_period_open(p_business_id,p_refund_date);
 select customer_credit_balance(p_business_id,p_customer_id) into v_balance;
 if p_amount>v_balance then raise exception 'Refund exceeds available customer credit'; end if;
 select currency_code into v_currency from public.businesses where id=p_business_id;
 if not exists(select 1 from public.accounts where id=p_account_id and business_id=p_business_id and is_active) then raise exception 'Refund account is invalid'; end if;
 select id into v_credit_acct from public.accounts where business_id=p_business_id and code='2150' and is_active;
 if v_credit_acct is null then raise exception 'Customer credit account is missing'; end if;
 insert into public.customer_refunds(business_id,customer_id,refund_date,amount,currency_code,method,account_id,reference,reason,created_by) values(p_business_id,p_customer_id,p_refund_date,p_amount,v_currency,p_method,p_account_id,p_reference,p_reason,auth.uid()) returning id into v_refund;
 insert into public.customer_credit_ledger(business_id,customer_id,refund_id,entry_type,amount,currency_code,description,created_by) values(p_business_id,p_customer_id,v_refund,'refund',-p_amount,v_currency,'Customer credit refund',auth.uid());
 perform pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));
 insert into public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated) values(p_business_id,(select coalesce(max(entry_number),0)+1 from public.journal_entries where business_id=p_business_id),p_refund_date,'Customer credit refund','refund',v_refund,'posted',now(),auth.uid(),auth.uid(),v_currency,p_amount,p_amount,true) returning id into v_entry;
 insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id) values(v_entry,v_credit_acct,'Customer credit refund',p_amount,0,v_currency,'customer',p_customer_id),(v_entry,p_account_id,'Refund paid',0,p_amount,v_currency,'customer',p_customer_id);
 perform public.validate_journal_entry_balance(v_entry); update public.customer_refunds set journal_entry_id=v_entry where id=v_refund;
 return v_refund;
end; $$;

create or replace function public.write_off_customer_invoice(p_business_id uuid,p_invoice_id uuid,p_amount numeric,p_expense_account_id uuid,p_reason text,p_date date default current_date)
returns uuid language plpgsql security definer set search_path=public,mm_private as $$
declare inv public.invoices%rowtype; v_id uuid; v_entry uuid; v_ar uuid;
begin
 if not mm_private.has_business_permission(p_business_id,'accounting.manage') then raise exception 'Access denied'; end if;
 perform public.assert_accounting_period_open(p_business_id,p_date);
 select * into inv from public.invoices where id=p_invoice_id and business_id=p_business_id for update;
 if inv.id is null then raise exception 'Invoice not found'; end if;
 if p_amount<=0 or p_amount>inv.balance_due then raise exception 'Invalid write-off amount'; end if;
 if not exists(select 1 from public.accounts where id=p_expense_account_id and business_id=p_business_id and is_active) then raise exception 'Write-off expense account is invalid'; end if;
 select id into v_ar from public.accounts where business_id=p_business_id and code='1100' and is_active;
 if v_ar is null then raise exception 'Accounts receivable account is missing'; end if;
 insert into public.write_offs(business_id,customer_id,invoice_id,writeoff_date,amount,currency_code,reason,expense_account_id,liability_or_receivable_account_id,created_by) values(p_business_id,inv.customer_id,inv.id,p_date,p_amount,inv.currency_code,p_reason,p_expense_account_id,v_ar,auth.uid()) returning id into v_id;
 perform pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));
 insert into public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated) values(p_business_id,(select coalesce(max(entry_number),0)+1 from public.journal_entries where business_id=p_business_id),p_date,'Receivable write-off','write_off',v_id,'posted',now(),auth.uid(),auth.uid(),inv.currency_code,p_amount,p_amount,true) returning id into v_entry;
 insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id) values(v_entry,p_expense_account_id,p_reason,p_amount,0,inv.currency_code,'customer',inv.customer_id),(v_entry,v_ar,'Receivable write-off',0,p_amount,inv.currency_code,'customer',inv.customer_id);
 perform public.validate_journal_entry_balance(v_entry); update public.write_offs set journal_entry_id=v_entry where id=v_id;
 update public.invoices set balance_due=greatest(balance_due-p_amount,0),status=case when balance_due-p_amount<=0 then 'paid'::invoice_status else status end,updated_at=now() where id=inv.id;
 return v_id;
end; $$;

alter table public.customer_credit_ledger enable row level security;
alter table public.customer_refunds enable row level security;
alter table public.write_offs enable row level security;
alter table public.debit_notes enable row level security;
alter table public.debit_note_items enable row level security;
alter table public.reconciliation_items enable row level security;
alter table public.fx_rates enable row level security;

drop policy if exists customer_credit_ledger_member on public.customer_credit_ledger;
drop policy if exists customer_refunds_member on public.customer_refunds;
drop policy if exists write_offs_member on public.write_offs;
drop policy if exists debit_notes_member on public.debit_notes;
drop policy if exists debit_note_items_member on public.debit_note_items;
drop policy if exists reconciliation_items_member on public.reconciliation_items;
drop policy if exists fx_rates_member on public.fx_rates;
create policy customer_credit_ledger_member on public.customer_credit_ledger for all to authenticated using (mm_private.has_business_permission(business_id,'customers.view')) with check (mm_private.has_business_permission(business_id,'accounting.manage'));
create policy customer_refunds_member on public.customer_refunds for all to authenticated using (mm_private.has_business_permission(business_id,'customers.view')) with check (mm_private.has_business_permission(business_id,'payments.receive'));
create policy write_offs_member on public.write_offs for all to authenticated using (mm_private.has_business_permission(business_id,'accounting.view')) with check (mm_private.has_business_permission(business_id,'accounting.manage'));
create policy debit_notes_member on public.debit_notes for all to authenticated using (mm_private.has_business_permission(business_id,'accounting.view')) with check (mm_private.has_business_permission(business_id,'accounting.manage'));
create policy debit_note_items_member on public.debit_note_items for all to authenticated using (exists(select 1 from public.debit_notes d where d.id=debit_note_id and mm_private.has_business_permission(d.business_id,'accounting.view'))) with check (exists(select 1 from public.debit_notes d where d.id=debit_note_id and mm_private.has_business_permission(d.business_id,'accounting.manage')));
create policy reconciliation_items_member on public.reconciliation_items for all to authenticated using (exists(select 1 from public.reconciliations r join public.bank_accounts b on b.id=r.bank_account_id where r.id=reconciliation_id and mm_private.has_business_permission(b.business_id,'accounting.view'))) with check (exists(select 1 from public.reconciliations r join public.bank_accounts b on b.id=r.bank_account_id where r.id=reconciliation_id and mm_private.has_business_permission(b.business_id,'accounting.manage')));
create policy fx_rates_member on public.fx_rates for all to authenticated using (mm_private.has_business_permission(business_id,'accounting.view')) with check (mm_private.has_business_permission(business_id,'accounting.manage'));

create index if not exists journal_entries_business_date_idx on public.journal_entries(business_id,entry_date);
create index if not exists journal_lines_entity_idx on public.journal_lines(entity_type,entity_id);
create index if not exists bank_transactions_reconciliation_idx on public.bank_transactions(bank_account_id,transaction_date,status);
create index if not exists payment_allocations_invoice_idx on public.payment_allocations(invoice_id);
create index if not exists payment_allocations_payment_idx on public.payment_allocations(payment_id);
