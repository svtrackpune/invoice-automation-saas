-- FX-rate driven document posting. No historic financial row is backfilled or rewritten.
BEGIN;

-- Rate convention: 1 unit of transaction currency = rate units of the business base currency.
-- Resolution is fail-closed and uses the latest rate effective on/before the document date.
CREATE OR REPLACE FUNCTION mm_private.resolve_business_fx_rate(
  p_business_id uuid,
  p_currency_code text,
  p_base_currency_code text,
  p_rate_date date
)
RETURNS TABLE(exchange_rate numeric, exchange_rate_source text, exchange_rate_timestamp timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','mm_private','pg_temp'
AS $function$
DECLARE
  v_currency text := upper(btrim(coalesce(p_currency_code,'')));
  v_base text := upper(btrim(coalesce(p_base_currency_code,'')));
BEGIN
  IF v_currency !~ '^[A-Z]{3}$' OR v_base !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'A valid ISO currency and base currency are required for FX conversion';
  END IF;
  IF p_rate_date IS NULL THEN RAISE EXCEPTION 'An effective date is required to resolve an FX rate'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id=p_business_id AND b.is_active) THEN
    RAISE EXCEPTION 'Business not found or inactive while resolving FX rate';
  END IF;
  IF v_currency=v_base THEN
    RETURN QUERY SELECT 1::numeric,'BASE_DOMESTIC'::text,(p_rate_date::timestamp AT TIME ZONE 'UTC');
    RETURN;
  END IF;
  RETURN QUERY
    SELECT fr.rate,coalesce(nullif(btrim(fr.source),''),'MANUAL_FX'),fr.created_at
    FROM public.fx_rates fr
    WHERE fr.business_id=p_business_id
      AND upper(fr.currency_code)=v_currency
      AND upper(fr.base_currency_code)=v_base
      AND fr.rate_date<=p_rate_date
    ORDER BY fr.rate_date DESC,fr.created_at DESC,fr.id DESC
    LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No FX rate is configured for % to % on or before % for this business. Add a dated rate before posting the document.',
      v_currency,v_base,p_rate_date;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION mm_private.resolve_business_fx_rate(uuid,text,text,date) FROM PUBLIC,anon,authenticated;

-- Seed realized FX gain/loss accounts idempotently for existing businesses; no posted ledger is rewritten.
INSERT INTO public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description)
SELECT b.id,'4050','Realized FX Gain','income','credit',true,true,'Realized foreign-exchange gains on settlement'
FROM public.businesses b WHERE b.is_active
ON CONFLICT (business_id,code) DO NOTHING;
INSERT INTO public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description)
SELECT b.id,'6050','Realized FX Loss','expense','debit',true,true,'Realized foreign-exchange losses on settlement'
FROM public.businesses b WHERE b.is_active
ON CONFLICT (business_id,code) DO NOTHING;


