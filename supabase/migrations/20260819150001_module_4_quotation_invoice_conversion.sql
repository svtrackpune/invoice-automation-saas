-- Moneymatters Module #4: quotation / estimate -> invoice conversion.
-- Keeps the conversion atomic, traceable and business-permission aware.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS source_quotation_id uuid
    REFERENCES public.quotations(id) ON DELETE SET NULL;

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS converted_at timestamptz,
  ADD COLUMN IF NOT EXISTS converted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_source_quotation_uidx
  ON public.invoices(source_quotation_id)
  WHERE source_quotation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS quotations_business_status_date_idx
  ON public.quotations(business_id,status,quotation_date DESC);
CREATE INDEX IF NOT EXISTS quotation_items_quotation_sort_idx
  ON public.quotation_items(quotation_id,sort_order);
CREATE INDEX IF NOT EXISTS invoice_items_invoice_sort_idx
  ON public.invoice_items(invoice_id,sort_order);

DROP FUNCTION IF EXISTS public.convert_quotation_to_invoice(uuid);

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
BEGIN
  SELECT * INTO q
  FROM public.quotations
  WHERE id=p_quotation_id
  FOR UPDATE;

  IF q.id IS NULL THEN
    RAISE EXCEPTION 'Quotation not found';
  END IF;

  IF NOT mm_private.has_business_permission(q.business_id,'sales.create') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF q.invoice_id IS NOT NULL THEN
    RETURN q.invoice_id;
  END IF;

  IF q.status NOT IN ('sent','accepted') THEN
    RAISE EXCEPTION 'Quotation must be sent or accepted before conversion';
  END IF;

  IF q.valid_until IS NOT NULL
     AND q.valid_until < current_date
     AND q.status <> 'accepted' THEN
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

  IF jsonb_array_length(v_items)=0 THEN
    RAISE EXCEPTION 'Quotation has no items';
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
      template_id=q.template_id
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

REVOKE EXECUTE ON FUNCTION public.create_quotation_from_items(uuid,uuid,date,date,jsonb,text,text,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_quotation_from_items(uuid,uuid,date,date,jsonb,text,text,uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_invoice_from_items(uuid,uuid,date,date,jsonb,text,numeric,text,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_items(uuid,uuid,date,date,jsonb,text,numeric,text,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.recalculate_invoice_totals(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.recalculate_invoice_totals(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_quotation_status(
  p_quotation_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','mm_private'
AS $$
DECLARE
  q public.quotations%rowtype;
BEGIN
  SELECT * INTO q
  FROM public.quotations
  WHERE id=p_quotation_id
  FOR UPDATE;

  IF q.id IS NULL THEN RAISE EXCEPTION 'Quotation not found'; END IF;
  IF NOT mm_private.has_business_permission(q.business_id,'sales.create') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_status NOT IN ('sent','accepted','rejected','expired','cancelled') THEN RAISE EXCEPTION 'Invalid quotation status'; END IF;
  IF q.status='converted' THEN RAISE EXCEPTION 'Converted quotation cannot change status'; END IF;
  IF q.status='draft' AND p_status NOT IN ('sent','cancelled') THEN RAISE EXCEPTION 'Draft quotation can only be sent or cancelled'; END IF;
  IF q.status='sent' AND p_status NOT IN ('accepted','rejected','expired','cancelled') THEN RAISE EXCEPTION 'Sent quotation can only be accepted, rejected, expired or cancelled'; END IF;
  IF q.status='accepted' AND p_status NOT IN ('rejected','cancelled') THEN RAISE EXCEPTION 'Accepted quotation can only be rejected or cancelled before conversion'; END IF;

  UPDATE public.quotations
  SET status=p_status,updated_at=now()
  WHERE id=q.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_quotation_status(uuid,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.set_quotation_status(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_quotation_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path='public'
AS $$
BEGIN
  IF new.status=old.status THEN RETURN new; END IF;
  IF old.status='draft' AND new.status IN ('sent','cancelled') THEN RETURN new; END IF;
  IF old.status='sent' AND new.status IN ('accepted','rejected','expired','cancelled','converted') THEN RETURN new; END IF;
  IF old.status='accepted' AND new.status='converted' THEN RETURN new; END IF;
  RAISE EXCEPTION 'Invalid quotation status transition: % -> %',old.status,new.status;
END;
$$;

DROP TRIGGER IF EXISTS quotations_status_transition_guard ON public.quotations;
CREATE TRIGGER quotations_status_transition_guard
BEFORE UPDATE OF status ON public.quotations
FOR EACH ROW
EXECUTE FUNCTION public.guard_quotation_status_transition();
