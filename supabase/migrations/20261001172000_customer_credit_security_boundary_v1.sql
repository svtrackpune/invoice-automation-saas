BEGIN;

ALTER TABLE public.customer_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_credit_ledger_member ON public.customer_credit_ledger;
DROP POLICY IF EXISTS customer_credit_ledger_access ON public.customer_credit_ledger;
DROP POLICY IF EXISTS customer_credit_ledger_select ON public.customer_credit_ledger;
DROP POLICY IF EXISTS customer_refunds_member ON public.customer_refunds;
DROP POLICY IF EXISTS customer_refunds_access ON public.customer_refunds;
DROP POLICY IF EXISTS customer_refunds_select ON public.customer_refunds;

CREATE POLICY customer_credit_ledger_select
  ON public.customer_credit_ledger
  FOR SELECT TO authenticated
  USING (mm_private.has_business_permission(business_id,'customers.view'));

CREATE POLICY customer_refunds_select
  ON public.customer_refunds
  FOR SELECT TO authenticated
  USING (mm_private.has_business_permission(business_id,'customers.view'));

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
  IF NOT mm_private.has_business_permission(p_business_id,'customers.view') THEN
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

CREATE OR REPLACE FUNCTION public.refund_customer_credit(
  p_business_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_account_id uuid,
  p_method text,
  p_reference text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_refund_date date DEFAULT current_date
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private AS $$
DECLARE
  v_balance numeric;
  v_refund uuid;
  v_entry uuid;
  v_credit_acct uuid;
  v_currency char(3);
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'payments.receive') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_amount<=0 THEN
    RAISE EXCEPTION 'Refund amount must be greater than zero';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.customers
    WHERE id=p_customer_id
      AND business_id=p_business_id
      AND is_active
  ) THEN
    RAISE EXCEPTION 'Customer not found or inactive';
  END IF;

  PERFORM public.assert_accounting_period_open(p_business_id,p_refund_date);

  SELECT public.customer_credit_balance(p_business_id,p_customer_id)
    INTO v_balance;

  IF p_amount>v_balance+0.005 THEN
    RAISE EXCEPTION 'Refund exceeds available customer credit';
  END IF;

  SELECT currency_code
    INTO v_currency
  FROM public.businesses
  WHERE id=p_business_id;

  IF NOT EXISTS(
    SELECT 1 FROM public.accounts
    WHERE id=p_account_id
      AND business_id=p_business_id
      AND is_active
      AND account_subtype IN ('cash','bank')
  ) THEN
    RAISE EXCEPTION 'Refund account must be an active Cash or Bank account';
  END IF;

  SELECT id
    INTO v_credit_acct
  FROM public.accounts
  WHERE business_id=p_business_id
    AND code='2150'
    AND is_active;

  IF v_credit_acct IS NULL THEN
    RAISE EXCEPTION 'Customer credit account is missing';
  END IF;

  INSERT INTO public.customer_refunds(
    business_id,customer_id,refund_date,amount,currency_code,method,
    account_id,reference,reason,created_by
  ) VALUES(
    p_business_id,p_customer_id,p_refund_date,p_amount,v_currency,p_method,
    p_account_id,p_reference,p_reason,auth.uid()
  ) RETURNING id INTO v_refund;

  INSERT INTO public.customer_credit_ledger(
    business_id,customer_id,refund_id,entry_type,amount,currency_code,
    description,created_by
  ) VALUES(
    p_business_id,p_customer_id,v_refund,'refund',-p_amount,v_currency,
    'Customer credit refund',auth.uid()
  );

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));

  INSERT INTO public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,
    status,posted_at,posted_by,created_by,currency_code,total_debit,
    total_credit,is_system_generated
  ) VALUES(
    p_business_id,
    (SELECT coalesce(max(je.entry_number),0)+1
     FROM public.journal_entries je
     WHERE je.business_id=p_business_id),
    p_refund_date,
    'Customer credit refund',
    'refund',
    v_refund,
    'posted',
    now(),auth.uid(),auth.uid(),v_currency,p_amount,p_amount,true
  ) RETURNING id INTO v_entry;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  ) VALUES(
    v_entry,v_credit_acct,'Customer credit refund',p_amount,0,v_currency,'customer',p_customer_id
  ),(
    v_entry,p_account_id,'Refund paid',0,p_amount,v_currency,'customer',p_customer_id
  );

  PERFORM public.validate_journal_entry_balance(v_entry);

  UPDATE public.customer_refunds
  SET journal_entry_id=v_entry,status='posted'
  WHERE id=v_refund;

  RETURN v_refund;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_credit_balance(uuid,uuid) FROM public,anon;
REVOKE EXECUTE ON FUNCTION public.refund_customer_credit(uuid,uuid,numeric,uuid,text,text,text,date) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.customer_credit_balance(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_customer_credit(uuid,uuid,numeric,uuid,text,text,text,date) TO authenticated;

COMMIT;