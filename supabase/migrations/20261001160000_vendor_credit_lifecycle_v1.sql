BEGIN;

ALTER TABLE public.vendor_credit_ledger
  ADD COLUMN IF NOT EXISTS bill_id uuid REFERENCES public.bills(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS vendor_credit_ledger_bill_idx
  ON public.vendor_credit_ledger(business_id,vendor_id,bill_id,created_at DESC);

DROP POLICY IF EXISTS vendor_credits_member_all ON public.vendor_credits;
DROP POLICY IF EXISTS vendor_credit_items_member_all ON public.vendor_credit_items;
DROP POLICY IF EXISTS vendor_credit_ledger_access ON public.vendor_credit_ledger;
DROP POLICY IF EXISTS vendor_credits_select ON public.vendor_credits;
DROP POLICY IF EXISTS vendor_credit_items_select ON public.vendor_credit_items;
DROP POLICY IF EXISTS vendor_credit_ledger_select ON public.vendor_credit_ledger;

ALTER TABLE public.vendor_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_credit_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_credit_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_credits_select
  ON public.vendor_credits
  FOR SELECT TO authenticated
  USING (mm_private.has_business_permission(business_id,'accounting.view'));

CREATE POLICY vendor_credit_items_select
  ON public.vendor_credit_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.vendor_credits vc
      WHERE vc.id=vendor_credit_items.vendor_credit_id
        AND mm_private.has_business_permission(vc.business_id,'accounting.view')
    )
  );

CREATE POLICY vendor_credit_ledger_select
  ON public.vendor_credit_ledger
  FOR SELECT TO authenticated
  USING (mm_private.has_business_permission(business_id,'accounting.view'));

CREATE OR REPLACE FUNCTION public.vendor_credit_balance(
  p_business_id uuid,p_vendor_id uuid
) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,mm_private AS $$
  SELECT coalesce(sum(vcl.amount),0)
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.business_id=p_business_id
    AND vcl.vendor_id=p_vendor_id;
$$;

