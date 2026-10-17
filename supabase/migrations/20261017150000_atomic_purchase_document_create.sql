BEGIN;

-- Atomic purchase document creation prevents issued PO headers from surviving a failed line insert.
CREATE OR REPLACE FUNCTION public.create_purchase_document(
  p_business_id uuid,
  p_vendor_id uuid,
  p_bill_number text,
  p_bill_date date,
  p_due_date date,
  p_currency_code text,
  p_notes text,
  p_supply_type text,
  p_reverse_charge boolean,
  p_tax_inclusive boolean,
  p_is_purchase_order boolean,
  p_po_status text,
  p_subtotal numeric,
  p_discount_total numeric,
  p_tax_total numeric,
  p_total numeric,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'mm_private', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_product_id uuid;
  v_tax_rate_id uuid;
  v_expense_account_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount_amount numeric;
  v_discount_value numeric;
  v_tax_amount numeric;
  v_line_total numeric;
  v_line_count integer;
  v_subtotal numeric;
  v_discount_total numeric;
  v_tax_total numeric;
  v_total numeric;
  v_bill_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT mm_private.has_business_permission(p_business_id, 'purchases.manage', v_user_id) THEN
    RAISE EXCEPTION 'Access denied: purchases.manage permission is required';
  END IF;
  IF p_vendor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = p_vendor_id AND v.business_id = p_business_id AND v.is_active
  ) THEN
    RAISE EXCEPTION 'Select an active supplier/vendor from this business';
  END IF;
  IF nullif(btrim(p_bill_number), '') IS NULL OR p_bill_date IS NULL OR p_due_date IS NULL THEN
    RAISE EXCEPTION 'Document number, bill date and due date are required';
  END IF;
  IF coalesce(p_currency_code, '') = '' THEN
    RAISE EXCEPTION 'A document currency is required';
  END IF;
  IF coalesce(p_supply_type, '') NOT IN ('intra_state','inter_state','export','other') THEN
    RAISE EXCEPTION 'Invalid supply type';
  END IF;
  IF p_is_purchase_order THEN
    IF p_po_status NOT IN ('draft','issued') THEN
      RAISE EXCEPTION 'A purchase order can only be saved as draft or issued';
    END IF;
  ELSIF p_po_status IS NOT NULL THEN
    RAISE EXCEPTION 'Vendor bills cannot have a purchase-order status';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Purchase document items must be a JSON array';
  END IF;
  IF jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'Add between 1 and 500 purchase document lines';
  END IF;
  IF p_subtotal IS NULL OR p_discount_total IS NULL OR p_tax_total IS NULL OR p_total IS NULL
     OR p_subtotal < 0 OR p_discount_total < 0 OR p_tax_total < 0 OR p_total <= 0 THEN
    RAISE EXCEPTION 'Purchase document totals must be valid and total must be greater than zero';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bills bl
    WHERE bl.business_id = p_business_id
      AND lower(bl.bill_number) = lower(btrim(p_bill_number))
  ) THEN
    RAISE EXCEPTION 'Purchase document number % already exists for this business', btrim(p_bill_number);
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS rows(value)
  LOOP
    IF nullif(btrim(v_item->>'description'), '') IS NULL THEN
      RAISE EXCEPTION 'Every purchase line needs a description';
    END IF;
    v_quantity := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
    v_unit_price := coalesce(nullif(v_item->>'unit_price','')::numeric, 0);
    v_discount_amount := coalesce(nullif(v_item->>'discount','')::numeric, 0);
    v_discount_value := coalesce(nullif(v_item->>'discount_value','')::numeric, 0);
    v_tax_amount := coalesce(nullif(v_item->>'tax_amount','')::numeric, 0);
    v_line_total := coalesce(nullif(v_item->>'line_total','')::numeric, 0);
    IF v_quantity <= 0 OR v_unit_price < 0 OR v_discount_amount < 0
       OR v_discount_value < 0 OR v_tax_amount < 0 OR v_line_total < v_tax_amount THEN
      RAISE EXCEPTION 'Purchase lines require positive quantities and non-negative price, discount and tax values';
    END IF;
    IF coalesce(v_item->>'discount_type','') NOT IN ('fixed','percentage') THEN
      RAISE EXCEPTION 'Invalid purchase line discount type';
    END IF;
    IF v_item->>'discount_type' = 'percentage' AND v_discount_value > 100 THEN
      RAISE EXCEPTION 'Percentage discount cannot exceed 100 percent';
    END IF;
    IF v_item->>'discount_type' = 'fixed' AND v_discount_value > v_quantity * v_unit_price THEN
      RAISE EXCEPTION 'Fixed discount cannot exceed the line amount';
    END IF;
    IF v_discount_amount > v_quantity * v_unit_price THEN
      RAISE EXCEPTION 'Computed discount cannot exceed the line amount';
    END IF;

    BEGIN
      v_product_id := nullif(btrim(v_item->>'product_service_id'), '')::uuid;
      v_tax_rate_id := nullif(btrim(v_item->>'tax_rate_id'), '')::uuid;
      v_expense_account_id := nullif(btrim(v_item->>'expense_account_id'), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Purchase line contains an invalid catalog, tax or account ID';
    END;
    IF v_product_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.products_services ps
      WHERE ps.id = v_product_id
        AND ps.business_id = p_business_id
        AND ps.is_active
        AND ps.purchase_enabled
    ) THEN
      RAISE EXCEPTION 'Purchase product/service is inactive, not purchasable, or belongs to another business';
    END IF;
    IF v_tax_rate_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.tax_rates tr
      WHERE tr.id = v_tax_rate_id AND tr.business_id = p_business_id AND tr.is_active
    ) THEN
      RAISE EXCEPTION 'Purchase tax rate is inactive or belongs to another business';
    END IF;
    IF v_expense_account_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.accounts ac
      WHERE ac.id = v_expense_account_id AND ac.business_id = p_business_id AND ac.is_active
    ) THEN
      RAISE EXCEPTION 'Purchase expense account is inactive or belongs to another business';
    END IF;
  END LOOP;

  SELECT count(*),
         round(coalesce(sum((value->>'line_total')::numeric - (value->>'tax_amount')::numeric),0),2),
         round(coalesce(sum((value->>'discount')::numeric),0),2),
         round(coalesce(sum((value->>'tax_amount')::numeric),0),2),
         round(coalesce(sum((value->>'line_total')::numeric),0),2)
  INTO v_line_count, v_subtotal, v_discount_total, v_tax_total, v_total
  FROM jsonb_array_elements(p_items) AS rows(value);

  IF v_line_count <> jsonb_array_length(p_items)
     OR v_subtotal <> round(p_subtotal,2)
     OR v_discount_total <> round(p_discount_total,2)
     OR v_tax_total <> round(p_tax_total,2)
     OR v_total <> round(p_total,2) THEN
    RAISE EXCEPTION 'Purchase document totals no longer match the validated line items. Refresh and try again.';
  END IF;

  INSERT INTO public.bills (
    business_id, vendor_id, bill_number, bill_date, due_date, status, currency_code,
    subtotal, discount_total, tax_total, total, amount_paid, balance_due, notes, terms,
    place_of_supply_state_code, supply_type, reverse_charge, tax_inclusive,
    is_purchase_order, po_status, created_by
  ) VALUES (
    p_business_id, p_vendor_id, btrim(p_bill_number), p_bill_date, p_due_date, 'draft', upper(btrim(p_currency_code)),
    v_subtotal, v_discount_total, v_tax_total, v_total, 0, v_total, p_notes, NULL,
    NULL, p_supply_type, coalesce(p_reverse_charge,false), coalesce(p_tax_inclusive,false),
    coalesce(p_is_purchase_order,false), CASE WHEN p_is_purchase_order THEN p_po_status ELSE NULL END, v_user_id
  )
  RETURNING id INTO v_bill_id;

  INSERT INTO public.bill_items (
    bill_id, product_service_id, description, quantity, unit_price, discount, discount_type,
    discount_value, tax_rate_id, tax_amount, line_total, expense_account_id, sort_order
  )
  SELECT
    v_bill_id,
    nullif(btrim(value->>'product_service_id'), '')::uuid,
    btrim(value->>'description'),
    (value->>'quantity')::numeric,
    (value->>'unit_price')::numeric,
    (value->>'discount')::numeric,
    value->>'discount_type',
    (value->>'discount_value')::numeric,
    nullif(btrim(value->>'tax_rate_id'), '')::uuid,
    (value->>'tax_amount')::numeric,
    (value->>'line_total')::numeric,
    nullif(btrim(value->>'expense_account_id'), '')::uuid,
    coalesce(nullif(value->>'sort_order','')::integer, 0)
  FROM jsonb_array_elements(p_items) AS rows(value)
  ORDER BY coalesce(nullif(value->>'sort_order','')::integer,0);

  RETURN v_bill_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_purchase_document(uuid,uuid,text,date,date,text,text,text,boolean,boolean,boolean,text,numeric,numeric,numeric,numeric,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_document(uuid,uuid,text,date,date,text,text,text,boolean,boolean,boolean,text,numeric,numeric,numeric,numeric,jsonb) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
