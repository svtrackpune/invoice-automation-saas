-- Keep public quotation acceptance deliberately simple and safe:
-- customer-facing acceptance is an email handoff; invoice conversion remains
-- the existing authenticated business workflow.

DROP FUNCTION IF EXISTS public.convert_quotation_to_invoice(uuid,date,date,text);

CREATE OR REPLACE FUNCTION public.convert_quotation_to_invoice(
  p_quotation_id uuid,
  p_invoice_date date DEFAULT current_date,
  p_due_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','mm_private'
AS $$
DECLARE
  q public.quotations%rowtype;
  v_invoice uuid;
  v_items jsonb;
  v_due date;
  v_customer_payment_mode text;
  v_bank_id uuid;
BEGIN
  SELECT * INTO q
  FROM public.quotations
  WHERE id=p_quotation_id
  FOR UPDATE;

  IF q.id IS NULL THEN RAISE EXCEPTION 'Quotation not found'; END IF;
  IF NOT mm_private.has_business_permission(q.business_id,'sales.create') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF q.invoice_id IS NOT NULL THEN RETURN q.invoice_id; END IF;
  IF q.status NOT IN ('sent','accepted') THEN RAISE EXCEPTION 'Quotation must be sent or accepted before conversion'; END IF;

  IF q.valid_until IS NOT NULL AND q.valid_until < current_date AND q.status <> 'accepted' THEN
    RAISE EXCEPTION 'Quotation has expired';
  END IF;

  v_due := coalesce(p_due_date,p_invoice_date,current_date);

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_service_id',qi.product_service_id,
        'description',qi.description,
        'quantity',qi.quantity,
        'unit_price',qi.unit_price,
        'discount_type',qi.discount_type,
        'discount_value',qi.discount_value,
        'tax_rate_id',qi.tax_rate_id
      ) ORDER BY qi.sort_order
    ),'[]'::jsonb
  )
  INTO v_items
  FROM public.quotation_items qi
  WHERE qi.quotation_id=q.id;

  IF jsonb_array_length(v_items)=0 THEN RAISE EXCEPTION 'Quotation has no items'; END IF;

  SELECT coalesce(c.default_payment_display_mode,'none')
  INTO v_customer_payment_mode
  FROM public.customers c
  WHERE c.id=q.customer_id AND c.business_id=q.business_id;

  IF v_customer_payment_mode='bank' THEN
    SELECT bs.default_bank_account_id
    INTO v_bank_id
    FROM public.business_settings bs
    JOIN public.bank_accounts ba ON ba.id=bs.default_bank_account_id
      AND ba.business_id=q.business_id
      AND ba.is_active=true
    WHERE bs.business_id=q.business_id;

    IF v_bank_id IS NULL THEN
      SELECT b.bank_account_id
      INTO v_bank_id
      FROM public.business_document_bank_accounts b
      JOIN public.bank_accounts ba ON ba.id=b.bank_account_id
      WHERE b.business_id=q.business_id
        AND b.document_type='invoice'
        AND ba.business_id=q.business_id
        AND ba.is_active=true
      ORDER BY b.display_order ASC,b.created_at ASC
      LIMIT 1;
    END IF;

    IF v_bank_id IS NULL THEN
      SELECT ba.id INTO v_bank_id
      FROM public.bank_accounts ba
      WHERE ba.business_id=q.business_id AND ba.is_active=true
      ORDER BY ba.created_at ASC
      LIMIT 1;
    END IF;
  END IF;

  v_invoice := public.create_invoice_from_items(
    q.business_id,
    q.customer_id,
    coalesce(p_invoice_date,current_date),
    v_due,
    v_items,
    NULL,
    q.notes,
    q.terms
  );

  UPDATE public.invoices
  SET source_quotation_id=q.id,
      template_id=q.template_id,
      payment_display_mode=coalesce(v_customer_payment_mode,'none'),
      payment_bank_account_id=CASE WHEN v_customer_payment_mode='bank' THEN v_bank_id ELSE NULL END
  WHERE id=v_invoice;

  UPDATE public.quotations
  SET invoice_id=v_invoice,
      status='converted',
      converted_at=now(),
      converted_by=auth.uid(),
      updated_at=now()
  WHERE id=q.id;

  RETURN v_invoice;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.convert_quotation_to_invoice(uuid,date,date) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.convert_quotation_to_invoice(uuid,date,date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_public_quotation(text) FROM public,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_quotation(text) TO anon;
