alter table public.recurring_expense_templates add column if not exists expense_date date;
update public.recurring_expense_templates set expense_date=next_due_date where expense_date is null;
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
 insert into public.expenses(business_id,vendor_id,expense_date,description,amount,tax_amount,tax_creditable,account_id,payment_account_id,expense_type,created_by)
 values(t.business_id,t.vendor_id,t.next_due_date,t.description,t.amount,t.tax_amount,t.tax_creditable,t.expense_account_id,t.payment_account_id,t.expense_type,auth.uid()) returning id into v_expense;
 perform public.post_expense(v_expense);
 v_next:=case t.frequency when 'weekly' then (t.next_due_date+interval '7 days')::date when 'monthly' then (t.next_due_date+interval '1 month')::date when 'quarterly' then (t.next_due_date+interval '3 months')::date when 'half_yearly' then (t.next_due_date+interval '6 months')::date when 'yearly' then (t.next_due_date+interval '1 year')::date end;
 update public.recurring_expense_templates set expense_date=v_next,next_due_date=v_next,is_active=case when end_date is not null and v_next>end_date then false else is_active end,updated_at=now() where id=t.id;
 return v_expense;
end; $$;