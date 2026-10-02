BEGIN;

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
  WHERE id=p_vendor_credit_id
    AND business_id=p_business_id
  FOR UPDATE;

  IF vc.id IS NULL OR vc.status<>'posted' THEN
    RAISE EXCEPTION 'Posted supplier credit not found';
  END IF;

  SELECT * INTO b
  FROM public.bills
  WHERE id=p_bill_id
    AND business_id=p_business_id
    AND vendor_id=vc.vendor_id
  FOR UPDATE;

  IF b.id IS NULL OR b.status='void' THEN
    RAISE EXCEPTION 'Target purchase bill not found or void';
  END IF;

  IF b.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Target purchase bill must be posted';
  END IF;

  IF b.currency_code IS DISTINCT FROM vc.currency_code THEN
    RAISE EXCEPTION 'Supplier credit currency does not match the target purchase bill';
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

REVOKE EXECUTE ON FUNCTION public.apply_vendor_credit_to_bill(uuid,uuid,uuid,numeric) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.apply_vendor_credit_to_bill(uuid,uuid,uuid,numeric) TO authenticated;

COMMIT;