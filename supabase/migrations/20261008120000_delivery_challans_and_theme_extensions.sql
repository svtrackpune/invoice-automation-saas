BEGIN;

ALTER TABLE public.business_document_preferences
  DROP CONSTRAINT IF EXISTS business_document_preferences_document_type_check;

ALTER TABLE public.business_document_preferences
  ADD CONSTRAINT business_document_preferences_document_type_check
  CHECK (document_type = ANY (ARRAY[
    'invoice','quotation','receipt','delivery_challan','purchase_order','credit_note','cash_bill'
  ]));

ALTER TABLE public.business_document_preferences
  ADD COLUMN IF NOT EXISTS document_title_override TEXT,
  ADD COLUMN IF NOT EXISTS min_item_rows INT NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS prefill_upi_amount BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_customer_balance BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_authorized_signatory BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_serial_numbers BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.barcode_print_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'thermal_roll' CHECK (media_type IN ('thermal_roll','sheet_a4')),
  label_width_mm NUMERIC(6,2) NOT NULL DEFAULT 50.00,
  label_height_mm NUMERIC(6,2) NOT NULL DEFAULT 25.00,
  labels_across INT NOT NULL DEFAULT 1,
  labels_down INT NOT NULL DEFAULT 1,
  page_margin_top_mm NUMERIC(6,2) NOT NULL DEFAULT 0,
  page_margin_left_mm NUMERIC(6,2) NOT NULL DEFAULT 0,
  gap_horizontal_mm NUMERIC(6,2) NOT NULL DEFAULT 0,
  gap_vertical_mm NUMERIC(6,2) NOT NULL DEFAULT 0,
  show_company_name BOOLEAN NOT NULL DEFAULT true,
  show_item_name BOOLEAN NOT NULL DEFAULT true,
  show_selling_price BOOLEAN NOT NULL DEFAULT true,
  show_mrp BOOLEAN NOT NULL DEFAULT true,
  show_category BOOLEAN NOT NULL DEFAULT false,
  show_batch_no BOOLEAN NOT NULL DEFAULT false,
  barcode_format TEXT NOT NULL DEFAULT 'CODE128',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_barcode_print_templates_business_name UNIQUE (business_id,name)
);

CREATE TABLE IF NOT EXISTS public.delivery_challans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  challan_number TEXT NOT NULL,
  challan_date DATE NOT NULL DEFAULT CURRENT_DATE,
  transporter_name TEXT,
  vehicle_number TEXT,
  eway_bill_number TEXT,
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'dispatched' CHECK (status IN ('dispatched','delivered','invoiced','cancelled')),
  notes TEXT,
  terms TEXT,
  converted_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_biz_challan_number UNIQUE (business_id,challan_number)
);

CREATE TABLE IF NOT EXISTS public.delivery_challan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id UUID NOT NULL REFERENCES public.delivery_challans(id) ON DELETE CASCADE,
  product_service_id UUID REFERENCES public.products_services(id),
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit TEXT,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  line_total NUMERIC NOT NULL DEFAULT 0,
  hsn_sac TEXT,
  batch_number TEXT,
  serial_number TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_barcode_print_templates_business ON public.barcode_print_templates(business_id);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_business_date ON public.delivery_challans(business_id,challan_date DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_customer ON public.delivery_challans(business_id,customer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_challan_items_challan ON public.delivery_challan_items(challan_id);

ALTER TABLE public.barcode_print_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_challans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_challan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS barcode_print_templates_member ON public.barcode_print_templates;
CREATE POLICY barcode_print_templates_member ON public.barcode_print_templates
FOR ALL TO authenticated
USING (mm_private.has_business_permission(business_id,'inventory.manage'))
WITH CHECK (mm_private.has_business_permission(business_id,'inventory.manage'));

DROP POLICY IF EXISTS delivery_challans_member ON public.delivery_challans;
CREATE POLICY delivery_challans_member ON public.delivery_challans
FOR ALL TO authenticated
USING (mm_private.is_org_member(mm_private.business_org(business_id)))
WITH CHECK (mm_private.is_org_member(mm_private.business_org(business_id)));

DROP POLICY IF EXISTS delivery_challan_items_member ON public.delivery_challan_items;
CREATE POLICY delivery_challan_items_member ON public.delivery_challan_items
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.delivery_challans dc
  WHERE dc.id=delivery_challan_items.challan_id
    AND mm_private.is_org_member(mm_private.business_org(dc.business_id))
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.delivery_challans dc
  WHERE dc.id=delivery_challan_items.challan_id
    AND mm_private.is_org_member(mm_private.business_org(dc.business_id))
));

