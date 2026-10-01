-- Production hardening tranche 2: purchase-bill and expense corrections.
-- Posted corrections preserve the business record ID/number and create an explicit
-- journal reversal followed by a corrected replacement journal.

CREATE OR REPLACE FUNCTION public.update_bill_any_state(
  p_bill_id uuid,
  p_vendor_id uuid,
  p_bill_date date,
  p_due_date date,
  p_items jsonb,
  p_supply_type text,
  p_reverse_charge boolean,
  p_tax_inclusive boolean,
  p_notes text DEFAULT NULL,
  p_terms text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $$
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

      UPDATE public.inventory_balances
      SET quantity_on_hand = quantity_on_hand - v_line.quantity,
          updated_at = now()
      WHERE business_id = b.business_id
        AND location_id = v_line.location_id
        AND product_service_id = v_line.product_service_id;

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
      b.id, v_product, v_desc, v_qty, v_price, v_disc, v_disc_type, v_disc_value,
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

          IF v_old_qty IS NULL THEN
            INSERT INTO public.inventory_balances(
              business_id,location_id,product_service_id,quantity_on_hand,average_cost,reorder_level
            )
            VALUES(
              b.business_id,v_location,v_line.product_service_id,v_line.quantity,v_unit_cost,
              coalesce((SELECT reorder_level FROM public.products_services WHERE id=v_line.product_service_id),0)
            );
          ELSE
            UPDATE public.inventory_balances
            SET quantity_on_hand=v_old_qty+v_line.quantity,
                average_cost=CASE
                  WHEN v_old_qty+v_line.quantity=0 THEN 0
                  ELSE round(((v_old_qty*coalesce(v_old_cost,0))+(v_line.quantity*v_unit_cost))/(v_old_qty+v_line.quantity),4)
                END,
                updated_at=now()
            WHERE business_id=b.business_id AND location_id=v_location AND product_service_id=v_line.product_service_id;
          END IF;

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
$$;

CREATE OR REPLACE FUNCTION public.update_vendor_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_method text,
  p_account_id uuid,
  p_reference text DEFAULT NULL,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $$
DECLARE
  pay_row public.payments%rowtype;
  alloc_row public.vendor_payment_allocations%rowtype;
  bill public.bills%rowtype;
  v_alloc_count integer;
  v_other_alloc numeric := 0;
  v_new_alloc numeric := 0;
  v_new_credit numeric := 0;
  v_old_credit numeric := 0;
  v_ap uuid;
  v_advance uuid;
  v_journal uuid;
  v_entry_number bigint;
  v_bill_paid numeric := 0;
  v_method public.payment_method;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  SELECT * INTO pay_row
  FROM public.payments
  WHERE id=p_payment_id AND direction='outbound'
  FOR UPDATE;

  IF pay_row.id IS NULL THEN
    RAISE EXCEPTION 'Supplier payment not found';
  END IF;

  IF NOT mm_private.has_business_permission(pay_row.business_id,'payments.pay') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT count(*) INTO v_alloc_count
  FROM public.vendor_payment_allocations
  WHERE payment_id=pay_row.id;

  IF v_alloc_count <> 1 THEN
    RAISE EXCEPTION 'Only supplier payments with exactly one bill allocation can be corrected here.';
  END IF;

  SELECT * INTO alloc_row
  FROM public.vendor_payment_allocations
  WHERE payment_id=pay_row.id
  LIMIT 1
  FOR UPDATE;

  SELECT * INTO bill
  FROM public.bills
  WHERE id=alloc_row.bill_id
    AND business_id=pay_row.business_id
    AND vendor_id=pay_row.vendor_id
  FOR UPDATE;

  IF bill.id IS NULL THEN
    RAISE EXCEPTION 'The supplier payment bill could not be found for the same business/vendor.';
  END IF;

  IF bill.status='void' THEN
    RAISE EXCEPTION 'Cannot correct a payment allocated to a void purchase bill.';
  END IF;

  IF p_payment_date < bill.bill_date THEN
    RAISE EXCEPTION 'Payment date cannot be before purchase bill date.';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.accounts
    WHERE id=p_account_id AND business_id=pay_row.business_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Payment account is invalid';
  END IF;

  v_method:=lower(p_method)::public.payment_method;

  PERFORM public.assert_accounting_period_open(pay_row.business_id,pay_row.payment_date);
  PERFORM public.assert_accounting_period_open(pay_row.business_id,p_payment_date);

  SELECT coalesce(sum(vpa.amount),0) INTO v_other_alloc
  FROM public.vendor_payment_allocations vpa
  WHERE vpa.bill_id=bill.id AND vpa.payment_id<>pay_row.id;

  v_new_alloc:=least(p_amount,greatest(bill.total-v_other_alloc,0));
  v_new_credit:=greatest(p_amount-v_new_alloc,0);

  SELECT coalesce(sum(amount),0)
  INTO v_old_credit
  FROM public.vendor_credit_ledger
  WHERE payment_id=pay_row.id;

  IF pay_row.journal_entry_id IS NOT NULL THEN
    IF NOT mm_private.has_business_permission(pay_row.business_id,'accounting.adjust') THEN
      RAISE EXCEPTION 'Accounting adjustment permission required to correct a posted supplier payment.';
    END IF;
    IF EXISTS(
      SELECT 1 FROM public.journal_entries
      WHERE reversal_of_id=pay_row.journal_entry_id
    ) THEN
      RAISE EXCEPTION 'This supplier payment has already been reversed and cannot be edited.';
    END IF;
    SELECT id INTO v_journal
    FROM public.journal_entries
    WHERE id=pay_row.journal_entry_id
    FOR UPDATE;
  END IF;

  IF v_old_credit<>0 THEN
    INSERT INTO public.vendor_credit_ledger(
      business_id,vendor_id,payment_id,entry_type,amount,currency_code,description,created_by
    )
    VALUES(
      pay_row.business_id,pay_row.vendor_id,pay_row.id,'adjustment',-v_old_credit,
      bill.currency_code,'Supplier payment correction reversed prior credit',auth.uid()
    );
  END IF;

  UPDATE public.payments
  SET amount=p_amount,
      method=v_method,
      account_id=p_account_id,
      reference=nullif(trim(p_reference),''),
      payment_date=p_payment_date,
      notes=p_notes,
      updated_at=now()
  WHERE id=pay_row.id;

  UPDATE public.vendor_payment_allocations
  SET amount=v_new_alloc
  WHERE id=alloc_row.id;

  IF v_new_credit>0 THEN
    INSERT INTO public.vendor_credit_ledger(
      business_id,vendor_id,payment_id,entry_type,amount,currency_code,description,created_by
    )
    VALUES(
      pay_row.business_id,pay_row.vendor_id,pay_row.id,'overpayment',v_new_credit,
      bill.currency_code,'Supplier payment correction created vendor credit',auth.uid()
    );
  END IF;

  SELECT id INTO v_ap
  FROM public.accounts
  WHERE business_id=pay_row.business_id AND code='2000' AND is_active;

  IF v_ap IS NULL THEN
    RAISE EXCEPTION 'Accounts payable account is missing';
  END IF;

  IF v_new_credit>0 THEN
    SELECT id INTO v_advance
    FROM public.accounts
    WHERE business_id=pay_row.business_id AND code='1255' AND is_active;

    IF v_advance IS NULL THEN
      INSERT INTO public.accounts(
        business_id,code,name,account_type,normal_balance,is_system,is_active,description
      )
      VALUES(
        pay_row.business_id,'1255','Vendor Advances','asset','debit',true,true,
        'Vendor overpayments and advances'
      )
      RETURNING id INTO v_advance;
    END IF;
  END IF;

  IF v_journal IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||pay_row.business_id::text));
    SELECT coalesce(max(entry_number),0)+1
    INTO v_entry_number
    FROM public.journal_entries
    WHERE business_id=pay_row.business_id;

    INSERT INTO public.journal_entries(
      business_id,entry_number,entry_date,description,source_type,source_id,status,
      posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
    )
    VALUES(
      pay_row.business_id,v_entry_number,p_payment_date,
      'Supplier payment for bill '||bill.bill_number,
      'vendor_payment',pay_row.id,'posted',now(),auth.uid(),auth.uid(),
      bill.currency_code,p_amount,p_amount,true
    )
    RETURNING id INTO v_journal;
  ELSE
    DELETE FROM public.journal_lines WHERE journal_entry_id=v_journal;
    UPDATE public.journal_entries
    SET entry_date=p_payment_date,
        description='Supplier payment for bill '||bill.bill_number,
        total_debit=p_amount,
        total_credit=p_amount,
        currency_code=bill.currency_code,
        updated_at=now()
    WHERE id=v_journal;
  END IF;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  )
  VALUES(
    v_journal,v_ap,'Accounts payable settlement',v_new_alloc,0,bill.currency_code,'vendor',pay_row.vendor_id
  );

  IF v_new_credit>0 THEN
    INSERT INTO public.journal_lines(
      journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
    )
    VALUES(
      v_journal,v_advance,'Vendor overpayment / advance',v_new_credit,0,bill.currency_code,'vendor',pay_row.vendor_id
    );
  END IF;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  )
  VALUES(
    v_journal,p_account_id,'Supplier payment',0,p_amount,bill.currency_code,'vendor',pay_row.vendor_id
  );

  PERFORM public.validate_journal_entry_balance(v_journal);

  UPDATE public.payments
  SET journal_entry_id=v_journal,updated_at=now()
  WHERE id=pay_row.id;

  SELECT coalesce(sum(vpa.amount),0)
  INTO v_bill_paid
  FROM public.vendor_payment_allocations vpa
  WHERE vpa.bill_id=bill.id;

  UPDATE public.bills
  SET amount_paid=least(total,v_bill_paid),
      balance_due=greatest(total-v_bill_paid,0),
      status=CASE
        WHEN v_bill_paid>=total THEN 'paid'::bill_status
        WHEN v_bill_paid>0 AND due_date<current_date THEN 'overdue'::bill_status
        WHEN v_bill_paid>0 THEN 'partially_paid'::bill_status
        WHEN due_date<current_date THEN 'overdue'::bill_status
        ELSE 'received'::bill_status
      END,
      updated_at=now()
  WHERE id=bill.id;

  RETURN pay_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_expense_any_state(
  p_expense_id uuid,
  p_vendor_id uuid,
  p_expense_date date,
  p_description text,
  p_amount numeric,
  p_tax_amount numeric,
  p_account_id uuid,
  p_payment_account_id uuid,
  p_payment_method text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_tax_creditable boolean DEFAULT false,
  p_expense_type text DEFAULT 'operating',
  p_category_id uuid DEFAULT NULL,
  p_tax_rate numeric DEFAULT 0,
  p_tax_inclusive boolean DEFAULT true,
  p_tax_components jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $$
DECLARE
  e public.expenses%rowtype;
  v_tax_account uuid;
  v_journal uuid;
  v_entry_number bigint;
  v_payment_account uuid;
  v_method public.payment_method;
  v_old_journal boolean := false;
  v_total numeric;
BEGIN
  SELECT * INTO e
  FROM public.expenses
  WHERE id=p_expense_id
  FOR UPDATE;

  IF e.id IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  IF p_description IS NULL OR trim(p_description)='' THEN
    RAISE EXCEPTION 'Expense description is required';
  END IF;
  IF p_amount<=0 THEN
    RAISE EXCEPTION 'Expense amount must be greater than zero';
  END IF;
  IF p_tax_amount<0 OR p_tax_rate<0 THEN
    RAISE EXCEPTION 'Tax amount and rate cannot be negative';
  END IF;

  IF NOT (
    mm_private.has_business_permission(e.business_id,'accounting.adjust')
    OR (e.journal_entry_id IS NULL AND mm_private.has_business_permission(e.business_id,'accounting.post'))
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.assert_accounting_period_open(e.business_id,e.expense_date);
  PERFORM public.assert_accounting_period_open(e.business_id,p_expense_date);

  IF p_vendor_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.vendors
    WHERE id=p_vendor_id AND business_id=e.business_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Vendor not found or inactive';
  END IF;

  IF p_category_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.expense_categories
    WHERE id=p_category_id AND business_id=e.business_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Expense category not found or inactive';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.accounts
    WHERE id=p_account_id AND business_id=e.business_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Expense account is invalid';
  END IF;

  v_payment_account:=coalesce(p_payment_account_id,e.payment_account_id);
  IF v_payment_account IS NULL THEN
    SELECT id INTO v_payment_account
    FROM public.accounts
    WHERE business_id=e.business_id AND code='1000' AND is_active;
  END IF;

  IF v_payment_account IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.accounts
    WHERE id=v_payment_account AND business_id=e.business_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Payment account is invalid';
  END IF;

  IF coalesce(nullif(trim(p_payment_method),''),e.payment_method::text) IS NOT NULL THEN
    v_method:=lower(coalesce(nullif(trim(p_payment_method),''),e.payment_method::text))::public.payment_method;
  ELSE
    v_method:=NULL;
  END IF;

  v_total:=round(p_amount+p_tax_amount,2);
  IF v_total<=0 THEN
    RAISE EXCEPTION 'Expense total must be greater than zero';
  END IF;

  IF e.journal_entry_id IS NOT NULL THEN
    v_old_journal:=true;
    IF EXISTS(
      SELECT 1 FROM public.journal_entries
      WHERE reversal_of_id=e.journal_entry_id
    ) THEN
      RAISE EXCEPTION 'This expense has already been reversed and cannot be edited.';
    END IF;

    PERFORM public.reverse_journal_entry(
      e.journal_entry_id,
      p_expense_date,
      'Expense correction: ' || e.description,
      auth.uid()
    );
  END IF;

  UPDATE public.expenses
  SET vendor_id=p_vendor_id,
      expense_date=p_expense_date,
      description=trim(p_description),
      amount=round(p_amount,2),
      tax_amount=round(p_tax_amount,2),
      account_id=p_account_id,
      payment_account_id=v_payment_account,
      payment_method=v_method,
      reference=nullif(trim(p_reference),''),
      tax_creditable=coalesce(p_tax_creditable,false),
      expense_type=coalesce(nullif(trim(p_expense_type),''),'operating'),
      category_id=p_category_id,
      tax_rate=round(p_tax_rate,4),
      tax_inclusive=coalesce(p_tax_inclusive,true),
      tax_components=coalesce(p_tax_components,'{}'::jsonb),
      journal_entry_id=NULL,
      updated_at=now()
  WHERE id=e.id;

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||e.business_id::text));
  SELECT coalesce(max(entry_number),0)+1
  INTO v_entry_number
  FROM public.journal_entries
  WHERE business_id=e.business_id;

  INSERT INTO public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,
    status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
  )
  VALUES(
    e.business_id,v_entry_number,p_expense_date,
    'Expense: '||trim(p_description),
    'expense',e.id,'posted',now(),auth.uid(),e.created_by,
    'INR',v_total,v_total,true
  )
  RETURNING id INTO v_journal;

  IF p_tax_creditable AND p_tax_amount>0 THEN
    SELECT id INTO v_tax_account
    FROM public.accounts
    WHERE business_id=e.business_id AND code='1300' AND is_active;

    IF v_tax_account IS NULL THEN
      RAISE EXCEPTION 'Input Tax Credit account (1300) is missing';
    END IF;

    INSERT INTO public.journal_lines(
      journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
    )
    VALUES
      (v_journal,p_account_id,trim(p_description),round(p_amount,2),0,'INR','expense',e.id),
      (v_journal,v_tax_account,'Input GST / eligible tax credit',round(p_tax_amount,2),0,'INR','expense',e.id),
      (v_journal,v_payment_account,trim(p_description),0,v_total,'INR','expense',e.id);
  ELSE
    INSERT INTO public.journal_lines(
      journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
    )
    VALUES
      (v_journal,p_account_id,trim(p_description),v_total,0,'INR','expense',e.id),
      (v_journal,v_payment_account,trim(p_description),0,v_total,'INR','expense',e.id);
  END IF;

  PERFORM public.validate_journal_entry_balance(v_journal);

  UPDATE public.expenses
  SET journal_entry_id=v_journal,updated_at=now()
  WHERE id=e.id;

  RETURN e.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_bill_void_with_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $$
