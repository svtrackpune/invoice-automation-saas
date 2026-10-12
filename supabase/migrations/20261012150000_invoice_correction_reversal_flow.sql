BEGIN;

-- Track correction revisions without rewriting historical journals.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS correction_count integer NOT NULL DEFAULT 0;

DO $correction_count_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.invoices'::regclass AND conname='invoices_correction_count_nonnegative'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_correction_count_nonnegative
      CHECK (correction_count >= 0) NOT VALID;
  END IF;
END;
$correction_count_check$;

CREATE OR REPLACE FUNCTION public.update_invoice_any_state(
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
SET search_path='public','mm_private'
AS $$
DECLARE
  inv public.invoices%rowtype;
  v_tax_enabled boolean;
  v_paid numeric := 0;
  v_item_count integer;
  v_item jsonb;
  v_product uuid;
  v_qty numeric;
  v_price numeric;
  v_desc text;
  v_disc_type text;
  v_disc_value numeric;
  v_tax uuid;
  v_hsn text;
  v_base numeric;
  v_line_discount numeric;
  v_tax_rate numeric;
  v_tax_amount numeric;
  v_line_total numeric;
  v_discount_type text;
  v_location uuid;
  v_cogs_total numeric := 0;
  v_cost numeric;
  v_stock numeric;
  v_product_row record;
  v_account_ar uuid;
  v_account_sales uuid;
  v_account_tax uuid;
  v_account_inventory uuid;
  v_account_cogs uuid;
  v_journal uuid;
  v_journal_number bigint;
  v_financial_change boolean := false;
  v_exchange_rate numeric := 1;
  v_exchange_rate_source text;
  v_exchange_rate_timestamp timestamptz;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF inv.status='void' THEN RAISE EXCEPTION 'Void invoices cannot be edited'; END IF;
  IF NOT (mm_private.has_business_permission(inv.business_id,'sales.edit') OR mm_private.has_business_permission(inv.business_id,'sales.create')) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT coalesce(sum(pa.amount),0) INTO v_paid
  FROM public.payment_allocations pa WHERE pa.invoice_id=inv.id;

  SELECT count(*) INTO v_item_count FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb));
  IF v_item_count=0 THEN RAISE EXCEPTION 'Invoice must contain at least one item'; END IF;
  IF p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id AND business_id=inv.business_id AND is_active) THEN
    RAISE EXCEPTION 'Customer not found or inactive';
  END IF;
  IF p_invoice_discount_type IS NOT NULL AND p_invoice_discount_type NOT IN ('amount','fixed','percentage','') THEN RAISE EXCEPTION 'Invalid invoice discount type'; END IF;
  IF coalesce(p_invoice_discount_value,0)<0 THEN RAISE EXCEPTION 'Invoice discount cannot be negative'; END IF;
  IF p_template_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.document_templates WHERE id=p_template_id AND document_type='invoice' AND is_active) THEN RAISE EXCEPTION 'Invalid or inactive invoice template'; END IF;
  IF p_payment_display_mode NOT IN ('none','bank','online') THEN RAISE EXCEPTION 'Invalid invoice payment display mode'; END IF;
  IF p_payment_display_mode='bank' AND p_payment_bank_account_id IS NULL THEN RAISE EXCEPTION 'Select a bank account for the invoice'; END IF;
  IF p_payment_bank_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.bank_accounts WHERE id=p_payment_bank_account_id AND business_id=inv.business_id AND is_active) THEN RAISE EXCEPTION 'Invoice bank account is invalid'; END IF;

  -- A posted journal is touched only if the accounting impact changes. Metadata-only
  -- corrections must not reverse/repost an otherwise identical accounting transaction.

  SELECT coalesce((b.feature_flags->>'is_tax_registered')::boolean,false) INTO v_tax_enabled
  FROM public.businesses b WHERE b.id=inv.business_id;
  v_discount_type:=case when p_invoice_discount_type in ('amount','fixed') then 'fixed' when p_invoice_discount_type='percentage' then 'percentage' else null end;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.mm_invoice_amend_lines(
    sort_order integer, product_service_id uuid, description text, quantity numeric, unit_price numeric,
    discount_type text, discount_value numeric, tax_rate_id uuid, hsn_sac text,
    discount numeric, tax_amount numeric, line_total numeric
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.mm_invoice_amend_lines;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product:=nullif(v_item->>'product_service_id','')::uuid;
    v_qty:=coalesce((v_item->>'quantity')::numeric,0);
    v_price:=coalesce((v_item->>'unit_price')::numeric,0);
    v_desc:=coalesce(nullif(v_item->>'description',''),(select name from public.products_services where id=v_product));
    v_disc_type:=nullif(v_item->>'discount_type',''); IF v_disc_type='amount' THEN v_disc_type='fixed'; END IF;
    v_disc_value:=coalesce((v_item->>'discount_value')::numeric,0);
    v_tax:=nullif(v_item->>'tax_rate_id','')::uuid;
    v_hsn:=nullif(trim(v_item->>'hsn_sac'),'');
    IF v_qty<=0 OR v_price<0 OR v_desc IS NULL THEN RAISE EXCEPTION 'Invalid invoice item'; END IF;
    IF v_product IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.products_services WHERE id=v_product AND business_id=inv.business_id AND is_active AND sell_enabled) THEN RAISE EXCEPTION 'Product/service not found'; END IF;
    IF v_disc_type IS NOT NULL AND v_disc_type NOT IN ('percentage','fixed') THEN RAISE EXCEPTION 'Invalid line discount type'; END IF;
    IF v_disc_value<0 THEN RAISE EXCEPTION 'Discount value cannot be negative'; END IF;
    IF v_tax_enabled THEN
      IF v_product IS NULL THEN RAISE EXCEPTION 'HSN / SAC is required for every tax-registered invoice line'; END IF;
      SELECT nullif(trim(hsn_sac),'') INTO v_hsn FROM public.products_services WHERE id=v_product AND business_id=inv.business_id;
      IF v_hsn IS NULL THEN RAISE EXCEPTION 'HSN / SAC is required for tax-registered invoice item %',v_desc; END IF;
    END IF;
    v_base:=round(v_qty*v_price,2);
    v_line_discount:=public.calculate_invoice_line_discount(inv.business_id,v_product,v_base,v_disc_type,v_disc_value);
    v_tax_rate:=case when v_tax_enabled and v_tax is not null then coalesce((select rate from public.tax_rates where id=v_tax and business_id=inv.business_id and is_active),0) else 0 end;
    v_tax_amount:=round((v_base-v_line_discount)*v_tax_rate/100,2);
    v_line_total:=round(v_base-v_line_discount+v_tax_amount,2);
    INSERT INTO pg_temp.mm_invoice_amend_lines VALUES(
      coalesce(nullif(v_item->>'sort_order','')::integer,(select coalesce(max(sort_order),-1)+1 from pg_temp.mm_invoice_amend_lines)),
      v_product,v_desc,v_qty,v_price,v_disc_type,v_disc_value,v_tax,v_hsn,v_line_discount,v_tax_amount,v_line_total
    );
  END LOOP;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.mm_invoice_amend_totals(subtotal numeric,discount numeric,tax numeric,total numeric) ON COMMIT DROP;
  TRUNCATE pg_temp.mm_invoice_amend_totals;
  INSERT INTO pg_temp.mm_invoice_amend_totals
  SELECT subtotal, line_discount + invoice_discount, tax, round(subtotal-line_discount-invoice_discount+tax,2)
  FROM (SELECT sum(quantity*unit_price) subtotal,sum(discount) line_discount,sum(tax_amount) tax FROM pg_temp.mm_invoice_amend_lines) s
  CROSS JOIN LATERAL (
    SELECT least(greatest(s.subtotal-s.line_discount,0),greatest(case when v_discount_type='percentage' then (s.subtotal-s.line_discount)*coalesce(p_invoice_discount_value,0)/100 else coalesce(p_invoice_discount_value,0) end,0)) invoice_discount
  ) d;

  IF (SELECT total FROM pg_temp.mm_invoice_amend_totals) < v_paid THEN
    RAISE EXCEPTION 'Corrected invoice total cannot be below payments already received (%). Reduce/refund the payment first.',v_paid;
  END IF;

  -- Compare ledger-relevant values before mutating anything. Notes, terms, due date,
  -- template, and other non-ledger metadata can change without journal churn.
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
  END IF;

  IF inv.journal_entry_id IS NOT NULL AND v_financial_change THEN
    FOR v_product_row IN
      SELECT location_id,product_service_id,quantity,unit_cost,batch_number,serial_number
      FROM public.inventory_movements
      WHERE reference_type='invoice' AND reference_id=inv.id AND movement_type='sale'
    LOOP
      UPDATE public.inventory_balances SET quantity_on_hand=quantity_on_hand+v_product_row.quantity,updated_at=now()
      WHERE business_id=inv.business_id AND location_id=v_product_row.location_id AND product_service_id=v_product_row.product_service_id;
      IF NOT FOUND THEN
        INSERT INTO public.inventory_balances(business_id,location_id,product_service_id,quantity_on_hand,average_cost,updated_at)
        VALUES(inv.business_id,v_product_row.location_id,v_product_row.product_service_id,v_product_row.quantity,v_product_row.unit_cost,now());
      END IF;
      INSERT INTO public.inventory_movements(business_id,location_id,product_service_id,movement_type,quantity,unit_cost,reference_type,reference_id,batch_number,serial_number,notes,created_by)
      VALUES(inv.business_id,v_product_row.location_id,v_product_row.product_service_id,'sale_reversal',v_product_row.quantity,v_product_row.unit_cost,'invoice_amendment',inv.id,v_product_row.batch_number,v_product_row.serial_number,'Invoice correction reversal',auth.uid());
    END LOOP;
  END IF;

  UPDATE public.invoices SET
    customer_id=p_customer_id,invoice_date=coalesce(p_invoice_date,invoice_date),due_date=coalesce(p_due_date,due_date),
    subtotal=(SELECT subtotal FROM pg_temp.mm_invoice_amend_totals),discount_total=(SELECT discount FROM pg_temp.mm_invoice_amend_totals),
    tax_total=(SELECT tax FROM pg_temp.mm_invoice_amend_totals),total=(SELECT total FROM pg_temp.mm_invoice_amend_totals),
    amount_paid=v_paid,balance_due=greatest((SELECT total FROM pg_temp.mm_invoice_amend_totals)-v_paid,0),
    notes=p_notes,terms=p_terms,discount_type=v_discount_type,discount_value=coalesce(p_invoice_discount_value,0),
    template_id=p_template_id,delivery_date=p_delivery_date,inventory_location_id=p_location_id,
    payment_display_mode=p_payment_display_mode,payment_bank_account_id=case when p_payment_display_mode='bank' then p_payment_bank_account_id else null end,
    journal_entry_id=CASE WHEN v_financial_change THEN NULL ELSE inv.journal_entry_id END,
    correction_count=coalesce(correction_count,0)+1,
    updated_at=now() WHERE id=inv.id;

  DELETE FROM public.invoice_items WHERE invoice_id=inv.id;
  INSERT INTO public.invoice_items(invoice_id,product_service_id,description,quantity,unit_price,discount,discount_type,discount_value,unit_price_before_discount,tax_rate_id,tax_amount,line_total,sort_order,hsn_sac)
  SELECT inv.id,product_service_id,description,quantity,unit_price,discount,discount_type,discount_value,unit_price,tax_rate_id,tax_amount,line_total,sort_order,hsn_sac
  FROM pg_temp.mm_invoice_amend_lines ORDER BY sort_order;

  UPDATE public.payments SET customer_id=p_customer_id WHERE invoice_id=inv.id;
  UPDATE public.receipts r SET customer_id=p_customer_id WHERE r.payment_id IN (SELECT p.id FROM public.payments p WHERE p.invoice_id=inv.id);
  IF inv.journal_entry_id IS NOT NULL AND v_financial_change AND EXISTS(SELECT 1 FROM public.businesses WHERE id=inv.business_id AND inventory_enabled) THEN
    SELECT coalesce(p_location_id,(SELECT id FROM public.inventory_locations WHERE business_id=inv.business_id AND is_default AND is_active LIMIT 1)) INTO v_location;
    IF v_location IS NOT NULL THEN
      FOR v_product_row IN
        SELECT l.product_service_id,l.quantity,p.inventory_tracked,l.sort_order,
               nullif(p_items->l.sort_order->>'batch_number','') batch_number,
               nullif(p_items->l.sort_order->>'serial_number','') serial_number
        FROM pg_temp.mm_invoice_amend_lines l JOIN public.products_services p ON p.id=l.product_service_id
        WHERE l.product_service_id IS NOT NULL AND p.inventory_tracked
      LOOP
        SELECT average_cost,quantity_on_hand INTO v_cost,v_stock FROM public.inventory_balances
        WHERE business_id=inv.business_id AND location_id=v_location AND product_service_id=v_product_row.product_service_id FOR UPDATE;
        IF v_cost IS NULL OR v_stock < v_product_row.quantity THEN RAISE EXCEPTION 'Insufficient inventory for product %',v_product_row.product_service_id; END IF;
        v_cogs_total:=v_cogs_total+round(v_product_row.quantity*v_cost,2);
        UPDATE public.inventory_balances SET quantity_on_hand=quantity_on_hand-v_product_row.quantity,updated_at=now()
        WHERE business_id=inv.business_id AND location_id=v_location AND product_service_id=v_product_row.product_service_id;
        INSERT INTO public.inventory_movements(business_id,location_id,product_service_id,movement_type,quantity,unit_cost,reference_type,reference_id,batch_number,serial_number,created_by)
        VALUES(inv.business_id,v_location,v_product_row.product_service_id,'sale',v_product_row.quantity,v_cost,'invoice',inv.id,v_product_row.batch_number,v_product_row.serial_number,auth.uid());
      END LOOP;
    END IF;
  END IF;

  IF inv.journal_entry_id IS NOT NULL AND v_financial_change THEN
    SELECT id INTO v_account_ar FROM public.accounts WHERE business_id=inv.business_id AND code='1100' AND is_active;
    SELECT id INTO v_account_sales FROM public.accounts WHERE business_id=inv.business_id AND code='4000' AND is_active;
    SELECT id INTO v_account_tax FROM public.accounts WHERE business_id=inv.business_id AND code='2100' AND is_active;
    SELECT id INTO v_account_inventory FROM public.accounts WHERE business_id=inv.business_id AND code='1200' AND is_active;
    SELECT id INTO v_account_cogs FROM public.accounts WHERE business_id=inv.business_id AND code='5000' AND is_active;
    IF v_account_ar IS NULL OR v_account_sales IS NULL THEN RAISE EXCEPTION 'Default AR or Sales account is missing'; END IF;

    PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||inv.business_id::text));
    SELECT coalesce(max(entry_number),0)+1 INTO v_journal_number
    FROM public.journal_entries WHERE business_id=inv.business_id;

    INSERT INTO public.journal_entries(
      business_id,entry_number,entry_date,description,source_type,source_id,status,
      created_by,currency_code,total_debit,total_credit,is_system_generated
    ) VALUES(
      inv.business_id,v_journal_number,coalesce(p_invoice_date,inv.invoice_date),
      'Invoice '||inv.invoice_number||' (corrected)','invoice',inv.id,'draft',
      coalesce(inv.created_by,auth.uid()),inv.currency_code,0,0,true
    ) RETURNING id INTO v_journal;

    INSERT INTO public.journal_lines(
      journal_entry_id,account_id,description,debit,credit,currency_code,
      exchange_rate,exchange_rate_source,exchange_rate_timestamp,entity_type,entity_id
    ) VALUES
      (v_journal,v_account_ar,'Invoice receivable',(SELECT total FROM pg_temp.mm_invoice_amend_totals),0,
       inv.currency_code,v_exchange_rate,v_exchange_rate_source,v_exchange_rate_timestamp,'customer',p_customer_id),
      (v_journal,v_account_sales,'Sales revenue',0,
       (SELECT subtotal-discount FROM pg_temp.mm_invoice_amend_totals),inv.currency_code,
       v_exchange_rate,v_exchange_rate_source,v_exchange_rate_timestamp,NULL,NULL);

    IF (SELECT tax FROM pg_temp.mm_invoice_amend_totals)>0 THEN
      IF v_account_tax IS NULL THEN RAISE EXCEPTION 'Output tax account is missing'; END IF;
      INSERT INTO public.journal_lines(
        journal_entry_id,account_id,description,debit,credit,currency_code,
        exchange_rate,exchange_rate_source,exchange_rate_timestamp
      ) VALUES(
        v_journal,v_account_tax,'Output tax',0,
        (SELECT tax FROM pg_temp.mm_invoice_amend_totals),inv.currency_code,
        v_exchange_rate,v_exchange_rate_source,v_exchange_rate_timestamp
      );
    END IF;

    IF v_cogs_total>0 THEN
      IF v_account_cogs IS NULL OR v_account_inventory IS NULL THEN RAISE EXCEPTION 'Inventory accounting accounts are missing'; END IF;
      INSERT INTO public.journal_lines(
        journal_entry_id,account_id,description,debit,credit,currency_code,
        exchange_rate,exchange_rate_source,exchange_rate_timestamp
      ) VALUES
        (v_journal,v_account_cogs,'Cost of goods sold',v_cogs_total,0,inv.currency_code,
         v_exchange_rate,v_exchange_rate_source,v_exchange_rate_timestamp),
        (v_journal,v_account_inventory,'Inventory asset reduction',0,v_cogs_total,inv.currency_code,
         v_exchange_rate,v_exchange_rate_source,v_exchange_rate_timestamp);
    END IF;

    PERFORM public.validate_journal_entry_balance(v_journal);
    UPDATE public.journal_entries SET status='posted',posted_at=now(),posted_by=auth.uid(),updated_at=now()
    WHERE id=v_journal;
    PERFORM public.validate_journal_entry_balance(v_journal);
    UPDATE public.invoices SET journal_entry_id=v_journal,updated_at=now() WHERE id=inv.id;
  END IF;

  UPDATE public.invoices SET
    status=case when v_paid >= (SELECT total FROM pg_temp.mm_invoice_amend_totals) then 'paid'::invoice_status
                when v_paid>0 AND coalesce(p_due_date,inv.due_date)<current_date then 'overdue'::invoice_status
                when v_paid>0 then 'partially_paid'::invoice_status
                when coalesce(p_due_date,inv.due_date)<current_date then 'overdue'::invoice_status
                WHEN inv.journal_entry_id IS NULL THEN 'draft'::invoice_status ELSE 'sent'::invoice_status END,
    updated_at=now() WHERE id=inv.id;
  RETURN inv.id;
END;
$$;


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
