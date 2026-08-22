-- Moneymatters: complete Expenses module accounting foundation
alter table public.expenses add column if not exists tax_creditable boolean not null default false;
alter table public.expenses add column if not exists expense_type text not null default 'operating';
alter table public.expenses drop constraint if exists expenses_expense_type_check;
alter table public.expenses add constraint expenses_expense_type_check check (expense_type in ('operating','asset_purchase','payroll_adjustment','other'));

create table if not exists public.recurring_expense_templates (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
 name text not null, description text not null, category_id uuid references public.expense_categories(id) on delete set null,
 expense_account_id uuid not null references public.accounts(id), payment_account_id uuid references public.accounts(id), vendor_id uuid references public.vendors(id) on delete set null,
 amount numeric(18,2) not null check(amount>0), tax_amount numeric(18,2) not null default 0 check(tax_amount>=0), tax_creditable boolean not null default false,
 expense_type text not null default 'operating' check(expense_type in ('operating','asset_purchase','payroll_adjustment','other')),
 frequency text not null check(frequency in ('weekly','monthly','quarterly','half_yearly','yearly')), next_due_date date not null, end_date date,
 auto_post boolean not null default false, is_active boolean not null default true, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(end_date is null or end_date>=next_due_date)
);
create index if not exists recurring_expense_templates_due_idx on public.recurring_expense_templates(business_id,is_active,next_due_date);
create index if not exists recurring_expense_templates_category_idx on public.recurring_expense_templates(business_id,category_id);
alter table public.recurring_expense_templates enable row level security;
drop policy if exists recurring_expense_templates_member_all on public.recurring_expense_templates;
create policy recurring_expense_templates_member_all on public.recurring_expense_templates for all using (mm_private.is_org_member(mm_private.business_org(business_id))) with check (mm_private.is_org_member(mm_private.business_org(business_id)));

insert into public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description)
select b.id,v.code,v.name,v.account_type::account_type,v.normal_balance::normal_balance,true,true,v.description
from public.businesses b
cross join (values
 ('6010','Premises Rent','expense','debit','Office/shop/mall rent and lease expense'),
 ('6011','Electricity & Utilities','expense','debit','Electricity and utility charges'),
 ('6012','Maintenance & Repairs','expense','debit','Premises, equipment and general maintenance'),
 ('6013','Office Supplies','expense','debit','Stationery and consumable office supplies'),
 ('6014','Internet & Broadband','expense','debit','Broadband, internet and connectivity'),
 ('6015','Software & Subscriptions','expense','debit','Software, SaaS and recurring subscriptions'),
 ('6016','Telephone & Mobile','expense','debit','Business telephone and mobile expenses'),
 ('6017','Insurance','expense','debit','Business insurance premiums'),
 ('6018','Professional & Legal Fees','expense','debit','CA, legal, consulting and professional fees'),
 ('6019','Marketing & Advertising','expense','debit','Advertising, promotion and marketing'),
 ('6020','Travel & Local Conveyance','expense','debit','Business travel, local conveyance and lodging'),
 ('6021','Transport & Freight','expense','debit','Goods transport, freight, loading and delivery'),
 ('6022','Vehicle Running & Fuel','expense','debit','Fuel, tolls, servicing and vehicle running costs'),
 ('6023','Employee Welfare','expense','debit','Staff welfare, meals and employee benefits'),
 ('6024','General Operating Expense','expense','debit','Other ordinary business operating expenses'),
 ('6110','Payroll & Wages','expense','debit','Salaries, wages and payroll-related cost'),
 ('1500','Furniture & Fixtures','asset','debit','Capital furniture and fixtures'),
 ('1510','Computer & IT Equipment','asset','debit','Capital computers, laptops, systems and IT equipment'),
 ('1520','Other Fixed Assets','asset','debit','Other capital business assets')
) as v(code,name,account_type,normal_balance,description)
on conflict(business_id,code) do update set name=excluded.name,account_type=excluded.account_type,normal_balance=excluded.normal_balance,description=excluded.description,is_active=true;

insert into public.expense_categories(business_id,name,account_id,is_active)
select b.id,v.category,a.id,true
from public.businesses b
cross join (values
 ('Office / Shop / Mall Rent','6010'),('Electricity & Utilities','6011'),('Maintenance & Repairs','6012'),('Office Supplies','6013'),('Broadband & Internet','6014'),('Software & Subscriptions','6015'),('Telephone & Mobile','6016'),('Insurance','6017'),('Professional & Legal Fees','6018'),('Marketing & Advertising','6019'),('Travel & Local Conveyance','6020'),('Transport & Freight','6021'),('Vehicle Running & Fuel','6022'),('Salaries & Wages','6110'),('Employee Welfare','6023'),('General Operating Expense','6024'),('Furniture & Fixtures (Asset Purchase)','1500'),('Computer / Laptop / IT Equipment (Asset Purchase)','1510'),('Other Fixed Asset (Asset Purchase)','1520'),('Bank & Payment Fees','6200')
) as v(category,code)
join public.accounts a on a.business_id=b.id and a.code=v.code
on conflict(business_id,name) do update set account_id=excluded.account_id,is_active=true;

