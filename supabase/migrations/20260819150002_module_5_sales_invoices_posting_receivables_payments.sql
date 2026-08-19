-- Moneymatters Module #5: Sales invoices -> posting -> receivables -> payments.
-- Atomic accounting posting, invoice-linked payment allocation, receipts and receivables reporting.

CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS payment_allocations_business_invoice_idx ON public.payment_allocations(business_id,invoice_id);
CREATE INDEX IF NOT EXISTS payment_allocations_payment_idx ON public.payment_allocations(payment_id);

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_allocations_member_all ON public.payment_allocations;
CREATE POLICY payment_allocations_member_all ON public.payment_allocations
FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.businesses b WHERE b.id=payment_allocations.business_id AND mm_private.is_org_member(b.organization_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.businesses b WHERE b.id=payment_allocations.business_id AND mm_private.is_org_member(b.organization_id))
);

CREATE UNIQUE INDEX IF NOT EXISTS journal_invoice_source_uidx ON public.journal_entries(source_id) WHERE source_type='invoice';
CREATE UNIQUE INDEX IF NOT EXISTS journal_payment_source_uidx ON public.journal_entries(source_id) WHERE source_type='payment';

CREATE OR REPLACE VIEW public.sales_receivables_live AS
SELECT
  i.business_id,
  i.id AS invoice_id,
  i.customer_id,
  i.invoice_number,
  i.invoice_date,
  i.due_date,
  i.status,
  i.total,
  i.amount_paid,
  i.balance_due,
  CASE WHEN i.balance_due > 0 AND i.due_date < current_date THEN current_date-i.due_date ELSE 0 END AS days_overdue,
  CASE
    WHEN i.balance_due <= 0 THEN 'paid'
    WHEN i.due_date < current_date THEN 'overdue'
    WHEN i.amount_paid > 0 THEN 'partially_paid'
    ELSE 'open'
  END AS receivable_status
FROM public.invoices i
WHERE i.status <> 'void';
ALTER VIEW public.sales_receivables_live SET (security_invoker=true);