CREATE OR REPLACE FUNCTION public.post_invoice(p_invoice_id uuid, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  inv public.invoices%rowtype;
  v_entry uuid;
  v_existing_entry_status text;
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
  v_base_currency char(3);
  v_fx_rate numeric;
  v_fx_source text;
  v_fx_timestamp timestamptz;
  v_challan_cogs numeric;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT mm_private.has_business_permission(inv.business_id,'accounting.post',auth.uid()) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF inv.status='void' THEN RAISE EXCEPTION 'Cannot post a void invoice'; END IF;
  IF inv.journal_entry_id IS NOT NULL THEN RETURN inv.journal_entry_id; END IF;

  PERFORM public.recalculate_invoice_totals(inv.id);
  SELECT * INTO inv FROM public.invoices WHERE id=inv.id FOR UPDATE;

  SELECT upper(base_currency_code) INTO v_base_currency
  FROM public.businesses WHERE id=inv.business_id AND is_active;
  IF v_base_currency IS NULL THEN RAISE EXCEPTION 'Business base currency is missing'; END IF;
  SELECT exchange_rate, exchange_rate_source, exchange_rate_timestamp
    INTO v_fx_rate, v_fx_source, v_fx_timestamp
  FROM mm_private.resolve_business_fx_rate(inv.business_id, inv.currency_code, v_base_currency, inv.invoice_date);

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

  IF EXISTS (
    SELECT 1
    FROM public.invoice_items ii
    JOIN public.products_services ps
      ON ps.id = ii.product_service_id
     AND ps.business_id = inv.business_id
    WHERE ii.invoice_id = inv.id
      AND ps.inventory_tracked
  ) THEN
    v_physical := true;
  END IF;

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
      v_location := coalesce(
        p_location_id,
        inv.inventory_location_id,
        (
          SELECT il.id
          FROM public.inventory_locations il
          WHERE il.business_id = inv.business_id
            AND il.is_active
          ORDER BY il.is_default DESC, il.name, il.id
          LIMIT 1
        )
      );
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
    'draft',
    NULL,
    NULL,
    auth.uid(),
    inv.currency_code,
    inv.total,
    inv.total,
    true
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_entry;

  IF v_entry IS NULL THEN
    SELECT id, status::text
      INTO v_entry, v_existing_entry_status
    FROM public.journal_entries
    WHERE business_id = inv.business_id
      AND source_type = 'invoice'
      AND source_id = inv.id
    FOR UPDATE;

    IF v_entry IS NULL THEN
      RAISE EXCEPTION 'Invoice journal uniqueness conflict could not be resolved for invoice %', inv.id;
    END IF;

    IF v_existing_entry_status IS DISTINCT FROM 'posted' THEN
      RAISE EXCEPTION
        'Invoice journal entry % already exists in status %; refusing to duplicate or append ledger lines',
        v_entry, coalesce(v_existing_entry_status, 'unknown');
    END IF;

    PERFORM public.validate_journal_entry_balance(v_entry);

    UPDATE public.invoices
    SET journal_entry_id = v_entry,
        status = CASE
          WHEN balance_due <= 0 THEN 'paid'::invoice_status
          WHEN due_date < current_date THEN 'overdue'::invoice_status
          WHEN amount_paid > 0 THEN 'partially_paid'::invoice_status
          ELSE 'sent'::invoice_status
        END,
        updated_at = now()
    WHERE id = inv.id
      AND business_id = inv.business_id;

    RETURN v_entry;
  END IF;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
    exchange_rate,exchange_rate_source,exchange_rate_timestamp,
    transaction_currency_code,transaction_amount,base_currency_code,base_amount
  )
  VALUES(
    v_entry,v_ar,'Invoice receivable',inv.total,0,inv.currency_code,'customer',inv.customer_id,
    v_fx_rate,v_fx_source,v_fx_timestamp,inv.currency_code,inv.total,v_base_currency,round(inv.total*v_fx_rate,6)
  ),
  (
    v_entry,v_sales,'Sales revenue',0,inv.subtotal-inv.discount_total,inv.currency_code,null,null,
    v_fx_rate,v_fx_source,v_fx_timestamp,inv.currency_code,round(inv.subtotal-inv.discount_total,6),
    v_base_currency,round((inv.subtotal-inv.discount_total)*v_fx_rate,6)
  );

  IF inv.tax_total>0 THEN
    IF v_tax IS NULL THEN RAISE EXCEPTION 'Output tax account is missing'; END IF;
    INSERT INTO public.journal_lines(
      journal_entry_id,account_id,description,debit,credit,currency_code,
      exchange_rate,exchange_rate_source,exchange_rate_timestamp,
      transaction_currency_code,transaction_amount,base_currency_code,base_amount
    )
    VALUES(
      v_entry,v_tax,'Output tax',0,inv.tax_total,inv.currency_code,
      v_fx_rate,v_fx_source,v_fx_timestamp,inv.currency_code,inv.tax_total,
      v_base_currency,round(inv.tax_total*v_fx_rate,6)
    );
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

        IF round(v_challan_movement_qty, 6) <> round(v_challan_qty, 6) THEN
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

        -- The movement trigger is the authoritative stock guard and honors
        -- the business allow_negative_stock policy. Use purchase price as the
        -- COGS fallback when this location has no balance yet.
        IF v_cost IS NULL THEN
          SELECT coalesce(ps.purchase_price, 0)
          INTO v_cost
          FROM public.products_services ps
          WHERE ps.id = v_product.product_service_id
            AND ps.business_id = inv.business_id;
        END IF;
        v_cost := coalesce(v_cost, 0);

        v_cogs_total:=v_cogs_total+round(v_product.quantity*v_cost,2);

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
      journal_entry_id,account_id,description,debit,credit,currency_code,
      exchange_rate,exchange_rate_source,exchange_rate_timestamp,
      transaction_currency_code,transaction_amount,base_currency_code,base_amount
    )
    VALUES(
      v_entry,v_cogs,'Cost of goods sold',v_cogs_total,0,v_base_currency,
      1,'BASE_DOMESTIC',v_fx_timestamp,v_base_currency,v_cogs_total,v_base_currency,v_cogs_total
    ),
    (
      v_entry,v_inventory,'Inventory asset reduction',0,v_cogs_total,v_base_currency,
      1,'BASE_DOMESTIC',v_fx_timestamp,v_base_currency,v_cogs_total,v_base_currency,v_cogs_total
    );
    UPDATE public.journal_entries
    SET total_debit=total_debit+v_cogs_total,total_credit=total_credit+v_cogs_total
    WHERE id=v_entry;
  END IF;

  -- Journal header totals are recorded in base currency, including mixed-currency COGS lines.
  UPDATE public.journal_entries
  SET total_debit = (SELECT coalesce(sum(base_amount),0) FROM public.journal_lines WHERE journal_entry_id=v_entry AND debit>0),
      total_credit = (SELECT coalesce(sum(base_amount),0) FROM public.journal_lines WHERE journal_entry_id=v_entry AND credit>0)
  WHERE id=v_entry;

  UPDATE public.journal_entries
  SET status = 'posted',
      posted_at = now(),
      posted_by = auth.uid()
  WHERE id = v_entry
    AND status = 'draft';

  IF NOT FOUND THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.journal_entries
      WHERE id = v_entry
        AND business_id = inv.business_id
        AND source_type = 'invoice'
        AND source_id = inv.id
        AND status = 'posted'
    ) THEN
      RAISE EXCEPTION 'Invoice posting refused: journal entry % did not transition from draft to posted', v_entry;
    END IF;
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
$function$