create or replace function public.post_expense(p_expense_id uuid)
returns uuid language plpgsql security definer set search_path=public,mm_private as $$
declare e public.expenses%rowtype; v_entry uuid; v_payment_account uuid; v_tax_account uuid; v_total numeric; v_entry_number bigint;
begin
 select * into e from public.expenses where id=p_expense_id for update;
 if e.id is null then raise exception 'Expense not found'; end if;
 if not mm_private.has_business_permission(e.business_id,'accounting.post') then raise exception 'Access denied'; end if;
 if e.journal_entry_id is not null then return e.journal_entry_id; end if;
 if e.account_id is null or not exists(select 1 from public.accounts a where a.id=e.account_id and a.business_id=e.business_id and a.is_active) then raise exception 'Expense account is invalid'; end if;
 v_payment_account:=e.payment_account_id;
 if v_payment_account is null then select id into v_payment_account from public.accounts where business_id=e.business_id and code='1000' and is_active; end if;
 if v_payment_account is null then raise exception 'Default payment account is missing'; end if;
 if not exists(select 1 from public.accounts where id=v_payment_account and business_id=e.business_id and is_active) then raise exception 'Payment account is invalid'; end if;
 if e.amount<=0 then raise exception 'Expense amount must be greater than zero'; end if;
 if e.tax_amount<0 then raise exception 'Tax amount cannot be negative'; end if;
 perform public.assert_accounting_period_open(e.business_id,e.expense_date);
 v_total:=round(e.amount+e.tax_amount,2);
 perform pg_advisory_xact_lock(hashtext('journal-entry-number:'||e.business_id::text));
 select coalesce(max(entry_number),0)+1 into v_entry_number from public.journal_entries where business_id=e.business_id;
 insert into public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated) values(e.business_id,v_entry_number,e.expense_date,'Expense: '||e.description,'expense',e.id,'posted',now(),auth.uid(),e.created_by,'INR',v_total,v_total,true) returning id into v_entry;
 if e.tax_creditable and e.tax_amount>0 then
   select id into v_tax_account from public.accounts where business_id=e.business_id and code='1300' and is_active;
   if v_tax_account is null then raise exception 'Input Tax Credit account (1300) is missing'; end if;
   insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id) values
    (v_entry,e.account_id,e.description,e.amount,0,'INR','expense',e.id),(v_entry,v_tax_account,'Input GST / eligible tax credit',e.tax_amount,0,'INR','expense',e.id),(v_entry,v_payment_account,e.description,0,v_total,'INR','expense',e.id);
 else
   insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id) values
    (v_entry,e.account_id,e.description,v_total,0,'INR','expense',e.id),(v_entry,v_payment_account,e.description,0,v_total,'INR','expense',e.id);
 end if;
 perform public.validate_journal_entry_balance(v_entry);
 update public.expenses set journal_entry_id=v_entry,updated_at=now() where id=e.id;
 return v_entry;
end; $$;

create or replace function public.generate_due_recurring_expense(p_template_id uuid)
returns uuid language plpgsql security definer set search_path=public,mm_private as $$
declare t public.recurring_expense_templates%rowtype; v_expense uuid; v_next date;
begin
 select * into t from public.recurring_expense_templates where id=p_template_id for update;
 if t.id is null then raise exception 'Recurring expense template not found'; end if;
 if not mm_private.has_business_permission(t.business_id,'accounting.post') then raise exception 'Access denied'; end if;
 if not t.is_active then raise exception 'Recurring expense is inactive'; end if;
 if t.next_due_date>current_date then raise exception 'Recurring expense is not due yet'; end if;
 if t.end_date is not null and t.next_due_date>t.end_date then raise exception 'Recurring expense has ended'; end if;
 insert into public.expenses(business_id,vendor_id,expense_date,description,amount,tax_amount,tax_creditable,account_id,payment_account_id,expense_type,created_by) values(t.business_id,t.vendor_id,t.next_due_date,t.description,t.amount,t.tax_amount,t.tax_creditable,t.expense_account_id,t.payment_account_id,t.expense_type,auth.uid()) returning id into v_expense;
 perform public.post_expense(v_expense);
 v_next:=case t.frequency when 'weekly' then (t.next_due_date+interval '7 days')::date when 'monthly' then (t.next_due_date+interval '1 month')::date when 'quarterly' then (t.next_due_date+interval '3 months')::date when 'half_yearly' then (t.next_due_date+interval '6 months')::date when 'yearly' then (t.next_due_date+interval '1 year')::date end;
 update public.recurring_expense_templates set next_due_date=v_next,is_active=case when end_date is not null and v_next>end_date then false else is_active end,updated_at=now() where id=t.id;
 return v_expense;
end; $$;