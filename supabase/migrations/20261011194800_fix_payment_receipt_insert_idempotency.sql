BEGIN;

-- A partial-index ON CONFLICT inference predicate can fail to resolve under
-- the hosted Postgres schema state even though the invariant index exists.
-- Keep the unique index as the final guard and recover only if an existing
-- receipt for this exact payment won a concurrent insert race.
CREATE OR REPLACE FUNCTION public.fn_on_payment_settled_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $function$
DECLARE
  v_customer_id uuid;
  v_receipt_id uuid;
  v_receipt_number text;
BEGIN
  IF NEW.direction::text <> 'inbound' THEN
    RETURN NEW;
  END IF;

  SELECT r.id INTO v_receipt_id
  FROM public.receipts r
  WHERE r.payment_id = NEW.id
    AND r.business_id = NEW.business_id
  ORDER BY r.created_at
  LIMIT 1;

  IF v_receipt_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.id INTO v_customer_id
  FROM public.customers c
  WHERE c.id = NEW.customer_id
    AND c.business_id = NEW.business_id
    AND c.is_active;

  IF v_customer_id IS NULL AND NEW.invoice_id IS NOT NULL THEN
    SELECT i.customer_id INTO v_customer_id
    FROM public.invoices i
    JOIN public.customers c
      ON c.id = i.customer_id
     AND c.business_id = i.business_id
    WHERE i.id = NEW.invoice_id
      AND i.business_id = NEW.business_id;
  END IF;

  v_receipt_number := public.next_document_number(NEW.business_id, 'receipt');

  BEGIN
    INSERT INTO public.receipts(
      business_id, customer_id, payment_id, receipt_number, receipt_date,
      amount, currency_code, payment_method, reference_number, notes, created_by
    )
    VALUES(
      NEW.business_id, v_customer_id, NEW.id, v_receipt_number, NEW.payment_date,
      NEW.amount, NEW.currency_code, NEW.method::text, NEW.reference, NEW.notes, NEW.created_by
    )
    RETURNING id INTO v_receipt_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT r.id INTO v_receipt_id
    FROM public.receipts r
    WHERE r.payment_id = NEW.id
      AND r.business_id = NEW.business_id
    ORDER BY r.created_at
    LIMIT 1;
    IF v_receipt_id IS NULL THEN
      RAISE;
    END IF;
  END;

  IF v_receipt_id IS NULL THEN
    SELECT r.id INTO v_receipt_id
    FROM public.receipts r
    WHERE r.payment_id = NEW.id
      AND r.business_id = NEW.business_id
    ORDER BY r.created_at
    LIMIT 1;
  END IF;

  IF v_receipt_id IS NULL THEN
    RAISE EXCEPTION 'Receipt could not be generated for inbound payment %', NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_on_payment_settled_notify()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_on_payment_settled_notify()
  TO service_role;

COMMIT;
