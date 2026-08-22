-- Keep invoice editing atomic and accounting-safe.
-- Posted/paid/void invoices are never mutated through this workflow.

CREATE OR REPLACE FUNCTION public.update_invoice_draft(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_items jsonb,
  p_invoice_discount_type text DEFAULT NULL,
  p_invoice_discount_value numeric DEFAULT 0,
  p_notes text DEFAULT NULL,
  p_terms text DEFAULT NULL,
  p_template_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','mm_private'
AS $$
DECLARE
  inv public.invoices%rowtype;
  v_customer_business uuid;
  v_item_count integer;
BEGIN
  SELECT * INTO inv
  FROM public.invoices
  WHERE id=p_invoice_id
  FOR UPDATE;

  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF NOT mm_private.has_business_permission(inv.business_id,'sales.create') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF inv.status <> 'draft' OR inv.journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only draft invoices can be edited';
  END IF;

  SELECT business_id INTO v_customer_business
  FROM public.customers
  WHERE id=p_customer_id AND is_active;
  IF v_customer_business IS NULL OR v_customer_business <> inv.business_id THEN
    RAISE EXCEPTION 'Customer does not belong to this business';
  END IF;

  SELECT count(*) INTO v_item_count
  FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb));
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Invoice must contain at least one item';
  END IF;

  IF p_invoice_discount_type IS NOT NULL
     AND p_invoice_discount_type NOT IN ('percentage','fixed') THEN
    RAISE EXCEPTION 'Invalid invoice discount type';
  END IF;
  IF coalesce(p_invoice_discount_value,0) < 0 THEN
    RAISE EXCEPTION 'Invoice discount cannot be negative';
  END IF;

  UPDATE public.invoices
  SET customer_id=p_customer_id,
      invoice_date=p_invoice_date,
      due_date=p_due_date,
      discount_type=p_invoice_discount_type,
      discount_value=coalesce(p_invoice_discount_value,0),
      notes=p_notes,
      terms=p_terms,
      template_id=p_template_id,
      updated_at=now()
  WHERE id=p_invoice_id;

  DELETE FROM public.invoice_items WHERE invoice_id=p_invoice_id;

  INSERT INTO public.invoice_items(
    invoice_id,product_service_id,description,quantity,unit_price,
    discount_type,discount_value,tax_rate_id,sort_order
  )
  SELECT
    p_invoice_id,
    x.product_service_id,
    x.description,
    x.quantity,
    x.unit_price,
    NULLIF(x.discount_type,''),
    coalesce(x.discount_value,0),
    NULLIF(x.tax_rate_id,''),
    x.sort_order
  FROM jsonb_to_recordset(p_items) AS x(
    product_service_id uuid,
    description text,
    quantity numeric,
    unit_price numeric,
    discount_type text,
    discount_value numeric,
    tax_rate_id text,
    sort_order integer
  );

  PERFORM public.recalculate_invoice_totals(p_invoice_id);
  RETURN p_invoice_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_invoice_draft(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.update_invoice_draft(uuid,uuid,date,date,jsonb,text,numeric,text,text,uuid) TO authenticated;
