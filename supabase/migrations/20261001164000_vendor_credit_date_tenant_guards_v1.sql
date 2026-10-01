BEGIN;

CREATE OR REPLACE FUNCTION public.create_vendor_credit(
  p_business_id uuid,
  p_vendor_id uuid,
  p_bill_id uuid,
  p_credit_date date,
  p_reason text,
  p_items jsonb,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  idd uuid;
  r jsonb;
  num text;
  cur char(3):='INR';
  v_subtotal numeric:=0;
  v_tax numeric:=0;
  v_total numeric:=0;
  v_bill public.bills%rowtype;
  v_vendor public.vendors%rowtype;
  v_item_qty numeric;
  v_item_price numeric;
  v_tax_rate numeric;
  v_bill_item public.bill_items%rowtype;
  v_source_base_unit numeric;
  v_source_tax_unit numeric;
  v_already_credited numeric;
  v_line_subtotal numeric;
  v_line_tax numeric;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'purchases.manage') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO v_vendor
  FROM public.vendors
  WHERE id=p_vendor_id AND business_id=p_business_id AND is_active;

  IF v_vendor.id IS NULL THEN
    RAISE EXCEPTION 'Vendor not found or inactive';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;

  IF nullif(trim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'Supplier credit reason is required';
  END IF;

  IF p_bill_id IS NOT NULL THEN
    SELECT * INTO v_bill
    FROM public.bills
    WHERE id=p_bill_id
      AND business_id=p_business_id
      AND vendor_id=p_vendor_id
      AND status<>'void'
    FOR UPDATE;

    IF v_bill.id IS NULL THEN
      RAISE EXCEPTION 'Source bill not found';
    END IF;

    IF v_bill.journal_entry_id IS NULL THEN
      RAISE EXCEPTION 'Post the source purchase bill before creating a supplier credit';
    END IF;

    IF p_credit_date<v_bill.bill_date THEN
      RAISE EXCEPTION 'Supplier credit date cannot be before the source bill date';
    END IF;

    cur:=v_bill.currency_code;
  END IF;

  PERFORM public.assert_accounting_period_open(p_business_id,p_credit_date);
  num:=public.next_document_number(p_business_id,'vendor_credit');

  INSERT INTO public.vendor_credits(
    business_id,vendor_id,bill_id,credit_number,credit_date,reason,currency_code,notes,created_by
  ) VALUES(
    p_business_id,p_vendor_id,p_bill_id,num,p_credit_date,p_reason,cur,p_notes,auth.uid()
  ) RETURNING id INTO idd;

  FOR r IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_qty:=coalesce((r->>'quantity')::numeric,0);
    v_item_price:=coalesce((r->>'unit_price')::numeric,0);
    v_tax_rate:=coalesce((r->>'tax_rate')::numeric,0);

    IF v_item_qty<=0 OR v_item_price<0 OR v_tax_rate<0 OR v_tax_rate>100 THEN
      RAISE EXCEPTION 'Invalid supplier credit item';
    END IF;

    IF nullif(r->>'bill_item_id','') IS NOT NULL THEN
      IF p_bill_id IS NULL THEN
        RAISE EXCEPTION 'A source bill item requires a source purchase bill';
      END IF;

      SELECT * INTO v_bill_item
      FROM public.bill_items bi
      WHERE bi.id=(r->>'bill_item_id')::uuid
        AND bi.bill_id=p_bill_id
      FOR UPDATE;

      IF v_bill_item.id IS NULL THEN
        RAISE EXCEPTION 'Supplier credit bill item does not belong to the source bill';
      END IF;

      IF nullif(r->>'product_service_id','') IS NOT NULL
         AND (r->>'product_service_id')::uuid IS DISTINCT FROM v_bill_item.product_service_id THEN
        RAISE EXCEPTION 'Supplier credit product does not match the source bill item';
      END IF;

      SELECT coalesce(sum(vci.quantity),0)
        INTO v_already_credited
      FROM public.vendor_credit_items vci
      JOIN public.vendor_credits vc ON vc.id=vci.vendor_credit_id
      WHERE vci.bill_item_id=v_bill_item.id
        AND vc.status='posted';

      IF v_item_qty>greatest(v_bill_item.quantity-v_already_credited,0)+0.000001 THEN
        RAISE EXCEPTION 'Supplier credit quantity exceeds the uncredited source quantity';
      END IF;

      v_source_base_unit:=round(
        greatest(coalesce(v_bill_item.line_total,0)-coalesce(v_bill_item.tax_amount,0),0)
        / nullif(v_bill_item.quantity,0),6
      );
      v_source_tax_unit:=round(
        greatest(coalesce(v_bill_item.tax_amount,0),0)
        / nullif(v_bill_item.quantity,0),6
      );

      v_line_subtotal:=round(v_item_qty*v_source_base_unit,2);
      v_line_tax:=round(v_item_qty*v_source_tax_unit,2);
      v_tax_rate:=CASE
        WHEN v_source_base_unit>0 THEN round(v_source_tax_unit/v_source_base_unit*100,6)
        ELSE 0
      END;
      v_item_price:=v_source_base_unit;
    ELSE
      v_line_subtotal:=round(v_item_qty*v_item_price,2);
      v_line_tax:=round(v_line_subtotal*v_tax_rate/100,2);
    END IF;

    IF nullif(r->>'product_service_id','') IS NOT NULL
       AND NOT EXISTS(
         SELECT 1 FROM public.products_services ps
         WHERE ps.id=(r->>'product_service_id')::uuid
           AND ps.business_id=p_business_id
           AND ps.is_active
       ) THEN
      RAISE EXCEPTION 'Product/service is invalid for this business';
    END IF;

    INSERT INTO public.vendor_credit_items(
      vendor_credit_id,bill_item_id,product_service_id,description,quantity,unit_price,
      tax_rate,line_subtotal,line_tax,line_total,sort_order
    ) VALUES(
      idd,
      nullif(r->>'bill_item_id','')::uuid,
      nullif(r->>'product_service_id','')::uuid,
      coalesce(nullif(trim(r->>'description'),''),'Purchase return / supplier adjustment'),
      v_item_qty,
      v_item_price,
      v_tax_rate,
      v_line_subtotal,
      v_line_tax,
      round(v_line_subtotal+v_line_tax,2),
      coalesce((r->>'sort_order')::int,0)
    );

    v_subtotal:=v_subtotal+v_line_subtotal;
    v_tax:=v_tax+v_line_tax;
  END LOOP;

  v_total:=round(v_subtotal+v_tax,2);
  IF v_total<=0 THEN
    RAISE EXCEPTION 'Supplier credit total must be greater than zero';
  END IF;

  UPDATE public.vendor_credits
  SET subtotal=round(v_subtotal,2),
      tax_total=round(v_tax,2),
      total=v_total,
      updated_at=now()
  WHERE id=idd;

  RETURN idd;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_vendor_credit_to_bill(
  p_business_id uuid,
  p_vendor_credit_id uuid,
  p_bill_id uuid,
  p_amount numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  vc public.vendor_credits%rowtype;
  b public.bills%rowtype;
  available numeric:=0;
  paid numeric:=0;
  applied numeric:=0;
  outstanding numeric:=0;
  v_entry uuid;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'accounting.adjust') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_amount<=0 THEN
    RAISE EXCEPTION 'Application amount must be greater than zero';
  END IF;

  PERFORM public.assert_accounting_period_open(p_business_id,current_date);

  SELECT * INTO vc
  FROM public.vendor_credits
  WHERE id=p_vendor_credit_id AND business_id=p_business_id
  FOR UPDATE;

  IF vc.id IS NULL OR vc.status<>'posted' THEN
    RAISE EXCEPTION 'Posted supplier credit not found';
  END IF;

  SELECT * INTO b
  FROM public.bills
  WHERE id=p_bill_id AND business_id=p_business_id AND vendor_id=vc.vendor_id
  FOR UPDATE;

  IF b.id IS NULL OR b.status='void' THEN
    RAISE EXCEPTION 'Target purchase bill not found or void';
  END IF;

  IF b.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Target purchase bill must be posted';
  END IF;

  SELECT coalesce(sum(vcl.amount),0)
    INTO available
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.vendor_credit_id=vc.id;

  IF available+0.005<p_amount THEN
    RAISE EXCEPTION 'Application exceeds available supplier credit';
  END IF;

  SELECT coalesce(sum(vpa.amount),0)
    INTO paid
  FROM public.vendor_payment_allocations vpa
  WHERE vpa.bill_id=b.id;

  SELECT greatest(-coalesce(sum(vcl.amount) FILTER (WHERE vcl.entry_type='application'),0),0)
    INTO applied
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.bill_id=b.id;

  outstanding:=greatest(b.total-paid-applied,0);

  IF p_amount>outstanding+0.005 THEN
    RAISE EXCEPTION 'Application exceeds the target purchase bill balance';
  END IF;

  INSERT INTO public.vendor_credit_ledger(
    business_id,vendor_id,vendor_credit_id,bill_id,entry_type,amount,
    currency_code,description,created_by
  ) VALUES(
    p_business_id,vc.vendor_id,vc.id,b.id,'application',-p_amount,
    vc.currency_code,'Applied to purchase bill '||b.bill_number,auth.uid()
  ) RETURNING id INTO v_entry;

  PERFORM public.recalculate_bill_settlement_state(b.id);
  RETURN v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_vendor_refund(
  p_business_id uuid,
  p_vendor_id uuid,
  p_vendor_credit_id uuid,
  p_amount numeric,
  p_method text,
  p_account_id uuid,
  p_reference text DEFAULT NULL,
  p_refund_date date DEFAULT current_date,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  vc public.vendor_credits%rowtype;
  available numeric:=0;
  pmt uuid;
  e uuid;
  ap uuid;
  method_value public.payment_method;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'payments.receive') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_amount<=0 THEN
    RAISE EXCEPTION 'Refund amount must be greater than zero';
  END IF;

  SELECT * INTO vc
  FROM public.vendor_credits
  WHERE id=p_vendor_credit_id
    AND business_id=p_business_id
    AND vendor_id=p_vendor_id
  FOR UPDATE;

  IF vc.id IS NULL OR vc.status<>'posted' THEN
    RAISE EXCEPTION 'Posted supplier credit not found';
  END IF;

  IF p_refund_date<vc.credit_date THEN
    RAISE EXCEPTION 'Refund date cannot be before supplier credit date';
  END IF;

  PERFORM public.assert_accounting_period_open(p_business_id,p_refund_date);

  SELECT coalesce(sum(vcl.amount),0)
    INTO available
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.vendor_credit_id=vc.id;

  IF available+0.005<p_amount THEN
    RAISE EXCEPTION 'Refund exceeds available supplier credit';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.accounts
    WHERE id=p_account_id
      AND business_id=p_business_id
      AND is_active
      AND account_subtype IN ('cash','bank')
  ) THEN
    RAISE EXCEPTION 'Refund account must be an active Cash or Bank account';
  END IF;

  method_value:=CASE
    WHEN lower(p_method)='gateway' THEN 'payment_gateway'::payment_method
    ELSE lower(p_method)::payment_method
  END;

  SELECT id INTO ap
  FROM public.accounts
  WHERE business_id=p_business_id AND code='2000' AND is_active;

  IF ap IS NULL THEN
    RAISE EXCEPTION 'Accounts payable account is missing';
  END IF;

  INSERT INTO public.payments(
    business_id,direction,vendor_id,account_id,amount,currency_code,payment_date,
    method,reference,notes,created_by
  ) VALUES(
    p_business_id,'inbound',p_vendor_id,p_account_id,p_amount,vc.currency_code,
    p_refund_date,method_value,nullif(trim(p_reference),''),p_notes,auth.uid()
  ) RETURNING id INTO pmt;

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));

  INSERT INTO public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,status,
    posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
  ) VALUES(
    p_business_id,
    (SELECT coalesce(max(entry_number),0)+1
     FROM public.journal_entries
     WHERE business_id=p_business_id),
    p_refund_date,
    'Supplier refund for credit '||vc.credit_number,
    'vendor_refund',
    pmt,
    'posted',
    now(),auth.uid(),auth.uid(),
    vc.currency_code,p_amount,p_amount,true
  ) RETURNING id INTO e;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  ) VALUES(
    e,p_account_id,'Supplier refund received',p_amount,0,vc.currency_code,'vendor',p_vendor_id
  ),(
    e,ap,'Accounts payable settlement of supplier credit',0,p_amount,vc.currency_code,'vendor',p_vendor_id
  );

  PERFORM public.validate_journal_entry_balance(e);

  INSERT INTO public.vendor_credit_ledger(
    business_id,vendor_id,payment_id,vendor_credit_id,entry_type,amount,
    currency_code,description,created_by
  ) VALUES(
    p_business_id,p_vendor_id,pmt,vc.id,'refund',-p_amount,vc.currency_code,
    'Supplier refund received',auth.uid()
  );

  UPDATE public.payments
  SET journal_entry_id=e,updated_at=now()
  WHERE id=pmt;

  RETURN pmt;
END;
$$;

REVOKE ALL ON FUNCTION public.vendor_credit_balance(uuid,uuid) FROM public,anon;
REVOKE ALL ON FUNCTION public.vendor_credit_available(uuid,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.vendor_credit_balance(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_credit_available(uuid,uuid) TO authenticated;

COMMIT;