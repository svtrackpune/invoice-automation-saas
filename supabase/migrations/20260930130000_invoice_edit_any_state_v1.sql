-- Allow controlled correction of any non-void invoice, including posted/paid invoices.
-- Corrections keep the same invoice number/id, preserve payment allocations, and
-- rebuild the linked accounting/inventory effects atomically.

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

  IF inv.journal_entry_id IS NOT NULL THEN
    IF NOT mm_private.has_business_permission(inv.business_id,'accounting.adjust') THEN RAISE EXCEPTION 'Accounting adjustment permission required to edit a posted invoice'; END IF;
    PERFORM public.assert_accounting_period_open(inv.business_id,inv.invoice_date);
    PERFORM public.assert_accounting_period_open(inv.business_id,coalesce(p_invoice_date,inv.invoice_date));
  END IF;

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

  IF inv.journal_entry_id IS NOT NULL THEN
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
    updated_at=now() WHERE id=inv.id;

  DELETE FROM public.invoice_items WHERE invoice_id=inv.id;
  INSERT INTO public.invoice_items(invoice_id,product_service_id,description,quantity,unit_price,discount,discount_type,discount_value,unit_price_before_discount,tax_rate_id,tax_amount,line_total,sort_order,hsn_sac)
  SELECT inv.id,product_service_id,description,quantity,unit_price,discount,discount_type,discount_value,unit_price,tax_rate_id,tax_amount,line_total,sort_order,hsn_sac
  FROM pg_temp.mm_invoice_amend_lines ORDER BY sort_order;

  UPDATE public.payments SET customer_id=p_customer_id WHERE invoice_id=inv.id;
  UPDATE public.receipts r SET customer_id=p_customer_id WHERE r.payment_id IN (SELECT p.id FROM public.payments p WHERE p.invoice_id=inv.id);
  IF inv.journal_entry_id IS NOT NULL THEN
    UPDATE public.journal_lines jl SET entity_id=p_customer_id
    WHERE jl.journal_entry_id IN (SELECT p.journal_entry_id FROM public.payments p WHERE p.invoice_id=inv.id) AND jl.entity_type='customer';
  END IF;

  IF inv.journal_entry_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.businesses WHERE id=inv.business_id AND inventory_enabled) THEN
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

  IF inv.journal_entry_id IS NOT NULL THEN
    SELECT id INTO v_account_ar FROM public.accounts WHERE business_id=inv.business_id AND code='1100' AND is_active;
    SELECT id INTO v_account_sales FROM public.accounts WHERE business_id=inv.business_id AND code='4000' AND is_active;
    SELECT id INTO v_account_tax FROM public.accounts WHERE business_id=inv.business_id AND code='2100' AND is_active;
    SELECT id INTO v_account_inventory FROM public.accounts WHERE business_id=inv.business_id AND code='1200' AND is_active;
    SELECT id INTO v_account_cogs FROM public.accounts WHERE business_id=inv.business_id AND code='5000' AND is_active;
    IF v_account_ar IS NULL OR v_account_sales IS NULL THEN RAISE EXCEPTION 'Default AR or Sales account is missing'; END IF;
    v_journal:=inv.journal_entry_id;
    DELETE FROM public.journal_lines WHERE journal_entry_id=v_journal;
    INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id)
    VALUES(v_journal,v_account_ar,(CASE WHEN v_paid>0 THEN 'Invoice receivable' ELSE 'Invoice receivable' END),(SELECT total FROM pg_temp.mm_invoice_amend_totals),0,inv.currency_code,'customer',p_customer_id),
          (v_journal,v_account_sales,'Sales revenue',0,(SELECT subtotal-discount FROM pg_temp.mm_invoice_amend_totals),inv.currency_code,NULL,NULL);
    IF (SELECT tax FROM pg_temp.mm_invoice_amend_totals)>0 THEN
      IF v_account_tax IS NULL THEN RAISE EXCEPTION 'Output tax account is missing'; END IF;
      INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code)
      VALUES(v_journal,v_account_tax,'Output tax',0,(SELECT tax FROM pg_temp.mm_invoice_amend_totals),inv.currency_code);
    END IF;
    IF v_cogs_total>0 THEN
      IF v_account_cogs IS NULL OR v_account_inventory IS NULL THEN RAISE EXCEPTION 'Inventory accounting accounts are missing'; END IF;
      INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code)
      VALUES(v_journal,v_account_cogs,'Cost of goods sold',v_cogs_total,0,inv.currency_code),(v_journal,v_account_inventory,'Inventory asset reduction',0,v_cogs_total,inv.currency_code);
    END IF;
    UPDATE public.journal_entries SET entry_date=coalesce(p_invoice_date,entry_date),description='Invoice '||inv.invoice_number,
      total_debit=(SELECT total FROM pg_temp.mm_invoice_amend_totals)+v_cogs_total,total_credit=(SELECT total FROM pg_temp.mm_invoice_amend_totals)+v_cogs_total,updated_at=now()
    WHERE id=v_journal;
    PERFORM public.validate_journal_entry_balance(v_journal);
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

REVOKE EXECUTE ON FUNCTION public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.update_invoice_any_state(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid,date,uuid,text,uuid) TO authenticated;
