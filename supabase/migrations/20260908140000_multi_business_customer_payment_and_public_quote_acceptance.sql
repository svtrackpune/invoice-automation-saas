-- Multi-business quotation-to-cash workflow enhancements.
-- Adds customer payment-display defaults and secure customer-facing quotation acceptance.
-- Existing business/account/quotation/invoice architecture is intentionally reused.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS default_payment_display_mode text NOT NULL DEFAULT 'none';

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_default_payment_display_mode_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_default_payment_display_mode_check
  CHECK (default_payment_display_mode IN ('none','bank','online'));

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS public_accept_token text
    DEFAULT encode(gen_random_bytes(24), 'hex'),
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_via text;

CREATE UNIQUE INDEX IF NOT EXISTS quotations_public_accept_token_uidx
  ON public.quotations(public_accept_token)
  WHERE public_accept_token IS NOT NULL;

ALTER TABLE public.quotations
  DROP CONSTRAINT IF EXISTS quotations_accepted_via_check;

ALTER TABLE public.quotations
  ADD CONSTRAINT quotations_accepted_via_check
  CHECK (accepted_via IS NULL OR accepted_via IN ('customer_web','internal'));

-- Existing internal status transitions remain intact. This function additionally
-- records the acceptance source when an internal user accepts a quotation.
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
  SET status=p_status,
      accepted_at=CASE WHEN p_status='accepted' THEN coalesce(accepted_at,now()) ELSE accepted_at END,
      accepted_via=CASE WHEN p_status='accepted' THEN coalesce(accepted_via,'internal') ELSE accepted_via END,
      updated_at=now()
  WHERE id=q.id;
END;
$$;

