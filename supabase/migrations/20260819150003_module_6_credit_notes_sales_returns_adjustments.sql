-- Moneymatters Module #6: credit notes / sales returns / invoice adjustments.
-- Posted invoices remain immutable; reductions flow through controlled credit notes.

CREATE TABLE IF NOT EXISTS public.credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE RESTRICT,
  credit_note_number text NOT NULL,
  credit_note_date date NOT NULL DEFAULT current_date,
  reason text NOT NULL,
  currency_code char(3) NOT NULL DEFAULT 'INR',
  subtotal numeric NOT NULL DEFAULT 0,
  discount_total numeric NOT NULL DEFAULT 0,
  tax_total numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','void')),
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,credit_note_number)
);

CREATE TABLE IF NOT EXISTS public.credit_note_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id uuid NOT NULL REFERENCES public.credit_notes(id) ON DELETE CASCADE,
  invoice_item_id uuid REFERENCES public.invoice_items(id) ON DELETE RESTRICT,
  product_service_id uuid REFERENCES public.products_services(id) ON DELETE RESTRICT,
  description text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  tax_rate_id uuid,
  tax_rate numeric NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  line_subtotal numeric NOT NULL DEFAULT 0,
  line_tax numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS credit_notes_business_date_idx ON public.credit_notes(business_id,credit_note_date DESC);
CREATE INDEX IF NOT EXISTS credit_notes_invoice_idx ON public.credit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS credit_note_items_note_idx ON public.credit_note_items(credit_note_id,sort_order);

ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_note_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_notes_member_all ON public.credit_notes;
DROP POLICY IF EXISTS credit_note_items_member_all ON public.credit_note_items;
CREATE POLICY credit_notes_member_all ON public.credit_notes FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.businesses b WHERE b.id=credit_notes.business_id AND mm_private.is_org_member(b.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.businesses b WHERE b.id=credit_notes.business_id AND mm_private.is_org_member(b.organization_id)));
CREATE POLICY credit_note_items_member_all ON public.credit_note_items FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.credit_notes n JOIN public.businesses b ON b.id=n.business_id WHERE n.id=credit_note_items.credit_note_id AND mm_private.is_org_member(b.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.credit_notes n JOIN public.businesses b ON b.id=n.business_id WHERE n.id=credit_note_items.credit_note_id AND mm_private.is_org_member(b.organization_id)));