CREATE OR REPLACE FUNCTION public.post_bill_legacy(p_bill_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  b public.bills%rowtype;
  v_entry uuid;
  v_ap uuid;
  v_inventory uuid;
  v_expense uuid;
  v_input_tax uuid;
  v_location uuid;
  v_line record;
  v_total numeric:=0;
  v_base numeric:=0;
  v_tax numeric:=0;
  v_entry_number bigint;
  v_tax_registered boolean:=false;
  v_tax_creditable boolean:=false;
  v_old_qty numeric;
  v_old_cost numeric;
  v_new_qty numeric;
  v_new_cost numeric;
  v_base_currency char(3);
  v_fx_rate numeric;
  v_fx_source text;
  v_fx_timestamp timestamptz;
begin
  select * into b from public.bills where id=p_bill_id for update;
  if b.id is null then raise exception 'Bill not found'; end if;
  IF coalesce(b.is_purchase_order, false) THEN
    RAISE EXCEPTION 'Purchase orders cannot be posted directly. Receive goods and convert the order to a vendor bill.';
  END IF;
  if not mm_private.has_business_permission(b.business_id,'accounting.post') then raise exception 'Access denied'; end if;
  if b.journal_entry_id is not null then return b.journal_entry_id; end if;
  select upper(base_currency_code) into v_base_currency
    from public.businesses where id=b.business_id and is_active;
  if v_base_currency is null then raise exception 'Business base currency is missing'; end if;
  select exchange_rate,exchange_rate_source,exchange_rate_timestamp
    into v_fx_rate,v_fx_source,v_fx_timestamp
    from mm_private.resolve_business_fx_rate(b.business_id,b.currency_code,v_base_currency,b.bill_date);
  select id into v_ap from public.accounts where business_id=b.business_id and code='2000' and is_active;
  select id into v_inventory from public.accounts where business_id=b.business_id and code='1200' and is_active;
  select id into v_expense from public.accounts where business_id=b.business_id and code='6000' and is_active;
  select id into v_input_tax from public.accounts where business_id=b.business_id and code='1300' and is_active;
  select coalesce(tax_regime='GST' and gst_registration_type<>'COMPOSITION',false) into v_tax_creditable from public.business_tax_profiles where business_id=b.business_id;
  v_tax_registered:=coalesce((select tax_regime='GST' from public.business_tax_profiles where business_id=b.business_id),false);
  if v_tax_registered and v_tax_creditable and v_input_tax is null then raise exception 'Input GST account (1300) is missing'; end if;
  if v_ap is null then raise exception 'Accounts Payable account is missing'; end if;
  IF v_inventory IS NULL AND EXISTS (
    SELECT 1
    FROM public.bill_items bi
    JOIN public.products_services ps ON ps.id = bi.product_service_id AND ps.business_id = b.business_id
    WHERE bi.bill_id = b.id AND ps.inventory_tracked
  ) THEN
    RAISE EXCEPTION 'Inventory asset account (1200) is missing for tracked purchase items. Configure the inventory account before posting this bill.';
  END IF;
  v_total:=round(coalesce(b.total,0),2);
  if v_total<=0 then raise exception 'Bill total must be greater than zero'; end if;
  select id into v_location
  from public.inventory_locations
  where business_id=b.business_id and is_active
  order by is_default desc, name, id
  limit 1;
  IF v_location IS NULL AND EXISTS (
    SELECT 1
    FROM public.bill_items bi
    JOIN public.products_services ps ON ps.id=bi.product_service_id AND ps.business_id=b.business_id
    WHERE bi.bill_id=b.id AND ps.inventory_tracked
  ) THEN
    RAISE EXCEPTION 'No active inventory location is configured. Create or activate a stock location before posting a tracked-item purchase bill.';
  END IF;
  perform pg_advisory_xact_lock(hashtext('journal-entry-number:'||b.business_id::text));
  select coalesce(max(entry_number),0)+1 into v_entry_number from public.journal_entries where business_id=b.business_id;
  insert into public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated)
  values(b.business_id,v_entry_number,b.bill_date,'Bill '||b.bill_number,'bill',b.id,'draft',NULL,NULL,b.created_by,b.currency_code,v_total,v_total,true) returning id into v_entry;
  for v_line in select bi.description,bi.line_total,bi.tax_amount,bi.quantity,bi.product_service_id,bi.expense_account_id,ps.inventory_tracked,ps.purchase_price from public.bill_items bi left join public.products_services ps on ps.id=bi.product_service_id where bi.bill_id=b.id order by bi.sort_order loop
    v_tax:=case when v_tax_registered and v_tax_creditable then round(coalesce(v_line.tax_amount,0),2) else 0 end;
    v_base:=round(coalesce(v_line.line_total,0)-v_tax,2);
    if v_line.inventory_tracked and v_inventory is not null then
      insert into public.journal_lines(
        journal_entry_id,account_id,description,debit,credit,currency_code,
        exchange_rate,exchange_rate_source,exchange_rate_timestamp,
        transaction_currency_code,transaction_amount,base_currency_code,base_amount
      ) values(
        v_entry,v_inventory,v_line.description,v_base,0,b.currency_code,
        v_fx_rate,v_fx_source,v_fx_timestamp,b.currency_code,v_base,v_base_currency,round(v_base*v_fx_rate,6)
      );
      if v_location is not null then
        select quantity_on_hand,average_cost into v_old_qty,v_old_cost from public.inventory_balances where business_id=b.business_id and location_id=v_location and product_service_id=v_line.product_service_id for update;

        insert into public.inventory_movements(business_id,location_id,product_service_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
        values(b.business_id,v_location,v_line.product_service_id,'purchase',v_line.quantity,
          coalesce((v_base*v_fx_rate)/nullif(v_line.quantity,0),v_line.purchase_price,0),'bill',b.id,auth.uid());
      end if;
    else
      insert into public.journal_lines(
        journal_entry_id,account_id,description,debit,credit,currency_code,
        exchange_rate,exchange_rate_source,exchange_rate_timestamp,
        transaction_currency_code,transaction_amount,base_currency_code,base_amount
      ) values(
        v_entry,coalesce(v_line.expense_account_id,v_expense,v_inventory),v_line.description,v_base,0,b.currency_code,
        v_fx_rate,v_fx_source,v_fx_timestamp,b.currency_code,v_base,v_base_currency,round(v_base*v_fx_rate,6)
      );
    end if;
    if v_tax>0 then
      insert into public.journal_lines(
        journal_entry_id,account_id,description,debit,credit,currency_code,
        exchange_rate,exchange_rate_source,exchange_rate_timestamp,
        transaction_currency_code,transaction_amount,base_currency_code,base_amount
      ) values(
        v_entry,v_input_tax,'Input GST / eligible tax credit',v_tax,0,b.currency_code,
        v_fx_rate,v_fx_source,v_fx_timestamp,b.currency_code,v_tax,v_base_currency,round(v_tax*v_fx_rate,6)
      );
    end if;
  end loop;
  insert into public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,
    exchange_rate,exchange_rate_source,exchange_rate_timestamp,
    transaction_currency_code,transaction_amount,base_currency_code,base_amount
  ) values(
    v_entry,v_ap,'Accounts payable',0,v_total,b.currency_code,
    v_fx_rate,v_fx_source,v_fx_timestamp,b.currency_code,v_total,v_base_currency,round(v_total*v_fx_rate,6)
  );
  update public.journal_entries
  set total_debit=(select coalesce(sum(base_amount),0) from public.journal_lines where journal_entry_id=v_entry and debit>0),
      total_credit=(select coalesce(sum(base_amount),0) from public.journal_lines where journal_entry_id=v_entry and credit>0)
  where id=v_entry;
  perform public.validate_journal_entry_balance(v_entry);
  -- LED-001: add all journal lines while the entry is draft, then post atomically.
  update public.journal_entries
     set status='posted', posted_at=now(), posted_by=auth.uid()
   where id=v_entry;
  update public.bills set journal_entry_id=v_entry,status=case when b.due_date<current_date then 'overdue'::bill_status else 'received'::bill_status end,updated_at=now() where id=b.id;
  return v_entry;