BEGIN
  IF NEW.status='void' AND OLD.status<>'void'
     AND EXISTS(
       SELECT 1 FROM public.vendor_payment_allocations vpa
       WHERE vpa.bill_id=OLD.id AND vpa.amount>0
     ) THEN
    RAISE EXCEPTION 'Paid or partially paid purchase bills cannot be voided. Correct the payment or use a controlled supplier refund/credit workflow first.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_bill_void_with_payments ON public.bills;
CREATE TRIGGER trg_guard_bill_void_with_payments
BEFORE UPDATE OF status ON public.bills
FOR EACH ROW
EXECUTE FUNCTION public.guard_bill_void_with_payments();

REVOKE EXECUTE ON FUNCTION public.update_bill_any_state(uuid,uuid,date,date,jsonb,text,boolean,boolean,text,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.update_bill_any_state(uuid,uuid,date,date,jsonb,text,boolean,boolean,text,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_vendor_payment(uuid,numeric,text,uuid,text,date,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.update_vendor_payment(uuid,numeric,text,uuid,text,date,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_expense_any_state(uuid,uuid,date,text,numeric,numeric,uuid,uuid,text,text,boolean,text,uuid,numeric,boolean,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.update_expense_any_state(uuid,uuid,date,text,numeric,numeric,uuid,uuid,text,text,boolean,text,uuid,numeric,boolean,jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.guard_bill_void_with_payments() FROM public,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_invoice_void_with_payments() FROM public,anon,authenticated;