CREATE OR REPLACE FUNCTION public.commit_stock_audit_adjustment(
  p_business_id UUID, p_location_id UUID, p_items JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,mm_private,pg_temp
AS $$
DECLARE
  v_item RECORD; v_diff NUMERIC; v_cost NUMERIC; v_variance NUMERIC:=0;
  v_inv UUID; v_shrink UUID; v_gain UUID; v_entry UUID;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'inventory.manage',auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: insufficient permissions to adjust inventory';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM inventory_locations WHERE id=p_location_id AND business_id=p_business_id AND is_active) THEN
    RAISE EXCEPTION 'Inventory location is invalid';
  END IF;

  SELECT id INTO v_inv FROM accounts WHERE business_id=p_business_id AND code='1200' AND is_active;
  SELECT id INTO v_shrink FROM accounts WHERE business_id=p_business_id AND code='5020' AND is_active;
  SELECT id INTO v_gain FROM accounts WHERE business_id=p_business_id AND code='4120' AND is_active;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID,recorded_qty NUMERIC,audited_qty NUMERIC,unit_cost NUMERIC) LOOP
    IF NOT EXISTS (SELECT 1 FROM products_services WHERE id=v_item.product_id AND business_id=p_business_id AND inventory_tracked) THEN
      RAISE EXCEPTION 'Audit item is not a tracked product in this business';
    END IF;
    v_diff:=v_item.audited_qty-v_item.recorded_qty;
    v_cost:=COALESCE(v_item.unit_cost,0);
    IF v_diff<>0 THEN
      INSERT INTO inventory_movements(business_id,product_service_id,location_id,movement_type,quantity,unit_cost,reference_type,notes,created_by)
      VALUES(p_business_id,v_item.product_id,p_location_id,CASE WHEN v_diff>0 THEN 'adjustment_in' ELSE 'adjustment_out' END,ABS(v_diff),v_cost,'stock_audit','Physical stock-take audit adjustment',auth.uid());
      UPDATE inventory_balances SET quantity_on_hand=v_item.audited_qty,updated_at=now()
      WHERE business_id=p_business_id AND product_service_id=v_item.product_id AND location_id=p_location_id;
      IF NOT FOUND THEN
        INSERT INTO inventory_balances(business_id,product_service_id,location_id,quantity_on_hand,average_cost,reorder_level)
        VALUES(p_business_id,v_item.product_id,p_location_id,v_item.audited_qty,v_cost,0);
      END IF;
      v_variance:=v_variance+(v_diff*v_cost);
    END IF;
  END LOOP;

  IF v_variance<>0 AND v_inv IS NOT NULL AND ((v_variance<0 AND v_shrink IS NOT NULL) OR (v_variance>0 AND v_gain IS NOT NULL)) THEN
    INSERT INTO journal_entries(business_id,entry_number,entry_date,description,status,created_by)
    VALUES(p_business_id,(SELECT COALESCE(MAX(entry_number),0)+1 FROM journal_entries WHERE business_id=p_business_id),CURRENT_DATE,'Physical Inventory Audit Variance Settlement','posted',auth.uid())
    RETURNING id INTO v_entry;
    IF v_variance<0 THEN
      INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,transaction_currency_code,transaction_amount,base_currency_code,base_amount)
      VALUES(v_entry,v_shrink,ABS(v_variance),0,'INR',ABS(v_variance),'INR',ABS(v_variance)),
            (v_entry,v_inv,0,ABS(v_variance),'INR',ABS(v_variance),'INR',ABS(v_variance));
    ELSE
      INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,transaction_currency_code,transaction_amount,base_currency_code,base_amount)
      VALUES(v_entry,v_inv,v_variance,0,'INR',v_variance,'INR',v_variance),
            (v_entry,v_gain,0,v_variance,'INR',v_variance,'INR',v_variance);
    END IF;
  END IF;
  RETURN jsonb_build_object('success',true,'net_variance_value',v_variance);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_day_book(p_business_id UUID,p_date DATE)
RETURNS TABLE(entry_time TIMESTAMPTZ,module TEXT,document_number TEXT,party_name TEXT,reference TEXT,debit NUMERIC,credit NUMERIC,payment_mode TEXT,status TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path=public,mm_private,pg_temp
AS $$
  SELECT i.created_at,
    CASE WHEN i.document_kind='cash_bill' THEN 'CASH BILL (POS)' ELSE 'TAX INVOICE' END,
    i.invoice_number,COALESCE(c.display_name,'Cash Customer'),COALESCE(i.buyer_reference,''),
    i.total::NUMERIC,0::NUMERIC,'CREDIT'::TEXT,i.status::TEXT
  FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id
  WHERE i.business_id=p_business_id AND i.invoice_date=p_date AND i.status<>'void'
  UNION ALL
  SELECT p.created_at,'PAYMENT RECEIVED',COALESCE(p.reference,p.id::TEXT),
    COALESCE(c.display_name,v.display_name,'Direct Counter'),COALESCE(p.gateway_transaction_id,''),
    0::NUMERIC,p.amount::NUMERIC,p.method::TEXT,'COMPLETED'::TEXT
  FROM payments p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN vendors v ON v.id=p.vendor_id
  WHERE p.business_id=p_business_id AND p.payment_date=p_date
  UNION ALL
  SELECT e.created_at,'EXPENSE',COALESCE(e.reference,'EXP'),COALESCE(v.display_name,e.description),
    e.description,e.amount::NUMERIC,0::NUMERIC,COALESCE(e.payment_method::TEXT,'CASH'),'POSTED'::TEXT
  FROM expenses e LEFT JOIN vendors v ON v.id=e.vendor_id
  WHERE e.business_id=p_business_id AND e.expense_date=p_date
  ORDER BY 1 ASC;
$$;

REVOKE ALL ON FUNCTION public.commit_stock_audit_adjustment(UUID,UUID,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_day_book(UUID,DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_stock_audit_adjustment(UUID,UUID,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_day_book(UUID,DATE) TO authenticated;

COMMIT;