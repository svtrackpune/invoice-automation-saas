BEGIN;

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS is_purchase_order BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS po_status TEXT DEFAULT NULL
    CHECK (po_status IN ('draft','issued','partially_received','fulfilled','cancelled')),
  ADD COLUMN IF NOT EXISTS converted_bill_id UUID REFERENCES public.bills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_po_id UUID REFERENCES public.bills(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bills_business_purchase_order
  ON public.bills (business_id, is_purchase_order, bill_date DESC);

CREATE INDEX IF NOT EXISTS idx_bills_source_po
  ON public.bills (source_po_id)
  WHERE source_po_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bills_converted_po
  ON public.bills (converted_bill_id)
  WHERE converted_bill_id IS NOT NULL;

ALTER FUNCTION public.post_bill(uuid) RENAME TO post_bill_legacy;
REVOKE ALL ON FUNCTION public.post_bill_legacy(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.post_bill(p_bill_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id UUID;
  v_is_po BOOLEAN;
BEGIN
  SELECT b.business_id, b.is_purchase_order INTO v_business_id, v_is_po
  FROM public.bills b WHERE b.id = p_bill_id FOR UPDATE;

  IF v_business_id IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF v_is_po THEN
    RAISE EXCEPTION 'Purchase orders cannot be posted as vendor bills. Receive goods and convert the PO first.';
  END IF;
  IF NOT mm_private.has_business_permission(v_business_id, 'accounting.post') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  RETURN public.post_bill_legacy(p_bill_id);
END;
$$;

REVOKE ALL ON FUNCTION public.post_bill(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_bill(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.convert_purchase_order_to_bill(
  p_business_id UUID,
  p_po_id UUID,
  p_vendor_invoice_number TEXT,
  p_bill_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $$
DECLARE
  v_po public.bills%ROWTYPE;
  v_item public.bill_items%ROWTYPE;
  v_new_bill_id UUID;
  v_subtotal NUMERIC := 0;
  v_discount_total NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_invoice_number TEXT := btrim(p_vendor_invoice_number);
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT mm_private.has_business_permission(p_business_id, 'bills.create', v_user)
     OR NOT mm_private.has_business_permission(p_business_id, 'accounting.post', v_user) THEN
    RAISE EXCEPTION 'Access denied: bills.create and accounting.post permissions are required';
  END IF;
  IF v_invoice_number IS NULL OR v_invoice_number = '' THEN
    RAISE EXCEPTION 'Vendor invoice number is required';
  END IF;
  IF p_bill_date IS NULL THEN RAISE EXCEPTION 'Bill date is required'; END IF;

  SELECT * INTO v_po
  FROM public.bills
  WHERE id = p_po_id AND business_id = p_business_id AND is_purchase_order = TRUE
  FOR UPDATE;

  IF v_po.id IS NULL THEN RAISE EXCEPTION 'Purchase order % not found', p_po_id; END IF;
  IF v_po.converted_bill_id IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase order % has already been converted to Bill %', v_po.bill_number, v_po.converted_bill_id;
  END IF;
  IF v_po.po_status = 'cancelled' THEN RAISE EXCEPTION 'Cannot convert a cancelled purchase order'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.bills b
    WHERE b.business_id = p_business_id AND b.is_purchase_order = FALSE
      AND lower(b.bill_number) = lower(v_invoice_number)
  ) THEN
    RAISE EXCEPTION 'Vendor bill number % already exists for this business', v_invoice_number;
  END IF;

  INSERT INTO public.bills (
    business_id, vendor_id, bill_number, bill_date, due_date, status, currency_code,
    subtotal, discount_total, tax_total, total, amount_paid, balance_due, notes, terms,
    place_of_supply_state_code, supply_type, reverse_charge, tax_inclusive,
    is_purchase_order, source_po_id, created_by
  ) VALUES (
    p_business_id, v_po.vendor_id, v_invoice_number, p_bill_date,
    (p_bill_date + INTERVAL '30 days')::date, 'draft', v_po.currency_code,
    0, 0, 0, 0, 0, 0, v_po.notes, v_po.terms, v_po.place_of_supply_state_code,
    v_po.supply_type, v_po.reverse_charge, v_po.tax_inclusive, FALSE, v_po.id, v_user
  ) RETURNING id INTO v_new_bill_id;

  FOR v_item IN SELECT * FROM public.bill_items WHERE bill_id = v_po.id ORDER BY sort_order ASC LOOP
    INSERT INTO public.bill_items (
      bill_id, product_service_id, description, quantity, unit_price, discount,
      discount_type, discount_value, tax_rate_id, tax_amount, line_total,
      expense_account_id, sort_order
    ) VALUES (
      v_new_bill_id, v_item.product_service_id, v_item.description, v_item.quantity,
      v_item.unit_price, v_item.discount, v_item.discount_type, v_item.discount_value,
      v_item.tax_rate_id, v_item.tax_amount, v_item.line_total,
      v_item.expense_account_id, v_item.sort_order
    );
    v_subtotal := v_subtotal + (v_item.line_total - COALESCE(v_item.tax_amount, 0));
    v_discount_total := v_discount_total + COALESCE(v_item.discount, 0);
    v_tax_total := v_tax_total + COALESCE(v_item.tax_amount, 0);
  END LOOP;

  v_total := v_subtotal + v_tax_total;
  IF v_total <= 0 THEN RAISE EXCEPTION 'Purchase order total must be greater than zero'; END IF;

  UPDATE public.bills
  SET subtotal = round(v_subtotal, 2), discount_total = round(v_discount_total, 2),
      tax_total = round(v_tax_total, 2), total = round(v_total, 2),
      balance_due = round(v_total, 2), updated_at = now()
  WHERE id = v_new_bill_id;

  PERFORM public.post_bill(v_new_bill_id);

  UPDATE public.bills
  SET po_status = 'fulfilled', converted_bill_id = v_new_bill_id, updated_at = now()
  WHERE id = v_po.id;

  RETURN jsonb_build_object(
    'success', true, 'po_id', v_po.id, 'bill_id', v_new_bill_id,
    'bill_number', v_invoice_number, 'total', round(v_total, 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.convert_purchase_order_to_bill(uuid, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_purchase_order_to_bill(uuid, uuid, text, date) TO authenticated;

COMMIT;