CREATE OR REPLACE FUNCTION public.post_invoice(p_invoice_id uuid,p_location_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','mm_private'
AS $$
DECLARE
  inv public.invoices%rowtype;
  v_entry uuid; v_ar uuid; v_sales uuid; v_tax uuid; v_inventory uuid; v_cogs uuid; v_location uuid;
  v_cogs_total numeric:=0; v_cost numeric; v_qty numeric; v_product record;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT mm_private.has_business_permission(inv.business_id,'accounting.post') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF inv.status='void' THEN RAISE EXCEPTION 'Cannot post a void invoice'; END IF;
  IF inv.journal_entry_id IS NOT NULL THEN RETURN inv.journal_entry_id; END IF;

  PERFORM public.recalculate_invoice_totals(inv.id);
  SELECT * INTO inv FROM public.invoices WHERE id=inv.id FOR UPDATE;

  SELECT id INTO v_ar FROM public.accounts WHERE business_id=inv.business_id AND code='1100' AND is_active;
  SELECT id INTO v_sales FROM public.accounts WHERE business_id=inv.business_id AND code='4000' AND is_active;
  SELECT id INTO v_tax FROM public.accounts WHERE business_id=inv.business_id AND code='2100' AND is_active;
  SELECT id INTO v_inventory FROM public.accounts WHERE business_id=inv.business_id AND code='1200' AND is_active;
  SELECT id INTO v_cogs FROM public.accounts WHERE business_id=inv.business_id AND code='5000' AND is_active;
  IF v_ar IS NULL OR v_sales IS NULL THEN RAISE EXCEPTION 'Default AR or Sales account is missing'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||inv.business_id::text));
  INSERT INTO public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated)
  VALUES(inv.business_id,(SELECT coalesce(max(entry_number),0)+1 FROM public.journal_entries WHERE business_id=inv.business_id),inv.invoice_date,'Invoice '||inv.invoice_number,'invoice',inv.id,'posted',now(),auth.uid(),auth.uid(),inv.currency_code,inv.total,inv.total,true)
  ON CONFLICT DO NOTHING RETURNING id INTO v_entry;

  IF v_entry IS NULL THEN SELECT id INTO v_entry FROM public.journal_entries WHERE source_type='invoice' AND source_id=inv.id LIMIT 1; RETURN v_entry; END IF;

  INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id)
  VALUES(v_entry,v_ar,'Invoice receivable',inv.total,0,inv.currency_code,'customer',inv.customer_id),
        (v_entry,v_sales,'Sales revenue',0,inv.subtotal-inv.discount_total,inv.currency_code,NULL,NULL);
  IF inv.tax_total>0 THEN
    IF v_tax IS NULL THEN RAISE EXCEPTION 'Output tax account is missing'; END IF;
    INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code) VALUES(v_entry,v_tax,'Output tax',0,inv.tax_total,inv.currency_code);
  END IF;

  IF p_location_id IS NULL AND EXISTS(SELECT 1 FROM public.businesses WHERE id=inv.business_id AND inventory_enabled) THEN
    SELECT id INTO v_location FROM public.inventory_locations WHERE business_id=inv.business_id AND is_default AND is_active LIMIT 1;
  ELSE v_location:=p_location_id; END IF;

  IF v_location IS NOT NULL THEN
    FOR v_product IN
      SELECT ii.product_service_id,ii.quantity FROM public.invoice_items ii JOIN public.products_services ps ON ps.id=ii.product_service_id
      WHERE ii.invoice_id=inv.id AND ii.product_service_id IS NOT NULL AND ps.inventory_tracked
    LOOP
      SELECT average_cost,quantity_on_hand INTO v_cost,v_qty FROM public.inventory_balances WHERE business_id=inv.business_id AND location_id=v_location AND product_service_id=v_product.product_service_id FOR UPDATE;
      IF v_cost IS NULL OR v_qty < v_product.quantity THEN RAISE EXCEPTION 'Insufficient inventory for product %',v_product.product_service_id; END IF;
      v_cogs_total:=v_cogs_total+round(v_product.quantity*v_cost,2);
      UPDATE public.inventory_balances SET quantity_on_hand=quantity_on_hand-v_product.quantity,updated_at=now() WHERE business_id=inv.business_id AND location_id=v_location AND product_service_id=v_product.product_service_id;
      INSERT INTO public.inventory_movements(business_id,location_id,product_service_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by)
      VALUES(inv.business_id,v_location,v_product.product_service_id,'sale',v_product.quantity,v_cost,'invoice',inv.id,auth.uid());
    END LOOP;
  END IF;

  IF v_cogs_total>0 THEN
    IF v_cogs IS NULL OR v_inventory IS NULL THEN RAISE EXCEPTION 'Inventory accounting accounts are missing'; END IF;
    INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code)
    VALUES(v_entry,v_cogs,'Cost of goods sold',v_cogs_total,0,inv.currency_code),(v_entry,v_inventory,'Inventory asset reduction',0,v_cogs_total,inv.currency_code);
    UPDATE public.journal_entries SET total_debit=total_debit+v_cogs_total,total_credit=total_credit+v_cogs_total WHERE id=v_entry;
  END IF;

  PERFORM public.validate_journal_entry_balance(v_entry);
  UPDATE public.invoices SET journal_entry_id=v_entry,status=CASE WHEN balance_due<=0 THEN 'paid'::invoice_status WHEN due_date<current_date THEN 'overdue'::invoice_status WHEN amount_paid>0 THEN 'partially_paid'::invoice_status ELSE 'sent'::invoice_status END,updated_at=now() WHERE id=inv.id;
  RETURN v_entry;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.post_invoice(uuid,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.post_invoice(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_customer_payment(
  p_business_id uuid,p_customer_id uuid,p_invoice_id uuid,p_amount numeric,p_method public.payment_method,p_account_id uuid,
  p_reference text DEFAULT NULL,p_gateway_transaction_id text DEFAULT NULL,p_payment_date date DEFAULT current_date,p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','mm_private'
AS $$
DECLARE
  inv public.invoices%rowtype; v_payment uuid; v_receipt uuid; v_entry uuid; v_ar uuid; v_number text; v_allocated numeric;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'payments.receive') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_amount<=0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero'; END IF;
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id AND business_id=p_business_id AND customer_id=p_customer_id FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF inv.status='void' THEN RAISE EXCEPTION 'Cannot pay a void invoice'; END IF;
  IF inv.journal_entry_id IS NULL THEN PERFORM public.post_invoice(inv.id,NULL); SELECT * INTO inv FROM public.invoices WHERE id=inv.id FOR UPDATE; END IF;
  IF p_amount>inv.balance_due THEN RAISE EXCEPTION 'Payment exceeds invoice balance'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_account_id AND business_id=p_business_id AND is_active) THEN RAISE EXCEPTION 'Payment account is invalid'; END IF;
  SELECT id INTO v_ar FROM public.accounts WHERE business_id=p_business_id AND code='1100' AND is_active;
  IF v_ar IS NULL THEN RAISE EXCEPTION 'Accounts receivable account is missing'; END IF;

  INSERT INTO public.payments(business_id,direction,customer_id,invoice_id,account_id,amount,currency_code,payment_date,method,reference,gateway_transaction_id,notes,created_by)
  VALUES(p_business_id,'inbound',p_customer_id,p_invoice_id,p_account_id,p_amount,inv.currency_code,p_payment_date,p_method,p_reference,p_gateway_transaction_id,p_notes,auth.uid()) RETURNING id INTO v_payment;
  INSERT INTO public.payment_allocations(business_id,payment_id,invoice_id,amount) VALUES(p_business_id,v_payment,p_invoice_id,p_amount);

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));
  INSERT INTO public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated)
  VALUES(p_business_id,(SELECT coalesce(max(entry_number),0)+1 FROM public.journal_entries WHERE business_id=p_business_id),p_payment_date,'Payment received for invoice '||inv.invoice_number,'payment',v_payment,'posted',now(),auth.uid(),auth.uid(),inv.currency_code,p_amount,p_amount,true) RETURNING id INTO v_entry;
  INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id)
  VALUES(v_entry,p_account_id,'Customer payment',p_amount,0,inv.currency_code,'customer',p_customer_id),(v_entry,v_ar,'Receivable settlement',0,p_amount,inv.currency_code,'customer',p_customer_id);
  PERFORM public.validate_journal_entry_balance(v_entry);
  UPDATE public.payments SET journal_entry_id=v_entry WHERE id=v_payment;

  SELECT coalesce(sum(pa.amount),0) INTO v_allocated FROM public.payment_allocations pa WHERE pa.invoice_id=inv.id;
  UPDATE public.invoices SET amount_paid=v_allocated,balance_due=greatest(total-v_allocated,0),status=CASE WHEN v_allocated>=total THEN 'paid'::invoice_status WHEN v_allocated>0 AND due_date<current_date THEN 'overdue'::invoice_status WHEN v_allocated>0 THEN 'partially_paid'::invoice_status WHEN due_date<current_date THEN 'overdue'::invoice_status ELSE 'sent'::invoice_status END,updated_at=now() WHERE id=inv.id;

  v_number:=public.next_document_number(p_business_id,'receipt');
  INSERT INTO public.receipts(business_id,customer_id,payment_id,receipt_number,receipt_date,amount,currency_code,payment_method,reference_number,notes,created_by)
  VALUES(p_business_id,p_customer_id,v_payment,v_number,p_payment_date,p_amount,inv.currency_code,p_method::text,p_reference,p_notes,auth.uid()) RETURNING id INTO v_receipt;
  RETURN v_receipt;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_customer_payment(uuid,uuid,uuid,numeric,public.payment_method,uuid,text,text,date,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(uuid,uuid,uuid,numeric,public.payment_method,uuid,text,text,date,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_receipt_for_payment(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','mm_private'
AS $$
DECLARE p public.payments%rowtype; v_receipt uuid; v_number text;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id=p_payment_id;
  IF p.id IS NULL OR p.direction<>'inbound' THEN RAISE EXCEPTION 'Inbound payment not found'; END IF;
  IF NOT mm_private.has_business_permission(p.business_id,'payments.receive') THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT id INTO v_receipt FROM public.receipts WHERE payment_id=p.id LIMIT 1;
  IF v_receipt IS NOT NULL THEN RETURN v_receipt; END IF;
  v_number:=public.next_document_number(p.business_id,'receipt');
  INSERT INTO public.receipts(business_id,customer_id,payment_id,receipt_number,receipt_date,amount,currency_code,payment_method,reference_number,notes,created_by)
  VALUES(p.business_id,p.customer_id,p.id,v_number,p.payment_date,p.amount,p.currency_code,p.method::text,p.reference,p.notes,p.created_by) RETURNING id INTO v_receipt;
  RETURN v_receipt;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_receipt_for_payment(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.generate_receipt_for_payment(uuid) TO authenticated;

CREATE INDEX IF NOT EXISTS invoices_receivables_idx ON public.invoices(business_id,status,due_date,customer_id) WHERE status<>'void';
CREATE INDEX IF NOT EXISTS payments_business_date_idx ON public.payments(business_id,payment_date DESC);
