create or replace function public.update_invoice_draft(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_items jsonb,
  p_invoice_discount_type text default null,
  p_invoice_discount_value numeric default 0,
  p_notes text default null,
  p_terms text default null,
  p_template_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public','mm_private'
as $function$
declare
  inv public.invoices%rowtype;
  v_tax_enabled boolean;
  v_item jsonb;
  v_product uuid;
  v_qty numeric;
  v_price numeric;
  v_desc text;
  v_disc_type text;
  v_disc_value numeric;
  v_tax uuid;
  v_base numeric;
  v_line_discount numeric;
  v_tax_rate numeric;
  v_tax_amount numeric;
  v_line_total numeric;
  v_discount_type text;
begin
  select * into inv from public.invoices where id=p_invoice_id for update;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if not (mm_private.has_business_permission(inv.business_id,'sales.edit') or mm_private.has_business_permission(inv.business_id,'sales.create')) then raise exception 'Access denied'; end if;
  if inv.status <> 'draft' or inv.journal_entry_id is not null then raise exception 'Only draft invoices can be edited'; end if;
  if not exists(select 1 from public.customers where id=p_customer_id and business_id=inv.business_id and is_active) then raise exception 'Customer not found or inactive'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one invoice item is required'; end if;

  select coalesce((tax_settings->>'enabled')::boolean,false) into v_tax_enabled
  from public.businesses where id=inv.business_id and is_active;

  if p_invoice_discount_type='amount' then v_discount_type='fixed'; else v_discount_type=p_invoice_discount_type; end if;

  update public.invoices set
    customer_id=p_customer_id,
    invoice_date=coalesce(p_invoice_date,invoice_date),
    due_date=coalesce(p_due_date,due_date),
    notes=p_notes,
    terms=p_terms,
    discount_type=v_discount_type,
    discount_value=coalesce(p_invoice_discount_value,0),
    template_id=p_template_id,
    updated_at=now()
  where id=p_invoice_id;

  delete from public.invoice_items where invoice_id=p_invoice_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product:=nullif(v_item->>'product_service_id','')::uuid;
    v_qty:=coalesce((v_item->>'quantity')::numeric,0);
    v_price:=coalesce((v_item->>'unit_price')::numeric,0);
    v_desc:=coalesce(nullif(v_item->>'description',''),(select name from public.products_services where id=v_product));
    v_disc_type:=nullif(v_item->>'discount_type','');
    if v_disc_type='amount' then v_disc_type='fixed'; end if;
    v_disc_value:=coalesce((v_item->>'discount_value')::numeric,0);
    v_tax:=nullif(v_item->>'tax_rate_id','')::uuid;

    if v_qty<=0 or v_price<0 or v_desc is null then raise exception 'Invalid invoice item'; end if;
    if v_product is not null and not exists(select 1 from public.products_services where id=v_product and business_id=inv.business_id and is_active and sell_enabled) then raise exception 'Product/service not found'; end if;

    v_base:=round(v_qty*v_price,2);
    v_line_discount:=public.calculate_invoice_discount(v_base,v_disc_type,v_disc_value);
    v_tax_rate:=case when v_tax_enabled and v_tax is not null then coalesce((select rate from public.tax_rates where id=v_tax and business_id=inv.business_id and is_active),0) else 0 end;
    v_tax_amount:=round((v_base-v_line_discount)*v_tax_rate/100,2);
    v_line_total:=round(v_base-v_line_discount+v_tax_amount,2);

    insert into public.invoice_items(invoice_id,product_service_id,description,quantity,unit_price,discount,discount_type,discount_value,unit_price_before_discount,tax_rate_id,tax_amount,line_total,sort_order)
    values(p_invoice_id,v_product,v_desc,v_qty,v_price,v_line_discount,v_disc_type,v_disc_value,v_price,v_tax,v_tax_amount,v_line_total,(select coalesce(max(sort_order),-1)+1 from public.invoice_items where invoice_id=p_invoice_id));
  end loop;

  perform public.recalculate_invoice_totals(p_invoice_id);
  return p_invoice_id;
end;
$function$;
