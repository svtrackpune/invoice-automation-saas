-- Enforce transaction-type correction boundaries at the RPC privilege layer.
CREATE OR REPLACE FUNCTION public.update_regular_invoice_any_state(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_items jsonb,
  p_invoice_discount_type text DEFAULT NULL,
  p_invoice_discount_value numeric DEFAULT 0,
  p_notes text DEFAULT NULL,
  p_terms text DEFAULT NULL,
  p_template_id uuid DEFAULT NULL,
  p_delivery_date date DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_payment_display_mode text DEFAULT 'none',
  p_payment_bank_account_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $$
DECLARE
  v_business_id uuid;
  v_document_kind text;
BEGIN
  SELECT business_id, document_kind
  INTO v_business_id, v_document_kind
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_document_kind = 'cash_bill' THEN
    RAISE EXCEPTION 'Cash Bills must be corrected through the Cash Bill settlement workflow.';
  END IF;

  IF NOT (
    mm_private.has_business_permission(v_business_id, 'sales.edit')
    OR mm_private.has_business_permission(v_business_id, 'sales.create')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN public.update_invoice_any_state(
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
    p_payment_display_mode,
    p_payment_bank_account_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_regular_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_regular_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid) TO authenticated;
