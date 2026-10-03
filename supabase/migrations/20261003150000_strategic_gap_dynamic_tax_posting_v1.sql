BEGIN;

DROP FUNCTION IF EXISTS public.api_create_invoice_with_dynamic_tax(text,uuid,uuid,date,date,jsonb,text,text,boolean);

CREATE OR REPLACE FUNCTION public.api_create_invoice_with_dynamic_tax(
  p_api_key_hash text,p_business_id uuid,p_customer_id uuid,p_invoice_date date,p_due_date date,p_items jsonb,
  p_notes text DEFAULT NULL,p_terms text DEFAULT NULL,p_buyer_reference text DEFAULT NULL,p_post boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $fn$
DECLARE k public.api_keys%rowtype; v_invoice uuid; v_number text; v_currency text; v_item jsonb;
DECLARE v_product uuid; v_qty numeric; v_price numeric; v_discount numeric; v_tax numeric; v_total numeric; v_hsn text; v_tax_rate uuid; v_meta jsonb;
DECLARE v_taxable numeric; v_effective_rate numeric; v_tax_category text;
BEGIN
  SELECT * INTO k FROM public.api_keys WHERE key_hash=lower(btrim(p_api_key_hash)) AND business_id=p_business_id AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE;
  IF k.id IS NULL THEN RAISE EXCEPTION 'Invalid or expired API key'; END IF;
  IF NOT ('invoices:write'=ANY(k.scopes)) THEN RAISE EXCEPTION 'API key lacks invoices:write scope'; END IF;
  IF k.created_by IS NULL OR NOT EXISTS (SELECT 1 FROM public.businesses b JOIN public.organization_members om ON om.organization_id=b.organization_id WHERE b.id=p_business_id AND om.user_id=k.created_by AND om.is_active) THEN RAISE EXCEPTION 'API key actor is no longer a business member'; END IF;
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'At least one invoice item is required'; END IF;
  IF p_buyer_reference IS NOT NULL AND (btrim(p_buyer_reference)='' OR length(btrim(p_buyer_reference))>70) THEN RAISE EXCEPTION 'Buyer reference must be 1-70 characters when provided.'; END IF;
  PERFORM set_config('request.jwt.claim.sub',k.created_by::text,true);
  SELECT currency_code INTO v_currency FROM public.businesses WHERE id=p_business_id AND is_active;
  IF v_currency IS NULL THEN RAISE EXCEPTION 'Business not found or inactive'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id AND business_id=p_business_id AND is_active) THEN RAISE EXCEPTION 'Customer not found or inactive'; END IF;
  v_number:=public.next_document_number(p_business_id,'invoice');
  INSERT INTO public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,status,currency_code,subtotal,discount_total,tax_total,total,amount_paid,balance_due,notes,terms,discount_type,discount_value,discount_before_tax,buyer_reference,created_by)
  VALUES(p_business_id,p_customer_id,v_number,coalesce(p_invoice_date,current_date),coalesce(p_due_date,coalesce(p_invoice_date,current_date)),'draft',v_currency,0,0,0,0,0,0,p_notes,p_terms,NULL,0,true,nullif(btrim(p_buyer_reference),''),k.created_by) RETURNING id INTO v_invoice;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
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
    IF v_tax<0 OR jsonb_typeof(v_meta)<>'array' THEN RAISE EXCEPTION 'Invalid dynamic tax result'; END IF;
    IF v_product IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.products_services WHERE id=v_product AND business_id=p_business_id AND is_active AND sell_enabled) THEN RAISE EXCEPTION 'Product/service not found'; END IF;

    v_taxable:=round(greatest(v_qty*v_price-v_discount,0),2);
    IF v_tax>round(v_taxable*1000000,2) THEN RAISE EXCEPTION 'Dynamic tax amount is not plausible'; END IF;
    IF jsonb_array_length(v_meta)>0 THEN
      SELECT coalesce(sum(greatest((x->>'taxAmount')::numeric,0)),0),
             coalesce(max((x->>'rate')::numeric),0)
      INTO v_total,v_effective_rate
      FROM jsonb_array_elements(v_meta) x;
      IF abs(v_total-v_tax)>0.02 THEN RAISE EXCEPTION 'Dynamic tax snapshot does not reconcile with line tax amount'; END IF;
      SELECT CASE WHEN count(*) FILTER (WHERE upper(coalesce(x->>'taxCategory','STANDARD'))='REVERSE_CHARGE')>0 THEN 'REVERSE_CHARGE' ELSE coalesce(max(upper(x->>'taxCategory')),'STANDARD') END
      INTO v_tax_category FROM jsonb_array_elements(v_meta) x;
    END IF;
    IF v_tax_rate IS NULL THEN
      INSERT INTO public.tax_rates(business_id,name,rate,tax_kind,component_code,is_compound,is_active,metadata)
      VALUES(p_business_id,coalesce(nullif(v_item->>'tax_name',''),'Dynamic tax'),v_effective_rate,'sales',null,false,true,jsonb_build_object('dynamic_provider',true,'snapshot',v_meta,'jurisdiction_id',v_item->>'jurisdiction_id','tax_rule_id',v_item->>'tax_rule_id','source_provider',coalesce(v_item->>'source_provider','moneymatters.dynamic-tax-v1'))) RETURNING id INTO v_tax_rate;
    END IF;
    INSERT INTO public.invoice_items(invoice_id,product_service_id,description,quantity,unit_price,discount,discount_type,discount_value,unit_price_before_discount,tax_rate_id,tax_amount,line_total,sort_order,hsn_sac)
    VALUES(v_invoice,v_product,coalesce(nullif(v_item->>'description',''),(SELECT name FROM public.products_services WHERE id=v_product)),v_qty,v_price,v_discount,case when v_discount>0 then 'fixed' else null end,v_discount,v_price,v_tax_rate,v_tax,round(v_taxable+v_tax,2),(SELECT coalesce(max(sort_order),-1)+1 FROM public.invoice_items WHERE invoice_id=v_invoice),v_hsn);
  END LOOP;

  PERFORM public.recalculate_invoice_totals(v_invoice);
  IF p_post THEN PERFORM public.post_invoice(v_invoice,NULL); END IF;
  UPDATE public.api_keys SET last_used_at=now(),updated_at=now() WHERE id=k.id;
  RETURN v_invoice;
