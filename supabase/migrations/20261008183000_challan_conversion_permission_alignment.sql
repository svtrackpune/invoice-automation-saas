BEGIN;
CREATE OR REPLACE FUNCTION public.convert_delivery_challan_to_invoice(
  p_business_id UUID,
  p_challan_id UUID,
  p_invoice_number TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public,mm_private,pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_challan public.delivery_challans%rowtype;
  v_business public.businesses%rowtype;
  v_settings public.business_settings%rowtype;
  v_invoice_id UUID;
  v_invoice_number TEXT;
  v_currency CHAR(3);
  v_tax_enabled BOOLEAN;
  v_due_date DATE;
  v_terms TEXT;
  v_item RECORD;
  v_tax_rate_id UUID;
  v_tax_rate NUMERIC := 0;
  v_base NUMERIC;
  v_tax_amount NUMERIC;
  v_line_total NUMERIC;
  v_item_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (mm_private.has_business_permission(p_business_id,'sales.create',v_user_id) OR mm_private.has_business_permission(p_business_id,'invoices.create',v_user_id)) THEN
    RAISE EXCEPTION 'Access denied: invoices.create permission required';
  END IF;

  SELECT * INTO v_challan
  FROM public.delivery_challans
  WHERE id=p_challan_id
    AND business_id=p_business_id
  FOR UPDATE;

  IF v_challan.id IS NULL THEN
    RAISE EXCEPTION 'Delivery challan not found';
  END IF;

  IF v_challan.status NOT IN ('dispatched','delivered') THEN
    RAISE EXCEPTION 'Delivery challan is not eligible for invoicing from status %',v_challan.status;
  END IF;

  IF v_challan.converted_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Delivery challan has already been converted to invoice';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id=v_challan.customer_id
      AND c.business_id=p_business_id
      AND c.is_active
  ) THEN
    RAISE EXCEPTION 'Delivery challan customer is invalid';
  END IF;

  SELECT b.*
  INTO v_business
  FROM public.businesses b
  WHERE b.id=p_business_id
    AND b.is_active;

  IF v_business.id IS NULL THEN
    RAISE EXCEPTION 'Business not found or inactive';
  END IF;

  SELECT *
  INTO v_settings
  FROM public.business_settings
  WHERE business_id=p_business_id
  FOR UPDATE;

  IF v_settings.business_id IS NULL THEN
    INSERT INTO public.business_settings(business_id)
    VALUES(p_business_id)
    ON CONFLICT (business_id) DO NOTHING;

    SELECT *
    INTO v_settings
    FROM public.business_settings
    WHERE business_id=p_business_id
    FOR UPDATE;
  END IF;

  v_currency := v_business.currency_code;
  v_tax_enabled := coalesce((v_business.feature_flags->>'is_tax_registered')::boolean,false);
  v_due_date := v_challan.challan_date + greatest(coalesce(v_settings.invoice_due_days,0),0);
  v_terms := coalesce(v_challan.terms,v_settings.default_payment_terms);

  IF nullif(btrim(p_invoice_number),'') IS NOT NULL THEN
    v_invoice_number := btrim(p_invoice_number);
    IF EXISTS (
      SELECT 1
      FROM public.invoices
      WHERE business_id=p_business_id
        AND invoice_number=v_invoice_number
    ) THEN
      RAISE EXCEPTION 'Invoice number % already exists for this business',v_invoice_number;
    END IF;
  ELSE
    v_invoice_number := public.next_document_number(p_business_id,'invoice');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.delivery_challan_items WHERE challan_id=p_challan_id
  ) THEN
    RAISE EXCEPTION 'Delivery challan has no line items';
  END IF;

  INSERT INTO public.invoices(
    business_id,
    customer_id,
    invoice_number,
    invoice_date,
    due_date,
    status,
    currency_code,
    subtotal,
    discount_total,
    tax_total,
    total,
    amount_paid,
    balance_due,
    notes,
    terms,
    discount_type,
    discount_value,
    discount_before_tax,
    created_by,
    source_challan_id,
    delivery_date,
    buyer_reference,
    document_kind
  )
  VALUES(
    p_business_id,
    v_challan.customer_id,
    v_invoice_number,
    v_challan.challan_date,
    v_due_date,
    'draft',
    v_currency,
    0,0,0,0,0,0,
    v_challan.notes,
    v_terms,
    NULL,
    0,
    true,
    v_user_id,
    p_challan_id,
    v_challan.challan_date,
    'Delivery Challan '||v_challan.challan_number,
    'invoice'
  )
  RETURNING id INTO v_invoice_id;

  FOR v_item IN
    SELECT
      dci.*,
      ps.default_tax_rate_id AS product_default_tax_rate_id,
      ps.hsn_sac AS product_hsn_sac
    FROM public.delivery_challan_items dci
    LEFT JOIN public.products_services ps
      ON ps.id=dci.product_service_id
     AND ps.business_id=p_business_id
     AND ps.is_active
    WHERE dci.challan_id=p_challan_id
    ORDER BY dci.sort_order,dci.created_at
  LOOP
    v_item_count := v_item_count + 1;

    IF v_item.product_service_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.products_services ps
         WHERE ps.id=v_item.product_service_id
           AND ps.business_id=p_business_id
           AND ps.is_active
           AND ps.sell_enabled
       )
    THEN
      RAISE EXCEPTION 'Delivery challan item references an invalid or inactive product';
    END IF;

    IF v_tax_enabled
       AND v_item.product_service_id IS NOT NULL
       AND nullif(trim(coalesce(v_item.hsn_sac,v_item.product_hsn_sac,'')),'') IS NULL
    THEN
      RAISE EXCEPTION 'HSN / SAC is required for tax-registered invoice item %',v_item.description;
    END IF;

    v_tax_rate_id := NULL;
    v_tax_rate := 0;

    IF v_tax_enabled THEN
      v_tax_rate_id := v_item.product_default_tax_rate_id;
      IF v_tax_rate_id IS NULL THEN
        v_tax_rate_id := v_settings.default_tax_rate_id;
      END IF;

      IF v_tax_rate_id IS NOT NULL THEN
        SELECT coalesce(rate,0)
        INTO v_tax_rate
        FROM public.tax_rates
        WHERE id=v_tax_rate_id
          AND business_id=p_business_id
          AND is_active;

        IF NOT FOUND THEN
          v_tax_rate_id := NULL;
          v_tax_rate := 0;
        END IF;
      END IF;
    END IF;

    v_base := round(coalesce(v_item.quantity,0) * coalesce(v_item.unit_price,0),2);
    v_tax_amount := round(v_base * v_tax_rate / 100,2);
    v_line_total := round(v_base + v_tax_amount,2);

    INSERT INTO public.invoice_items(
      invoice_id,
      product_service_id,
      description,
      quantity,
      unit_price,
      discount,
      discount_type,
      discount_value,
      unit_price_before_discount,
      tax_rate_id,
      tax_amount,
      line_total,
      sort_order,
      hsn_sac,
      batch_number,
      serial_number
    )
    VALUES(
      v_invoice_id,
      v_item.product_service_id,
      v_item.description,
      v_item.quantity,
      coalesce(v_item.unit_price,0),
      0,
      NULL,
      0,
      coalesce(v_item.unit_price,0),
      v_tax_rate_id,
      v_tax_amount,
      v_line_total,
      v_item.sort_order,
      nullif(trim(coalesce(v_item.hsn_sac,v_item.product_hsn_sac,'')),''),
      v_item.batch_number,
      v_item.serial_number
    );
  END LOOP;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Delivery challan has no line items';
  END IF;

  PERFORM public.recalculate_invoice_totals(v_invoice_id);

  UPDATE public.delivery_challans
  SET status='invoiced',
      converted_invoice_id=v_invoice_id,
      updated_at=now()
  WHERE id=p_challan_id
    AND business_id=p_business_id
    AND converted_invoice_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery challan conversion marker could not be updated';
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'invoice_id',v_invoice_id,
    'invoice_number',v_invoice_number,
    'challan_id',p_challan_id,
    'status','draft',
    'inventory_rededucted',false
  );
END;
$$;


REVOKE ALL ON FUNCTION public.convert_delivery_challan_to_invoice(UUID,UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.convert_delivery_challan_to_invoice(UUID,UUID,TEXT) TO authenticated;
COMMIT;
