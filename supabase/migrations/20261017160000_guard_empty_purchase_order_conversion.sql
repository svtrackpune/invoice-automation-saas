BEGIN;

-- Existing malformed orders should report a repairable message, and cannot
-- create/attempt a vendor bill until at least one source line exists.
CREATE OR REPLACE FUNCTION public.convert_purchase_order_to_bill(p_business_id uuid, p_po_id uuid, p_vendor_invoice_number text, p_bill_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT mm_private.has_business_permission(p_business_id, 'purchases.manage', v_user)
     OR NOT mm_private.has_business_permission(p_business_id, 'accounting.post', v_user) THEN
    RAISE EXCEPTION 'Access denied: purchases.manage and accounting.post permissions are required';
  END IF;

  IF v_invoice_number IS NULL OR v_invoice_number = '' THEN
    RAISE EXCEPTION 'Vendor invoice number is required';
  END IF;
  IF p_bill_date IS NULL THEN
    RAISE EXCEPTION 'Bill date is required';
  END IF;

  SELECT *
  INTO v_po
  FROM public.bills
  WHERE id = p_po_id
    AND business_id = p_business_id
    AND is_purchase_order = TRUE
  FOR UPDATE;

  IF v_po.id IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id;
  END IF;
  IF v_po.converted_bill_id IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase order % has already been converted to Bill %',
      v_po.bill_number, v_po.converted_bill_id;
  END IF;
  IF v_po.po_status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot convert a cancelled purchase order';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.bill_items bi WHERE bi.bill_id = v_po.id
  ) THEN
    RAISE EXCEPTION 'Purchase order has no line items. Edit the order and add at least one product or service before receiving goods.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bills b
    WHERE b.business_id = p_business_id
      AND b.is_purchase_order = FALSE
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
  )
  RETURNING id INTO v_new_bill_id;

  FOR v_item IN
    SELECT *
    FROM public.bill_items
    WHERE bill_id = v_po.id
    ORDER BY sort_order ASC
  LOOP
    IF v_item.unit_price < 0 THEN
      RAISE EXCEPTION 'Negative unit price (%) is invalid for line item %',
        v_item.unit_price, v_item.description;
    END IF;

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
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Purchase order total must be greater than zero';
  END IF;

  UPDATE public.bills
  SET subtotal = round(v_subtotal, 2),
      discount_total = round(v_discount_total, 2),
      tax_total = round(v_tax_total, 2),
      total = round(v_total, 2),
      balance_due = round(v_total, 2),
      updated_at = now()
  WHERE id = v_new_bill_id;

  PERFORM public.post_bill(v_new_bill_id);

  UPDATE public.bills
  SET po_status = 'fulfilled',
      converted_bill_id = v_new_bill_id,
      updated_at = now()
  WHERE id = v_po.id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'po_id', v_po.id,
    'bill_id', v_new_bill_id,
    'bill_number', v_invoice_number,
    'total', round(v_total, 2)
  );
END;
$function$
;

COMMIT;
