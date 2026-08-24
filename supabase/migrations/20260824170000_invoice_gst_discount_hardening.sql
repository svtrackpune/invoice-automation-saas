-- Invoice GST/discount hardening
-- GST registration is authoritative for invoice tax enablement.
-- Seed standard sales GST rates for regular GST businesses so invoice lines
-- have usable tax-rate choices without requiring manual database setup.

update public.businesses b
set tax_settings = jsonb_set(
  jsonb_set(coalesce(b.tax_settings,'{}'::jsonb), '{enabled}', to_jsonb(
    case when p.tax_regime = 'GST' and p.gst_registration_type <> 'COMPOSITION' then true else false end
  ), true),
  '{mode}', to_jsonb(
    case when p.tax_regime = 'GST' then 'gst' else 'non_gst' end
  ),
  true
)
from public.business_tax_profiles p
where p.business_id = b.id;

insert into public.tax_rates (business_id,name,rate,tax_kind,component_code,is_compound,is_active,metadata)
select b.id, v.name, v.rate, 'sales', 'GST', false, true,
       jsonb_build_object('source','system_default','tax_group','GST')
from public.businesses b
join public.business_tax_profiles p on p.business_id = b.id
cross join (values
  ('GST 0%', numeric '0'),
  ('GST 5%', numeric '5'),
  ('GST 12%', numeric '12'),
  ('GST 18%', numeric '18'),
  ('GST 28%', numeric '28')
) as v(name,rate)
where p.tax_regime = 'GST'
  and p.gst_registration_type = 'REGULAR'
  and not exists (
    select 1
    from public.tax_rates t
    where t.business_id = b.id
      and t.rate = v.rate
      and t.tax_kind = 'sales'
      and t.is_active
  );

create or replace function public.create_invoice_from_items(
  p_business_id uuid,
  p_customer_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_items jsonb,
  p_invoice_discount_type text default null,
  p_invoice_discount_value numeric default 0,
  p_notes text default null,
  p_terms text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invoice_id uuid;
  v_number text;
  v_currency char(3);
  v_tax_enabled boolean;
  v_item jsonb;
  v_product uuid;
  v_qty numeric;
  v_price numeric;
  v_desc text;
  v_disc_type text;
  v_disc_value numeric;
  v_tax uuid;
  v_subtotal numeric:=0;
  v_discount numeric:=0;
  v_tax_total numeric:=0;
  v_total numeric:=0;
  v_base numeric;
  v_line_discount numeric;
  v_tax_amount numeric;
  v_line_total numeric;
  v_tax_rate numeric;
begin
  if not mm_private.has_business_permission(p_business_id,'sales.create') then
    raise exception 'Access denied';
  end if;

  if not exists(
    select 1 from public.customers
    where id=p_customer_id and business_id=p_business_id and is_active
  ) then
    raise exception 'Customer not found or inactive';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'At least one invoice item is required';
  end if;

  select
    b.currency_code,
    case
      when coalesce(tp.tax_regime,'NONE')='GST'
       and coalesce(tp.gst_registration_type,'NONE')<>'COMPOSITION'
      then true
      else false
    end
  into v_currency,v_tax_enabled
  from public.businesses b
  left join public.business_tax_profiles tp on tp.business_id=b.id
  where b.id=p_business_id and b.is_active;

  if v_currency is null then
    raise exception 'Business not found or inactive';
  end if;

  v_number:=public.next_document_number(p_business_id,'invoice');

  insert into public.invoices(
    business_id,customer_id,invoice_number,invoice_date,due_date,status,currency_code,
    subtotal,discount_total,tax_total,total,amount_paid,balance_due,notes,terms,
    discount_type,discount_value,discount_before_tax,created_by
  )
  values(
    p_business_id,p_customer_id,v_number,coalesce(p_invoice_date,current_date),
    coalesce(p_due_date,coalesce(p_invoice_date,current_date)), 'draft',v_currency,
    0,0,0,0,0,0,p_notes,p_terms,p_invoice_discount_type,
    coalesce(p_invoice_discount_value,0),true,auth.uid()
  ) returning id into v_invoice_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product:=nullif(v_item->>'product_service_id','')::uuid;
    v_qty:=coalesce((v_item->>'quantity')::numeric,0);
    v_price:=coalesce((v_item->>'unit_price')::numeric,0);
    v_desc:=coalesce(
      nullif(v_item->>'description',''),
      (select name from public.products_services where id=v_product)
    );
    v_disc_type:=nullif(v_item->>'discount_type','');
    v_disc_value:=coalesce((v_item->>'discount_value')::numeric,0);
    v_tax:=nullif(v_item->>'tax_rate_id','')::uuid;

    if v_qty<=0 or v_price<0 or v_desc is null then
      raise exception 'Invalid invoice item';
    end if;

    if v_product is not null and not exists(
      select 1 from public.products_services
      where id=v_product and business_id=p_business_id and is_active
    ) then
      raise exception 'Product/service not found';
    end if;

    v_base:=round(v_qty*v_price,2);
    v_line_discount:=public.calculate_invoice_discount(v_base,v_disc_type,v_disc_value);
    v_tax_rate:=case
      when v_tax_enabled and v_tax is not null then
        coalesce((
          select rate from public.tax_rates
          where id=v_tax and business_id=p_business_id and is_active
        ),0)
      else 0
    end;
    v_tax_amount:=round((v_base-v_line_discount)*v_tax_rate/100,2);
    v_line_total:=round(v_base-v_line_discount+v_tax_amount,2);

    insert into public.invoice_items(
      invoice_id,product_service_id,description,quantity,unit_price,discount,
      discount_type,discount_value,unit_price_before_discount,tax_rate_id,
      tax_amount,line_total,sort_order
    )
    values(
      v_invoice_id,v_product,v_desc,v_qty,v_price,v_line_discount,v_disc_type,
      v_disc_value,v_price,v_tax,v_tax_amount,v_line_total,
      (select count(*) from public.invoice_items where invoice_id=v_invoice_id)
    );

    v_subtotal:=v_subtotal+v_base;
    v_discount:=v_discount+v_line_discount;
    v_tax_total:=v_tax_total+v_tax_amount;
    v_total:=v_total+v_line_total;
  end loop;

  if coalesce(p_invoice_discount_value,0)>0 then
    v_discount:=v_discount+public.calculate_invoice_discount(
      v_subtotal-v_discount,p_invoice_discount_type,p_invoice_discount_value
    );
  end if;

  v_total:=round(v_subtotal-v_discount+v_tax_total,2);

  update public.invoices
  set subtotal=round(v_subtotal,2),
      discount_total=round(v_discount,2),
      tax_total=round(v_tax_total,2),
      total=v_total,
      balance_due=v_total,
      updated_at=now()
  where id=v_invoice_id;

  perform public.post_invoice(v_invoice_id,NULL);
  return v_invoice_id;
end
$function$;