end;
$function$



-- FX-aware settlement preserves each document's booking rate and posts realized FX differences in base currency.
CREATE OR REPLACE FUNCTION public.record_customer_payment(p_business_id uuid, p_customer_id uuid, p_invoice_id uuid, p_amount numeric, p_method payment_method, p_account_id uuid, p_reference text DEFAULT NULL::text, p_gateway_transaction_id text DEFAULT NULL::text, p_payment_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_currency_code text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE inv public.invoices%rowtype; v_payment uuid; v_receipt uuid; v_entry uuid; v_ar uuid; v_credit_acct uuid; v_number text; v_allocated numeric; v_excess numeric; v_total numeric; v_business_currency char(3); v_transaction_currency char(3); v_fx_rate numeric; v_fx_source text; v_fx_timestamp timestamptz; v_invoice_rate numeric; v_invoice_rate_source text; v_invoice_rate_timestamp timestamptz; v_fx_delta numeric:=0; v_fx_gain uuid; v_fx_loss uuid;
BEGIN
 IF NOT mm_private.has_business_permission(p_business_id,'payments.receive') THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_amount<=0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero'; END IF;
 PERFORM public.assert_accounting_period_open(p_business_id,p_payment_date);
 SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id AND business_id=p_business_id AND customer_id=p_customer_id FOR UPDATE;
 IF inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
 IF inv.status='void' THEN RAISE EXCEPTION 'Cannot pay a void invoice'; END IF;
 IF inv.journal_entry_id IS NULL THEN PERFORM public.post_invoice(inv.id,NULL); SELECT * INTO inv FROM public.invoices WHERE id=inv.id FOR UPDATE; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_account_id AND business_id=p_business_id AND is_active AND account_subtype IN ('cash','bank')) THEN RAISE EXCEPTION 'Deposit account must be Cash or Bank. Inventory, Furniture & Fixtures and other non-settlement accounts are not valid customer deposit accounts.'; END IF;
 SELECT upper(coalesce(nullif(btrim(base_currency_code),''),nullif(btrim(currency_code),''),'INR')) INTO v_business_currency FROM public.businesses WHERE id=p_business_id AND is_active;
 IF v_business_currency IS NULL THEN RAISE EXCEPTION 'Business not found'; END IF;
 v_transaction_currency:=upper(coalesce(nullif(btrim(p_currency_code),''),nullif(btrim(inv.currency_code),''),v_business_currency));
 IF v_transaction_currency<>upper(inv.currency_code) THEN
   RAISE EXCEPTION 'Payment currency % must match invoice currency %; cross-currency settlement is not supported in this workflow',v_transaction_currency,upper(inv.currency_code);
 END IF;
 SELECT exchange_rate,exchange_rate_source,exchange_rate_timestamp
   INTO v_fx_rate,v_fx_source,v_fx_timestamp
 FROM mm_private.resolve_business_fx_rate(p_business_id,v_transaction_currency,v_business_currency,p_payment_date);
 SELECT id INTO v_ar FROM public.accounts WHERE business_id=p_business_id AND code='1100' AND is_active;
 IF v_ar IS NULL THEN RAISE EXCEPTION 'Accounts receivable account is missing'; END IF;
 SELECT exchange_rate,exchange_rate_source,exchange_rate_timestamp
   INTO v_invoice_rate,v_invoice_rate_source,v_invoice_rate_timestamp
 FROM public.journal_lines
 WHERE journal_entry_id=inv.journal_entry_id AND account_id=v_ar AND debit>0
   AND upper(transaction_currency_code)=upper(inv.currency_code)
 ORDER BY id LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original invoice FX booking rate is missing; payment cannot be posted safely'; END IF;
 v_allocated:=least(p_amount,greatest(inv.balance_due,0)); v_excess:=greatest(p_amount-v_allocated,0);
 IF v_transaction_currency<>v_business_currency AND v_excess>0 THEN
   RAISE EXCEPTION 'Foreign-currency overpayments are disabled until FX credit application is supported. Limit this payment to the invoice balance.';
 END IF;
 v_fx_delta:=round(round(v_allocated*v_fx_rate,6)-round(v_allocated*v_invoice_rate,6),6);
 IF v_fx_delta>0 THEN
   SELECT id INTO v_fx_gain FROM public.accounts WHERE business_id=p_business_id AND code='4050' AND is_active;
   IF v_fx_gain IS NULL THEN RAISE EXCEPTION 'Realized FX gain account (4050) is missing'; END IF;
 ELSIF v_fx_delta<0 THEN
   SELECT id INTO v_fx_loss FROM public.accounts WHERE business_id=p_business_id AND code='6050' AND is_active;
   IF v_fx_loss IS NULL THEN RAISE EXCEPTION 'Realized FX loss account (6050) is missing'; END IF;
 END IF;
 IF v_excess>0 THEN INSERT INTO public.accounts(business_id,code,name,account_type,normal_balance,is_system,is_active,description) SELECT p_business_id,'2150','Customer Credits','liability','credit',true,true,'Customer overpayments and unapplied credits' WHERE NOT EXISTS(SELECT 1 FROM public.accounts WHERE business_id=p_business_id AND code='2150'); END IF;
 SELECT id INTO v_credit_acct FROM public.accounts WHERE business_id=p_business_id AND code='2150' AND is_active;
 INSERT INTO public.payments(business_id,direction,customer_id,invoice_id,account_id,amount,currency_code,payment_date,method,reference,gateway_transaction_id,notes,created_by) VALUES(p_business_id,'inbound',p_customer_id,p_invoice_id,p_account_id,p_amount,v_transaction_currency,p_payment_date,p_method,p_reference,p_gateway_transaction_id,p_notes,auth.uid()) RETURNING id INTO v_payment;
 IF v_allocated>0 THEN INSERT INTO public.payment_allocations(business_id,payment_id,invoice_id,amount) VALUES(p_business_id,v_payment,p_invoice_id,v_allocated); END IF;
 IF v_excess>0 THEN INSERT INTO public.customer_credit_ledger(business_id,customer_id,payment_id,entry_type,amount,currency_code,description,created_by) VALUES(p_business_id,p_customer_id,v_payment,'overpayment',v_excess,v_transaction_currency,'Unapplied customer overpayment',auth.uid()); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));
 INSERT INTO public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated) VALUES(p_business_id,(select coalesce(max(entry_number),0)+1 from public.journal_entries where business_id=p_business_id),p_payment_date,'Payment received for invoice '||inv.invoice_number,'payment',v_payment,'draft',NULL,NULL,auth.uid(),v_transaction_currency,p_amount,p_amount,true) RETURNING id INTO v_entry;
 INSERT INTO public.journal_lines(
   journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
   exchange_rate,exchange_rate_source,exchange_rate_timestamp,
   transaction_currency_code,transaction_amount,base_currency_code,base_amount
 ) VALUES(
   v_entry,p_account_id,'Customer payment',p_amount,0,v_transaction_currency,'customer',p_customer_id,
   v_fx_rate,v_fx_source,v_fx_timestamp,v_transaction_currency,p_amount,v_business_currency,round(p_amount*v_fx_rate,6)
 );
 IF v_allocated>0 THEN
   INSERT INTO public.journal_lines(
     journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
     exchange_rate,exchange_rate_source,exchange_rate_timestamp,
     transaction_currency_code,transaction_amount,base_currency_code,base_amount
   ) VALUES(
     v_entry,v_ar,'Receivable settlement',0,v_allocated,v_transaction_currency,'customer',p_customer_id,
     v_invoice_rate,coalesce(v_invoice_rate_source,'INVOICE_BOOKING'),v_invoice_rate_timestamp,
     v_transaction_currency,v_allocated,v_business_currency,round(v_allocated*v_invoice_rate,6)
   );
 END IF;
 IF v_excess>0 THEN
   INSERT INTO public.journal_lines(
     journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
     exchange_rate,exchange_rate_source,exchange_rate_timestamp,
     transaction_currency_code,transaction_amount,base_currency_code,base_amount
   ) VALUES(
     v_entry,v_credit_acct,'Customer credit',0,v_excess,v_transaction_currency,'customer',p_customer_id,
     v_fx_rate,v_fx_source,v_fx_timestamp,v_transaction_currency,v_excess,v_business_currency,round(v_excess*v_fx_rate,6)
   );
 END IF;
 IF v_fx_delta>0 THEN
   INSERT INTO public.journal_lines(
     journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
     exchange_rate,exchange_rate_source,exchange_rate_timestamp,
     transaction_currency_code,transaction_amount,base_currency_code,base_amount
   ) VALUES(
     v_entry,v_fx_gain,'Realized FX gain on customer settlement',0,v_fx_delta,v_business_currency,'customer',p_customer_id,
     1,'BASE_DOMESTIC',v_fx_timestamp,v_business_currency,v_fx_delta,v_business_currency,v_fx_delta
   );
 ELSIF v_fx_delta<0 THEN
   INSERT INTO public.journal_lines(
     journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
     exchange_rate,exchange_rate_source,exchange_rate_timestamp,
     transaction_currency_code,transaction_amount,base_currency_code,base_amount
   ) VALUES(
     v_entry,v_fx_loss,'Realized FX loss on customer settlement',abs(v_fx_delta),0,v_business_currency,'customer',p_customer_id,
     1,'BASE_DOMESTIC',v_fx_timestamp,v_business_currency,abs(v_fx_delta),v_business_currency,abs(v_fx_delta)
   );
 END IF;
 UPDATE public.journal_entries
 SET total_debit=(SELECT coalesce(sum(base_amount),0) FROM public.journal_lines WHERE journal_entry_id=v_entry AND debit>0),
     total_credit=(SELECT coalesce(sum(base_amount),0) FROM public.journal_lines WHERE journal_entry_id=v_entry AND credit>0)
 WHERE id=v_entry;
 PERFORM public.validate_journal_entry_balance(v_entry);
 -- LED-001: journal lines can only be attached while the header is draft.
 UPDATE public.journal_entries SET status='posted', posted_at=now(), posted_by=auth.uid() WHERE id=v_entry AND status='draft';
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment posting refused: journal entry % did not transition from draft to posted', v_entry; END IF;
 PERFORM public.validate_journal_entry_balance(v_entry);
 UPDATE public.payments SET journal_entry_id=v_entry WHERE id=v_payment;
 SELECT coalesce(sum(pa.amount),0) INTO v_total FROM public.payment_allocations pa WHERE pa.invoice_id=inv.id;
 UPDATE public.invoices SET amount_paid=v_total,balance_due=greatest(total-v_total,0),status=case when v_total>=total then 'paid'::invoice_status when v_total>0 and due_date<current_date then 'overdue'::invoice_status when v_total>0 then 'partially_paid'::invoice_status when due_date<current_date then 'overdue'::invoice_status else 'sent'::invoice_status end,updated_at=now() WHERE id=inv.id;
 v_number:=public.next_document_number(p_business_id,'receipt');
 INSERT INTO public.receipts(business_id,customer_id,payment_id,receipt_number,receipt_date,amount,currency_code,payment_method,reference_number,notes,created_by) VALUES(p_business_id,p_customer_id,v_payment,v_number,p_payment_date,p_amount,v_transaction_currency,p_method::text,p_reference,p_notes,auth.uid()) RETURNING id INTO v_receipt;
 RETURN v_receipt;
