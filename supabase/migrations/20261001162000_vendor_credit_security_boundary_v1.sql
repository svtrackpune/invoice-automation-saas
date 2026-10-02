BEGIN;

CREATE OR REPLACE FUNCTION public.vendor_credit_balance(
  p_business_id uuid,
  p_vendor_id uuid
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  v_total numeric:=0;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'accounting.view') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT coalesce(sum(vcl.amount),0)
    INTO v_total
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.business_id=p_business_id
    AND vcl.vendor_id=p_vendor_id;

  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.vendor_credit_available(
  p_business_id uuid,
  p_vendor_credit_id uuid
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  v_business_id uuid;
  v_total numeric:=0;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'accounting.view') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT business_id
    INTO v_business_id
  FROM public.vendor_credits
  WHERE id=p_vendor_credit_id;

  IF v_business_id IS NULL OR v_business_id<>p_business_id THEN
    RAISE EXCEPTION 'Supplier credit not found';
  END IF;

  SELECT coalesce(sum(vcl.amount),0)
    INTO v_total
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.business_id=p_business_id
    AND vcl.vendor_credit_id=p_vendor_credit_id;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.vendor_credit_balance(uuid,uuid) FROM public,anon;
REVOKE ALL ON FUNCTION public.vendor_credit_available(uuid,uuid) FROM public,anon;

REVOKE ALL ON FUNCTION public.recalculate_bill_settlement_state(uuid) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_bill_settlement_state_trigger() FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_vendor_payment_allocation_net_balance() FROM public,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.vendor_credit_balance(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_credit_available(uuid,uuid) TO authenticated;

COMMIT;