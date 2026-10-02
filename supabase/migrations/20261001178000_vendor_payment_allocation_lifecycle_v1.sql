BEGIN;

-- Supplier payments may be recorded before a bill exists, then applied/reallocated
-- across one or more posted purchase bills without changing the payment identity.
CREATE INDEX IF NOT EXISTS idx_vendor_payment_allocations_payment
  ON public.vendor_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_vendor_payment_allocations_bill
  ON public.vendor_payment_allocations(bill_id);

ALTER TABLE public.vendor_payment_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_payment_allocations_access ON public.vendor_payment_allocations;
DROP POLICY IF EXISTS vendor_payment_allocations_select ON public.vendor_payment_allocations;

CREATE POLICY vendor_payment_allocations_select
  ON public.vendor_payment_allocations
  FOR SELECT
  TO authenticated
  USING (
    mm_private.has_business_permission(business_id,'payments.pay')
    OR mm_private.has_business_permission(business_id,'accounting.view')
    OR mm_private.has_business_permission(business_id,'purchases.manage')
  );

REVOKE ALL ON TABLE public.vendor_payment_allocations FROM anon, authenticated;
GRANT SELECT ON TABLE public.vendor_payment_allocations TO authenticated;

CREATE OR REPLACE FUNCTION public.record_vendor_payment_unapplied(
  p_business_id uuid,
  p_vendor_id uuid,
  p_amount numeric,
  p_method text,
  p_account_id uuid,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public,mm_private
AS $function$
DECLARE
  v_payment uuid;
  v_entry uuid;
  v_advance uuid;
  v_vendor_business uuid;
  v_currency bpchar;
  v_method public.payment_method;
  v_entry_number bigint;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'payments.pay') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  SELECT v.business_id
  INTO v_vendor_business
  FROM public.vendors v
  WHERE v.id=p_vendor_id
    AND v.business_id=p_business_id
    AND v.is_active;

  IF v_vendor_business IS NULL THEN
    RAISE EXCEPTION 'Supplier not found';
  END IF;

  PERFORM public.assert_accounting_period_open(p_business_id,p_payment_date);

  IF NOT EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id=p_account_id
      AND a.business_id=p_business_id
      AND a.is_active
      AND a.account_subtype IN ('cash','bank')
  ) THEN
    RAISE EXCEPTION 'Payment account must be an active Cash or Bank account';
  END IF;

  SELECT b.currency_code
  INTO v_currency
  FROM public.businesses b
  WHERE b.id=p_business_id
    AND b.is_active;

  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'Business not found';
  END IF;

  v_method := CASE
    WHEN lower(p_method)='gateway' THEN 'payment_gateway'::public.payment_method
    ELSE lower(p_method)::public.payment_method
  END CASE;

  SELECT id
  INTO v_advance
  FROM public.accounts
  WHERE business_id=p_business_id
    AND code='1255'
    AND is_active
  FOR UPDATE;

  IF v_advance IS NULL THEN
    INSERT INTO public.accounts(
      business_id,code,name,account_type,normal_balance,is_system,is_active,description
    )
    VALUES(
      p_business_id,'1255','Vendor Advances','asset','debit',true,true,
      'Vendor overpayments and advances'
    )
    RETURNING id INTO v_advance;
  END IF;

  INSERT INTO public.payments(
    business_id,direction,vendor_id,account_id,amount,currency_code,payment_date,
    method,reference,notes,created_by
  )
  VALUES(
    p_business_id,'outbound',p_vendor_id,p_account_id,p_amount,v_currency,p_payment_date,
    v_method,nullif(trim(p_reference),''),p_notes,auth.uid()
  )
  RETURNING id INTO v_payment;

  INSERT INTO public.vendor_credit_ledger(
    business_id,vendor_id,payment_id,entry_type,amount,currency_code,
    description,created_by
  )
  VALUES(
    p_business_id,p_vendor_id,v_payment,'overpayment',p_amount,v_currency,
    'Unapplied supplier payment / vendor advance',auth.uid()
  );

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));

  SELECT coalesce(max(entry_number),0)+1
  INTO v_entry_number
  FROM public.journal_entries
  WHERE business_id=p_business_id;

  INSERT INTO public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,status,
    posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
  )
  VALUES(
    p_business_id,v_entry_number,p_payment_date,
    'Unapplied supplier payment to '||p_vendor_id::text,
    'vendor_payment',v_payment,'posted',now(),auth.uid(),auth.uid(),
    v_currency,p_amount,p_amount,true
  )
  RETURNING id INTO v_entry;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  )
  VALUES(
    v_entry,v_advance,'Vendor advance / unapplied supplier payment',
    p_amount,0,v_currency,'vendor',p_vendor_id
  ),(
    v_entry,p_account_id,'Supplier payment',
    0,p_amount,v_currency,'vendor',p_vendor_id
  );

  PERFORM public.validate_journal_entry_balance(v_entry);

  UPDATE public.payments
  SET journal_entry_id=v_entry,updated_at=now()
  WHERE id=v_payment;

  RETURN v_payment;
