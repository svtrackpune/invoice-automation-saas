-- Moneymatters: GST component calculation rules v2.
-- State-aware CGST/SGST vs IGST calculation, using invoice place of supply
-- with customer-address fallback and the authoritative invoice totals path.

CREATE OR REPLACE FUNCTION public.gst_state_code(p_state text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_state IS NULL OR btrim(p_state)='' THEN NULL
    WHEN upper(btrim(p_state)) ~ '^[0-9]{2}$' THEN lpad(btrim(p_state),2,'0')
    WHEN upper(btrim(p_state)) IN ('ANDHRA PRADESH','AP') THEN '37'
    WHEN upper(btrim(p_state)) IN ('ARUNACHAL PRADESH','AR') THEN '12'
    WHEN upper(btrim(p_state)) IN ('ASSAM','AS') THEN '18'
    WHEN upper(btrim(p_state)) IN ('BIHAR','BR') THEN '10'
    WHEN upper(btrim(p_state)) IN ('CHHATTISGARH','CG') THEN '22'
    WHEN upper(btrim(p_state)) IN ('GOA','GA') THEN '30'
    WHEN upper(btrim(p_state)) IN ('GUJARAT','GJ') THEN '24'
    WHEN upper(btrim(p_state)) IN ('HARYANA','HR') THEN '06'
    WHEN upper(btrim(p_state)) IN ('HIMACHAL PRADESH','HP') THEN '02'
    WHEN upper(btrim(p_state)) IN ('JHARKHAND','JH') THEN '20'
    WHEN upper(btrim(p_state)) IN ('KARNATAKA','KA') THEN '29'
    WHEN upper(btrim(p_state)) IN ('KERALA','KL') THEN '32'
    WHEN upper(btrim(p_state)) IN ('MADHYA PRADESH','MP') THEN '23'
    WHEN upper(btrim(p_state)) IN ('MAHARASHTRA','MH') THEN '27'
    WHEN upper(btrim(p_state)) IN ('MANIPUR','MN') THEN '14'
    WHEN upper(btrim(p_state)) IN ('MEGHALAYA','ML') THEN '17'
    WHEN upper(btrim(p_state)) IN ('MIZORAM','MZ') THEN '15'
    WHEN upper(btrim(p_state)) IN ('NAGALAND','NL') THEN '13'
    WHEN upper(btrim(p_state)) IN ('ODISHA','OR') THEN '21'
    WHEN upper(btrim(p_state)) IN ('PUNJAB','PB') THEN '03'
    WHEN upper(btrim(p_state)) IN ('RAJASTHAN','RJ') THEN '08'
    WHEN upper(btrim(p_state)) IN ('SIKKIM','SK') THEN '11'
    WHEN upper(btrim(p_state)) IN ('TAMIL NADU','TN') THEN '33'
    WHEN upper(btrim(p_state)) IN ('TELANGANA','TS') THEN '36'
    WHEN upper(btrim(p_state)) IN ('TRIPURA','TR') THEN '16'
    WHEN upper(btrim(p_state)) IN ('UTTAR PRADESH','UP') THEN '09'
    WHEN upper(btrim(p_state)) IN ('UTTARAKHAND','UK','UTTARANCHAL') THEN '05'
    WHEN upper(btrim(p_state)) IN ('WEST BENGAL','WB') THEN '19'
    WHEN upper(btrim(p_state)) IN ('DELHI','NCT OF DELHI','DL') THEN '07'
    WHEN upper(btrim(p_state)) IN ('JAMMU AND KASHMIR','J&K','JK') THEN '01'
    WHEN upper(btrim(p_state)) IN ('LADAKH','LA') THEN '38'
    WHEN upper(btrim(p_state)) IN ('PUDUCHERRY','PONDICHERRY','PY') THEN '34'
    WHEN upper(btrim(p_state)) IN ('CHANDIGARH','CH') THEN '04'
    WHEN upper(btrim(p_state)) IN ('DADRA AND NAGAR HAVELI AND DAMAN AND DIU','DNHDD') THEN '26'
    WHEN upper(btrim(p_state)) IN ('LAKSHADWEEP','LD') THEN '31'
    WHEN upper(btrim(p_state)) IN ('ANDAMAN AND NICOBAR ISLANDS','AN') THEN '35'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_invoice_totals(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','mm_private'
AS $$
DECLARE
  i public.invoices%rowtype;
  v_line_net numeric;
  v_line_tax numeric;
  v_invoice_discount numeric;
  v_tax numeric;
  v_total numeric;
  v_cgst numeric := 0;
  v_sgst numeric := 0;
  v_igst numeric := 0;
  v_supplier_state text;
  v_place_state text;
  v_intra_state boolean;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  SELECT coalesce(sum(quantity*unit_price-discount),0), coalesce(sum(tax_amount),0)
    INTO v_line_net,v_line_tax
  FROM public.invoice_items WHERE invoice_id=i.id;

  v_invoice_discount:=public.calculate_invoice_discount(v_line_net,i.discount_type,i.discount_value);
  IF i.discount_before_tax AND v_line_net>0 THEN
    v_tax:=round(v_line_tax*greatest(v_line_net-v_invoice_discount,0)/v_line_net,2);
  ELSE
    v_tax:=v_line_tax;
  END IF;
  v_total:=round(greatest(v_line_net-v_invoice_discount,0)+v_tax,2);

  SELECT public.gst_state_code(tp.tax_state) INTO v_supplier_state
  FROM public.business_tax_profiles tp WHERE tp.business_id=i.business_id;

  v_place_state := public.gst_state_code(i.place_of_supply_state_code);
  IF v_place_state IS NULL THEN
    SELECT public.gst_state_code(coalesce(c.billing_address->>'state',c.shipping_address->>'state'))
      INTO v_place_state
    FROM public.customers c WHERE c.id=i.customer_id AND c.business_id=i.business_id;
  END IF;

  v_intra_state := v_supplier_state IS NOT NULL AND v_place_state IS NOT NULL AND v_supplier_state=v_place_state;
  IF upper(coalesce(i.supply_type,''))='INTRA_STATE' THEN v_intra_state:=true; END IF;
  IF upper(coalesce(i.supply_type,''))='INTER_STATE' THEN v_intra_state:=false; END IF;

  IF upper(coalesce(i.supply_type,'')) NOT IN ('EXPORT','SEZ') AND NOT coalesce(i.reverse_charge,false) THEN
    IF v_intra_state THEN
      v_cgst:=round(v_tax/2,2);
      v_sgst:=round(v_tax-v_cgst,2);
    ELSE
      v_igst:=v_tax;
    END IF;
  ELSE
    v_igst:=CASE WHEN upper(coalesce(i.supply_type,'')) IN ('EXPORT','SEZ') THEN v_tax ELSE 0 END;
  END IF;

  UPDATE public.invoices
  SET subtotal=round((SELECT coalesce(sum(quantity*unit_price),0) FROM public.invoice_items WHERE invoice_id=i.id),2),
      discount_total=round((SELECT coalesce(sum(discount),0) FROM public.invoice_items WHERE invoice_id=i.id)+v_invoice_discount,2),
      tax_total=v_tax,
      cgst_amount=v_cgst,
      sgst_amount=v_sgst,
      igst_amount=v_igst,
      total=v_total,
      balance_due=greatest(v_total-amount_paid,0),
      updated_at=now()
  WHERE id=i.id;
END;
$$;