END; $function$


CREATE OR REPLACE FUNCTION public.record_vendor_payment(p_business_id uuid, p_vendor_id uuid, p_bill_id uuid, p_amount numeric, p_method text, p_account_id uuid, p_reference text DEFAULT NULL::text, p_payment_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_currency_code text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'mm_private'
AS $function$
DECLARE
 v_payment uuid;
 v_bill public.bills%rowtype;
 v_alloc numeric;
 v_remaining numeric;
 v_credit numeric;
 v_ap uuid;
 v_advance uuid;
 v_entry uuid;
 v_method payment_method;
 v_entry_number bigint;
 v_paid numeric;
 v_business_currency char(3);
 v_transaction_currency char(3);
 v_fx_rate numeric;
 v_fx_source text;
 v_fx_timestamp timestamptz;
 v_bill_rate numeric;
 v_bill_rate_source text;
 v_bill_rate_timestamp timestamptz;
 v_fx_delta numeric:=0;
 v_fx_gain uuid;
 v_fx_loss uuid;
BEGIN
 IF NOT mm_private.has_business_permission(p_business_id,'payments.pay') THEN
   RAISE EXCEPTION 'Access denied';
 END IF;
 IF p_amount IS NULL OR p_amount<=0 THEN
   RAISE EXCEPTION 'Payment amount must be positive';
 END IF;
 PERFORM public.assert_accounting_period_open(p_business_id,p_payment_date);
 v_method:=CASE lower(p_method) WHEN 'gateway' THEN 'payment_gateway'::payment_method ELSE lower(p_method)::payment_method END;

 SELECT * INTO v_bill
 FROM public.bills
 WHERE id=p_bill_id AND business_id=p_business_id AND vendor_id=p_vendor_id
 FOR UPDATE;
 IF v_bill.id IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;

 SELECT upper(coalesce(nullif(btrim(base_currency_code),''),nullif(btrim(currency_code),''),'INR'))
 INTO v_business_currency
 FROM public.businesses WHERE id=p_business_id AND is_active;
 IF v_business_currency IS NULL THEN RAISE EXCEPTION 'Business not found'; END IF;
 v_transaction_currency:=upper(coalesce(nullif(btrim(p_currency_code),''),nullif(btrim(v_bill.currency_code),''),v_business_currency));
 IF v_transaction_currency<>upper(v_bill.currency_code) THEN
   RAISE EXCEPTION 'Payment currency % must match bill currency %; cross-currency settlement is not supported in this workflow',v_transaction_currency,upper(v_bill.currency_code);
 END IF;
 IF v_bill.journal_entry_id IS NULL THEN RAISE EXCEPTION 'Purchase bill must be posted before payment'; END IF;
 SELECT exchange_rate,exchange_rate_source,exchange_rate_timestamp
   INTO v_fx_rate,v_fx_source,v_fx_timestamp
 FROM mm_private.resolve_business_fx_rate(p_business_id,v_transaction_currency,v_business_currency,p_payment_date);

 SELECT coalesce(sum(vpa.amount),0) INTO v_alloc
 FROM public.vendor_payment_allocations vpa WHERE vpa.bill_id=p_bill_id;
 v_remaining:=greatest(v_bill.total-v_alloc,0);
 v_credit:=greatest(p_amount-v_remaining,0);
 IF v_transaction_currency<>v_business_currency AND v_credit>0 THEN
   RAISE EXCEPTION 'Foreign-currency overpayments are disabled until FX supplier-credit allocation is supported. Limit this payment to the bill balance.';
 END IF;

 IF NOT EXISTS (
   SELECT 1 FROM public.accounts
   WHERE id=p_account_id AND business_id=p_business_id AND is_active
     AND account_subtype IN ('cash','bank')
 ) THEN
   RAISE EXCEPTION 'Payment account must be an active Cash or Bank account';
 END IF;
 SELECT id INTO v_ap FROM public.accounts
 WHERE business_id=p_business_id AND code='2000' AND is_active;
 IF v_ap IS NULL THEN RAISE EXCEPTION 'Accounts payable account is missing'; END IF;
 SELECT exchange_rate,exchange_rate_source,exchange_rate_timestamp
   INTO v_bill_rate,v_bill_rate_source,v_bill_rate_timestamp
 FROM public.journal_lines
 WHERE journal_entry_id=v_bill.journal_entry_id AND account_id=v_ap AND credit>0
   AND upper(transaction_currency_code)=upper(v_bill.currency_code)
 ORDER BY id LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original purchase-bill FX booking rate is missing; payment cannot be posted safely'; END IF;
 v_fx_delta:=round(round(least(p_amount,v_remaining)*v_fx_rate,6)-round(least(p_amount,v_remaining)*v_bill_rate,6),6);
 IF v_fx_delta>0 THEN
   SELECT id INTO v_fx_loss FROM public.accounts WHERE business_id=p_business_id AND code='6050' AND is_active;
   IF v_fx_loss IS NULL THEN RAISE EXCEPTION 'Realized FX loss account (6050) is missing'; END IF;
 ELSIF v_fx_delta<0 THEN
   SELECT id INTO v_fx_gain FROM public.accounts WHERE business_id=p_business_id AND code='4050' AND is_active;
   IF v_fx_gain IS NULL THEN RAISE EXCEPTION 'Realized FX gain account (4050) is missing'; END IF;
 END IF;

 INSERT INTO public.payments(
   business_id,direction,vendor_id,bill_id,account_id,amount,currency_code,
   payment_date,method,reference,notes,created_by
 ) VALUES (
   p_business_id,'outbound',p_vendor_id,p_bill_id,p_account_id,p_amount,
   v_transaction_currency,p_payment_date,v_method,p_reference,p_notes,auth.uid()
 ) RETURNING id INTO v_payment;

 IF v_remaining>0 THEN
   INSERT INTO public.vendor_payment_allocations(business_id,payment_id,vendor_id,bill_id,amount)
   VALUES(p_business_id,v_payment,p_vendor_id,p_bill_id,least(p_amount,v_remaining));
 END IF;
 IF v_credit>0 THEN
   INSERT INTO public.vendor_credit_ledger(
     business_id,vendor_id,payment_id,entry_type,amount,currency_code,description,created_by
   ) VALUES(
     p_business_id,p_vendor_id,v_payment,'overpayment',v_credit,v_transaction_currency,
     'Unapplied vendor overpayment',auth.uid()
   );
 END IF;

 PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));
 SELECT coalesce(max(entry_number),0)+1 INTO v_entry_number
 FROM public.journal_entries WHERE business_id=p_business_id;

 INSERT INTO public.journal_entries(
   business_id,entry_number,entry_date,description,source_type,source_id,status,
   posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
 ) VALUES(
   p_business_id,v_entry_number,p_payment_date,
   'Payment made to vendor for bill '||v_bill.bill_number,
   'vendor_payment',v_payment,'draft',NULL,NULL,auth.uid(),
   v_transaction_currency,0,0,true
 ) RETURNING id INTO v_entry;

 -- Avoid a zero/zero AP journal line if the bill is already fully allocated.
 IF v_remaining>0 THEN
   INSERT INTO public.journal_lines(
     journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
     exchange_rate,exchange_rate_source,exchange_rate_timestamp,
     transaction_currency_code,transaction_amount,base_currency_code,base_amount
   ) VALUES(
     v_entry,v_ap,'Accounts payable settlement',least(p_amount,v_remaining),0,
     v_transaction_currency,'vendor',p_vendor_id,v_bill_rate,coalesce(v_bill_rate_source,'BILL_BOOKING'),v_bill_rate_timestamp,
     v_transaction_currency,least(p_amount,v_remaining),v_business_currency,round(least(p_amount,v_remaining)*v_bill_rate,6)
   );
 END IF;

 INSERT INTO public.journal_lines(
   journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
   exchange_rate,exchange_rate_source,exchange_rate_timestamp,
   transaction_currency_code,transaction_amount,base_currency_code,base_amount
 ) VALUES(
   v_entry,p_account_id,'Vendor payment',0,p_amount,v_transaction_currency,'vendor',p_vendor_id,
   v_fx_rate,v_fx_source,v_fx_timestamp,v_transaction_currency,p_amount,v_business_currency,round(p_amount*v_fx_rate,6)
 );

 IF v_credit>0 THEN
   SELECT id INTO v_advance FROM public.accounts
   WHERE business_id=p_business_id AND code='1255' AND is_active;
   IF v_advance IS NULL THEN
     INSERT INTO public.accounts(
       business_id,code,name,account_type,normal_balance,is_system,is_active,description
     ) VALUES(
       p_business_id,'1255','Vendor Advances','asset','debit',true,true,
       'Vendor overpayments and advances'
     ) RETURNING id INTO v_advance;
   END IF;
   INSERT INTO public.journal_lines(
     journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
     exchange_rate,exchange_rate_source,exchange_rate_timestamp,
     transaction_currency_code,transaction_amount,base_currency_code,base_amount
   ) VALUES(
     v_entry,v_advance,'Vendor overpayment / advance',v_credit,0,v_transaction_currency,
     'vendor',p_vendor_id,v_fx_rate,v_fx_source,v_fx_timestamp,v_transaction_currency,v_credit,
     v_business_currency,round(v_credit*v_fx_rate,6)
   );
 END IF;

 -- Add every line while the header is still draft; posted journal entries are immutable.
 IF v_fx_delta>0 THEN
   INSERT INTO public.journal_lines(
     journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
     exchange_rate,exchange_rate_source,exchange_rate_timestamp,
     transaction_currency_code,transaction_amount,base_currency_code,base_amount
   ) VALUES(
     v_entry,v_fx_loss,'Realized FX loss on supplier settlement',v_fx_delta,0,v_business_currency,'vendor',p_vendor_id,
     1,'BASE_DOMESTIC',v_fx_timestamp,v_business_currency,v_fx_delta,v_business_currency,v_fx_delta
   );
 ELSIF v_fx_delta<0 THEN
   INSERT INTO public.journal_lines(
     journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id,
     exchange_rate,exchange_rate_source,exchange_rate_timestamp,
     transaction_currency_code,transaction_amount,base_currency_code,base_amount
   ) VALUES(
     v_entry,v_fx_gain,'Realized FX gain on supplier settlement',0,abs(v_fx_delta),v_business_currency,'vendor',p_vendor_id,
     1,'BASE_DOMESTIC',v_fx_timestamp,v_business_currency,abs(v_fx_delta),v_business_currency,abs(v_fx_delta)
   );
 END IF;
 UPDATE public.journal_entries
 SET total_debit=(SELECT coalesce(sum(base_amount),0) FROM public.journal_lines WHERE journal_entry_id=v_entry AND debit>0),
     total_credit=(SELECT coalesce(sum(base_amount),0) FROM public.journal_lines WHERE journal_entry_id=v_entry AND credit>0)
 WHERE id=v_entry;
 PERFORM public.validate_journal_entry_balance(v_entry);
 UPDATE public.journal_entries
 SET status='posted',posted_at=now(),posted_by=auth.uid()
 WHERE id=v_entry AND status='draft';
 IF NOT FOUND THEN RAISE EXCEPTION 'Vendor payment posting refused: journal entry % did not transition from draft to posted',v_entry; END IF;
 PERFORM public.validate_journal_entry_balance(v_entry);
 UPDATE public.payments SET journal_entry_id=v_entry WHERE id=v_payment;

 SELECT coalesce(sum(vpa.amount),0) INTO v_paid
 FROM public.vendor_payment_allocations vpa WHERE vpa.bill_id=p_bill_id;
 UPDATE public.bills
 SET amount_paid=least(total,v_paid),
     balance_due=greatest(total-v_paid,0),
     status=CASE
       WHEN total<=v_paid THEN 'paid'::bill_status
       WHEN v_paid>0 THEN 'partially_paid'::bill_status
       ELSE status
     END,
     updated_at=now()
 WHERE id=p_bill_id;

 RETURN v_payment;
END;
$function$


COMMIT;
