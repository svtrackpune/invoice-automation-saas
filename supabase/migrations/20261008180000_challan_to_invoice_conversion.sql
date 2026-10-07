BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS source_challan_id UUID REFERENCES public.delivery_challans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_source_challan_idx
  ON public.invoices(source_challan_id)
  WHERE source_challan_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_source_challan_unique_idx
  ON public.invoices(source_challan_id)
  WHERE source_challan_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.convert_delivery_challan_to_invoice(
  p_business_id UUID,
  p_challan_id UUID,
  p_invoice_number TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public,mm_private,pg_temp
AS $
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
$;

REVOKE ALL ON FUNCTION public.convert_delivery_challan_to_invoice(UUID,UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.convert_delivery_challan_to_invoice(UUID,UUID,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.post_invoice(
  p_invoice_id uuid,
  p_location_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','mm_private','pg_temp'
AS $$
DECLARE
  inv public.invoices%rowtype;
  v_entry uuid;
  v_ar uuid;
  v_sales uuid;
  v_tax uuid;
  v_inventory uuid;
  v_cogs uuid;
  v_location uuid;
  v_cogs_total numeric:=0;
  v_cost numeric;
  v_qty numeric;
  v_physical boolean;
  v_track boolean;
  v_product record;
  v_challan_qty numeric;
  v_challan_movement_qty numeric;
  v_challan_cogs numeric;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT mm_private.has_business_permission(inv.business_id,'accounting.post',auth.uid()) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF inv.status='void' THEN RAISE EXCEPTION 'Cannot post a void invoice'; END IF;
  IF inv.journal_entry_id IS NOT NULL THEN RETURN inv.journal_entry_id; END IF;

  PERFORM public.recalculate_invoice_totals(inv.id);
  SELECT * INTO inv FROM public.invoices WHERE id=inv.id FOR UPDATE;

  IF inv.source_challan_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.delivery_challans dc
      WHERE dc.id=inv.source_challan_id
        AND dc.business_id=inv.business_id
        AND dc.status='invoiced'
        AND dc.converted_invoice_id=inv.id
    ) THEN
      RAISE EXCEPTION 'Source delivery challan is invalid for this invoice';
    END IF;

    IF EXISTS (
      (
        SELECT ii.product_service_id, round(sum(ii.quantity),6) AS quantity
        FROM public.invoice_items ii
        WHERE ii.invoice_id=inv.id
        GROUP BY ii.product_service_id
      )
      EXCEPT
      (
        SELECT dci.product_service_id, round(sum(dci.quantity),6) AS quantity
        FROM public.delivery_challan_items dci
        WHERE dci.challan_id=inv.source_challan_id
        GROUP BY dci.product_service_id
      )
    )
    OR EXISTS (
      (
        SELECT dci.product_service_id, round(sum(dci.quantity),6) AS quantity
        FROM public.delivery_challan_items dci
        WHERE dci.challan_id=inv.source_challan_id
        GROUP BY dci.product_service_id
      )
      EXCEPT
      (
        SELECT ii.product_service_id, round(sum(ii.quantity),6) AS quantity
        FROM public.invoice_items ii
        WHERE ii.invoice_id=inv.id
        GROUP BY ii.product_service_id
      )
    )
    THEN
      RAISE EXCEPTION 'Source delivery challan quantities no longer match invoice quantities';
    END IF;
  END IF;

  SELECT coalesce((b.feature_flags->>'has_physical_inventory')::boolean,false),
         coalesce((b.feature_flags->>'track_batch_serial')::boolean,false)
    INTO v_physical,v_track
  FROM public.businesses b WHERE b.id=inv.business_id;

  SELECT id INTO v_ar FROM public.accounts WHERE business_id=inv.business_id AND code='1100' AND is_active;
  SELECT id INTO v_sales FROM public.accounts WHERE business_id=inv.business_id AND code='4000' AND is_active;
  SELECT id INTO v_tax FROM public.accounts WHERE business_id=inv.business_id AND code='2100' AND is_active;
  SELECT id INTO v_inventory FROM public.accounts WHERE business_id=inv.business_id AND code='1200' AND is_active;
  SELECT id INTO v_cogs FROM public.accounts WHERE business_id=inv.business_id AND code='5000' AND is_active;

  IF v_ar IS NULL OR v_sales IS NULL THEN RAISE EXCEPTION 'Default AR or Sales account is missing'; END IF;

  IF v_physical AND EXISTS(
    SELECT 1
    FROM public.invoice_items ii
    JOIN public.products_services ps ON ps.id=ii.product_service_id
    WHERE ii.invoice_id=inv.id AND ps.inventory_tracked
  ) THEN
    IF inv.source_challan_id IS NULL THEN
      v_location:=coalesce(p_location_id,inv.inventory_location_id);
      IF v_location IS NULL THEN RAISE EXCEPTION 'Inventory location is required before posting this invoice'; END IF;
      IF NOT EXISTS(
        SELECT 1 FROM public.inventory_locations
        WHERE id=v_location AND business_id=inv.business_id AND is_active
      ) THEN
        RAISE EXCEPTION 'Inventory location is invalid';
      END IF;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||inv.business_id::text));
  INSERT INTO public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,status,
    posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
  )
  VALUES(
    inv.business_id,
    (SELECT coalesce(max(entry_number),0)+1 FROM public.journal_entries WHERE business_id=inv.business_id),
    inv.invoice_date,
    'Invoice '||inv.invoice_number,
    'invoice',
    inv.id,
    'posted',
    now(),
    auth.uid(),
    auth.uid(),
    inv.currency_code,
    inv.total,
    inv.total,
    true
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_entry;

  IF v_entry IS NULL THEN
    SELECT id INTO v_entry
    FROM public.journal_entries
    WHERE source_type='invoice' AND source_id=inv.id
    LIMIT 1;
    RETURN v_entry;
  END IF;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  )
  VALUES(
    v_entry,v_ar,'Invoice receivable',inv.total,0,inv.currency_code,'customer',inv.customer_id
  ),
  (
    v_entry,v_sales,'Sales revenue',0,inv.subtotal-inv.discount_total,inv.currency_code,null,null
  );

  IF inv.tax_total>0 THEN
    IF v_tax IS NULL THEN RAISE EXCEPTION 'Output tax account is missing'; END IF;
    INSERT INTO public.journal_lines(
      journal_entry_id,account_id,description,debit,credit,currency_code
    )
    VALUES(v_entry,v_tax,'Output tax',0,inv.tax_total,inv.currency_code);
  END IF;

  IF v_physical THEN
    IF inv.source_challan_id IS NOT NULL THEN
      FOR v_product IN
        SELECT ii.product_service_id, sum(ii.quantity) AS quantity
        FROM public.invoice_items ii
        JOIN public.products_services ps ON ps.id=ii.product_service_id
        WHERE ii.invoice_id=inv.id
          AND ii.product_service_id IS NOT NULL
          AND ps.inventory_tracked
        GROUP BY ii.product_service_id
      LOOP
        SELECT
          coalesce(sum(im.quantity),0),
          coalesce(sum(im.quantity*im.unit_cost),0)
        INTO v_challan_movement_qty,v_challan_cogs
        FROM public.inventory_movements im
        WHERE im.business_id=inv.business_id
          AND im.reference_type='delivery_challan'
          AND im.reference_id=inv.source_challan_id
          AND im.movement_type='delivery_challan_out'
          AND im.product_service_id=v_product.product_service_id;

        v_challan_qty:=v_product.quantity;

        IF v_challan_movement_qty < v_challan_qty THEN
          RAISE EXCEPTION 'Delivery challan inventory movement is missing or incomplete for product %',v_product.product_service_id;
        END IF;

        v_cogs_total:=v_cogs_total+round(v_challan_cogs,2);
      END LOOP;
    ELSIF v_physical AND v_location IS NOT NULL THEN
      FOR v_product IN
        SELECT ii.product_service_id,ii.quantity,ii.batch_number,ii.serial_number,
               ps.track_batches,ps.track_serials,ps.inventory_tracked
        FROM public.invoice_items ii
        JOIN public.products_services ps ON ps.id=ii.product_service_id
        WHERE ii.invoice_id=inv.id
          AND ii.product_service_id IS NOT NULL
          AND ps.inventory_tracked
      LOOP
        IF v_track AND v_product.track_batches
           AND nullif(trim(coalesce(v_product.batch_number,'')),'') IS NULL
        THEN
          RAISE EXCEPTION 'Batch number is required before posting inventory-tracked item';
        END IF;
        IF v_track AND v_product.track_serials THEN
          IF nullif(trim(coalesce(v_product.serial_number,'')),'') IS NULL
          THEN
            RAISE EXCEPTION 'Serial number is required before posting serial-tracked item';
          END IF;
          IF v_product.quantity<>1
          THEN
            RAISE EXCEPTION 'Serial-tracked products must be invoiced one unit per line';
          END IF;
        END IF;

        SELECT average_cost,quantity_on_hand
        INTO v_cost,v_qty
        FROM public.inventory_balances
        WHERE business_id=inv.business_id
          AND location_id=v_location
          AND product_service_id=v_product.product_service_id
        FOR UPDATE;

        IF v_cost IS NULL OR v_qty < v_product.quantity
        THEN
          RAISE EXCEPTION 'Insufficient inventory for product %',v_product.product_service_id;
        END IF;

        v_cogs_total:=v_cogs_total+round(v_product.quantity*v_cost,2);

        UPDATE public.inventory_balances
        SET quantity_on_hand=quantity_on_hand-v_product.quantity,updated_at=now()
        WHERE business_id=inv.business_id
          AND location_id=v_location
          AND product_service_id=v_product.product_service_id;

        INSERT INTO public.inventory_movements(
          business_id,location_id,product_service_id,movement_type,quantity,unit_cost,
          reference_type,reference_id,batch_number,serial_number,created_by
        )
        VALUES(
          inv.business_id,v_location,v_product.product_service_id,'sale',v_product.quantity,v_cost,
          'invoice',inv.id,v_product.batch_number,v_product.serial_number,auth.uid()
        );
      END LOOP;
    END IF;
  END IF;

  IF v_cogs_total>0 THEN
    IF v_cogs IS NULL OR v_inventory IS NULL THEN RAISE EXCEPTION 'Inventory accounting accounts are missing'; END IF;
    INSERT INTO public.journal_lines(
      journal_entry_id,account_id,description,debit,credit,currency_code
    )
    VALUES(
      v_entry,v_cogs,'Cost of goods sold',v_cogs_total,0,inv.currency_code
    ),
    (
      v_entry,v_inventory,'Inventory asset reduction',0,v_cogs_total,inv.currency_code
    );
    UPDATE public.journal_entries
    SET total_debit=total_debit+v_cogs_total,total_credit=total_credit+v_cogs_total
    WHERE id=v_entry;
  END IF;

  PERFORM public.validate_journal_entry_balance(v_entry);

  UPDATE public.invoices
  SET journal_entry_id=v_entry,
      status=CASE
        WHEN balance_due<=0 THEN 'paid'::invoice_status
        WHEN due_date<current_date THEN 'overdue'::invoice_status
        WHEN amount_paid>0 THEN 'partially_paid'::invoice_status
        ELSE 'sent'::invoice_status
      END,
      updated_at=now()
  WHERE id=inv.id;

  RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public.post_invoice(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_invoice(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_day_book(
  p_business_id UUID,
  p_date DATE
)
RETURNS TABLE(
  entry_time TIMESTAMPTZ,
  module TEXT,
  document_number TEXT,
  party_name TEXT,
  reference TEXT,
  debit NUMERIC,
  credit NUMERIC,
  payment_mode TEXT,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private,pg_temp
AS $$
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'reports.view',auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: reports.view permission required';
  END IF;

  RETURN QUERY
  SELECT
    i.created_at,
    CASE WHEN i.document_kind='cash_bill' THEN 'CASH BILL (POS)' ELSE 'TAX INVOICE' END,
    i.invoice_number,
    COALESCE(c.display_name,'Cash Customer'),
    COALESCE(i.buyer_reference,''),
    i.total::NUMERIC,
    0::NUMERIC,
    'CREDIT'::TEXT,
    i.status::TEXT
  FROM public.invoices i
  LEFT JOIN public.customers c ON c.id=i.customer_id
  WHERE i.business_id=p_business_id
    AND i.invoice_date=p_date
    AND i.status<>'void'

  UNION ALL

  SELECT
    p.created_at,
    'PAYMENT RECEIVED',
    COALESCE(p.reference,p.id::TEXT),
    COALESCE(c.display_name,v.display_name,'Direct Counter'),
    COALESCE(p.gateway_transaction_id,''),
    0::NUMERIC,
    p.amount::NUMERIC,
    p.method::TEXT,
    'COMPLETED'::TEXT
  FROM public.payments p
  LEFT JOIN public.customers c ON c.id=p.customer_id
  LEFT JOIN public.vendors v ON v.id=p.vendor_id
  WHERE p.business_id=p_business_id
    AND p.payment_date=p_date

  UNION ALL

  SELECT
    e.created_at,
    'EXPENSE',
    COALESCE(e.reference,'EXP'),
    COALESCE(v.display_name,e.description),
    e.description,
    e.amount::NUMERIC,
    0::NUMERIC,
    COALESCE(e.payment_method::TEXT,'CASH'),
    'POSTED'::TEXT
  FROM public.expenses e
  LEFT JOIN public.vendors v ON v.id=e.vendor_id
  WHERE e.business_id=p_business_id
    AND e.expense_date=p_date

  UNION ALL

  SELECT
    b.created_at,
    'PURCHASE BILL',
    b.bill_number,
    COALESCE(v.display_name,'Supplier'),
    'Purchase bill',
    0::NUMERIC,
    b.total::NUMERIC,
    'CREDIT'::TEXT,
    b.status::TEXT
  FROM public.bills b
  LEFT JOIN public.vendors v ON v.id=b.vendor_id
  WHERE b.business_id=p_business_id
    AND b.bill_date=p_date
    AND b.status::TEXT<>'void'

  ORDER BY 1 ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_day_book(UUID,DATE) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_day_book(UUID,DATE) TO authenticated;

COMMIT;
