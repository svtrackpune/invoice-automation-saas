-- Moneymatters go-live hardening v1
-- Keeps the repository migration history aligned with the live accounting hardening fixes.

alter table public.payment_webhook_events enable row level security;
revoke all on table public.payment_webhook_events from anon, authenticated;

create or replace function public.create_vendor_credit(
  p_business_id uuid,
  p_vendor_id uuid,
  p_bill_id uuid,
  p_credit_date date,
  p_reason text,
  p_items jsonb,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path=public,mm_private as $$
declare
  idd uuid;
  r jsonb;
  num text;
  cur char(3) := 'INR';
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
begin
  if not mm_private.has_business_permission(p_business_id,'purchases.create') then raise exception 'Access denied'; end if;
  if p_items is null or jsonb_array_length(p_items)=0 then raise exception 'At least one item is required'; end if;
  if p_bill_id is not null and not exists(
    select 1 from public.bills
    where id=p_bill_id and business_id=p_business_id and vendor_id=p_vendor_id and status<>'void'
  ) then raise exception 'Source bill not found'; end if;

  select currency_code into cur from public.bills where id=p_bill_id;
  num := public.next_document_number(p_business_id,'vendor_credit');

  insert into public.vendor_credits(
    business_id,vendor_id,bill_id,credit_number,credit_date,reason,currency_code,notes,created_by
  ) values(
    p_business_id,p_vendor_id,p_bill_id,num,p_credit_date,p_reason,coalesce(cur,'INR'),p_notes,auth.uid()
  ) returning id into idd;

  for r in select * from jsonb_array_elements(p_items) loop
    insert into public.vendor_credit_items(
      vendor_credit_id,bill_item_id,product_service_id,description,quantity,unit_price,tax_rate,
      line_subtotal,line_tax,line_total,sort_order
    ) values(
      idd,
      nullif(r->>'bill_item_id','')::uuid,
      nullif(r->>'product_service_id','')::uuid,
      coalesce(r->>'description','Purchase return'),
      (r->>'quantity')::numeric,
      (r->>'unit_price')::numeric,
      coalesce((r->>'tax_rate')::numeric,0),
      round((r->>'quantity')::numeric*(r->>'unit_price')::numeric,2),
      round((r->>'quantity')::numeric*(r->>'unit_price')::numeric*coalesce((r->>'tax_rate')::numeric,0)/100,2),
      round((r->>'quantity')::numeric*(r->>'unit_price')::numeric*(1+coalesce((r->>'tax_rate')::numeric,0)/100),2),
      coalesce((r->>'sort_order')::int,0)
    );
  end loop;

  select coalesce(sum(line_subtotal),0),coalesce(sum(line_tax),0),coalesce(sum(line_total),0)
    into v_subtotal,v_tax,v_total
  from public.vendor_credit_items where vendor_credit_id=idd;

  update public.vendor_credits
    set subtotal=v_subtotal,tax_total=v_tax,total=v_total,updated_at=now()
    where id=idd;

  return idd;
end;
$$;

create or replace function public.post_year_end_closing(p_closing_id uuid)
returns uuid
language plpgsql security definer set search_path=public,mm_private as $$
declare
  c public.year_end_closings%rowtype;
  e uuid;
  a record;
  amt numeric;
  net_pl numeric := 0;
  total_debits numeric := 0;
  total_credits numeric := 0;
begin
  select * into c from public.year_end_closings where id=p_closing_id for update;
  if c.id is null then raise exception 'Year-end closing not found'; end if;
  if not mm_private.has_business_permission(c.business_id,'accounting.post') then raise exception 'Access denied'; end if;
  if c.status='posted' then return c.closing_journal_id; end if;
  if not exists(
    select 1 from public.accounting_periods
    where business_id=c.business_id
      and period_start<=c.fiscal_year_start
      and period_end>=c.fiscal_year_end
      and status='closed'
  ) then raise exception 'Fiscal period must be closed before year-end posting'; end if;

  insert into public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,status,
    posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
  ) values(
    c.business_id,
    (select coalesce(max(entry_number),0)+1 from public.journal_entries where business_id=c.business_id),
    c.fiscal_year_end,'Year-end closing','year_end_closing',c.id,'posted',now(),auth.uid(),auth.uid(),
    'INR',0,0,true
  ) returning id into e;

  for a in
    select ac.id,coalesce(sum(jl.debit-jl.credit),0) bal
    from public.accounts ac
    join public.journal_lines jl on jl.account_id=ac.id
    join public.journal_entries je on je.id=jl.journal_entry_id
    where ac.business_id=c.business_id
      and je.business_id=c.business_id
      and je.status='posted'
      and je.entry_date between c.fiscal_year_start and c.fiscal_year_end
      and lower(ac.account_type) in ('income','revenue','expense','cost_of_goods_sold','cogs')
    group by ac.id
    having abs(coalesce(sum(jl.debit-jl.credit),0))>0.005
  loop
    amt := a.bal;
    net_pl := net_pl - amt;
    if amt>0 then
      insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code)
      values(e,a.id,'Year-end close',0,amt,'INR');
      total_credits := total_credits + amt;
    else
      insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code)
      values(e,a.id,'Year-end close',-amt,0,'INR');
      total_debits := total_debits - amt;
    end if;
  end loop;

  if abs(net_pl)>0.005 then
    if net_pl>0 then
      insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code)
      values(e,c.retained_earnings_account_id,'Transfer profit to retained earnings',0,net_pl,'INR');
      total_credits := total_credits + net_pl;
    else
      insert into public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code)
      values(e,c.retained_earnings_account_id,'Transfer loss to retained earnings',-net_pl,0,'INR');
      total_debits := total_debits - net_pl;
    end if;
  end if;

  update public.journal_entries
    set total_debit=total_debits,total_credit=total_credits
    where id=e;

  perform public.validate_journal_entry_balance(e);

  update public.year_end_closings
    set closing_journal_id=e,status='posted',posted_at=now(),posted_by=auth.uid(),profit_loss_amount=net_pl
    where id=c.id;

  return e;
end;
$$;

revoke execute on function public.post_year_end_closing(uuid) from public,anon;
grant execute on function public.post_year_end_closing(uuid) to authenticated;
