-- Receipt document payload: include the source invoice, invoice items and payment totals.
-- This keeps the receipt renderer read-only while giving it the complete data needed
-- for Item / Qty / Rate / Amount, Total / Amount Received / Balance.

CREATE OR REPLACE FUNCTION public.prepare_document_render(p_document_type text, p_document_id uuid, p_template_id uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'mm_private'
AS $function$
DECLARE
  bid uuid;
  tid uuid;
  tv integer;
  payload jsonb;
  job uuid;
BEGIN
  IF p_document_type NOT IN ('invoice','quotation','receipt','credit_note','debit_note') THEN
    RAISE EXCEPTION 'Unsupported document type';
  END IF;

  IF p_document_type='invoice' THEN
    SELECT business_id INTO bid FROM public.invoices WHERE id=p_document_id;
  ELSIF p_document_type='quotation' THEN
    SELECT business_id INTO bid FROM public.quotations WHERE id=p_document_id;
  ELSIF p_document_type='receipt' THEN
    SELECT business_id INTO bid FROM public.receipts WHERE id=p_document_id;
  ELSIF p_document_type='credit_note' THEN
    SELECT business_id INTO bid FROM public.credit_notes WHERE id=p_document_id;
  ELSE
    SELECT business_id INTO bid FROM public.debit_notes WHERE id=p_document_id;
  END IF;

  IF bid IS NULL THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF NOT mm_private.is_org_member((SELECT organization_id FROM public.businesses WHERE id=bid)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_template_id IS NULL THEN
    SELECT dp.template_id INTO tid
    FROM public.business_document_preferences dp
    WHERE dp.business_id=bid AND dp.document_type=p_document_type;
  END IF;
  tid:=coalesce(tid,p_template_id);
  IF tid IS NULL THEN
    SELECT id INTO tid
    FROM public.document_templates
    WHERE document_type=p_document_type AND is_active
    ORDER BY is_system DESC,version DESC
    LIMIT 1;
  END IF;
  IF tid IS NOT NULL THEN
    SELECT version INTO tv FROM public.document_templates WHERE id=tid AND is_active;
  END IF;

  IF p_document_type='invoice' THEN
    SELECT to_jsonb(i)||jsonb_build_object(
      'items',coalesce((SELECT jsonb_agg(to_jsonb(ii) ORDER BY ii.sort_order) FROM public.invoice_items ii WHERE ii.invoice_id=i.id),'[]'::jsonb),
      'customer',to_jsonb(c),'business',to_jsonb(b)
    ) INTO payload
    FROM public.invoices i
    JOIN public.customers c ON c.id=i.customer_id
    JOIN public.businesses b ON b.id=i.business_id
    WHERE i.id=p_document_id;
  ELSIF p_document_type='quotation' THEN
    SELECT to_jsonb(q)||jsonb_build_object(
      'items',coalesce((SELECT jsonb_agg(to_jsonb(qi) ORDER BY qi.sort_order) FROM public.quotation_items qi WHERE qi.quotation_id=q.id),'[]'::jsonb),
      'customer',to_jsonb(c),'business',to_jsonb(b)
    ) INTO payload
    FROM public.quotations q
    JOIN public.customers c ON c.id=q.customer_id
    JOIN public.businesses b ON b.id=q.business_id
    WHERE q.id=p_document_id;
  ELSIF p_document_type='receipt' THEN
    SELECT to_jsonb(r)||jsonb_build_object(
      'customer',to_jsonb(c),
      'business',to_jsonb(b),
      'payment',to_jsonb(p),
      'invoice',to_jsonb(i),
      'invoice_id',i.id,
      'invoice_number',i.invoice_number,
      'invoice_total',coalesce(i.total,0),
      'amount_received',coalesce(r.amount,0),
      'balance_due',greatest(coalesce(i.total,0)-coalesce(r.amount,0),0),
      'items',coalesce((SELECT jsonb_agg(to_jsonb(ii) ORDER BY ii.sort_order) FROM public.invoice_items ii WHERE ii.invoice_id=i.id),'[]'::jsonb)
    ) INTO payload
    FROM public.receipts r
    JOIN public.customers c ON c.id=r.customer_id
    JOIN public.businesses b ON b.id=r.business_id
    LEFT JOIN public.payments p ON p.id=r.payment_id
    LEFT JOIN public.invoices i ON i.id=p.invoice_id
    WHERE r.id=p_document_id;
  ELSIF p_document_type='credit_note' THEN
    SELECT to_jsonb(n)||jsonb_build_object(
      'items',coalesce((SELECT jsonb_agg(to_jsonb(ni) ORDER BY ni.sort_order) FROM public.credit_note_items ni WHERE ni.credit_note_id=n.id),'[]'::jsonb),
      'customer',to_jsonb(c),'business',to_jsonb(b)
    ) INTO payload
    FROM public.credit_notes n
    JOIN public.customers c ON c.id=n.customer_id
    JOIN public.businesses b ON b.id=n.business_id
    WHERE n.id=p_document_id;
  ELSE
    SELECT to_jsonb(n)||jsonb_build_object(
      'items',coalesce((SELECT jsonb_agg(to_jsonb(ni) ORDER BY ni.sort_order) FROM public.debit_note_items ni WHERE ni.debit_note_id=n.id),'[]'::jsonb),
      'business',to_jsonb(b)
    ) INTO payload
    FROM public.debit_notes n
    JOIN public.businesses b ON b.id=n.business_id
    WHERE n.id=p_document_id;
  END IF;

  INSERT INTO public.document_render_jobs(
    business_id,document_type,document_id,template_id,template_version,payload,created_by
  ) VALUES(
    bid,p_document_type,p_document_id,tid,tv,coalesce(payload,'{}'::jsonb),auth.uid()
  )
  ON CONFLICT(document_type,document_id,template_id,template_version)
  DO UPDATE SET payload=excluded.payload,status='ready',error_message=NULL,created_at=now()
  RETURNING id INTO job;

  RETURN job;
END;
$function$;
