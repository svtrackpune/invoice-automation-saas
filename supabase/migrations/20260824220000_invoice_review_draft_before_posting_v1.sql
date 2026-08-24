CREATE OR REPLACE FUNCTION public.create_invoice_from_items(p_business_id uuid, p_customer_id uuid, p_invoice_date date, p_due_date date, p_items jsonb, p_invoice_discount_type text DEFAULT NULL::text, p_invoice_discount_value numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_terms text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
 v_invoice_id uuid; v_number text; v_currency char(3); v_tax_enabled boolean;
 v_item jsonb; v_product uuid; v_qty numeric; v_price numeric; v_desc text; v_disc_type text; v_disc_value numeric; v_tax uuid;
 v_subtotal numeric:=0; v_discount numeric:=0; v_tax_total numeric:=0; v_total numeric:=0;
 v_base numeric; v_line_discount numeric; v_tax_amount numeric; v_line_total numeric; v_tax_rate numeric;
begin
 if not mm_private.has_business_permission(p_business_id,'sales.create') then raise exception 'Access denied'; end if;
 if not exists(select 1 from public.customers where id=p_customer_id and business_id=p_business_id and is_active) then raise exception 'Customer not found or inactive'; end if;
 if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one invoice item is required'; end if;
 select currency_code,(tax_settings->>'enabled')::boolean into v_currency,v_tax_enabled from public.businesses where id=p_business_id and is_active;
 if v_currency is null then raise exception 'Business not found or inactive'; end if;
 v_number:=public.next_document_number(p_business_id,'invoice');
 insert into public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,status,currency_code,subtotal,discount_total,tax_total,total,amount_paid,balance_due,notes,terms,discount_type,discount_value,discount_before_tax,created_by)
 values(p_business_id,p_customer_id,v_number,coalesce(p_invoice_date,current_date),coalesce(p_due_date,coalesce(p_invoice_date,current_date)), 'draft',v_currency,0,0,0,0,0,0,p_notes,p_terms,p_invoice_discount_type,coalesce(p_invoice_discount_value,0),true,auth.uid()) returning id into v_invoice_id;
 for v_item in select * from jsonb_array_elements(p_items) loop
   v_product:=nullif(v_item->>'product_service_id','')::uuid;
   v_qty:=coalesce((v_item->>'quantity')::numeric,0);
   v_price:=coalesce((v_item->>'unit_price')::numeric,0);
   v_desc:=coalesce(nullif(v_item->>'description',''),(select name from public.products_services where id=v_product));
   v_disc_type:=nullif(v_item->>'discount_type',''); v_disc_value:=coalesce((v_item->>'discount_value')::numeric,0);
   v_tax:=nullif(v_item->>'tax_rate_id','')::uuid;
   if v_qty<=0 or v_price<0 or v_desc is null then raise exception 'Invalid invoice item'; end if;
   if v_product is not null and not exists(select 1 from public.products_services where id=v_product and business_id=p_business_id and is_active) then raise exception 'Product/service not found'; end if;
   v_base:=round(v_qty*v_price,2);
   v_line_discount:=public.calculate_invoice_discount(v_base,v_disc_type,v_disc_value);
   v_tax_rate:=case when v_tax_enabled and v_tax is not null then coalesce((select rate from public.tax_rates where id=v_tax and business_id=p_business_id and is_active),0) else 0 end;
   v_tax_amount:=round((v_base-v_line_discount)*v_tax_rate/100,2);
   v_line_total:=round(v_base-v_line_discount+v_tax_amount,2);
   insert into public.invoice_items(invoice_id,product_service_id,description,quantity,unit_price,discount,discount_type,discount_value,unit_price_before_discount,tax_rate_id,tax_amount,line_total,sort_order)
   values(v_invoice_id,v_product,v_desc,v_qty,v_price,v_line_discount,v_disc_type,v_disc_value,v_price,v_tax,v_tax_amount,v_line_total,(select count(*) from public.invoice_items where invoice_id=v_invoice_id));
   v_subtotal:=v_subtotal+v_base; v_discount:=v_discount+v_line_discount; v_tax_total:=v_tax_total+v_tax_amount; v_total:=v_total+v_line_total;
 end loop;
 if coalesce(p_invoice_discount_value,0)>0 then
   v_discount:=v_discount+public.calculate_invoice_discount(v_subtotal-v_discount,p_invoice_discount_type,p_invoice_discount_value);
 end if;
 v_total:=round(v_subtotal-v_discount+v_tax_total,2);
 update public.invoices set subtotal=round(v_subtotal,2),discount_total=round(v_discount,2),tax_total=round(v_tax_total,2),total=v_total,balance_due=v_total,updated_at=now() where id=v_invoice_id;
 return v_invoice_id;
end $function$;
