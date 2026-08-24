-- Keep invoice draft creation/editing aligned with the India tax profile and accounting workflow.
-- Draft mutations never create journal entries; posting remains the accounting boundary.

CREATE OR REPLACE FUNCTION public.create_invoice_from_items(
  p_business_id uuid,
  p_customer_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_items jsonb,
  p_invoice_discount_type text DEFAULT NULL,
  p_invoice_discount_value numeric DEFAULT 0,
  p_notes text DEFAULT NULL,
  p_terms text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','mm_private'
AS $function$
DECLARE
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
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_tax_total numeric := 0;
  v_total numeric := 0;
  v_base numeric;
  v_line_discount numeric;
  v_tax_amount numeric;
  v_line_total numeric;
  v_tax_rate numeric;
  v_discount_type text;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'sales.create') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id=p_customer_id AND business_id=p_business_id AND is_active) THEN
    RAISE EXCEPTION 'Customer not found or inactive';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items)=0 THEN
    RAISE EXCEPTION 'At least one invoice item is required';
  END IF;
  SELECT b.currency_code,
         CASE WHEN upper(coalesce(tp.tax_regime,'NONE'))='GST' AND upper(coalesce(tp.gst_registration_type,'NONE'))<>'COMPOSITION' THEN true ELSE false END
  INTO v_currency, v_tax_enabled
  FROM public.businesses b
  LEFT JOIN public.business_tax_profiles tp ON tp.business_id=b.id
  WHERE b.id=p_business_id AND b.is_active;
  IF v_currency IS NULL THEN RAISE EXCEPTION 'Business not found or inactive'; END IF;
  IF p_invoice_discount_type IS NOT NULL AND p_invoice_discount_type NOT IN ('amount','fixed','percentage','') THEN
    RAISE EXCEPTION 'Invalid invoice discount type';
  END IF;
  IF coalesce(p_invoice_discount_value,0)<0 THEN RAISE EXCEPTION 'Discount value cannot be negative'; END IF;
  v_discount_type := CASE WHEN p_invoice_discount_type IN ('amount','fixed') THEN 'fixed' WHEN p_invoice_discount_type='percentage' THEN 'percentage' ELSE NULL END;
  v_number:=public.next_document_number(p_business_id,'invoice');
  INSERT INTO public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,status,currency_code,subtotal,discount_total,tax_total,total,amount_paid,balance_due,notes,terms,discount_type,discount_value,discount_before_tax,created_by)
  VALUES(p_business_id,p_customer_id,v_number,coalesce(p_invoice_date,current_date),coalesce(p_due_date,coalesce(p_invoice_date,current_date)),'draft',v_currency,0,0,0,0,0,0,p_notes,p_terms,v_discount_type,coalesce(p_invoice_discount_value,0),true,auth.uid())
  RETURNING id INTO v_invoice_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product:=nullif(v_item->>'product_service_id','')::uuid;
    v_qty:=coalesce((v_item->>'quantity')::numeric,0);
    v_price:=coalesce((v_item->>'unit_price')::numeric,0);
    v_desc:=coalesce(nullif(v_item->>'description',''),(select name from public.products_services where id=v_product));
    v_disc_type:=nullif(v_item->>'discount_type',''); IF v_disc_type='amount' THEN v_disc_type='fixed'; END IF;
    v_disc_value:=coalesce((v_item->>'discount_value')::numeric,0);
    v_tax:=nullif(v_item->>'tax_rate_id','')::uuid;
    IF v_qty<=0 OR v_price<0 OR v_desc IS NULL THEN RAISE EXCEPTION 'Invalid invoice item'; END IF;
    IF v_product IS NOT NULL AND NOT EXISTS(select 1 from public.products_services where id=v_product and business_id=p_business_id and is_active and sell_enabled) THEN RAISE EXCEPTION 'Product/service not found'; END IF;
    IF v_disc_type IS NOT NULL AND v_disc_type NOT IN ('percentage','fixed') THEN RAISE EXCEPTION 'Invalid line discount type'; END IF;
    IF v_disc_value<0 THEN RAISE EXCEPTION 'Discount value cannot be negative'; END IF;
    v_base:=round(v_qty*v_price,2);
    v_line_discount:=public.calculate_invoice_discount(v_base,v_disc_type,v_disc_value);
    v_tax_rate:=case when v_tax_enabled and v_tax is not null then coalesce((select rate from public.tax_rates where id=v_tax and business_id=p_business_id and is_active),0) else 0 end;
    v_tax_amount:=round((v_base-v_line_discount)*v_tax_rate/100,2);
    v_line_total:=round(v_base-v_line_discount+v_tax_amount,2);
    INSERT INTO public.invoice_items(invoice_id,product_service_id,description,quantity,unit_price,discount,discount_type,discount_value,unit_price_before_discount,tax_rate_id,tax_amount,line_total,sort_order)
    VALUES(v_invoice_id,v_product,v_desc,v_qty,v_price,v_line_discount,v_disc_type,v_disc_value,v_price,v_tax,v_tax_amount,v_line_total,(select count(*) from public.invoice_items where invoice_id=v_invoice_id));
    v_subtotal:=v_subtotal+v_base; v_discount:=v_discount+v_line_discount; v_tax_total:=v_tax_total+v_tax_amount; v_total:=v_total+v_line_total;
  END LOOP;
  IF coalesce(p_invoice_discount_value,0)>0 THEN
    v_discount:=v_discount+public.calculate_invoice_discount(v_subtotal-v_discount,v_discount_type,p_invoice_discount_value);
  END IF;
  v_total:=round(v_subtotal-v_discount+v_tax_total,2);
  UPDATE public.invoices SET subtotal=round(v_subtotal,2),discount_total=round(v_discount,2),tax_total=round(v_tax_total,2),total=v_total,balance_due=v_total,updated_at=now() WHERE id=v_invoice_id;
  RETURN v_invoice_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_invoice_draft(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_items jsonb,
  p_invoice_discount_type text DEFAULT NULL,
  p_invoice_discount_value numeric DEFAULT 0,
  p_notes text DEFAULT NULL,
  p_terms text DEFAULT NULL,
  p_template_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','mm_private'
AS $function$
DECLARE
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
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT (mm_private.has_business_permission(inv.business_id,'sales.edit') OR mm_private.has_business_permission(inv.business_id,'sales.create')) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF inv.status<>'draft' OR inv.journal_entry_id IS NOT NULL THEN RAISE EXCEPTION 'Only draft invoices can be edited'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id=p_customer_id AND business_id=inv.business_id AND is_active) THEN RAISE EXCEPTION 'Customer not found or inactive'; END IF;
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'At least one invoice item is required'; END IF;
  SELECT CASE WHEN upper(coalesce(tp.tax_regime,'NONE'))='GST' AND upper(coalesce(tp.gst_registration_type,'NONE'))<>'COMPOSITION' THEN true ELSE false END INTO v_tax_enabled FROM public.business_tax_profiles tp WHERE tp.business_id=inv.business_id;
  v_tax_enabled:=coalesce(v_tax_enabled,false);
  IF p_invoice_discount_type IS NOT NULL AND p_invoice_discount_type NOT IN ('amount','fixed','percentage','') THEN RAISE EXCEPTION 'Invalid invoice discount type'; END IF;
  IF coalesce(p_invoice_discount_value,0)<0 THEN RAISE EXCEPTION 'Discount value cannot be negative'; END IF;
  v_discount_type:=CASE WHEN p_invoice_discount_type IN ('amount','fixed') THEN 'fixed' WHEN p_invoice_discount_type='percentage' THEN 'percentage' ELSE NULL END;
  UPDATE public.invoices SET customer_id=p_customer_id,invoice_date=coalesce(p_invoice_date,invoice_date),due_date=coalesce(p_due_date,due_date),notes=p_notes,terms=p_terms,discount_type=v_discount_type,discount_value=coalesce(p_invoice_discount_value,0),template_id=p_template_id,updated_at=now() WHERE id=p_invoice_id;
  DELETE FROM public.invoice_items WHERE invoice_id=p_invoice_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product:=nullif(v_item->>'product_service_id','')::uuid;
    v_qty:=coalesce((v_item->>'quantity')::numeric,0);
    v_price:=coalesce((v_item->>'unit_price')::numeric,0);
    v_desc:=coalesce(nullif(v_item->>'description',''),(select name from public.products_services where id=v_product));
    v_disc_type:=nullif(v_item->>'discount_type',''); IF v_disc_type='amount' THEN v_disc_type='fixed'; END IF;
    v_disc_value:=coalesce((v_item->>'discount_value')::numeric,0);
    v_tax:=nullif(v_item->>'tax_rate_id','')::uuid;
    IF v_qty<=0 OR v_price<0 OR v_desc IS NULL THEN RAISE EXCEPTION 'Invalid invoice item'; END IF;
    IF v_product IS NOT NULL AND NOT EXISTS(select 1 from public.products_services where id=v_product and business_id=inv.business_id and is_active and sell_enabled) THEN RAISE EXCEPTION 'Product/service not found'; END IF;
    IF v_disc_type IS NOT NULL AND v_disc_type NOT IN ('percentage','fixed') THEN RAISE EXCEPTION 'Invalid line discount type'; END IF;
    IF v_disc_value<0 THEN RAISE EXCEPTION 'Discount value cannot be negative'; END IF;
    v_base:=round(v_qty*v_price,2);
    v_line_discount:=public.calculate_invoice_discount(v_base,v_disc_type,v_disc_value);
    v_tax_rate:=case when v_tax_enabled and v_tax is not null then coalesce((select rate from public.tax_rates where id=v_tax and business_id=inv.business_id and is_active),0) else 0 end;
    v_tax_amount:=round((v_base-v_line_discount)*v_tax_rate/100,2);
    v_line_total:=round(v_base-v_line_discount+v_tax_amount,2);
    INSERT INTO public.invoice_items(invoice_id,product_service_id,description,quantity,unit_price,discount,discount_type,discount_value,unit_price_before_discount,tax_rate_id,tax_amount,line_total,sort_order)
    VALUES(p_invoice_id,v_product,v_desc,v_qty,v_price,v_line_discount,v_disc_type,v_disc_value,v_price,v_tax,v_tax_amount,v_line_total,(select coalesce(max(sort_order),-1)+1 from public.invoice_items where invoice_id=p_invoice_id));
  END LOOP;
  PERFORM public.recalculate_invoice_totals(p_invoice_id);
  RETURN p_invoice_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_invoice_from_items(uuid,uuid,date,date,jsonb,text,numeric,text,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_items(uuid,uuid,date,date,jsonb,text,numeric,text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.update_invoice_draft(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.update_invoice_draft(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid) TO authenticated;
