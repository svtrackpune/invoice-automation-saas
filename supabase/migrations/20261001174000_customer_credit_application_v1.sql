BEGIN;

CREATE OR REPLACE FUNCTION public.apply_customer_credit_to_invoice(
  p_business_id uuid,
  p_customer_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_application_date date DEFAULT current_date
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private AS $$
DECLARE
  inv public.invoices%rowtype;
  v_credit_acct uuid;
  v_ar uuid;
  v_available numeric:=0;
  v_application numeric;
  v_entry uuid;
  v_ledger_id uuid;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'accounting.adjust') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_amount<=0 THEN
    RAISE EXCEPTION 'Credit application amount must be greater than zero';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('customer-credit:'||p_business_id::text||':'||p_customer_id::text)
  );
  PERFORM public.assert_accounting_period_open(p_business_id,p_application_date);

  SELECT * INTO inv
  FROM public.invoices
  WHERE id=p_invoice_id
    AND business_id=p_business_id
    AND customer_id=p_customer_id
  FOR UPDATE;

  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found for this customer and business';
  END IF;

  IF inv.status='void' THEN
    RAISE EXCEPTION 'Cannot apply customer credit to a void invoice';
  END IF;

  IF inv.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Target invoice must be posted';
  END IF;

  IF p_application_date<inv.invoice_date THEN
    RAISE EXCEPTION 'Credit application date cannot be before invoice date';
  END IF;

  SELECT coalesce(sum(ccl.amount),0)
    INTO v_available
  FROM public.customer_credit_ledger ccl
  WHERE ccl.business_id=p_business_id
    AND ccl.customer_id=p_customer_id;

  IF v_available+0.005<p_amount THEN
    RAISE EXCEPTION 'Application exceeds available customer credit';
  END IF;

  v_application:=least(
    p_amount,
    greatest(inv.balance_due,0)
  );

  IF v_application<=0 THEN
    RAISE EXCEPTION 'Target invoice has no outstanding balance';
  END IF;

  IF v_application+0.005<p_amount THEN
    RAISE EXCEPTION 'Application exceeds the target invoice balance';
  END IF;

  SELECT id INTO v_credit_acct
  FROM public.accounts
  WHERE business_id=p_business_id
    AND code='2150'
    AND is_active;

  SELECT id INTO v_ar
  FROM public.accounts
  WHERE business_id=p_business_id
    AND code='1100'
    AND is_active;

  IF v_credit_acct IS NULL THEN
    RAISE EXCEPTION 'Customer credit account is missing';
  END IF;

  IF v_ar IS NULL THEN
    RAISE EXCEPTION 'Accounts receivable account is missing';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));

  INSERT INTO public.customer_credit_ledger(
    business_id,customer_id,credit_note_id,entry_type,amount,currency_code,
    description,created_by
  ) VALUES(
    p_business_id,p_customer_id,NULL,'application',-v_application,
    inv.currency_code,'Applied customer credit to invoice '||inv.invoice_number,auth.uid()
  ) RETURNING id INTO v_ledger_id;

  INSERT INTO public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,status,
    posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
  ) VALUES(
    p_business_id,
    (SELECT coalesce(max(je.entry_number),0)+1
     FROM public.journal_entries je
     WHERE je.business_id=p_business_id),
    p_application_date,
    'Customer credit applied to invoice '||inv.invoice_number,
    'customer_credit_application',
    v_ledger_id,
    'posted',
    now(),auth.uid(),auth.uid(),
    inv.currency_code,v_application,v_application,true
  ) RETURNING id INTO v_entry;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  ) VALUES(
    v_entry,v_credit_acct,'Customer credit applied',v_application,0,inv.currency_code,'customer',p_customer_id
  ),(
    v_entry,v_ar,'Receivable settlement from customer credit',0,v_application,inv.currency_code,'customer',p_customer_id
  );

  PERFORM public.validate_journal_entry_balance(v_entry);

  UPDATE public.invoices
  SET balance_due=greatest(balance_due-v_application,0),
      status=CASE
        WHEN greatest(balance_due-v_application,0)<=0 THEN 'paid'::invoice_status
        WHEN due_date<current_date THEN 'overdue'::invoice_status
        WHEN amount_paid>0 THEN 'partially_paid'::invoice_status
        ELSE 'sent'::invoice_status
      END,
      updated_at=now()
  WHERE id=inv.id;

  RETURN v_ledger_id;
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

  PERFORM pg_advisory_xact_lock(
    hashtext('customer-credit:'||p_business_id::text||':'||p_customer_id::text)
  );
  PERFORM public.assert_accounting_period_open(p_business_id,p_refund_date);

  IF NOT EXISTS(
    SELECT 1 FROM public.customers
    WHERE id=p_customer_id
      AND business_id=p_business_id
      AND is_active
  ) THEN
    RAISE EXCEPTION 'Customer not found or inactive';
  END IF;

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

  SELECT id INTO v_credit_acct
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

REVOKE EXECUTE ON FUNCTION public.apply_customer_credit_to_invoice(uuid,uuid,uuid,numeric,date) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.apply_customer_credit_to_invoice(uuid,uuid,uuid,numeric,date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_customer_credit(uuid,uuid,numeric,uuid,text,text,text,date) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.refund_customer_credit(uuid,uuid,numeric,uuid,text,text,text,date) TO authenticated;

COMMIT;