-- Conversion keeps the existing authenticated workflow and gains an optional
-- high-entropy public token path used only by the customer acceptance endpoint.
CREATE OR REPLACE FUNCTION public.convert_quotation_to_invoice(
  p_quotation_id uuid,
  p_invoice_date date DEFAULT current_date,
  p_due_date date DEFAULT NULL,
  p_public_accept_token text DEFAULT NULL
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

  IF q.id IS NULL THEN
    RAISE EXCEPTION 'Quotation not found';
  END IF;

  IF p_public_accept_token IS NULL THEN
    IF NOT mm_private.has_business_permission(q.business_id,'sales.create') THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  ELSE
    IF q.public_accept_token IS NULL OR q.public_accept_token <> p_public_accept_token THEN
      RAISE EXCEPTION 'Invalid quotation acceptance link';
    END IF;
    IF q.status NOT IN ('sent','accepted') THEN
      RAISE EXCEPTION 'Quotation is no longer available for customer acceptance';
    END IF;
    IF q.valid_until IS NOT NULL AND q.valid_until < current_date AND q.status <> 'accepted' THEN
      RAISE EXCEPTION 'Quotation has expired';
    END IF;
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

  IF p_public_accept_token IS NOT NULL AND q.status='sent' THEN
    UPDATE public.quotations
    SET status='accepted',
        accepted_at=coalesce(accepted_at,now()),
        accepted_via='customer_web',
        updated_at=now()
    WHERE id=q.id;
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

  SELECT coalesce(c.default_payment_display_mode,'none')
  INTO v_customer_payment_mode
  FROM public.customers c
  WHERE c.id=q.customer_id AND c.business_id=q.business_id;

  IF v_customer_payment_mode='bank' THEN
    SELECT coalesce(
      bs.default_bank_account_id,
      (
        SELECT b.bank_account_id
        FROM public.business_document_bank_accounts b
        JOIN public.bank_accounts ba ON ba.id=b.bank_account_id
        WHERE b.business_id=q.business_id
          AND b.document_type='invoice'
          AND ba.business_id=q.business_id
          AND ba.is_active=true
        ORDER BY b.display_order ASC,b.created_at ASC
        LIMIT 1
      )
    )
    INTO v_bank_id
    FROM public.business_settings bs
    WHERE bs.business_id=q.business_id;

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
      payment_bank_account_id=CASE
        WHEN v_customer_payment_mode='bank' THEN v_bank_id
        ELSE NULL
      END
  WHERE id=v_invoice;

  UPDATE public.quotations
  SET invoice_id=v_invoice,
      status='converted',
      converted_at=now(),
      converted_by=CASE WHEN auth.uid() IS NOT NULL THEN auth.uid() ELSE converted_by END,
      updated_at=now()
  WHERE id=q.id;

  RETURN v_invoice;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.convert_quotation_to_invoice(uuid,date,date,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.convert_quotation_to_invoice(uuid,date,date,text) TO authenticated,service_role;

-- Safe public read: only a random, non-guessable quotation token exposes the
-- quotation, and only the minimum fields needed for customer review are returned.
CREATE OR REPLACE FUNCTION public.get_public_quotation(p_public_accept_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  q public.quotations%rowtype;
  result jsonb;
BEGIN
  SELECT * INTO q
  FROM public.quotations
  WHERE public_accept_token=p_public_accept_token;

  IF q.id IS NULL THEN RAISE EXCEPTION 'Quotation not found'; END IF;
  IF q.status NOT IN ('sent','accepted') THEN RAISE EXCEPTION 'Quotation is not available'; END IF;
  IF q.valid_until IS NOT NULL AND q.valid_until < current_date AND q.status <> 'accepted' THEN
    RAISE EXCEPTION 'Quotation has expired';
  END IF;

  SELECT jsonb_build_object(
    'id',q.id,
    'quotation_number',q.quotation_number,
    'quotation_date',q.quotation_date,
    'valid_until',q.valid_until,
    'status',q.status,
    'notes',q.notes,
    'terms',q.terms,
    'total',q.total,
    'subtotal',q.subtotal,
    'discount_total',q.discount_total,
    'tax_total',q.tax_total,
    'customer',jsonb_build_object(
      'id',c.id,
      'display_name',c.display_name,
      'legal_name',c.legal_name,
      'email',c.email,
      'phone',c.phone,
      'billing_address',c.billing_address
    ),
    'business',jsonb_build_object(
      'name',b.name,
      'legal_name',b.legal_name,
      'email',b.email,
      'phone',b.phone,
      'website',b.website,
      'address',b.address,
      'logo_url',b.logo_url,
      'tax_registration_number',case when coalesce(tp.gst_registration_type,'NONE')='NONE' then null else coalesce(tp.gstin,b.tax_registration_number) end
    ),
    'items',coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'description',qi.description,
          'quantity',qi.quantity,
          'unit_price',qi.unit_price,
          'discount_type',qi.discount_type,
          'discount_value',qi.discount_value,
          'tax_rate',coalesce(tr.rate,0)
        ) ORDER BY qi.sort_order
      )
      FROM public.quotation_items qi
      LEFT JOIN public.tax_rates tr ON tr.id=qi.tax_rate_id
      WHERE qi.quotation_id=q.id
    ),'[]'::jsonb)
  )
  INTO result
  FROM public.customers c
  JOIN public.businesses b ON b.id=q.business_id
  LEFT JOIN public.business_tax_profiles tp ON tp.business_id=q.business_id
  WHERE c.id=q.customer_id AND c.business_id=q.business_id;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_quotation(text) FROM public,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_quotation(text) TO anon;

REVOKE EXECUTE ON FUNCTION public.convert_quotation_to_invoice(uuid,date,date,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.convert_quotation_to_invoice(uuid,date,date,text) TO service_role,authenticated;


-- Preserve the existing 3-argument application API while routing it through
-- the enhanced implementation.
DROP FUNCTION IF EXISTS public.convert_quotation_to_invoice(uuid,date,date);

CREATE OR REPLACE FUNCTION public.convert_quotation_to_invoice(
  p_quotation_id uuid,
  p_invoice_date date DEFAULT current_date,
  p_due_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path='public','mm_private'
AS $$
  SELECT public.convert_quotation_to_invoice(p_quotation_id,p_invoice_date,p_due_date,NULL);
$$;

REVOKE EXECUTE ON FUNCTION public.convert_quotation_to_invoice(uuid,date,date) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.convert_quotation_to_invoice(uuid,date,date) TO authenticated;