CREATE OR REPLACE FUNCTION public.recalculate_credit_note_totals(p_credit_note_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','mm_private' AS $$
DECLARE s numeric:=0; t numeric:=0;
BEGIN
  SELECT coalesce(sum(round(quantity*unit_price,2)),0),coalesce(sum(round(quantity*unit_price*tax_rate/100,2)),0) INTO s,t FROM public.credit_note_items WHERE credit_note_id=p_credit_note_id;
  UPDATE public.credit_notes SET subtotal=s,discount_total=0,tax_total=t,total=s+t,updated_at=now() WHERE id=p_credit_note_id;
END; $$;

CREATE OR REPLACE FUNCTION public.create_credit_note(
  p_business_id uuid,p_customer_id uuid,p_invoice_id uuid,p_credit_note_date date,p_reason text,p_items jsonb,p_notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','mm_private' AS $$
DECLARE n uuid; r jsonb; v_num text; v_currency char(3);
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'sales.create') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Credit note requires at least one item'; END IF;
  SELECT currency_code INTO v_currency FROM public.invoices WHERE id=p_invoice_id AND business_id=p_business_id AND customer_id=p_customer_id AND status<>'void';
  IF p_invoice_id IS NOT NULL AND v_currency IS NULL THEN RAISE EXCEPTION 'Source invoice not found'; END IF;
  v_num:=public.next_document_number(p_business_id,'credit_note');
  INSERT INTO public.credit_notes(business_id,customer_id,invoice_id,credit_note_number,credit_note_date,reason,currency_code,notes,created_by)
  VALUES(p_business_id,p_customer_id,p_invoice_id,v_num,p_credit_note_date,p_reason,coalesce(v_currency,'INR'),p_notes,auth.uid()) RETURNING id INTO n;
  FOR r IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.credit_note_items(credit_note_id,invoice_item_id,product_service_id,description,quantity,unit_price,tax_rate,sort_order)
    VALUES(n,NULLIF(r->>'invoice_item_id','')::uuid,NULLIF(r->>'product_service_id','')::uuid,coalesce(r->>'description','Adjustment'),(r->>'quantity')::numeric,(r->>'unit_price')::numeric,coalesce((r->>'tax_rate')::numeric,0),coalesce((r->>'sort_order')::int,0));
  END LOOP;
  PERFORM public.recalculate_credit_note_totals(n);
  RETURN n;
END; $$;

CREATE OR REPLACE FUNCTION public.post_credit_note(p_credit_note_id uuid,p_location_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','mm_private' AS $$
DECLARE n public.credit_notes%rowtype; src public.invoices%rowtype; e uuid; ar uuid; sales uuid; tax uuid; invacct uuid; cogs uuid; loc uuid; cost numeric; qty_on_hand numeric; cogs_total numeric:=0; r record;
BEGIN
  SELECT * INTO n FROM public.credit_notes WHERE id=p_credit_note_id FOR UPDATE;
  IF n.id IS NULL THEN RAISE EXCEPTION 'Credit note not found'; END IF;
  IF NOT mm_private.has_business_permission(n.business_id,'accounting.post') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF n.status='void' THEN RAISE EXCEPTION 'Cannot post a void credit note'; END IF;
  IF n.journal_entry_id IS NOT NULL THEN RETURN n.journal_entry_id; END IF;
  PERFORM public.recalculate_credit_note_totals(n.id); SELECT * INTO n FROM public.credit_notes WHERE id=n.id FOR UPDATE;
  IF n.total<=0 THEN RAISE EXCEPTION 'Credit note total must be greater than zero'; END IF;
  IF n.invoice_id IS NOT NULL THEN
    SELECT * INTO src FROM public.invoices WHERE id=n.invoice_id AND business_id=n.business_id AND customer_id=n.customer_id FOR UPDATE;
    IF src.id IS NULL OR src.status='void' THEN RAISE EXCEPTION 'Source invoice not found'; END IF;
    IF n.total>src.balance_due THEN RAISE EXCEPTION 'Credit note exceeds current invoice balance; refund/customer-credit handling is required instead'; END IF;
  END IF;
  SELECT id INTO ar FROM public.accounts WHERE business_id=n.business_id AND code='1100' AND is_active;
  SELECT id INTO sales FROM public.accounts WHERE business_id=n.business_id AND code='4000' AND is_active;
  SELECT id INTO tax FROM public.accounts WHERE business_id=n.business_id AND code='2100' AND is_active;
  SELECT id INTO invacct FROM public.accounts WHERE business_id=n.business_id AND code='1200' AND is_active;
  SELECT id INTO cogs FROM public.accounts WHERE business_id=n.business_id AND code='5000' AND is_active;
  IF ar IS NULL OR sales IS NULL THEN RAISE EXCEPTION 'Default AR or Sales account is missing'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||n.business_id::text));
  INSERT INTO public.journal_entries(business_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated)
  VALUES(n.business_id,(SELECT coalesce(max(entry_number),0)+1 FROM public.journal_entries WHERE business_id=n.business_id),n.credit_note_date,'Credit note '||n.credit_note_number,'credit_note',n.id,'posted',now(),auth.uid(),auth.uid(),n.currency_code,n.total,n.total,true) RETURNING id INTO e;
  INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id)
  VALUES(e,sales,'Sales reversal',n.subtotal,0,n.currency_code,NULL,NULL),(e,ar,'Customer receivable reduction',0,n.total,n.currency_code,'customer',n.customer_id);
  IF n.tax_total>0 THEN
    IF tax IS NULL THEN RAISE EXCEPTION 'Output tax account is missing'; END IF;
    INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code) VALUES(e,tax,'Output tax reversal',n.tax_total,0,n.currency_code);
  END IF;
  IF p_location_id IS NULL AND EXISTS(SELECT 1 FROM public.businesses WHERE id=n.business_id AND inventory_enabled) THEN SELECT id INTO loc FROM public.inventory_locations WHERE business_id=n.business_id AND is_default AND is_active LIMIT 1; ELSE loc:=p_location_id; END IF;
  IF loc IS NOT NULL THEN
    FOR r IN SELECT cni.product_service_id,cni.quantity FROM public.credit_note_items cni JOIN public.products_services ps ON ps.id=cni.product_service_id WHERE cni.credit_note_id=n.id AND cni.product_service_id IS NOT NULL AND ps.inventory_tracked LOOP
      SELECT average_cost,quantity_on_hand INTO cost,qty_on_hand FROM public.inventory_balances WHERE business_id=n.business_id AND location_id=loc AND product_service_id=r.product_service_id FOR UPDATE;
      IF cost IS NULL THEN RAISE EXCEPTION 'Inventory balance not found for returned product %',r.product_service_id; END IF;
      cogs_total:=cogs_total+round(r.quantity*cost,2);
      UPDATE public.inventory_balances SET quantity_on_hand=quantity_on_hand+r.quantity,updated_at=now() WHERE business_id=n.business_id AND location_id=loc AND product_service_id=r.product_service_id;
      INSERT INTO public.inventory_movements(business_id,location_id,product_service_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by) VALUES(n.business_id,loc,r.product_service_id,'sale_return',r.quantity,cost,'credit_note',n.id,auth.uid());
    END LOOP;
  END IF;
  IF cogs_total>0 THEN
    IF cogs IS NULL OR invacct IS NULL THEN RAISE EXCEPTION 'Inventory accounting accounts are missing'; END IF;
    INSERT INTO public.journal_lines(journal_entry_id,account_id,description,debit,credit,currency_code) VALUES(e,invacct,'Inventory returned',cogs_total,0,n.currency_code),(e,cogs,'Cost of goods sold reversal',0,cogs_total,n.currency_code);
    UPDATE public.journal_entries SET total_debit=total_debit+cogs_total,total_credit=total_credit+cogs_total WHERE id=e;
  END IF;
  PERFORM public.validate_journal_entry_balance(e);
  UPDATE public.credit_notes SET journal_entry_id=e,status='posted',updated_at=now() WHERE id=n.id;
  IF n.invoice_id IS NOT NULL THEN
    UPDATE public.invoices SET balance_due=greatest(balance_due-n.total,0),status=CASE WHEN greatest(balance_due-n.total,0)<=0 THEN 'paid'::invoice_status WHEN due_date<current_date THEN 'overdue'::invoice_status WHEN amount_paid>0 THEN 'partially_paid'::invoice_status ELSE 'sent'::invoice_status END,updated_at=now() WHERE id=n.invoice_id;
  END IF;
  RETURN e;
END; $$;

REVOKE EXECUTE ON FUNCTION public.create_credit_note(uuid,uuid,uuid,date,text,jsonb,text) FROM public,anon;
REVOKE EXECUTE ON FUNCTION public.post_credit_note(uuid,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_credit_note(uuid,uuid,uuid,date,text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_credit_note(uuid,uuid) TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS journal_credit_note_source_uidx ON public.journal_entries(source_id) WHERE source_type='credit_note';
CREATE INDEX IF NOT EXISTS credit_notes_receivables_idx ON public.credit_notes(business_id,customer_id,status,credit_note_date DESC);
