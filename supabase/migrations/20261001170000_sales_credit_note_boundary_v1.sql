BEGIN;

CREATE OR REPLACE FUNCTION public.recalculate_credit_note_totals(p_credit_note_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private AS $$
DECLARE
  v_business_id uuid;
  s numeric:=0;
  t numeric:=0;
BEGIN
  SELECT business_id INTO v_business_id
  FROM public.credit_notes
  WHERE id=p_credit_note_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Credit note not found';
  END IF;

  SELECT coalesce(sum(round(quantity*unit_price,2)),0),
         coalesce(sum(round(quantity*unit_price*tax_rate/100,2)),0)
    INTO s,t
  FROM public.credit_note_items
  WHERE credit_note_id=p_credit_note_id;

  UPDATE public.credit_notes
  SET subtotal=round(s,2),
      discount_total=0,
      tax_total=round(t,2),
      total=round(s+t,2),
      updated_at=now()
  WHERE id=p_credit_note_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_credit_note(
  p_business_id uuid,
  p_customer_id uuid,
  p_invoice_id uuid,
  p_credit_note_date date,
  p_reason text,
  p_items jsonb,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private AS $$
DECLARE
  n uuid;
  r jsonb;
  v_num text;
  v_currency char(3):='INR';
  v_customer_exists boolean;
  v_invoice public.invoices%rowtype;
  v_invoice_item public.invoice_items%rowtype;
  v_qty numeric;
  v_source_base_unit numeric;
  v_source_tax_unit numeric;
  v_tax_rate numeric;
  v_line_subtotal numeric;
  v_line_tax numeric;
  v_already_credited numeric;
  v_subtotal numeric:=0;
  v_tax numeric:=0;
  v_total numeric:=0;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'sales.create') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF nullif(trim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'Credit note reason is required';
  END IF;

  IF p_items IS NULL
     OR jsonb_typeof(p_items)<>'array'
     OR jsonb_array_length(p_items)=0 THEN
    RAISE EXCEPTION 'Credit note requires at least one item';
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.customers
    WHERE id=p_customer_id
      AND business_id=p_business_id
      AND is_active
  ) INTO v_customer_exists;

  IF NOT v_customer_exists THEN
    RAISE EXCEPTION 'Customer not found or inactive';
  END IF;

  IF p_invoice_id IS NOT NULL THEN
    SELECT * INTO v_invoice
    FROM public.invoices
    WHERE id=p_invoice_id
      AND business_id=p_business_id
      AND customer_id=p_customer_id
      AND status<>'void'
    FOR UPDATE;

    IF v_invoice.id IS NULL THEN
      RAISE EXCEPTION 'Source invoice not found';
    END IF;

    IF v_invoice.journal_entry_id IS NULL THEN
      RAISE EXCEPTION 'Post the source invoice before creating a credit note';
    END IF;

    IF p_credit_note_date<v_invoice.invoice_date THEN
      RAISE EXCEPTION 'Credit note date cannot be before the source invoice date';
    END IF;

    v_currency:=v_invoice.currency_code;
  END IF;

  PERFORM public.assert_accounting_period_open(p_business_id,p_credit_note_date);

  v_num:=public.next_document_number(p_business_id,'credit_note');

  INSERT INTO public.credit_notes(
    business_id,customer_id,invoice_id,credit_note_number,credit_note_date,
    reason,currency_code,notes,created_by
  ) VALUES(
    p_business_id,p_customer_id,p_invoice_id,v_num,p_credit_note_date,
    p_reason,v_currency,p_notes,auth.uid()
  ) RETURNING id INTO n;

  FOR r IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty:=coalesce((r->>'quantity')::numeric,0);

    IF v_qty<=0 THEN
      RAISE EXCEPTION 'Credit note item quantity must be greater than zero';
    END IF;

    IF nullif(r->>'invoice_item_id','') IS NOT NULL THEN
      IF p_invoice_id IS NULL THEN
        RAISE EXCEPTION 'An invoice item requires a source invoice';
      END IF;

      SELECT * INTO v_invoice_item
      FROM public.invoice_items ii
      WHERE ii.id=(r->>'invoice_item_id')::uuid
        AND ii.invoice_id=p_invoice_id
      FOR UPDATE;

      IF v_invoice_item.id IS NULL THEN
        RAISE EXCEPTION 'Credit note invoice item does not belong to the source invoice';
      END IF;

      SELECT coalesce(sum(cni.quantity),0)
        INTO v_already_credited
      FROM public.credit_note_items cni
      JOIN public.credit_notes cn ON cn.id=cni.credit_note_id
      WHERE cni.invoice_item_id=v_invoice_item.id
        AND cn.status='posted';

      IF v_qty>greatest(v_invoice_item.quantity-v_already_credited,0)+0.000001 THEN
        RAISE EXCEPTION 'Credit note quantity exceeds the uncredited source quantity';
      END IF;

      v_source_base_unit:=round(
        greatest(coalesce(v_invoice_item.line_total,0)-coalesce(v_invoice_item.tax_amount,0),0)
        / nullif(v_invoice_item.quantity,0),6
      );
      v_source_tax_unit:=round(
        greatest(coalesce(v_invoice_item.tax_amount,0),0)
        / nullif(v_invoice_item.quantity,0),6
      );

      v_line_subtotal:=round(v_qty*v_source_base_unit,2);
      v_line_tax:=round(v_qty*v_source_tax_unit,2);
      v_tax_rate:=CASE
        WHEN v_source_base_unit>0
        THEN round(v_source_tax_unit/v_source_base_unit*100,6)
        ELSE 0
      END;

      INSERT INTO public.credit_note_items(
        credit_note_id,invoice_item_id,product_service_id,description,
        quantity,unit_price,tax_rate,sort_order
      ) VALUES(
        n,
        v_invoice_item.id,
        v_invoice_item.product_service_id,
        coalesce(nullif(trim(r->>'description'),''),v_invoice_item.description),
        v_qty,
        v_source_base_unit,
        v_tax_rate,
        coalesce((r->>'sort_order')::int,0)
      );
    ELSE
      v_line_subtotal:=round(
        v_qty*coalesce((r->>'unit_price')::numeric,0),2
      );
      v_tax_rate:=coalesce((r->>'tax_rate')::numeric,0);

      IF v_line_subtotal<0 OR v_tax_rate<0 OR v_tax_rate>100 THEN
        RAISE EXCEPTION 'Invalid credit note item amount or tax rate';
      END IF;

      v_line_tax:=round(v_line_subtotal*v_tax_rate/100,2);

      IF nullif(r->>'product_service_id','') IS NOT NULL
         AND NOT EXISTS(
           SELECT 1
           FROM public.products_services ps
           WHERE ps.id=(r->>'product_service_id')::uuid
             AND ps.business_id=p_business_id
             AND ps.is_active
         ) THEN
        RAISE EXCEPTION 'Credit note product/service is invalid for this business';
      END IF;

      INSERT INTO public.credit_note_items(
        credit_note_id,invoice_item_id,product_service_id,description,
        quantity,unit_price,tax_rate,sort_order
      ) VALUES(
        n,
        NULL,
        nullif(r->>'product_service_id','')::uuid,
        coalesce(nullif(trim(r->>'description'),''),'Sales adjustment'),
        v_qty,
        coalesce((r->>'unit_price')::numeric,0),
        v_tax_rate,
        coalesce((r->>'sort_order')::int,0)
      );
    END IF;

    v_subtotal:=v_subtotal+v_line_subtotal;
    v_tax:=v_tax+v_line_tax;
  END LOOP;

  v_total:=round(v_subtotal+v_tax,2);

  IF v_total<=0 THEN
    RAISE EXCEPTION 'Credit note total must be greater than zero';
  END IF;

  UPDATE public.credit_notes
  SET subtotal=round(v_subtotal,2),
      tax_total=round(v_tax,2),
      total=v_total,
      updated_at=now()
  WHERE id=n;

  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_credit_note(
  p_credit_note_id uuid,
  p_location_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private AS $$
DECLARE
  n public.credit_notes%rowtype;
  src public.invoices%rowtype;
  e uuid;
  ar uuid;
  sales uuid;
  tax uuid;
  invacct uuid;
  cogs uuid;
  loc uuid;
  cost numeric;
  qty_on_hand numeric;
  cogs_total numeric:=0;
  r record;
BEGIN
  SELECT * INTO n
  FROM public.credit_notes
  WHERE id=p_credit_note_id
  FOR UPDATE;

  IF n.id IS NULL THEN
    RAISE EXCEPTION 'Credit note not found';
  END IF;

  IF NOT mm_private.has_business_permission(n.business_id,'accounting.post') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF n.status='void' THEN
    RAISE EXCEPTION 'Cannot post a void credit note';
  END IF;

  IF n.journal_entry_id IS NOT NULL THEN
    RETURN n.journal_entry_id;
  END IF;

  PERFORM public.assert_accounting_period_open(n.business_id,n.credit_note_date);
  PERFORM public.recalculate_credit_note_totals(n.id);

  SELECT * INTO n FROM public.credit_notes WHERE id=n.id FOR UPDATE;

  IF n.total<=0 THEN
    RAISE EXCEPTION 'Credit note total must be greater than zero';
  END IF;

  SELECT * INTO src
  FROM public.invoices
  WHERE id=n.invoice_id
    AND business_id=n.business_id
    AND customer_id=n.customer_id
  FOR UPDATE;

  IF n.invoice_id IS NOT NULL THEN
    IF src.id IS NULL OR src.status='void' THEN
      RAISE EXCEPTION 'Source invoice not found';
    END IF;

    IF src.journal_entry_id IS NULL THEN
      RAISE EXCEPTION 'Source invoice must be posted before the credit note';
    END IF;

    IF n.total>src.balance_due+0.005 THEN
      RAISE EXCEPTION 'Credit note exceeds the current invoice balance; use customer-credit/refund handling for settled amounts';
    END IF;
  END IF;

  SELECT id INTO ar FROM public.accounts WHERE business_id=n.business_id AND code='1100' AND is_active;
  SELECT id INTO sales FROM public.accounts WHERE business_id=n.business_id AND code='4000' AND is_active;
  SELECT id INTO tax FROM public.accounts WHERE business_id=n.business_id AND code='2100' AND is_active;
  SELECT id INTO invacct FROM public.accounts WHERE business_id=n.business_id AND code='1200' AND is_active;
  SELECT id INTO cogs FROM public.accounts WHERE business_id=n.business_id AND code='5000' AND is_active;

  IF ar IS NULL OR sales IS NULL THEN
    RAISE EXCEPTION 'Default AR or Sales account is missing';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||n.business_id::text));

  INSERT INTO public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,status,
    posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
  ) VALUES(
    n.business_id,
    (SELECT coalesce(max(je.entry_number),0)+1 FROM public.journal_entries je WHERE je.business_id=n.business_id),
    n.credit_note_date,
    'Credit note '||n.credit_note_number,
    'credit_note',
    n.id,
    'posted',
    now(),auth.uid(),auth.uid(),n.currency_code,n.total,n.total,true
  ) RETURNING id INTO e;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  ) VALUES(
    e,sales,'Sales reversal',n.subtotal,0,n.currency_code,NULL,NULL
  ),(
    e,ar,'Customer receivable reduction',0,n.total,n.currency_code,'customer',n.customer_id
  );

  IF n.tax_total>0 THEN
    IF tax IS NULL THEN
      RAISE EXCEPTION 'Output tax account is missing';
    END IF;

    INSERT INTO public.journal_lines(
      journal_entry_id,account_id,description,debit,credit,currency_code
    ) VALUES(
      e,tax,'Output tax reversal',n.tax_total,0,n.currency_code
    );
  END IF;

  IF p_location_id IS NULL
     AND EXISTS(
       SELECT 1 FROM public.businesses
       WHERE id=n.business_id
         AND inventory_enabled
     ) THEN
    SELECT id INTO loc
    FROM public.inventory_locations
    WHERE business_id=n.business_id
      AND is_default
      AND is_active
    LIMIT 1;
  ELSE
    loc:=p_location_id;

    IF loc IS NOT NULL
       AND NOT EXISTS(
         SELECT 1 FROM public.inventory_locations
         WHERE id=loc
           AND business_id=n.business_id
           AND is_active
       ) THEN
      RAISE EXCEPTION 'Inventory location is invalid';
    END IF;
  END IF;

  IF loc IS NOT NULL THEN
    FOR r IN
      SELECT cni.product_service_id,cni.quantity
      FROM public.credit_note_items cni
      JOIN public.products_services ps ON ps.id=cni.product_service_id
      WHERE cni.credit_note_id=n.id
        AND cni.product_service_id IS NOT NULL
        AND ps.inventory_tracked
    LOOP
      SELECT average_cost,quantity_on_hand
        INTO cost,qty_on_hand
      FROM public.inventory_balances
      WHERE business_id=n.business_id
        AND location_id=loc
        AND product_service_id=r.product_service_id
      FOR UPDATE;

      IF cost IS NULL THEN
        RAISE EXCEPTION 'Inventory balance not found for returned product %',r.product_service_id;
      END IF;

      cogs_total:=cogs_total+round(r.quantity*cost,2);

      UPDATE public.inventory_balances
      SET quantity_on_hand=quantity_on_hand+r.quantity,
          updated_at=now()
      WHERE business_id=n.business_id
        AND location_id=loc
        AND product_service_id=r.product_service_id;

      INSERT INTO public.inventory_movements(
        business_id,location_id,product_service_id,movement_type,quantity,unit_cost,
        reference_type,reference_id,created_by
      ) VALUES(
        n.business_id,loc,r.product_service_id,'sale_return',r.quantity,cost,
        'credit_note',n.id,auth.uid()
      );
    END LOOP;
  END IF;

  IF cogs_total>0 THEN
    IF cogs IS NULL OR invacct IS NULL THEN
      RAISE EXCEPTION 'Inventory accounting accounts are missing';
    END IF;

    INSERT INTO public.journal_lines(
      journal_entry_id,account_id,description,debit,credit,currency_code
    ) VALUES(
      e,invacct,'Inventory returned',cogs_total,0,n.currency_code
    ),(
      e,cogs,'Cost of goods sold reversal',0,cogs_total,n.currency_code
    );

    UPDATE public.journal_entries
    SET total_debit=total_debit+cogs_total,
        total_credit=total_credit+cogs_total
    WHERE id=e;
  END IF;

  PERFORM public.validate_journal_entry_balance(e);

  UPDATE public.credit_notes
  SET journal_entry_id=e,status='posted',updated_at=now()
  WHERE id=n.id;

  IF n.invoice_id IS NOT NULL THEN
    UPDATE public.invoices
    SET balance_due=greatest(balance_due-n.total,0),
        status=CASE
          WHEN greatest(balance_due-n.total,0)<=0 THEN 'paid'::invoice_status
          WHEN due_date<current_date THEN 'overdue'::invoice_status
          WHEN amount_paid>0 THEN 'partially_paid'::invoice_status
          ELSE 'sent'::invoice_status
        END,
        updated_at=now()
    WHERE id=n.invoice_id;
  END IF;

  RETURN e;
END;
$$;

DROP POLICY IF EXISTS credit_notes_member_all ON public.credit_notes;
DROP POLICY IF EXISTS credit_note_items_member_all ON public.credit_note_items;

CREATE POLICY credit_notes_select
  ON public.credit_notes
  FOR SELECT TO authenticated
  USING (mm_private.has_business_permission(business_id,'accounting.view'));

CREATE POLICY credit_note_items_select
  ON public.credit_note_items
  FOR SELECT TO authenticated
  USING (
    EXISTS(
      SELECT 1
      FROM public.credit_notes n
      WHERE n.id=credit_note_items.credit_note_id
        AND mm_private.has_business_permission(n.business_id,'accounting.view')
    )
  );

REVOKE ALL ON FUNCTION public.recalculate_credit_note_totals(uuid) FROM public,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.create_credit_note(uuid,uuid,uuid,date,text,jsonb,text) FROM public,anon;
REVOKE EXECUTE ON FUNCTION public.post_credit_note(uuid,uuid) FROM public,anon;

GRANT EXECUTE ON FUNCTION public.create_credit_note(uuid,uuid,uuid,date,text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_credit_note(uuid,uuid) TO authenticated;

COMMIT;