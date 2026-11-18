BEGIN;

-- Cash Bill is a walk-in sale: keep one internal counter customer per business.
-- The customer's mobile belongs to the receipt event, not a registered customer profile.
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS delivery_phone text;

COMMENT ON COLUMN public.receipts.delivery_phone IS
  'Walk-in Cash Bill receipt destination captured at POS; deliberately separate from registered customer profile data.';

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
SET search_path TO 'public', 'mm_private'
AS $function$
DECLARE
  v_customer uuid;
  v_invoice uuid;
  v_receipt uuid;
  v_currency char(3);
BEGIN
  PERFORM set_config('moneymatters.pos_cash_bill', '1', true);

  IF NOT mm_private.has_business_permission(p_business_id, 'sales.create') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_phone IS NULL OR btrim(p_phone) !~ '^[+]91[6-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'A valid Indian mobile number is required for the paid Cash Bill receipt.';
  END IF;

  IF p_payment_method NOT IN ('cash', 'upi') THEN
    RAISE EXCEPTION 'Cash Bill settlement must be Cash or UPI.';
  END IF;

  IF p_payment_method = 'cash' AND NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE id = p_account_id AND business_id = p_business_id
      AND is_active AND account_subtype = 'cash'
  ) THEN
    RAISE EXCEPTION 'Select a Cash settlement account for a Cash Bill paid by cash.';
  END IF;

  IF p_payment_method = 'upi' AND NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE id = p_account_id AND business_id = p_business_id
      AND is_active AND account_subtype = 'bank'
  ) THEN
    RAISE EXCEPTION 'Select a Bank settlement account for a Cash Bill paid by UPI.';
  END IF;

  SELECT upper(coalesce(
    nullif(btrim(base_currency_code), ''),
    nullif(btrim(currency_code), ''),
    'INR'
  ))
  INTO v_currency
  FROM public.businesses
  WHERE id = p_business_id AND is_active;

  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'Business not found';
  END IF;

  -- No customer registration/profile is created for a walk-in. The shared
  -- system counter customer preserves the existing ledger/payment relations.
  v_customer := public.get_or_create_cash_customer(p_business_id);

  v_invoice := public.create_invoice_from_items(
    p_business_id, v_customer, p_invoice_date, p_invoice_date, p_items,
    p_invoice_discount_type, p_invoice_discount_value, p_notes, p_terms
  );

  UPDATE public.invoices
  SET document_kind = 'cash_bill',
      payment_display_mode = 'none',
      payment_bank_account_id = NULL,
      updated_at = now()
  WHERE id = v_invoice;

  PERFORM public.post_invoice(v_invoice, NULL);

  v_receipt := public.record_customer_payment(
    p_business_id, v_customer, v_invoice,
    (SELECT total FROM public.invoices WHERE id = v_invoice),
    p_payment_method, p_account_id, NULL, NULL, p_invoice_date, p_notes, v_currency
  );

  -- record_customer_payment creates the authoritative receipt in the same
  -- transaction. Store the walk-in contact on that receipt before deferred
  -- notification triggers run at commit.
  UPDATE public.receipts
  SET delivery_phone = p_phone
  WHERE id = v_receipt
    AND business_id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cash Bill payment receipt was not created.';
  END IF;

  RETURN v_invoice;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_cash_bill(uuid,text,date,jsonb,public.payment_method,uuid,text,numeric,text,text)
  TO authenticated;

-- Existing receipt outbox routing remains authoritative. Extend its phone
-- destination to prefer the per-receipt walk-in number, falling back to a
-- registered customer's saved phone for all other payment receipts.
DO $migration$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.enqueue_receipt_delivery_notifications(uuid)'::regprocedure
  )
  INTO v_definition;

  IF v_definition IS NULL OR position('c.phone' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Receipt delivery function did not match the expected phone-routing contract.';
  END IF;

  v_definition := replace(v_definition, 'c.phone', 'coalesce(r.delivery_phone, c.phone)');
  EXECUTE v_definition;
END;
$migration$;

COMMIT;
