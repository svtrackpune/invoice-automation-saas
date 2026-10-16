-- Keep the edit RPC's calculation alias separate from the persisted bill_items discount enum.
-- The database stores 'fixed'/'percentage'; the RPC normalizes 'fixed' to 'amount' for calculation,
-- then must normalize back before INSERT to satisfy bill_items_discount_type_check.
BEGIN;

CREATE OR REPLACE FUNCTION public.update_bill_any_state(p_bill_id uuid, p_vendor_id uuid, p_bill_date date, p_due_date date, p_items jsonb, p_supply_type text, p_reverse_charge boolean, p_tax_inclusive boolean, p_notes text DEFAULT NULL::text, p_terms text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  b public.bills%rowtype;
  v_paid numeric := 0;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_item jsonb;
  v_product uuid;
  v_qty numeric;
  v_price numeric;
  v_disc_type text;
  v_disc_value numeric;
  v_gross numeric;
  v_disc numeric;
  v_net numeric;
  v_base numeric;
  v_tax_rate numeric;
  v_tax_amount numeric;
  v_line_total numeric;
  v_desc text;
  v_tax_registered boolean := false;
  v_tax_creditable boolean := false;
  v_ap uuid;
  v_inventory uuid;
  v_expense uuid;
  v_input_tax uuid;
  v_location uuid;
  v_entry uuid;
  v_entry_number bigint;
  v_line record;
  v_old_qty numeric;
  v_old_cost numeric;
  v_unit_cost numeric;
  v_journal_was_posted boolean := false;
  v_status public.bill_status;
BEGIN
  SELECT * INTO b
  FROM public.bills
  WHERE id = p_bill_id
  FOR UPDATE;

  IF b.id IS NULL THEN
    RAISE EXCEPTION 'Purchase bill not found';
  END IF;

  IF b.status = 'void' THEN
    RAISE EXCEPTION 'Void purchase bills cannot be edited';
  END IF;

  IF NOT (
    mm_private.has_business_permission(b.business_id, 'purchases.manage')
    OR mm_private.has_business_permission(b.business_id, 'accounting.adjust')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Purchase bill must contain at least one item';
  END IF;

  IF p_vendor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.vendors
    WHERE id = p_vendor_id AND business_id = b.business_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Vendor not found or inactive';
  END IF;

  SELECT coalesce(sum(vpa.amount), 0)
  INTO v_paid
  FROM public.vendor_payment_allocations vpa
  WHERE vpa.bill_id = b.id;

  IF p_vendor_id <> b.vendor_id AND v_paid > 0 THEN
    RAISE EXCEPTION 'A paid purchase bill cannot change supplier. Correct supplier identity through a controlled reallocation/refund workflow.';
  END IF;

  IF b.journal_entry_id IS NULL AND v_paid > 0 THEN
    RAISE EXCEPTION 'Purchase bill has payments but no posted accounting entry. Repair the accounting state before editing.';
  END IF;

  IF b.journal_entry_id IS NOT NULL THEN
    IF NOT mm_private.has_business_permission(b.business_id, 'accounting.adjust') THEN
      RAISE EXCEPTION 'Accounting adjustment permission required to edit a posted purchase bill';
    END IF;
    PERFORM public.assert_accounting_period_open(b.business_id, b.bill_date);
    PERFORM public.assert_accounting_period_open(b.business_id, coalesce(p_bill_date, b.bill_date));
    v_journal_was_posted := true;
  END IF;

  SELECT
    coalesce((bp.tax_regime = 'GST'), false),
    coalesce((bp.tax_regime = 'GST' AND bp.gst_registration_type <> 'COMPOSITION'), false)
  INTO v_tax_registered, v_tax_creditable
  FROM public.business_tax_profiles bp
  WHERE bp.business_id = b.business_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product := nullif(v_item->>'product_service_id', '')::uuid;
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_desc := nullif(trim(v_item->>'description'), '');
    v_disc_type := nullif(v_item->>'discount_type', '');
    IF v_disc_type = 'fixed' THEN v_disc_type := 'amount'; END IF;
    v_disc_value := coalesce((v_item->>'discount_value')::numeric, (v_item->>'discount')::numeric, 0);

    IF v_desc IS NULL AND v_product IS NOT NULL THEN
      SELECT name INTO v_desc
      FROM public.products_services
      WHERE id = v_product AND business_id = b.business_id;
    END IF;

    IF v_qty <= 0 OR v_price < 0 OR v_desc IS NULL THEN
      RAISE EXCEPTION 'Invalid purchase bill item';
    END IF;

    IF v_product IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.products_services
      WHERE id = v_product AND business_id = b.business_id AND is_active AND purchase_enabled
    ) THEN
      RAISE EXCEPTION 'Product/service not found or purchase-disabled';
    END IF;

    IF v_disc_type IS NOT NULL AND v_disc_type NOT IN ('amount', 'percentage') THEN
      RAISE EXCEPTION 'Invalid line discount type';
    END IF;
    IF v_disc_value < 0 THEN
      RAISE EXCEPTION 'Discount value cannot be negative';
    END IF;

    v_gross := round(v_qty * v_price, 2);
    v_disc := CASE
      WHEN v_disc_type = 'percentage' THEN round(v_gross * v_disc_value / 100, 2)
      ELSE least(round(v_disc_value, 2), v_gross)
    END;
    v_net := greatest(v_gross - v_disc, 0);

    IF v_tax_registered THEN
      v_tax_rate := coalesce((
        SELECT rate FROM public.tax_rates
        WHERE id = nullif(v_item->>'tax_rate_id', '')::uuid
          AND business_id = b.business_id AND is_active
      ), 0);
    ELSE
      v_tax_rate := 0;
    END IF;

    IF p_tax_inclusive AND v_tax_rate > 0 THEN
      v_base := round(v_net / (1 + v_tax_rate / 100), 2);
      v_tax_amount := round(v_net - v_base, 2);
    ELSE
      v_base := round(v_net, 2);
      v_tax_amount := round(v_base * v_tax_rate / 100, 2);
    END IF;

    v_line_total := round(v_base + v_tax_amount, 2);
    v_subtotal := v_subtotal + v_base;
    v_discount := v_discount + v_disc;
    v_tax := v_tax + v_tax_amount;
  END LOOP;

  v_total := round(v_subtotal + v_tax, 2);

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Corrected purchase bill total must be greater than zero';
  END IF;

  IF v_total < v_paid THEN
    RAISE EXCEPTION 'Corrected purchase bill total cannot be below supplier payments already made (%). Correct/refund the payment first.', v_paid;
  END IF;

  -- Reverse the previous inventory movement before changing the bill. A correction
  -- is rejected when the current balance cannot safely absorb that reversal.
  IF v_journal_was_posted THEN
    FOR v_line IN
      SELECT location_id, product_service_id, quantity, unit_cost, batch_number, serial_number
      FROM public.inventory_movements
      WHERE reference_type = 'bill'
        AND reference_id = b.id
        AND movement_type = 'purchase'
    LOOP
      SELECT quantity_on_hand, average_cost
      INTO v_old_qty, v_old_cost
      FROM public.inventory_balances
      WHERE business_id = b.business_id
        AND location_id = v_line.location_id
        AND product_service_id = v_line.product_service_id
      FOR UPDATE;

      IF coalesce(v_old_qty, 0) + 0.000001 < v_line.quantity THEN
        RAISE EXCEPTION 'Cannot safely correct purchase bill % because current stock is below the original purchased quantity for product %', b.bill_number, v_line.product_service_id;
      END IF;


      INSERT INTO public.inventory_movements(
        business_id, location_id, product_service_id, movement_type, quantity,
        unit_cost, reference_type, reference_id, batch_number, serial_number,
        notes, created_by
      )
      VALUES(
        b.business_id, v_line.location_id, v_line.product_service_id,
        'adjustment_out', v_line.quantity, v_line.unit_cost,
        'bill_amendment', b.id, v_line.batch_number, v_line.serial_number,
        'Purchase bill correction reversal', auth.uid()
      );
    END LOOP;

    PERFORM public.reverse_journal_entry(
      b.journal_entry_id,
      coalesce(p_bill_date, b.bill_date),
      'Purchase bill correction: ' || b.bill_number,
      auth.uid()
    );
  END IF;

  UPDATE public.bills
  SET vendor_id = p_vendor_id,
      bill_date = coalesce(p_bill_date, bill_date),
      due_date = coalesce(p_due_date, due_date),
      subtotal = v_subtotal,
      discount_total = v_discount,
      tax_total = v_tax,
      total = v_total,
      amount_paid = v_paid,
      balance_due = greatest(v_total - v_paid, 0),
      notes = p_notes,
      terms = p_terms,
      supply_type = coalesce(nullif(p_supply_type, ''), supply_type),
      reverse_charge = coalesce(p_reverse_charge, reverse_charge),
      tax_inclusive = coalesce(p_tax_inclusive, tax_inclusive),
      journal_entry_id = NULL,
      status = 'draft',
      updated_at = now()
  WHERE id = b.id;

  DELETE FROM public.bill_items WHERE bill_id = b.id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(value, ord) ORDER BY x.ord LOOP
    v_product := nullif(v_item->>'product_service_id', '')::uuid;
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_desc := nullif(trim(v_item->>'description'), '');
    IF v_desc IS NULL AND v_product IS NOT NULL THEN
      SELECT name INTO v_desc FROM public.products_services WHERE id = v_product AND business_id = b.business_id;
    END IF;
    v_disc_type := nullif(v_item->>'discount_type', '');
    IF v_disc_type = 'fixed' THEN v_disc_type := 'amount'; END IF;
    v_disc_value := coalesce((v_item->>'discount_value')::numeric, (v_item->>'discount')::numeric, 0);
    v_gross := round(v_qty * v_price, 2);
    v_disc := CASE WHEN v_disc_type = 'percentage' THEN round(v_gross * v_disc_value / 100, 2) ELSE least(round(v_disc_value,2), v_gross) END;
    v_net := greatest(v_gross - v_disc, 0);
    IF v_tax_registered THEN
      v_tax_rate := coalesce((SELECT rate FROM public.tax_rates WHERE id = nullif(v_item->>'tax_rate_id', '')::uuid AND business_id = b.business_id AND is_active), 0);
    ELSE
      v_tax_rate := 0;
    END IF;
    IF p_tax_inclusive AND v_tax_rate > 0 THEN
      v_base := round(v_net / (1 + v_tax_rate / 100), 2);
      v_tax_amount := round(v_net - v_base, 2);
    ELSE
      v_base := round(v_net, 2);
      v_tax_amount := round(v_base * v_tax_rate / 100, 2);
    END IF;
    v_line_total := round(v_base + v_tax_amount, 2);
    INSERT INTO public.bill_items(
      bill_id, product_service_id, description, quantity, unit_price,
      discount, discount_type, discount_value, tax_rate_id, tax_amount,
      line_total, expense_account_id, sort_order
    )
    VALUES(
      b.id, v_product, v_desc, v_qty, v_price, v_disc, CASE WHEN v_disc_type = 'amount' THEN 'fixed' ELSE v_disc_type END, v_disc_value,
      nullif(v_item->>'tax_rate_id','')::uuid, v_tax_amount, v_line_total,
      (SELECT expense_account_id FROM public.products_services WHERE id = v_product AND business_id = b.business_id),
      ((SELECT count(*) FROM public.bill_items WHERE bill_id = b.id)::integer)
    );
  END LOOP;

  IF v_journal_was_posted THEN
    SELECT id INTO v_ap FROM public.accounts WHERE business_id=b.business_id AND code='2000' AND is_active;
    SELECT id INTO v_inventory FROM public.accounts WHERE business_id=b.business_id AND code='1200' AND is_active;
    SELECT id INTO v_expense FROM public.accounts WHERE business_id=b.business_id AND code='6000' AND is_active;
    SELECT id INTO v_input_tax FROM public.accounts WHERE business_id=b.business_id AND code='1300' AND is_active;
    SELECT id INTO v_location FROM public.inventory_locations WHERE business_id=b.business_id AND is_default AND is_active LIMIT 1;

    IF v_ap IS NULL THEN RAISE EXCEPTION 'Accounts Payable account is missing'; END IF;
    IF v_tax_registered AND v_tax_creditable AND v_tax > 0 AND v_input_tax IS NULL THEN
      RAISE EXCEPTION 'Input GST account (1300) is missing';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:' || b.business_id::text));
    SELECT coalesce(max(entry_number),0)+1
    INTO v_entry_number
    FROM public.journal_entries
    WHERE business_id=b.business_id;

    INSERT INTO public.journal_entries(
      business_id, entry_number, entry_date, description,
      source_type, source_id, status, posted_at, posted_by, created_by,
      currency_code, total_debit, total_credit, is_system_generated
    )
    VALUES(
      b.business_id, v_entry_number, coalesce(p_bill_date,b.bill_date),
      'Bill ' || b.bill_number || ' (corrected)',
      'bill', b.id, 'posted', now(), auth.uid(), b.created_by,
      b.currency_code, v_total, v_total, true
    )
    RETURNING id INTO v_entry;

    FOR v_line IN
      SELECT bi.*, ps.inventory_tracked, ps.purchase_price
      FROM public.bill_items bi
      LEFT JOIN public.products_services ps ON ps.id=bi.product_service_id
      WHERE bi.bill_id=b.id
      ORDER BY bi.sort_order
    LOOP
      v_tax_amount := CASE WHEN v_tax_registered AND v_tax_creditable THEN round(coalesce(v_line.tax_amount,0),2) ELSE 0 END;
      v_base := round(coalesce(v_line.line_total,0) - v_tax_amount,2);

      IF coalesce(v_line.inventory_tracked,false) AND v_inventory IS NOT NULL THEN
        INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code)
        VALUES(v_entry,v_inventory,v_line.description,v_base,0,b.currency_code);

        IF v_location IS NOT NULL THEN
          SELECT quantity_on_hand, average_cost
          INTO v_old_qty, v_old_cost
          FROM public.inventory_balances
          WHERE business_id=b.business_id
            AND location_id=v_location
            AND product_service_id=v_line.product_service_id
          FOR UPDATE;

          v_unit_cost := coalesce(
            v_base / nullif(v_line.quantity,0),
            v_line.purchase_price,
            0
          );



          INSERT INTO public.inventory_movements(
            business_id,location_id,product_service_id,movement_type,quantity,unit_cost,
            reference_type,reference_id,created_by
          )
          VALUES(
            b.business_id,v_location,v_line.product_service_id,'purchase',v_line.quantity,
            v_unit_cost,'bill',b.id,auth.uid()
          );
        END IF;
      ELSE
        INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code)
        VALUES(
          v_entry,
          coalesce(v_line.expense_account_id,v_expense,v_inventory),
          v_line.description,
          v_base,
          0,
          b.currency_code
        );
      END IF;

      IF v_tax_amount > 0 THEN
        INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code)
        VALUES(v_entry,v_input_tax,'Input GST / eligible tax credit',v_tax_amount,0,b.currency_code);
      END IF;
    END LOOP;

    INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code)
    VALUES(v_entry,v_ap,'Accounts payable',0,v_total,b.currency_code);

    PERFORM public.validate_journal_entry_balance(v_entry);

    UPDATE public.bills
    SET journal_entry_id=v_entry,
        status=CASE
          WHEN v_paid >= v_total THEN 'paid'::bill_status
          WHEN v_paid > 0 THEN 'partially_paid'::bill_status
          WHEN coalesce(p_due_date,b.due_date) < current_date THEN 'overdue'::bill_status
          ELSE 'received'::bill_status
        END,
        updated_at=now()
    WHERE id=b.id;
  ELSE
    UPDATE public.bills
    SET status='draft'::bill_status,
        updated_at=now()
    WHERE id=b.id;
  END IF;

  RETURN b.id;
END;
$function$;

COMMIT;