CREATE OR REPLACE FUNCTION public.vendor_credit_available(
  p_business_id uuid,p_vendor_credit_id uuid
) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,mm_private AS $$
  SELECT coalesce(sum(vcl.amount),0)
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.business_id=p_business_id
    AND vcl.vendor_credit_id=p_vendor_credit_id;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_bill_settlement_state(
  p_bill_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  b public.bills%rowtype;
  v_paid numeric:=0;
  v_credit_applied numeric:=0;
  v_settled numeric:=0;
BEGIN
  SELECT * INTO b FROM public.bills WHERE id=p_bill_id FOR UPDATE;
  IF b.id IS NULL THEN RETURN; END IF;

  SELECT coalesce(sum(vpa.amount),0)
    INTO v_paid
  FROM public.vendor_payment_allocations vpa
  WHERE vpa.bill_id=b.id;

  SELECT greatest(-coalesce(sum(vcl.amount) FILTER (WHERE vcl.entry_type='application'),0),0)
    INTO v_credit_applied
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.bill_id=b.id;

  v_settled:=greatest(v_paid+v_credit_applied,0);

  UPDATE public.bills
  SET amount_paid=least(total,v_paid),
      balance_due=greatest(total-v_settled,0),
      status=CASE
        WHEN status='void' THEN 'void'::bill_status
        WHEN journal_entry_id IS NULL THEN 'draft'::bill_status
        WHEN v_settled>=total THEN 'paid'::bill_status
        WHEN v_settled>0 AND due_date<current_date THEN 'overdue'::bill_status
        WHEN v_settled>0 THEN 'partially_paid'::bill_status
        WHEN due_date<current_date THEN 'overdue'::bill_status
        ELSE 'received'::bill_status
      END,
      updated_at=now()
  WHERE id=b.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_bill_settlement_state_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
BEGIN
  IF pg_trigger_depth()>1 THEN
    RETURN COALESCE(NEW,OLD);
  END IF;

  IF TG_TABLE_NAME='vendor_payment_allocations' THEN
    PERFORM public.recalculate_bill_settlement_state(COALESCE(NEW.bill_id,OLD.bill_id));
  ELSIF TG_TABLE_NAME='vendor_credit_ledger' THEN
    IF COALESCE(NEW.bill_id,OLD.bill_id) IS NOT NULL THEN
      PERFORM public.recalculate_bill_settlement_state(COALESCE(NEW.bill_id,OLD.bill_id));
    END IF;
  ELSIF TG_TABLE_NAME='bills' THEN
    PERFORM public.recalculate_bill_settlement_state(COALESCE(NEW.id,OLD.id));
  END IF;

  RETURN COALESCE(NEW,OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_vendor_payment_allocation_settlement_sync ON public.vendor_payment_allocations;
CREATE TRIGGER trg_vendor_payment_allocation_settlement_sync
AFTER INSERT OR UPDATE OR DELETE ON public.vendor_payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.sync_bill_settlement_state_trigger();

DROP TRIGGER IF EXISTS trg_vendor_credit_ledger_settlement_sync ON public.vendor_credit_ledger;
CREATE TRIGGER trg_vendor_credit_ledger_settlement_sync
AFTER INSERT OR UPDATE OR DELETE ON public.vendor_credit_ledger
FOR EACH ROW EXECUTE FUNCTION public.sync_bill_settlement_state_trigger();

DROP TRIGGER IF EXISTS trg_bill_settlement_sync ON public.bills;
CREATE TRIGGER trg_bill_settlement_sync
AFTER UPDATE ON public.bills
FOR EACH ROW EXECUTE FUNCTION public.sync_bill_settlement_state_trigger();

CREATE OR REPLACE FUNCTION public.guard_vendor_payment_allocation_net_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  b public.bills%rowtype;
  v_other_paid numeric:=0;
  v_applied_credit numeric:=0;
  v_new_total numeric:=0;
BEGIN
  SELECT * INTO b FROM public.bills WHERE id=NEW.bill_id FOR UPDATE;
  IF b.id IS NULL OR b.status='void' THEN
    RAISE EXCEPTION 'Purchase bill is not available for payment allocation';
  END IF;

  SELECT coalesce(sum(vpa.amount),0)
    INTO v_other_paid
  FROM public.vendor_payment_allocations vpa
  WHERE vpa.bill_id=b.id
    AND (TG_OP='INSERT' OR vpa.id<>NEW.id);

  SELECT greatest(-coalesce(sum(vcl.amount) FILTER (WHERE vcl.entry_type='application'),0),0)
    INTO v_applied_credit
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.bill_id=b.id;

  v_new_total:=v_other_paid+NEW.amount+v_applied_credit;

  IF v_new_total>b.total+0.005 THEN
    RAISE EXCEPTION 'Supplier settlement would exceed bill total after vendor credits. Reduce the payment/allocation first.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendor_payment_allocation_net_guard ON public.vendor_payment_allocations;
CREATE TRIGGER trg_vendor_payment_allocation_net_guard
BEFORE INSERT OR UPDATE ON public.vendor_payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_payment_allocation_net_balance();

CREATE OR REPLACE FUNCTION public.create_vendor_credit(
  p_business_id uuid,
  p_vendor_id uuid,
  p_bill_id uuid,
  p_credit_date date,
  p_reason text,
  p_items jsonb,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  idd uuid;
  r jsonb;
  num text;
  cur char(3):='INR';
  v_subtotal numeric:=0;
  v_tax numeric:=0;
  v_total numeric:=0;
  v_bill public.bills%rowtype;
  v_item_qty numeric;
  v_item_price numeric;
  v_tax_rate numeric;
  v_bill_item public.bill_items%rowtype;
  v_source_base_unit numeric;
  v_source_tax_unit numeric;
  v_already_credited numeric;
  v_line_subtotal numeric;
  v_line_tax numeric;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'purchases.manage') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;

  IF nullif(trim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'Supplier credit reason is required';
  END IF;

  IF p_bill_id IS NOT NULL THEN
    SELECT * INTO v_bill
    FROM public.bills
    WHERE id=p_bill_id
      AND business_id=p_business_id
      AND vendor_id=p_vendor_id
      AND status<>'void'
    FOR UPDATE;

    IF v_bill.id IS NULL THEN
      RAISE EXCEPTION 'Source bill not found';
    END IF;

    IF v_bill.journal_entry_id IS NULL THEN
      RAISE EXCEPTION 'Post the source purchase bill before creating a supplier credit';
    END IF;

    IF p_credit_date<v_bill.bill_date THEN
      RAISE EXCEPTION 'Supplier credit date cannot be before the source bill date';
    END IF;

    cur:=v_bill.currency_code;
  END IF;

  PERFORM public.assert_accounting_period_open(p_business_id,p_credit_date);

  num:=public.next_document_number(p_business_id,'vendor_credit');

  INSERT INTO public.vendor_credits(
    business_id,vendor_id,bill_id,credit_number,credit_date,reason,currency_code,notes,created_by
  ) VALUES(
    p_business_id,p_vendor_id,p_bill_id,num,p_credit_date,p_reason,cur,p_notes,auth.uid()
  ) RETURNING id INTO idd;

  FOR r IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_qty:=coalesce((r->>'quantity')::numeric,0);
    v_item_price:=coalesce((r->>'unit_price')::numeric,0);
    v_tax_rate:=coalesce((r->>'tax_rate')::numeric,0);

    IF v_item_qty<=0 OR v_item_price<0 OR v_tax_rate<0 OR v_tax_rate>100 THEN
      RAISE EXCEPTION 'Invalid supplier credit item';
    END IF;

    IF nullif(r->>'bill_item_id','') IS NOT NULL THEN
      IF p_bill_id IS NULL THEN
        RAISE EXCEPTION 'A source bill item requires a source purchase bill';
      END IF;

      SELECT * INTO v_bill_item
      FROM public.bill_items bi
      WHERE bi.id=(r->>'bill_item_id')::uuid
        AND bi.bill_id=p_bill_id
      FOR UPDATE;

      IF v_bill_item.id IS NULL THEN
        RAISE EXCEPTION 'Supplier credit bill item does not belong to the source bill';
      END IF;

      IF nullif(r->>'product_service_id','') IS NOT NULL
         AND (r->>'product_service_id')::uuid IS DISTINCT FROM v_bill_item.product_service_id THEN
        RAISE EXCEPTION 'Supplier credit product does not match the source bill item';
      END IF;

      SELECT coalesce(sum(vci.quantity),0)
        INTO v_already_credited
      FROM public.vendor_credit_items vci
      JOIN public.vendor_credits vc ON vc.id=vci.vendor_credit_id
      WHERE vci.bill_item_id=v_bill_item.id
        AND vc.status='posted';

      IF v_item_qty>greatest(v_bill_item.quantity-v_already_credited,0)+0.000001 THEN
        RAISE EXCEPTION 'Supplier credit quantity exceeds the uncredited source quantity';
      END IF;

      v_source_base_unit:=round(
        greatest(coalesce(v_bill_item.line_total,0)-coalesce(v_bill_item.tax_amount,0),0)
        / nullif(v_bill_item.quantity,0),6
      );
      v_source_tax_unit:=round(
        greatest(coalesce(v_bill_item.tax_amount,0),0)
        / nullif(v_bill_item.quantity,0),6
      );

      v_line_subtotal:=round(v_item_qty*v_source_base_unit,2);
      v_line_tax:=round(v_item_qty*v_source_tax_unit,2);
      v_tax_rate:=CASE
        WHEN v_source_base_unit>0 THEN round(v_source_tax_unit/v_source_base_unit*100,6)
        ELSE 0
      END;
      v_item_price:=v_source_base_unit;
    ELSE
      v_line_subtotal:=round(v_item_qty*v_item_price,2);
      v_line_tax:=round(v_line_subtotal*v_tax_rate/100,2);
    END IF;

    IF nullif(r->>'product_service_id','') IS NOT NULL
       AND NOT EXISTS(
         SELECT 1 FROM public.products_services ps
         WHERE ps.id=(r->>'product_service_id')::uuid
           AND ps.business_id=p_business_id
           AND ps.is_active
       ) THEN
      RAISE EXCEPTION 'Product/service is invalid for this business';
    END IF;

    INSERT INTO public.vendor_credit_items(
      vendor_credit_id,bill_item_id,product_service_id,description,quantity,unit_price,
      tax_rate,line_subtotal,line_tax,line_total,sort_order
    ) VALUES(
      idd,
      nullif(r->>'bill_item_id','')::uuid,
      nullif(r->>'product_service_id','')::uuid,
      coalesce(nullif(trim(r->>'description'),''),'Purchase return / supplier adjustment'),
      v_item_qty,
      v_item_price,
      v_tax_rate,
      v_line_subtotal,
      v_line_tax,
      round(v_line_subtotal+v_line_tax,2),
      coalesce((r->>'sort_order')::int,0)
    );

    v_subtotal:=v_subtotal+v_line_subtotal;
    v_tax:=v_tax+v_line_tax;
  END LOOP;

  v_total:=round(v_subtotal+v_tax,2);
  IF v_total<=0 THEN
    RAISE EXCEPTION 'Supplier credit total must be greater than zero';
  END IF;

  UPDATE public.vendor_credits
  SET subtotal=round(v_subtotal,2),
      tax_total=round(v_tax,2),
      total=v_total,
      updated_at=now()
  WHERE id=idd;

  RETURN idd;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_vendor_credit(
  p_vendor_credit_id uuid,
  p_location_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  n public.vendor_credits%rowtype;
  src public.bills%rowtype;
  e uuid;
  ap uuid;
  inventory_acct uuid;
  input_tax uuid;
  expense_acct uuid;
  loc uuid;
  line record;
  post_tax numeric;
  base numeric;
  old_qty numeric;
  old_cost numeric;
  unit_cost numeric;
  v_paid numeric:=0;
  v_credit_applied numeric:=0;
  v_outstanding numeric:=0;
  v_apply numeric:=0;
  tax_registered boolean:=false;
  tax_creditable boolean:=false;
  entry_number bigint;
BEGIN
  SELECT * INTO n FROM public.vendor_credits WHERE id=p_vendor_credit_id FOR UPDATE;
  IF n.id IS NULL THEN RAISE EXCEPTION 'Supplier credit not found'; END IF;

  IF NOT mm_private.has_business_permission(n.business_id,'accounting.post') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF n.status='void' THEN
    RAISE EXCEPTION 'Cannot post a void supplier credit';
  END IF;

  IF n.journal_entry_id IS NOT NULL THEN
    RETURN n.journal_entry_id;
  END IF;

  PERFORM public.assert_accounting_period_open(n.business_id,n.credit_date);

  SELECT * INTO src
  FROM public.bills
  WHERE id=n.bill_id
    AND business_id=n.business_id
    AND vendor_id=n.vendor_id
  FOR UPDATE;

  IF n.bill_id IS NOT NULL AND src.id IS NULL THEN
    RAISE EXCEPTION 'Source purchase bill not found';
  END IF;

  IF n.bill_id IS NOT NULL AND src.status='void' THEN
    RAISE EXCEPTION 'Cannot post a supplier credit against a void bill';
  END IF;

  IF n.bill_id IS NOT NULL AND src.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Source purchase bill must be posted before the supplier credit';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||n.business_id::text));

  SELECT coalesce(sum(vci.line_subtotal),0),
         coalesce(sum(vci.line_tax),0),
         coalesce(sum(vci.line_total),0)
    INTO n.subtotal,n.tax_total,n.total
  FROM public.vendor_credit_items vci
  WHERE vci.vendor_credit_id=n.id;

  IF n.total<=0 THEN
    RAISE EXCEPTION 'Supplier credit total must be greater than zero';
  END IF;

  UPDATE public.vendor_credits
  SET subtotal=round(n.subtotal,2),
      tax_total=round(n.tax_total,2),
      total=round(n.total,2),
      updated_at=now()
  WHERE id=n.id;

  SELECT coalesce(bp.tax_regime='GST',false),
         coalesce(bp.tax_regime='GST' AND bp.gst_registration_type<>'COMPOSITION',false)
    INTO tax_registered,tax_creditable
  FROM public.business_tax_profiles bp
  WHERE bp.business_id=n.business_id;

  SELECT id INTO ap
  FROM public.accounts
  WHERE business_id=n.business_id AND code='2000' AND is_active;

  SELECT id INTO inventory_acct
  FROM public.accounts
  WHERE business_id=n.business_id AND code='1200' AND is_active;

  SELECT id INTO input_tax
  FROM public.accounts
  WHERE business_id=n.business_id AND code='1300' AND is_active;

  SELECT id INTO expense_acct
  FROM public.accounts
  WHERE business_id=n.business_id AND code='6000' AND is_active;

  IF ap IS NULL THEN
    RAISE EXCEPTION 'Accounts Payable account is missing';
  END IF;

  IF tax_registered AND tax_creditable AND n.tax_total>0 AND input_tax IS NULL THEN
    RAISE EXCEPTION 'Input GST account (1300) is missing';
  END IF;

  IF p_location_id IS NOT NULL THEN
    SELECT id INTO loc
    FROM public.inventory_locations
    WHERE id=p_location_id AND business_id=n.business_id AND is_active;
    IF loc IS NULL THEN RAISE EXCEPTION 'Inventory location is invalid'; END IF;
  ELSE
    SELECT id INTO loc
    FROM public.inventory_locations
    WHERE business_id=n.business_id AND is_default AND is_active
    LIMIT 1;
  END IF;

  entry_number:=(
    SELECT coalesce(max(je.entry_number),0)+1
    FROM public.journal_entries je
    WHERE je.business_id=n.business_id
  );

  INSERT INTO public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,status,
    posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
  ) VALUES(
    n.business_id,entry_number,n.credit_date,'Supplier credit '||n.credit_number,
    'vendor_credit',n.id,'posted',now(),auth.uid(),auth.uid(),
    n.currency_code,n.total,n.total,true
  ) RETURNING id INTO e;

  FOR line IN
    SELECT vci.*,ps.inventory_tracked,ps.purchase_price,ps.expense_account_id
    FROM public.vendor_credit_items vci
    LEFT JOIN public.products_services ps ON ps.id=vci.product_service_id
    WHERE vci.vendor_credit_id=n.id
    ORDER BY vci.sort_order
  LOOP
    post_tax:=CASE
      WHEN tax_registered AND tax_creditable THEN round(coalesce(line.line_tax,0),2)
      ELSE 0
    END;
    base:=round(coalesce(line.line_total,0)-post_tax,2);

    IF coalesce(line.inventory_tracked,false) AND inventory_acct IS NOT NULL AND loc IS NOT NULL THEN
      SELECT quantity_on_hand,average_cost
      INTO old_qty,old_cost
      FROM public.inventory_balances
      WHERE business_id=n.business_id
        AND location_id=loc
        AND product_service_id=line.product_service_id
      FOR UPDATE;

      IF coalesce(old_qty,0)+0.000001<line.quantity THEN
        RAISE EXCEPTION 'Cannot post supplier credit because current stock is below the return quantity for product %',line.product_service_id;
      END IF;

      unit_cost:=coalesce(line.line_subtotal/nullif(line.quantity,0),line.purchase_price,old_cost,0);

      INSERT INTO public.journal_lines(
        journal_entry_id,account_id,description,debit,credit,currency_code
      ) VALUES(
        e,inventory_acct,line.description,0,base,n.currency_code
      );

      UPDATE public.inventory_balances
      SET quantity_on_hand=greatest(quantity_on_hand-line.quantity,0),
          updated_at=now()
      WHERE business_id=n.business_id
        AND location_id=loc
        AND product_service_id=line.product_service_id;

      INSERT INTO public.inventory_movements(
        business_id,location_id,product_service_id,movement_type,quantity,unit_cost,
        reference_type,reference_id,notes,created_by
      ) VALUES(
        n.business_id,loc,line.product_service_id,'purchase_return',line.quantity,unit_cost,
        'vendor_credit',n.id,'Supplier credit / purchase return',auth.uid()
      );
    ELSE
      IF coalesce(line.expense_account_id,expense_acct,inventory_acct) IS NULL THEN
        RAISE EXCEPTION 'No expense or inventory account is available for supplier credit line %',line.description;
      END IF;

      INSERT INTO public.journal_lines(
        journal_entry_id,account_id,description,debit,credit,currency_code
      ) VALUES(
        e,coalesce(line.expense_account_id,expense_acct,inventory_acct),
        line.description,0,base,n.currency_code
      );
    END IF;

    IF post_tax>0 THEN
      INSERT INTO public.journal_lines(
        journal_entry_id,account_id,description,debit,credit,currency_code
      ) VALUES(
        e,input_tax,'Input GST reversal',0,post_tax,n.currency_code
      );
    END IF;
  END LOOP;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code
  ) VALUES(e,ap,'Accounts payable reduction',n.total,0,n.currency_code);

  PERFORM public.validate_journal_entry_balance(e);

  INSERT INTO public.vendor_credit_ledger(
    business_id,vendor_id,vendor_credit_id,bill_id,entry_type,amount,currency_code,
    description,created_by
  ) VALUES(
    n.business_id,n.vendor_id,n.id,n.bill_id,'credit_note',n.total,n.currency_code,
    'Posted supplier credit '||n.credit_number,auth.uid()
  );

  IF n.bill_id IS NOT NULL THEN
    SELECT coalesce(sum(vpa.amount),0)
      INTO v_paid
    FROM public.vendor_payment_allocations vpa
    WHERE vpa.bill_id=n.bill_id;

    SELECT greatest(-coalesce(sum(vcl.amount) FILTER (WHERE vcl.entry_type='application'),0),0)
      INTO v_credit_applied
    FROM public.vendor_credit_ledger vcl
    WHERE vcl.bill_id=n.bill_id;

    v_outstanding:=greatest(src.total-v_paid-v_credit_applied,0);
    v_apply:=least(n.total,v_outstanding);

    IF v_apply>0 THEN
      INSERT INTO public.vendor_credit_ledger(
        business_id,vendor_id,vendor_credit_id,bill_id,entry_type,amount,
        currency_code,description,created_by
      ) VALUES(
        n.business_id,n.vendor_id,n.id,n.bill_id,'application',-v_apply,
        n.currency_code,'Applied to source purchase bill '||src.bill_number,auth.uid()
      );
    END IF;

    PERFORM public.recalculate_bill_settlement_state(n.bill_id);
  END IF;

  UPDATE public.vendor_credits
  SET journal_entry_id=e,status='posted',updated_at=now()
  WHERE id=n.id;

  RETURN e;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_vendor_credit_to_bill(
  p_business_id uuid,
  p_vendor_credit_id uuid,
  p_bill_id uuid,
  p_amount numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  vc public.vendor_credits%rowtype;
  b public.bills%rowtype;
  available numeric:=0;
  paid numeric:=0;
  applied numeric:=0;
  outstanding numeric:=0;
  v_entry uuid;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'accounting.adjust') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_amount<=0 THEN
    RAISE EXCEPTION 'Application amount must be greater than zero';
  END IF;

  SELECT * INTO vc
  FROM public.vendor_credits
  WHERE id=p_vendor_credit_id AND business_id=p_business_id
  FOR UPDATE;

  IF vc.id IS NULL OR vc.status<>'posted' THEN
    RAISE EXCEPTION 'Posted supplier credit not found';
  END IF;

  SELECT * INTO b
  FROM public.bills
  WHERE id=p_bill_id AND business_id=p_business_id AND vendor_id=vc.vendor_id
  FOR UPDATE;

  IF b.id IS NULL OR b.status='void' THEN
    RAISE EXCEPTION 'Target purchase bill not found or void';
  END IF;
  IF b.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Target purchase bill must be posted';
  END IF;

  SELECT coalesce(sum(vcl.amount),0)
    INTO available
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.vendor_credit_id=vc.id;

  IF available+0.005<p_amount THEN
    RAISE EXCEPTION 'Application exceeds available supplier credit';
  END IF;

  SELECT coalesce(sum(vpa.amount),0)
    INTO paid
  FROM public.vendor_payment_allocations vpa
  WHERE vpa.bill_id=b.id;

  SELECT greatest(-coalesce(sum(vcl.amount) FILTER (WHERE vcl.entry_type='application'),0),0)
    INTO applied
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.bill_id=b.id;

  outstanding:=greatest(b.total-paid-applied,0);

  IF p_amount>outstanding+0.005 THEN
    RAISE EXCEPTION 'Application exceeds the target purchase bill balance';
  END IF;

  INSERT INTO public.vendor_credit_ledger(
    business_id,vendor_id,vendor_credit_id,bill_id,entry_type,amount,
    currency_code,description,created_by
  ) VALUES(
    p_business_id,vc.vendor_id,vc.id,b.id,'application',-p_amount,
    vc.currency_code,'Applied to purchase bill '||b.bill_number,auth.uid()
  ) RETURNING id INTO v_entry;

  PERFORM public.recalculate_bill_settlement_state(b.id);
  RETURN v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_vendor_refund(
  p_business_id uuid,
  p_vendor_id uuid,
  p_vendor_credit_id uuid,
  p_amount numeric,
  p_method text,
  p_account_id uuid,
  p_reference text DEFAULT NULL,
  p_refund_date date DEFAULT current_date,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  vc public.vendor_credits%rowtype;
  available numeric:=0;
  pmt uuid;
  e uuid;
  ap uuid;
  method_value public.payment_method;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'payments.receive') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_amount<=0 THEN
    RAISE EXCEPTION 'Refund amount must be greater than zero';
  END IF;

  SELECT * INTO vc
  FROM public.vendor_credits
  WHERE id=p_vendor_credit_id
    AND business_id=p_business_id
    AND vendor_id=p_vendor_id
  FOR UPDATE;

  IF vc.id IS NULL OR vc.status<>'posted' THEN
    RAISE EXCEPTION 'Posted supplier credit not found';
  END IF;

  PERFORM public.assert_accounting_period_open(p_business_id,p_refund_date);

  SELECT coalesce(sum(vcl.amount),0)
    INTO available
  FROM public.vendor_credit_ledger vcl
  WHERE vcl.vendor_credit_id=vc.id;

  IF available+0.005<p_amount THEN
    RAISE EXCEPTION 'Refund exceeds available supplier credit';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.accounts
    WHERE id=p_account_id
      AND business_id=p_business_id
      AND is_active
      AND account_subtype IN ('cash','bank')
  ) THEN
    RAISE EXCEPTION 'Refund account must be an active Cash or Bank account';
  END IF;

  method_value:=CASE
    WHEN lower(p_method)='gateway' THEN 'payment_gateway'::payment_method
    ELSE lower(p_method)::payment_method
  END;

  SELECT id INTO ap
  FROM public.accounts
  WHERE business_id=p_business_id AND code='2000' AND is_active;

  IF ap IS NULL THEN
    RAISE EXCEPTION 'Accounts payable account is missing';
  END IF;

  INSERT INTO public.payments(
    business_id,direction,vendor_id,account_id,amount,currency_code,payment_date,
    method,reference,notes,created_by
  ) VALUES(
    p_business_id,'inbound',p_vendor_id,p_account_id,p_amount,vc.currency_code,
    p_refund_date,method_value,nullif(trim(p_reference),''),p_notes,auth.uid()
  ) RETURNING id INTO pmt;

  PERFORM pg_advisory_xact_lock(hashtext('journal-entry-number:'||p_business_id::text));

  INSERT INTO public.journal_entries(
    business_id,entry_number,entry_date,description,source_type,source_id,status,
    posted_at,posted_by,created_by,currency_code,total_debit,total_credit,is_system_generated
  ) VALUES(
    p_business_id,
    (SELECT coalesce(max(entry_number),0)+1
     FROM public.journal_entries
     WHERE business_id=p_business_id),
    p_refund_date,
    'Supplier refund for credit '||vc.credit_number,
    'vendor_refund',
    pmt,
    'posted',
    now(),auth.uid(),auth.uid(),
    vc.currency_code,p_amount,p_amount,true
  ) RETURNING id INTO e;

  INSERT INTO public.journal_lines(
    journal_entry_id,account_id,description,debit,credit,currency_code,entity_type,entity_id
  ) VALUES(
    e,p_account_id,'Supplier refund received',p_amount,0,vc.currency_code,'vendor',p_vendor_id
  ),(
    e,ap,'Accounts payable settlement of supplier credit',0,p_amount,vc.currency_code,'vendor',p_vendor_id
  );

  PERFORM public.validate_journal_entry_balance(e);

  INSERT INTO public.vendor_credit_ledger(
    business_id,vendor_id,payment_id,vendor_credit_id,entry_type,amount,
    currency_code,description,created_by
  ) VALUES(
    p_business_id,p_vendor_id,pmt,vc.id,'refund',-p_amount,vc.currency_code,
    'Supplier refund received',auth.uid()
  );

  UPDATE public.payments
  SET journal_entry_id=e,updated_at=now()
  WHERE id=pmt;

  RETURN pmt;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_and_post_vendor_credit(
  p_business_id uuid,
  p_vendor_id uuid,
  p_bill_id uuid,
  p_credit_date date,
  p_reason text,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE
  v_credit_id uuid;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'purchases.manage')
     OR NOT mm_private.has_business_permission(p_business_id,'accounting.post') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_credit_id:=public.create_vendor_credit(
    p_business_id,p_vendor_id,p_bill_id,p_credit_date,p_reason,p_items,p_notes
  );

  PERFORM public.post_vendor_credit(v_credit_id,p_location_id);

  RETURN v_credit_id;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS journal_vendor_credit_source_uidx
  ON public.journal_entries(source_id)
  WHERE source_type='vendor_credit';

REVOKE ALL ON FUNCTION public.vendor_credit_balance(uuid,uuid) FROM public,anon;
REVOKE ALL ON FUNCTION public.vendor_credit_available(uuid,uuid) FROM public,anon;
REVOKE EXECUTE ON FUNCTION public.create_vendor_credit(uuid,uuid,uuid,date,text,jsonb,text) FROM public,anon;
REVOKE EXECUTE ON FUNCTION public.post_vendor_credit(uuid,uuid) FROM public,anon;
REVOKE EXECUTE ON FUNCTION public.apply_vendor_credit_to_bill(uuid,uuid,uuid,numeric) FROM public,anon;
REVOKE EXECUTE ON FUNCTION public.receive_vendor_refund(uuid,uuid,uuid,numeric,text,uuid,text,date,text) FROM public,anon;
REVOKE EXECUTE ON FUNCTION public.create_and_post_vendor_credit(uuid,uuid,uuid,date,text,jsonb,text,uuid) FROM public,anon;

GRANT EXECUTE ON FUNCTION public.vendor_credit_balance(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_credit_available(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_vendor_credit(uuid,uuid,uuid,date,text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_vendor_credit(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_vendor_credit_to_bill(uuid,uuid,uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_vendor_refund(uuid,uuid,uuid,numeric,text,uuid,text,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_and_post_vendor_credit(uuid,uuid,uuid,date,text,jsonb,text,uuid) TO authenticated;

COMMIT;