BEGIN;

-- Increment an append-only audit-visible correction counter on each existing-document save.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS correction_count integer NOT NULL DEFAULT 0;

DO $correction_count_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.invoices'::regclass
      AND conname='invoices_correction_count_nonnegative'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_correction_count_nonnegative
      CHECK (correction_count >= 0) NOT VALID;
  END IF;
END;
$correction_count_check$;

-- Patch the current deployed correction routine instead of replacing it with the older
-- baseline definition. This preserves later delivery-challan and tracked-inventory guards.
DO $patch_invoice_correction$
DECLARE
  v_target regprocedure := 'public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid)'::regprocedure;
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(v_target) INTO v_definition;

  v_old := $old$  v_account_cogs uuid;
  v_journal uuid;$old$;
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction patch aborted: journal variables differ from expected baseline';
  END IF;
  v_new := $new$  v_account_cogs uuid;
  v_journal uuid;
  v_journal_number bigint;
  v_financial_change boolean := false;
  v_exchange_rate numeric := 1;
  v_exchange_rate_source text;
  v_exchange_rate_timestamp timestamptz;$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$  IF inv.journal_entry_id IS NOT NULL THEN
    IF NOT mm_private.has_business_permission(inv.business_id,'accounting.adjust') THEN RAISE EXCEPTION 'Accounting adjustment permission required to edit a posted invoice'; END IF;
    PERFORM public.assert_accounting_period_open(inv.business_id,inv.invoice_date);
    PERFORM public.assert_accounting_period_open(inv.business_id,coalesce(p_invoice_date,inv.invoice_date));
  END IF;$old$;
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction patch aborted: posted-invoice permission guard differs from expected baseline';
  END IF;
  v_new := $new$  -- Defer accounting-adjustment/period checks until a financial change is established.
  -- Notes, terms, due date, template, and other metadata-only corrections do not touch journals.$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$  IF (SELECT total FROM pg_temp.mm_invoice_amend_totals) < v_paid THEN
    RAISE EXCEPTION 'Corrected invoice total cannot be below payments already received (%). Reduce/refund the payment first.',v_paid;
  END IF;$old$;
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction patch aborted: totals guard differs from expected baseline';
  END IF;
  v_new := $new$  IF (SELECT total FROM pg_temp.mm_invoice_amend_totals) < v_paid THEN
    RAISE EXCEPTION 'Corrected invoice total cannot be below payments already received (%). Reduce/refund the payment first.',v_paid;
  END IF;

  -- Only accounting-relevant changes need a reversal. Compare individual components and
  -- normalized invoice lines so equal totals with changed products/tax/discount are handled.
  v_financial_change := inv.journal_entry_id IS NOT NULL AND (
    p_customer_id IS DISTINCT FROM inv.customer_id
    OR coalesce(p_invoice_date,inv.invoice_date) IS DISTINCT FROM inv.invoice_date
    OR coalesce(p_location_id,inv.inventory_location_id) IS DISTINCT FROM inv.inventory_location_id
    OR round(coalesce(inv.subtotal,0),2) IS DISTINCT FROM round((SELECT subtotal FROM pg_temp.mm_invoice_amend_totals),2)
    OR round(coalesce(inv.discount_total,0),2) IS DISTINCT FROM round((SELECT discount FROM pg_temp.mm_invoice_amend_totals),2)
    OR round(coalesce(inv.tax_total,0),2) IS DISTINCT FROM round((SELECT tax FROM pg_temp.mm_invoice_amend_totals),2)
    OR round(coalesce(inv.total,0),2) IS DISTINCT FROM round((SELECT total FROM pg_temp.mm_invoice_amend_totals),2)
    OR EXISTS (
      SELECT 1
      FROM (
        SELECT row_number() OVER (ORDER BY sort_order,id) AS rn,
               product_service_id,quantity,unit_price,discount_type,discount_value,tax_rate_id,hsn_sac
        FROM public.invoice_items WHERE invoice_id=inv.id
      ) old_line
      FULL OUTER JOIN (
        SELECT row_number() OVER (ORDER BY sort_order,product_service_id) AS rn,
               product_service_id,quantity,unit_price,discount_type,discount_value,tax_rate_id,hsn_sac
        FROM pg_temp.mm_invoice_amend_lines
      ) new_line USING (rn)
      WHERE old_line.rn IS NULL OR new_line.rn IS NULL
         OR old_line.product_service_id IS DISTINCT FROM new_line.product_service_id
         OR old_line.quantity IS DISTINCT FROM new_line.quantity
         OR old_line.unit_price IS DISTINCT FROM new_line.unit_price
         OR old_line.discount_type IS DISTINCT FROM new_line.discount_type
         OR old_line.discount_value IS DISTINCT FROM new_line.discount_value
         OR old_line.tax_rate_id IS DISTINCT FROM new_line.tax_rate_id
         OR old_line.hsn_sac IS DISTINCT FROM new_line.hsn_sac
    )
  );

  IF v_financial_change THEN
    IF NOT mm_private.has_business_permission(inv.business_id,'accounting.adjust') THEN
      RAISE EXCEPTION 'Accounting adjustment permission required to change a posted invoice';
    END IF;
    IF p_customer_id IS DISTINCT FROM inv.customer_id AND EXISTS (
      SELECT 1 FROM public.payments p
      JOIN public.journal_entries je ON je.id=p.journal_entry_id
      WHERE p.invoice_id=inv.id AND je.status::text IN ('posted','locked')
    ) THEN
      RAISE EXCEPTION 'Customer identity cannot be changed while posted payment journals are linked. Use a Credit Note and reissue the invoice.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id=inv.journal_entry_id AND je.status::text='posted') THEN
      RAISE EXCEPTION 'The linked invoice journal is not posted. Repair the accounting state before correcting this invoice.';
    END IF;
    PERFORM public.assert_accounting_period_open(inv.business_id,inv.invoice_date);
    PERFORM public.assert_accounting_period_open(inv.business_id,coalesce(p_invoice_date,inv.invoice_date));
    SELECT jl.exchange_rate,jl.exchange_rate_source,jl.exchange_rate_timestamp
      INTO v_exchange_rate,v_exchange_rate_source,v_exchange_rate_timestamp
    FROM public.journal_lines jl
    WHERE jl.journal_entry_id=inv.journal_entry_id
    ORDER BY CASE WHEN jl.debit>0 THEN 0 ELSE 1 END,jl.id
    LIMIT 1;
    v_exchange_rate:=coalesce(v_exchange_rate,1);
    PERFORM public.reverse_journal_entry(
      inv.journal_entry_id,
      coalesce(p_invoice_date,inv.invoice_date),
      'Invoice correction reversal for '||inv.invoice_number,
      auth.uid()
    );
  END IF;$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$  IF inv.journal_entry_id IS NOT NULL THEN
    FOR v_product_row IN
      SELECT location_id,product_service_id,quantity,unit_cost,batch_number,serial_number
      FROM public.inventory_movements
      WHERE reference_type='invoice' AND reference_id=inv.id AND movement_type='sale'$old$;
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction patch aborted: inventory reversal block differs from expected baseline';
  END IF;
  v_new := $new$  IF inv.journal_entry_id IS NOT NULL AND v_financial_change THEN
    FOR v_product_row IN
      SELECT location_id,product_service_id,quantity,unit_cost,batch_number,serial_number
      FROM public.inventory_movements
      WHERE reference_type='invoice' AND reference_id=inv.id AND movement_type='sale'$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$UPDATE public.invoices SET customer_id=p_customer_id,invoice_date=coalesce(p_invoice_date,invoice_date),due_date=coalesce(p_due_date,due_date),subtotal=(SELECT subtotal FROM pg_temp.mm_invoice_amend_totals),discount_total=(SELECT discount FROM pg_temp.mm_invoice_amend_totals),tax_total=(SELECT tax FROM pg_temp.mm_invoice_amend_totals),total=(SELECT total FROM pg_temp.mm_invoice_amend_totals),amount_paid=v_paid,balance_due=greatest((SELECT total FROM pg_temp.mm_invoice_amend_totals)-v_paid,0),notes=p_notes,terms=p_terms,discount_type=v_discount_type,discount_value=coalesce(p_invoice_discount_value,0),template_id=p_template_id,delivery_date=p_delivery_date,inventory_location_id=p_location_id,payment_display_mode=p_payment_display_mode,payment_bank_account_id=case when p_payment_display_mode='bank' then p_payment_bank_account_id else null end,updated_at=now() WHERE id=inv.id;$old$;
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction patch aborted: invoice update statement differs from expected baseline';
  END IF;
  v_new := $new$UPDATE public.invoices SET customer_id=p_customer_id,invoice_date=coalesce(p_invoice_date,invoice_date),due_date=coalesce(p_due_date,due_date),subtotal=(SELECT subtotal FROM pg_temp.mm_invoice_amend_totals),discount_total=(SELECT discount FROM pg_temp.mm_invoice_amend_totals),tax_total=(SELECT tax FROM pg_temp.mm_invoice_amend_totals),total=(SELECT total FROM pg_temp.mm_invoice_amend_totals),amount_paid=v_paid,balance_due=greatest((SELECT total FROM pg_temp.mm_invoice_amend_totals)-v_paid,0),notes=p_notes,terms=p_terms,discount_type=v_discount_type,discount_value=coalesce(p_invoice_discount_value,0),template_id=p_template_id,delivery_date=p_delivery_date,inventory_location_id=p_location_id,payment_display_mode=p_payment_display_mode,payment_bank_account_id=case when p_payment_display_mode='bank' then p_payment_bank_account_id else null end,correction_count=coalesce(correction_count,0)+1,updated_at=now() WHERE id=inv.id;$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$  UPDATE public.payments SET customer_id=p_customer_id WHERE invoice_id=inv.id;
  UPDATE public.receipts r SET customer_id=p_customer_id WHERE r.payment_id IN (SELECT p.id FROM public.payments p WHERE p.invoice_id=inv.id);
  IF inv.journal_entry_id IS NOT NULL THEN UPDATE public.journal_lines jl SET entity_id=p_customer_id WHERE jl.journal_entry_id IN (SELECT p.journal_entry_id FROM public.payments p WHERE p.invoice_id=inv.id) AND jl.entity_type='customer'; END IF;$old$;
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction patch aborted: payment identity update block differs from expected baseline';
  END IF;
  v_new := $new$  IF p_customer_id IS DISTINCT FROM inv.customer_id THEN
    UPDATE public.payments SET customer_id=p_customer_id WHERE invoice_id=inv.id;
    UPDATE public.receipts r SET customer_id=p_customer_id WHERE r.payment_id IN (SELECT p.id FROM public.payments p WHERE p.invoice_id=inv.id);
  END IF;$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$  IF inv.journal_entry_id IS NOT NULL
     AND inv.source_challan_id IS NOT NULL
     AND EXISTS ($old$;
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction patch aborted: challan-source inventory branch differs from expected baseline';
  END IF;
  v_new := $new$  IF inv.journal_entry_id IS NOT NULL
     AND v_financial_change
     AND inv.source_challan_id IS NOT NULL
     AND EXISTS ($new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$  IF inv.journal_entry_id IS NOT NULL
     AND inv.source_challan_id IS NULL
     AND EXISTS ($old$;
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction patch aborted: regular inventory branch differs from expected baseline';
  END IF;
  v_new := $new$  IF inv.journal_entry_id IS NOT NULL
     AND v_financial_change
     AND inv.source_challan_id IS NULL
     AND EXISTS ($new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$  IF inv.journal_entry_id IS NOT NULL THEN
    SELECT id INTO v_account_ar FROM public.accounts WHERE business_id=inv.business_id AND code='1100' AND is_active;$old$;
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction patch aborted: journal construction block differs from expected baseline';
  END IF;
  v_new := $new$  IF inv.journal_entry_id IS NOT NULL AND v_financial_change THEN
    SELECT id INTO v_account_ar FROM public.accounts WHERE business_id=inv.business_id AND code='1100' AND is_active;$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$v_journal:=inv.journal_entry_id; DELETE FROM public.journal_lines WHERE journal_entry_id=v_journal;$old$;
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction patch aborted: posted journal mutation site differs from expected baseline';
  END IF;
  v_new := $new$PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||inv.business_id::text));
    SELECT coalesce(max(entry_number),0)+1 INTO v_journal_number FROM public.journal_entries WHERE business_id=inv.business_id;
    INSERT INTO public.journal_entries(
      business_id,entry_number,entry_date,description,source_type,source_id,status,
      created_by,currency_code,total_debit,total_credit,is_system_generated
    ) VALUES(
      inv.business_id,v_journal_number,coalesce(p_invoice_date,inv.invoice_date),
      'Invoice '||inv.invoice_number||' (corrected)','invoice',inv.id,'draft',
      coalesce(inv.created_by,auth.uid()),inv.currency_code,0,0,true
    ) RETURNING id INTO v_journal;
    DELETE FROM public.journal_lines WHERE journal_entry_id=v_journal;$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id) VALUES(v_journal,v_account_ar,'Invoice receivable',(SELECT total FROM pg_temp.mm_invoice_amend_totals),0,inv.currency_code,'customer',p_customer_id),(v_journal,v_account_sales,'Sales revenue',0,(SELECT subtotal-discount FROM pg_temp.mm_invoice_amend_totals),inv.currency_code,NULL,NULL);$old$;
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction patch aborted: AR/revenue line statement differs from expected baseline';
  END IF;
  v_new := $new$INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,exchange_rate,exchange_rate_source,exchange_rate_timestamp,entity_type,entity_id) VALUES(v_journal,v_account_ar,'Invoice receivable',(SELECT total FROM pg_temp.mm_invoice_amend_totals),0,inv.currency_code,v_exchange_rate,v_exchange_rate_source,v_exchange_rate_timestamp,'customer',p_customer_id),(v_journal,v_account_sales,'Sales revenue',0,(SELECT subtotal-discount FROM pg_temp.mm_invoice_amend_totals),inv.currency_code,v_exchange_rate,v_exchange_rate_source,v_exchange_rate_timestamp,NULL,NULL);$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code) VALUES(v_journal,v_account_tax,'Output tax',0,(SELECT tax FROM pg_temp.mm_invoice_amend_totals),inv.currency_code);$old$;
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction patch aborted: tax line statement differs from expected baseline';
  END IF;
  v_new := $new$INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,exchange_rate,exchange_rate_source,exchange_rate_timestamp) VALUES(v_journal,v_account_tax,'Output tax',0,(SELECT tax FROM pg_temp.mm_invoice_amend_totals),inv.currency_code,v_exchange_rate,v_exchange_rate_source,v_exchange_rate_timestamp);$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code) VALUES(v_journal,v_account_cogs,'Cost of goods sold',v_cogs_total,0,inv.currency_code),(v_journal,v_account_inventory,'Inventory asset reduction',0,v_cogs_total,inv.currency_code);$old$;
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction patch aborted: COGS line statement differs from expected baseline';
  END IF;
  v_new := $new$INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,exchange_rate,exchange_rate_source,exchange_rate_timestamp) VALUES(v_journal,v_account_cogs,'Cost of goods sold',v_cogs_total,0,inv.currency_code,v_exchange_rate,v_exchange_rate_source,v_exchange_rate_timestamp),(v_journal,v_account_inventory,'Inventory asset reduction',0,v_cogs_total,inv.currency_code,v_exchange_rate,v_exchange_rate_source,v_exchange_rate_timestamp);$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$    PERFORM public.validate_journal_entry_balance(v_journal);
  END IF;$old$;
  IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
    RAISE EXCEPTION 'Invoice correction patch aborted: corrected-journal post site differs from expected baseline';
  END IF;
  v_new := $new$    PERFORM public.validate_journal_entry_balance(v_journal);
    UPDATE public.journal_entries SET status='posted',posted_at=now(),posted_by=auth.uid(),updated_at=now()
    WHERE id=v_journal;
    PERFORM public.validate_journal_entry_balance(v_journal);
    UPDATE public.invoices SET journal_entry_id=v_journal,updated_at=now() WHERE id=inv.id;
  END IF;$new$;
  v_definition := replace(v_definition,v_old,v_new);

  EXECUTE v_definition;
END;
$patch_invoice_correction$;

CREATE OR REPLACE FUNCTION public.rpc_correct_posted_invoice(
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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
  v_document_kind text;
BEGIN
  SELECT business_id,document_kind INTO v_business_id,v_document_kind
  FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF v_business_id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF v_document_kind='cash_bill' THEN
    RAISE EXCEPTION 'Cash Bills must be corrected through the Cash Bill settlement workflow';
  END IF;
  IF NOT (
    mm_private.has_business_permission(v_business_id,'sales.edit')
    OR mm_private.has_business_permission(v_business_id,'sales.create')
  ) THEN RAISE EXCEPTION 'Access denied'; END IF;

  RETURN public.update_invoice_any_state(
    p_invoice_id,p_customer_id,p_invoice_date,p_due_date,p_items,
    p_invoice_discount_type,p_invoice_discount_value,p_notes,p_terms,p_template_id,
    p_delivery_date,p_location_id,p_payment_display_mode,p_payment_bank_account_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid) FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.rpc_correct_posted_invoice(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.rpc_correct_posted_invoice(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid) TO authenticated;

COMMIT;
