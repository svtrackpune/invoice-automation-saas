BEGIN;

CREATE OR REPLACE FUNCTION public.customer_credit_balance(
  p_business_id uuid,
  p_customer_id uuid
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=public,mm_private AS $$
DECLARE
  v_total numeric:=0;
BEGIN
  IF NOT (
    mm_private.has_business_permission(p_business_id,'customers.view')
    OR mm_private.has_business_permission(p_business_id,'accounting.view')
    OR mm_private.has_business_permission(p_business_id,'payments.receive')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT EXISTS(
    SELECT 1
    FROM public.customers
    WHERE id=p_customer_id
      AND business_id=p_business_id
  ) THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  SELECT coalesce(sum(amount),0)
    INTO v_total
  FROM public.customer_credit_ledger
  WHERE business_id=p_business_id
    AND customer_id=p_customer_id;

  RETURN v_total;
END;
$$;

COMMIT;