END;
$function$;

CREATE OR REPLACE FUNCTION public.allocate_vendor_payment(
  p_payment_id uuid,
  p_allocations jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public,mm_private
AS $function$
DECLARE
  pay_row public.payments%rowtype;
  v_journal public.journal_entries%rowtype;
  v_bill public.bills%rowtype;
  v_alloc record;
  v_old_allocated numeric:=0;
  v_new_allocated numeric:=0;
  v_old_unapplied numeric:=0;
  v_new_unapplied numeric:=0;
  v_unapplied_delta numeric:=0;
  v_other_paid numeric:=0;
  v_credit_applied numeric:=0;
  v_advance uuid;
  v_ap uuid;
  v_entry_number bigint;
  v_distinct_count integer:=0;
BEGIN
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations)<>'array' THEN
    RAISE EXCEPTION 'Supplier payment allocations must be a JSON array';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _vendor_payment_target_allocations(
    bill_id uuid PRIMARY KEY,
    amount numeric NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE _vendor_payment_target_allocations;

  INSERT INTO _vendor_payment_target_allocations(bill_id,amount)
  SELECT x.bill_id, sum(x.amount)
  FROM jsonb_to_recordset(p_allocations)
    AS x(bill_id uuid, amount numeric)
  GROUP BY x.bill_id;

  IF EXISTS(
    SELECT 1
    FROM _vendor_payment_target_allocations
    WHERE bill_id IS NULL OR amount <= 0
  ) THEN
    RAISE EXCEPTION 'Each supplier payment allocation must have a bill_id and a positive amount';
  END IF;

  SELECT *
  INTO pay_row
  FROM public.payments
  WHERE id=p_payment_id
    AND direction='outbound'
  FOR UPDATE;

  IF pay_row.id IS NULL OR pay_row.vendor_id IS NULL THEN
    RAISE EXCEPTION 'Posted supplier payment not found';
  END IF;

  IF NOT mm_private.has_business_permission(pay_row.business_id,'payments.pay') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF pay_row.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Only posted supplier payments can be allocated or reallocated';
  END IF;

  IF NOT mm_private.has_business_permission(pay_row.business_id,'accounting.adjust') THEN
    RAISE EXCEPTION 'Accounting adjustment permission required to change supplier payment allocations';
  END IF;

  PERFORM public.assert_accounting_period_open(pay_row.business_id,pay_row.payment_date);

  SELECT coalesce(sum(vpa.amount),0)
  INTO v_old_allocated
  FROM public.vendor_payment_allocations vpa
  WHERE vpa.payment_id=pay_row.id;

  SELECT coalesce(sum(vcl.amount),0)
  INTO v_old_unapplied
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.payment_id=pay_row.id;

  IF abs((pay_row.amount-v_old_allocated)-v_old_unapplied)>0.005 THEN
    RAISE EXCEPTION 'Supplier payment allocation state is inconsistent; reconcile the payment before reallocating it';
  END IF;

  SELECT coalesce(sum(amount),0)
  INTO v_new_allocated
  FROM _vendor_payment_target_allocations;

  IF v_new_allocated>pay_row.amount+0.005 THEN
    RAISE EXCEPTION 'Supplier payment allocations exceed the payment amount';
  END IF;

  -- Lock every current and target bill in deterministic order.
  FOR v_bill IN
    SELECT b.*
    FROM public.bills b
    WHERE b.id IN (
      SELECT bill_id FROM _vendor_payment_target_allocations
      UNION
      SELECT vpa.bill_id
      FROM public.vendor_payment_allocations vpa
      WHERE vpa.payment_id=pay_row.id
    )
    ORDER BY b.id
    FOR UPDATE
  LOOP
    IF v_bill.business_id<>pay_row.business_id
       OR v_bill.vendor_id<>pay_row.vendor_id THEN
      RAISE EXCEPTION 'Supplier payment allocation crosses business or supplier boundary';
    END IF;
  END LOOP;

  FOR v_alloc IN
    SELECT t.bill_id,t.amount,b.*
    FROM _vendor_payment_target_allocations t
    JOIN public.bills b ON b.id=t.bill_id
    ORDER BY t.bill_id
  LOOP
    IF v_alloc.business_id<>pay_row.business_id
       OR v_alloc.vendor_id<>pay_row.vendor_id THEN
      RAISE EXCEPTION 'Target purchase bill does not belong to the supplier payment';
    END IF;

    IF v_alloc.status IN ('draft','void') OR v_alloc.journal_entry_id IS NULL THEN
      RAISE EXCEPTION 'Target purchase bill must be posted and not void';
    END IF;

    IF v_alloc.currency_code IS DISTINCT FROM pay_row.currency_code THEN
      RAISE EXCEPTION 'Supplier payment currency does not match target purchase bill';
    END IF;

    IF pay_row.payment_date<v_alloc.bill_date THEN
      RAISE EXCEPTION 'Supplier payment date cannot be before target purchase bill date';
    END IF;

    SELECT coalesce(sum(vpa.amount),0)
    INTO v_other_paid
    FROM public.vendor_payment_allocations vpa
    WHERE vpa.bill_id=v_alloc.bill_id
      AND vpa.payment_id<>pay_row.id;

    SELECT greatest(
      -coalesce(sum(vcl.amount) FILTER (WHERE vcl.entry_type='application'),0),
      0
    )
    INTO v_credit_applied
    FROM public.vendor_credit_ledger vcl
    WHERE vcl.bill_id=v_alloc.bill_id;

    IF v_alloc.amount>greatest(v_alloc.total-v_other_paid-v_credit_applied,0)+0.005 THEN
      RAISE EXCEPTION 'Allocation to bill % exceeds its remaining payable balance after other payments and supplier credits', v_alloc.bill_number;
    END IF;
  END LOOP;

  v_new_unapplied:=greatest(pay_row.amount-v_new_allocated,0);
  v_unapplied_delta:=v_new_unapplied-v_old_unapplied;

  IF abs(v_unapplied_delta)>0.005 THEN
    INSERT INTO public.vendor_credit_ledger(
      business_id,vendor_id,payment_id,entry_type,amount,currency_code,
      description,created_by
    )
    VALUES(
      pay_row.business_id,pay_row.vendor_id,pay_row.id,'adjustment',v_unapplied_delta,
      pay_row.currency_code,
      CASE
        WHEN v_unapplied_delta>0 THEN 'Supplier payment reallocation created unapplied vendor advance'
        ELSE 'Supplier payment reallocation applied prior vendor advance'
      END,
      auth.uid()
    );
  END IF;

  DELETE FROM public.vendor_payment_allocations vpa
  WHERE vpa.payment_id=pay_row.id
    AND NOT EXISTS (
      SELECT 1
      FROM _vendor_payment_target_allocations t
      WHERE t.bill_id=vpa.bill_id
    );

  UPDATE public.vendor_payment_allocations vpa
  SET amount=t.amount
  FROM _vendor_payment_target_allocations t
  WHERE vpa.payment_id=pay_row.id
    AND vpa.bill_id=t.bill_id;

  INSERT INTO public.vendor_payment_allocations(
    business_id,payment_id,vendor_id,bill_id,amount
  )
  SELECT
    pay_row.business_id,pay_row.id,pay_row.vendor_id,t.bill_id,t.amount
  FROM _vendor_payment_target_allocations t
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.vendor_payment_allocations vpa
    WHERE vpa.payment_id=pay_row.id
      AND vpa.bill_id=t.bill_id
  );

  SELECT count(*)
  INTO v_distinct_count
  FROM _vendor_payment_target_allocations;

  IF v_distinct_count=1 THEN
    SELECT bill_id INTO v_bill
    FROM _vendor_payment_target_allocations
    LIMIT 1;
  ELSE
    v_bill.id:=NULL;
  END IF;

  UPDATE public.payments
  SET bill_id=CASE WHEN v_distinct_count=1 THEN v_bill.id ELSE NULL END,
      updated_at=now()
  WHERE id=pay_row.id;

  SELECT *
  INTO v_journal
  FROM public.journal_entries
  WHERE id=pay_row.journal_entry_id
    AND business_id=pay_row.business_id
    AND source_type='vendor_payment'
    AND source_id=pay_row.id
  FOR UPDATE;

  IF v_journal.id IS NULL THEN
    RAISE EXCEPTION 'Supplier payment journal could not be verified';
  END IF;

  SELECT id
  INTO v_ap
  FROM public.accounts
  WHERE business_id=pay_row.business_id
    AND code='2000'
    AND is_active;

  IF v_ap IS NULL THEN
    RAISE EXCEPTION 'Accounts payable account is missing';
  END IF;

  IF v_new_unapplied>0.005 THEN
    SELECT id
    INTO v_advance
    FROM public.accounts
    WHERE business_id=pay_row.business_id
      AND code='1255'
      AND is_active
    FOR UPDATE;

    IF v_advance IS NULL THEN
      INSERT INTO public.accounts(
        business_id,code,name,account_type,normal_balance,is_system,is_active,description
      )
      VALUES(
        pay_row.business_id,'1255','Vendor Advances','asset','debit',true,true,
        'Vendor overpayments and advances'
      )
      RETURNING id INTO v_advance;
    END IF;
  END IF;

  DELETE FROM public.journal_lines
  WHERE journal_entry_id=v_journal.id;

  UPDATE public.journal_entries
  SET description='Supplier payment reallocation',
      total_debit=pay_row.amount,
      total_credit=pay_row.amount,
      updated_at=now()
  WHERE id=v_journal.id;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  )
  SELECT
    v_journal.id,v_ap,'Accounts payable settlement',
    v_new_allocated,0,pay_row.currency_code,'vendor',pay_row.vendor_id
  WHERE v_new_allocated>0;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  )
  SELECT
    v_journal.id,v_advance,'Vendor advance / unapplied supplier payment',
    v_new_unapplied,0,pay_row.currency_code,'vendor',pay_row.vendor_id
  WHERE v_new_unapplied>0.005;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  )
  VALUES(
    v_journal.id,pay_row.account_id,'Supplier payment',
    0,pay_row.amount,pay_row.currency_code,'vendor',pay_row.vendor_id
  );

  PERFORM public.validate_journal_entry_balance(v_journal.id);

  -- Make final bill settlement values explicit after the allocation set is stable.
  FOR v_bill IN
    SELECT b.*
    FROM public.bills b
    WHERE b.id IN (
      SELECT bill_id FROM _vendor_payment_target_allocations
      UNION
      SELECT vpa.bill_id
      FROM public.vendor_payment_allocations vpa
      WHERE vpa.payment_id=pay_row.id
    )
    ORDER BY b.id
    FOR UPDATE
  LOOP
    PERFORM public.recalculate_bill_settlement_state(v_bill.id);
  END LOOP;

  RETURN pay_row.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_vendor_payment_unapplied(uuid,uuid,numeric,text,uuid,date,text,text) FROM public,anon;
REVOKE ALL ON FUNCTION public.allocate_vendor_payment(uuid,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.record_vendor_payment_unapplied(uuid,uuid,numeric,text,uuid,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_vendor_payment(uuid,jsonb) TO authenticated;

COMMIT;