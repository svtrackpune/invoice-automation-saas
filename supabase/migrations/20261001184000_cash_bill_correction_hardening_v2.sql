BEGIN;

CREATE OR REPLACE FUNCTION public.update_cash_bill_any_state(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_items jsonb,
  p_invoice_discount_type text,
  p_invoice_discount_value numeric,
  p_notes text,
  p_terms text,
  p_template_id uuid,
  p_delivery_date date,
  p_location_id uuid,
  p_payment_method public.payment_method,
  p_payment_account_id uuid,
  p_payment_amount numeric,
  p_payment_reference text DEFAULT NULL,
  p_payment_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
DECLARE
  inv public.invoices%rowtype;
  payment_row public.payments%rowtype;
  payment_count integer;
  final_invoice public.invoices%rowtype;
  account_subtype text;
BEGIN
  SELECT *
  INTO inv
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'Cash Bill not found';
  END IF;

  IF inv.document_kind <> 'cash_bill' THEN
    RAISE EXCEPTION 'This document is not a Cash Bill.';
  END IF;

  IF inv.status = 'void' THEN
    RAISE EXCEPTION 'Void Cash Bills cannot be edited.';
  END IF;

  IF NOT (
    mm_private.has_business_permission(inv.business_id, 'sales.edit')
    OR mm_private.has_business_permission(inv.business_id, 'sales.create')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_customer_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = p_customer_id
      AND c.business_id = inv.business_id
      AND c.is_active
  ) THEN
    RAISE EXCEPTION 'Customer not found or inactive';
  END IF;

  IF p_payment_amount <= 0 THEN
    RAISE EXCEPTION 'Cash Bill payment amount must be greater than zero.';
  END IF;

  IF p_payment_method NOT IN ('cash','upi') THEN
    RAISE EXCEPTION 'Cash Bill settlement must be Cash or UPI.';
  END IF;

  SELECT count(*)
  INTO payment_count
  FROM public.payments p
  WHERE p.business_id = inv.business_id
    AND p.invoice_id = inv.id
    AND p.direction = 'inbound';

  IF payment_count <> 1 THEN
    RAISE EXCEPTION 'Cash Bill must have exactly one inbound settlement payment.';
  END IF;

  SELECT *
  INTO payment_row
  FROM public.payments p
  WHERE p.business_id = inv.business_id
    AND p.invoice_id = inv.id
    AND p.direction = 'inbound'
  ORDER BY p.created_at, p.id
  LIMIT 1
  FOR UPDATE;

  IF payment_row.id IS NULL THEN
    RAISE EXCEPTION 'Cash Bill settlement payment could not be locked.';
  END IF;

  IF payment_row.currency_code IS DISTINCT FROM inv.currency_code THEN
    RAISE EXCEPTION 'Cash Bill payment currency does not match the document currency.';
  END IF;

  SELECT a.account_subtype
  INTO account_subtype
  FROM public.accounts a
  WHERE a.id = p_payment_account_id
    AND a.business_id = inv.business_id
    AND a.is_active;

  IF account_subtype IS NULL THEN
    RAISE EXCEPTION 'Cash Bill settlement account is invalid.';
  END IF;

  IF p_payment_method = 'cash' AND account_subtype <> 'cash' THEN
    RAISE EXCEPTION 'Cash settlement requires an active Cash account.';
  END IF;

  IF p_payment_method = 'upi' AND account_subtype <> 'bank' THEN
    RAISE EXCEPTION 'UPI settlement requires an active Bank account.';
  END IF;

  PERFORM public.assert_accounting_period_open(inv.business_id, p_invoice_date);
  PERFORM public.assert_accounting_period_open(inv.business_id, p_payment_date);

  PERFORM public.update_invoice_any_state(
    p_invoice_id,
    p_customer_id,
    p_invoice_date,
    p_due_date,
    p_items,
    p_invoice_discount_type,
    p_invoice_discount_value,
    p_notes,
    p_terms,
    p_template_id,
    p_delivery_date,
    p_location_id,
    'none',
    NULL
  );

  SELECT *
  INTO final_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF final_invoice.document_kind <> 'cash_bill' THEN
    RAISE EXCEPTION 'Cash Bill document type was not preserved during correction.';
  END IF;

  IF final_invoice.total <> round(p_payment_amount,2) THEN
    RAISE EXCEPTION 'Cash Bill payment amount must equal the corrected document total.';
  END IF;

  PERFORM public.update_customer_payment(
    payment_row.id,
    round(p_payment_amount,2),
    p_payment_method,
    p_payment_account_id,
    p_payment_reference,
    p_payment_date,
    p_notes
  );

  SELECT *
  INTO final_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF final_invoice.document_kind <> 'cash_bill'
     OR final_invoice.total <> round(p_payment_amount,2)
     OR final_invoice.balance_due <> 0
     OR final_invoice.status = 'void' THEN
    RAISE EXCEPTION 'Cash Bill correction must leave the document fully settled at the corrected total.';
  END IF;

  IF final_invoice.amount_paid <> final_invoice.total THEN
    RAISE EXCEPTION 'Cash Bill amount paid must equal the corrected total.';
  END IF;

  RETURN final_invoice.id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.update_cash_bill_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,public.payment_method,uuid,numeric,text,date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_cash_bill_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,public.payment_method,uuid,numeric,text,date) TO authenticated;

COMMIT;