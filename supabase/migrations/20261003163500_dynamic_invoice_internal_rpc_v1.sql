BEGIN;

CREATE OR REPLACE FUNCTION public.create_invoice_with_dynamic_tax(
  p_business_id uuid,
  p_customer_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_terms text DEFAULT NULL,
  p_buyer_reference text DEFAULT NULL,
  p_post boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private
AS $fn$
DECLARE
  v_invoice uuid;
  v_number text;
  v_currency text;
  v_item jsonb;
  v_product uuid;
  v_qty numeric;
  v_price numeric;
  v_discount numeric;
  v_tax numeric;
  v_hsn text;
  v_tax_rate uuid;
  v_meta jsonb;
  v_taxable numeric;
  v_meta_tax numeric;
  v_effective_rate numeric;
  v_tax_category text;
  v_actor uuid:=auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT mm_private.has_business_permission(p_business_id,'sales.create',v_actor) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id AND business_id=p_business_id AND is_active) THEN
    RAISE EXCEPTION 'Customer not found or inactive';
  END IF;
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN
    RAISE EXCEPTION 'At least one invoice item is required';
  END IF;
  IF p_buyer_reference IS NOT NULL AND (btrim(p_buyer_reference)='' OR length(btrim(p_buyer_reference))>70) THEN
    RAISE EXCEPTION 'Buyer reference must be 1-70 characters when provided.';
  END IF;

  SELECT currency_code INTO v_currency FROM public.businesses WHERE id=p_business_id AND is_active;
  IF v_currency IS NULL THEN RAISE EXCEPTION 'Business not found or inactive'; END IF;
  v_number:=public.next_document_number(p_business_id,'invoice');

  INSERT INTO public.invoices(
    business_id,customer_id,invoice_number,invoice_date,due_date,status,currency_code,
    subtotal,discount_total,tax_total,total,amount_paid,balance_due,notes,terms,
    discount_type,discount_value,discount_before_tax,buyer_reference,created_by
  )
  VALUES(
    p_business_id,p_customer_id,v_number,coalesce(p_invoice_date,current_date),
    coalesce(p_due_date,p_invoice_date,current_date),'draft',v_currency,
    0,0,0,0,0,0,p_notes,p_terms,NULL,0,true,
    nullif(btrim(p_buyer_reference),''),v_actor
  ) RETURNING id INTO v_invoice;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product:=nullif(v_item->>'product_service_id','')::uuid;
    v_qty:=coalesce((v_item->>'quantity')::numeric,0);
    v_price:=coalesce((v_item->>'unit_price')::numeric,0);
    v_discount:=round(greatest(coalesce((v_item->>'discount')::numeric,0),0),2);
    v_tax:=round(greatest(coalesce((v_item->>'tax_amount')::numeric,0),0),2);
    v_hsn:=nullif(trim(v_item->>'hsn_sac'),'');
    v_tax_category:=upper(coalesce(v_item->>'tax_category','STANDARD'));
    v_meta:=coalesce(v_item->'dynamic_tax_snapshot','[]'::jsonb);

    IF v_qty<=0 OR v_price<0 THEN RAISE EXCEPTION 'Invalid dynamic invoice item'; END IF;
    IF v_discount>round(v_qty*v_price,2) THEN RAISE EXCEPTION 'Dynamic line discount exceeds line amount'; END IF;
    IF jsonb_typeof(v_meta)<>'array' THEN RAISE EXCEPTION 'Invalid dynamic tax result'; END IF;
    IF v_product IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.products_services
      WHERE id=v_product AND business_id=p_business_id AND is_active AND sell_enabled
    ) THEN RAISE EXCEPTION 'Product/service not found'; END IF;

    v_taxable:=round(greatest(v_qty*v_price-v_discount,0),2);
    IF v_tax>round(v_taxable*1000000,2) THEN RAISE EXCEPTION 'Dynamic tax amount is not plausible'; END IF;

    IF jsonb_array_length(v_meta)>0 THEN
      SELECT coalesce(sum(greatest((x->>'taxAmount')::numeric,0)),0),
             coalesce(avg(nullif((x->>'rate')::numeric,0)),0)
      INTO v_meta_tax,v_effective_rate
      FROM jsonb_array_elements(v_meta) x;
      IF abs(v_meta_tax-v_tax)>0.02 THEN
        RAISE EXCEPTION 'Dynamic tax snapshot does not reconcile with line tax amount';
      END IF;
      SELECT CASE
        WHEN count(*) FILTER(WHERE upper(coalesce(x->>'taxCategory','STANDARD'))='REVERSE_CHARGE')>0
        THEN 'REVERSE_CHARGE'
        ELSE coalesce(max(upper(x->>'taxCategory')),'STANDARD')
      END INTO v_tax_category
      FROM jsonb_array_elements(v_meta) x;
    ELSE
      v_effective_rate:=0;
      v_tax_category:='STANDARD';
    END IF;

    INSERT INTO public.tax_rates(
      business_id,name,rate,tax_kind,component_code,is_compound,is_active,metadata
    )
    VALUES(
      p_business_id,
      coalesce(nullif(v_item->>'tax_name',''),'Dynamic tax'),
      coalesce(v_effective_rate,0),
      'sales',null,false,true,
      jsonb_build_object(
        'dynamic_provider',true,
        'snapshot',v_meta,
        'jurisdiction_id',v_item->>'jurisdiction_id',
        'tax_rule_id',v_item->>'tax_rule_id',
        'source_provider',coalesce(v_item->>'source_provider','moneymatters.dynamic-tax-v1')
      )
    ) RETURNING id INTO v_tax_rate;

    INSERT INTO public.invoice_items(
      invoice_id,product_service_id,description,quantity,unit_price,discount,
      discount_type,discount_value,unit_price_before_discount,tax_rate_id,
      tax_amount,line_total,sort_order,hsn_sac
    )
    VALUES(
      v_invoice,v_product,
      coalesce(nullif(v_item->>'description',''),(SELECT name FROM public.products_services WHERE id=v_product)),
      v_qty,v_price,v_discount,
      case when v_discount>0 then 'fixed' else null end,v_discount,v_price,v_tax_rate,
      v_tax,round(v_taxable+v_tax,2),
      (SELECT coalesce(max(sort_order),-1)+1 FROM public.invoice_items WHERE invoice_id=v_invoice),
      v_hsn
    );
  END LOOP;

  PERFORM public.recalculate_invoice_totals(v_invoice);
  IF p_post THEN PERFORM public.post_invoice(v_invoice,NULL); END IF;
  RETURN v_invoice;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_invoice_with_dynamic_tax(uuid,uuid,date,date,jsonb,text,text,text,boolean) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_with_dynamic_tax(uuid,uuid,date,date,jsonb,text,text,text,boolean) TO authenticated;

COMMIT;