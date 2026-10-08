BEGIN;

CREATE OR REPLACE FUNCTION public.create_cash_bill(
  p_business_id uuid,
  p_phone text,
  p_invoice_date date,
  p_items jsonb,
  p_payment_method public.payment_method,
  p_account_id uuid,
  p_invoice_discount_type text DEFAULT NULL,
  p_invoice_discount_value numeric DEFAULT 0,
  p_notes text DEFAULT 'Cash & Carry',
  p_terms text DEFAULT 'Paid in full at counter.'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $function$
DECLARE
  v_customer uuid;
  v_invoice uuid;
  v_currency char(3);
BEGIN
  PERFORM set_config('moneymatters.pos_cash_bill', '1', true);

  IF NOT mm_private.has_business_permission(p_business_id, 'sales.create', auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_payment_method NOT IN ('cash', 'upi') THEN
    RAISE EXCEPTION 'Cash Bill settlement must be Cash or UPI.';
  END IF;

  IF p_payment_method = 'cash' AND NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE id = p_account_id
      AND business_id = p_business_id
      AND is_active = true
      AND account_subtype = 'cash'
  ) THEN
    RAISE EXCEPTION 'Select a valid Cash settlement account for a Cash Bill paid by cash.';
  END IF;

  IF p_payment_method = 'upi' AND NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE id = p_account_id
      AND business_id = p_business_id
      AND is_active = true
      AND account_subtype = 'bank'
  ) THEN
    RAISE EXCEPTION 'Select a valid Bank settlement account for a Cash Bill paid by UPI.';
  END IF;

  SELECT upper(coalesce(
    nullif(btrim(base_currency_code), ''),
    nullif(btrim(currency_code), ''),
    'INR'
  ))
  INTO v_currency
  FROM public.businesses
  WHERE id = p_business_id
    AND is_active = true;

  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'Business % not found or inactive', p_business_id;
  END IF;

  IF nullif(trim(coalesce(p_phone, '')), '') IS NULL THEN
    v_customer := public.get_or_create_cash_customer(p_business_id);
  ELSE
    v_customer := public.get_or_create_cash_customer_by_phone(
      p_business_id,
      trim(p_phone)
    );
  END IF;

  v_invoice := public.create_invoice_from_items(
    p_business_id,
    v_customer,
    p_invoice_date,
    p_invoice_date,
    p_items,
    p_invoice_discount_type,
    p_invoice_discount_value,
    p_notes,
    p_terms
  );

  UPDATE public.invoices
  SET document_kind = 'cash_bill',
      payment_display_mode = 'none',
      payment_bank_account_id = NULL,
      currency_code = v_currency,
      updated_at = now()
  WHERE id = v_invoice;

  PERFORM public.post_invoice(v_invoice, NULL);

  PERFORM public.record_customer_payment(
    p_business_id,
    v_customer,
    v_invoice,
    (SELECT total FROM public.invoices WHERE id = v_invoice),
    p_payment_method,
    p_account_id,
    NULL,
    NULL,
    p_invoice_date,
    p_notes,
    v_currency
  );

  RETURN v_invoice;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text)
  FROM anon;

COMMIT;