END; $fn$;

REVOKE ALL ON FUNCTION public.api_create_invoice_with_dynamic_tax(text,uuid,uuid,date,date,jsonb,text,text,text,boolean) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_invoice_with_dynamic_tax(text,uuid,uuid,date,date,jsonb,text,text,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.snapshot_dynamic_invoice_tax(p_invoice_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $fn$
DECLARE i public.invoices%rowtype; b public.businesses%rowtype; item record; tr public.tax_rates%rowtype; x jsonb; v_exchange_rate numeric:=1; v_count integer:=0; v_base_currency text;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF i.id IS NULL OR i.journal_entry_id IS NULL THEN RETURN 0; END IF;
  IF EXISTS(SELECT 1 FROM public.invoice_tax_lines WHERE invoice_id=i.id) THEN RETURN (SELECT count(*) FROM public.invoice_tax_lines WHERE invoice_id=i.id); END IF;
  SELECT * INTO b FROM public.businesses WHERE id=i.business_id; IF b.id IS NULL THEN RAISE EXCEPTION 'Business not found'; END IF;
  SELECT upper(coalesce(min(jl.exchange_rate),1)), upper(b.base_currency_code) INTO v_exchange_rate,v_base_currency FROM public.journal_lines jl WHERE jl.journal_entry_id=i.journal_entry_id AND jl.transaction_currency_code=upper(i.currency_code);
  v_exchange_rate:=coalesce(v_exchange_rate,1); v_base_currency:=coalesce(v_base_currency,upper(i.currency_code));
  FOR item IN SELECT ii.*,ps.id AS ps_id FROM public.invoice_items ii LEFT JOIN public.products_services ps ON ps.id=ii.product_service_id WHERE ii.invoice_id=i.id ORDER BY ii.sort_order,ii.id LOOP
    SELECT * INTO tr FROM public.tax_rates WHERE id=item.tax_rate_id AND business_id=i.business_id LIMIT 1;
    IF tr.id IS NULL OR NOT coalesce((tr.metadata->>'dynamic_provider')::boolean,false) THEN CONTINUE; END IF;
    FOR x IN SELECT * FROM jsonb_array_elements(coalesce(tr.metadata->'snapshot','[]'::jsonb)) LOOP
      INSERT INTO public.invoice_tax_lines(business_id,invoice_id,invoice_item_id,jurisdiction_id,tax_rule_id,tax_component_id,tax_code,tax_category,rate,taxable_amount,tax_amount,base_tax_amount,transaction_currency_code,base_currency_code,exchange_rate,is_reverse_charge,source_adapter,snapshot_at)
      VALUES(i.business_id,i.id,item.id,(x->>'jurisdictionId')::uuid,(x->>'taxRuleId')::uuid,nullif(x->>'taxComponentId','')::uuid,coalesce(x->>'taxCode',tr.component_code,tr.name),upper(coalesce(x->>'taxCategory','STANDARD')),(x->>'rate')::numeric,(x->>'taxableAmount')::numeric,(x->>'taxAmount')::numeric,round((x->>'taxAmount')::numeric*v_exchange_rate,6),upper(i.currency_code),v_base_currency,v_exchange_rate,coalesce((x->>'isReverseCharge')::boolean,false),coalesce(x->>'sourceProvider','moneymatters.dynamic-tax-v1'),now()) ON CONFLICT(dedupe_key) DO NOTHING;
      v_count:=v_count+1;
    END LOOP;
  END LOOP;
  RETURN v_count;
END; $fn$;

CREATE OR REPLACE FUNCTION public.trigger_snapshot_posted_invoice_tax_dynamic() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $fn$
BEGIN
  IF NEW.journal_entry_id IS NOT NULL AND (TG_OP='INSERT' OR OLD.journal_entry_id IS DISTINCT FROM NEW.journal_entry_id) THEN PERFORM public.snapshot_dynamic_invoice_tax(NEW.id); END IF;
  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS trg_snapshot_posted_invoice_tax_dynamic ON public.invoices;
CREATE TRIGGER trg_snapshot_posted_invoice_tax_dynamic AFTER INSERT OR UPDATE OF journal_entry_id ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.trigger_snapshot_posted_invoice_tax_dynamic();

REVOKE ALL ON FUNCTION public.snapshot_dynamic_invoice_tax(uuid) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.trigger_snapshot_posted_invoice_tax_dynamic() FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_dynamic_invoice_tax(uuid) TO service_role;
COMMIT;