-- Fix vendor payment posting to use the real payment_method enum/column,
-- preserve unapplied vendor overpayments, and keep the journal balanced.
create table if not exists public.vendor_credit_ledger (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 vendor_id uuid not null references public.vendors(id) on delete cascade,
 payment_id uuid references public.payments(id) on delete set null,
 vendor_credit_id uuid references public.vendor_credits(id) on delete set null,
 entry_type text not null check(entry_type in ('overpayment','credit_note','application','refund','adjustment','writeoff_reversal')),
 amount numeric(18,2) not null check(amount<>0),
 currency_code char(3) not null,
 description text,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists vendor_credit_ledger_vendor_idx on public.vendor_credit_ledger(business_id,vendor_id,created_at desc);
alter table public.vendor_credit_ledger enable row level security;
drop policy if exists vendor_credit_ledger_access on public.vendor_credit_ledger;
create policy vendor_credit_ledger_access on public.vendor_credit_ledger for all to authenticated using(mm_private.has_business_permission(business_id,'payments.make')) with check(mm_private.has_business_permission(business_id,'payments.make'));

create or replace function public.record_vendor_payment(p_business_id uuid,p_vendor_id uuid,p_bill_id uuid,p_amount numeric,p_method text,p_account_id uuid,p_reference text default null,p_payment_date date default current_date,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public,mm_private as $$
declare v_payment uuid; v_bill public.bills%rowtype; v_alloc numeric; v_remaining numeric; v_credit numeric; v_ap uuid; v_advance uuid; v_entry uuid; v_method payment_method;
begin
 if not mm_private.has_business_permission(p_business_id,'payments.make') then raise exception 'Access denied'; end if;
 if p_amount<=0 then raise exception 'Payment amount must be positive'; end if;
 perform public.assert_accounting_period_open(p_business_id,p_payment_date);
 v_method:=case lower(p_method) when 'gateway' then 'payment_gateway'::payment_method else lower(p_method)::payment_method end;
 select * into v_bill from public.bills where id=p_bill_id and business_id=p_business_id and vendor_id=p_vendor_id for update;
 if v_bill.id is null then raise exception 'Bill not found'; end if;
 select coalesce(sum(amount),0) into v_alloc from public.vendor_payment_allocations where bill_id=p_bill_id;
 v_remaining:=greatest(v_bill.total-v_alloc,0); v_credit:=greatest(p_amount-v_remaining,0);
 if not exists(select 1 from public.accounts where id=p_account_id and business_id=p_business_id and is_active) then raise exception 'Payment account is invalid'; end if;
 select id into v_ap from public.accounts where business_id=p_business_id and code='2000' and is_active;
 if v_ap is null then raise exception 'Accounts payable account is missing'; end if;
 insert into public.payments(business_id,direction,vendor_id,bill_id,account_id,amount,currency_code,payment_date,method,reference,notes,created_by) values(p_business_id,'outbound',p_vendor_id,p_bill_id,p_account_id,p_amount,v_bill.currency_code,p_payment_date,v_method,p_reference,p_notes,auth.uid()) returning id into v_payment;
 if v_remaining>0 then insert into public.vendor_payment_allocations(business_id,payment_id,vendor_id,bill_id,amount) values(p_business_id,v_payment,p_vendor_id,p_bill_id,least(p_amount,v_remaining)); end if;
 if v_credit>0 then insert into public.vendor_credit_ledger(business_id,vendor_id,payment_id,entry_type,amount,currency_code,description,created_by) values(p_business_id,p_vendor_id,v_payment,'overpayment',v_credit,v_bill.currency_code,'Unapplied vendor overpayment',auth.uid()); end if;
 perform pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));
 insert into public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated) values(p_business_id,(select coalesce(max(entry_number),0)+1 from public.journal_entries where business_id=p_business_id),p_payment_date,'Payment made to vendor for bill '||v_bill.bill_number,'vendor_payment',v_payment,'posted',now(),auth.uid(),auth.uid(),v_bill.currency_code,p_amount,p_amount,true) returning id into v_entry;
 insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id) values(v_entry,v_ap,'Accounts payable settlement',least(p_amount,v_remaining),0,v_bill.currency_code,'vendor',p_vendor_id),(v_entry,p_account_id,'Vendor payment',0,p_amount,v_bill.currency_code,'vendor',p_vendor_id);
 if v_credit>0 then
   select id into v_advance from public.accounts where business_id=p_business_id and code='1255' and is_active;
   if v_advance is null then insert into public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description) values(p_business_id,'1255','Vendor Advances','asset','debit',true,true,'Vendor overpayments and advances') returning id into v_advance; end if;
   insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id) values(v_entry,v_advance,'Vendor overpayment / advance',v_credit,0,v_bill.currency_code,'vendor',p_vendor_id);
 end if;
 perform public.validate_journal_entry_balance(v_entry); update public.payments set journal_entry_id=v_entry where id=v_payment;
 update public.bills set amount_paid=least(total,coalesce((select sum(amount) from public.vendor_payment_allocations where bill_id=id),0)),balance_due=greatest(total-coalesce((select sum(amount) from public.vendor_payment_allocations where bill_id=id),0),0),status=case when total<=coalesce((select sum(amount) from public.vendor_payment_allocations where bill_id=id),0) then 'paid'::bill_status when coalesce((select sum(amount) from public.vendor_payment_allocations where bill_id=id),0)>0 then 'partially_paid'::bill_status else status end,updated_at=now() where id=p_bill_id;
 return v_payment;
end; $$;
revoke execute on function public.record_vendor_payment(uuid,uuid,uuid,numeric,text,uuid,text,date,text) from public,anon;
grant execute on function public.record_vendor_payment(uuid,uuid,uuid,numeric,text,uuid,text,date,text) to authenticated;
