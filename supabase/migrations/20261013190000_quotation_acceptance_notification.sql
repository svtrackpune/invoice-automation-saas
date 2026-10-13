BEGIN;

-- In-app business notifications are tenant-scoped and readable only by authenticated
-- business members who can view sales. Writes are made by the secured acceptance RPC.
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_business_unread_created_idx
  ON public.notifications (business_id, is_read, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.notifications TO authenticated;

DROP POLICY IF EXISTS notifications_business_select ON public.notifications;
CREATE POLICY notifications_business_select
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (mm_private.has_business_permission(business_id, 'sales.view'::text));

DROP POLICY IF EXISTS notifications_business_update ON public.notifications;
CREATE POLICY notifications_business_update
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (mm_private.has_business_permission(business_id, 'sales.view'::text))
  WITH CHECK (mm_private.has_business_permission(business_id, 'sales.view'::text));

-- Enable database change subscriptions if this project has the standard publication.
DO $publication$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'notifications'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END;
$publication$;

-- Return the generated invoice's opaque public token, but only supply a navigable
-- public invoice URL after it is posted to a status accepted by get_public_invoice.
CREATE OR REPLACE FUNCTION public.accept_public_quotation(p_public_accept_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $function$
DECLARE
  q public.quotations%rowtype;
  v_invoice_id uuid;
  v_invoice_number text;
  v_invoice_status text;
  v_invoice_token text;
  v_due_date date;
BEGIN
  IF nullif(btrim(coalesce(p_public_accept_token,'')), '') IS NULL
     OR btrim(p_public_accept_token) !~ '^[A-Fa-f0-9]{48,128}$' THEN
    RAISE EXCEPTION 'Quotation link is invalid or unavailable';
  END IF;

  SELECT * INTO q
  FROM public.quotations
  WHERE public_accept_token = btrim(p_public_accept_token)
  FOR UPDATE;

  IF q.id IS NULL THEN
    RAISE EXCEPTION 'Quotation link is invalid or unavailable';
  END IF;

  IF q.status = 'converted' AND q.invoice_id IS NOT NULL THEN
    SELECT i.invoice_number, i.status::text, i.public_share_token
      INTO v_invoice_number, v_invoice_status, v_invoice_token
    FROM public.invoices i
    WHERE i.id = q.invoice_id AND i.business_id = q.business_id;

    RETURN jsonb_build_object(
      'accepted', true,
      'already_processed', true,
      'quotation_id', q.id,
      'quotation_number', q.quotation_number,
      'invoice_id', q.invoice_id,
      'invoice_number', v_invoice_number,
      'invoice_status', v_invoice_status,
      'public_token', v_invoice_token,
      'redirect_url', CASE
        WHEN v_invoice_status IN ('sent','partially_paid','paid')
          AND nullif(v_invoice_token, '') IS NOT NULL
        THEN '/invoice/' || v_invoice_token
        ELSE NULL
      END,
      'delivery_pending_posting', v_invoice_status = 'draft'
    );
  END IF;

  IF q.status NOT IN ('sent','accepted') THEN
    RAISE EXCEPTION 'Only a sent quotation can be accepted';
  END IF;

  IF q.status = 'sent' AND q.valid_until IS NOT NULL AND q.valid_until < current_date THEN
    RAISE EXCEPTION 'Quotation has expired';
  END IF;

  IF q.created_by IS NULL
     OR NOT mm_private.has_business_permission(q.business_id,'sales.create',q.created_by) THEN
    RAISE EXCEPTION 'The business can no longer convert this quotation; please contact the business';
  END IF;

  IF q.status = 'sent' THEN
    UPDATE public.quotations
    SET status = 'accepted',
        accepted_at = coalesce(accepted_at, now()),
        accepted_via = 'public_link',
        updated_at = now()
    WHERE id = q.id;
  END IF;

  -- Use the existing audited conversion engine. The customer is never granted
  -- membership or direct permission to create or post business invoices.
  PERFORM set_config('request.jwt.claim.sub', q.created_by::text, true);

  SELECT current_date + greatest(0, coalesce(c.payment_terms_days, 0))
    INTO v_due_date
  FROM public.customers c
  WHERE c.id = q.customer_id AND c.business_id = q.business_id;

  v_invoice_id := public.convert_quotation_to_invoice(
    q.id,
    current_date,
    coalesce(v_due_date, current_date)
  );

  SELECT i.invoice_number, i.status::text, i.public_share_token
    INTO v_invoice_number, v_invoice_status, v_invoice_token
  FROM public.invoices i
  WHERE i.id = v_invoice_id AND i.business_id = q.business_id;

  RETURN jsonb_build_object(
    'accepted', true,
    'already_processed', false,
    'quotation_id', q.id,
    'quotation_number', q.quotation_number,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'invoice_status', v_invoice_status,
    'public_token', v_invoice_token,
    'redirect_url', CASE
      WHEN v_invoice_status IN ('sent','partially_paid','paid')
        AND nullif(v_invoice_token, '') IS NOT NULL
      THEN '/invoice/' || v_invoice_token
      ELSE NULL
    END,
    'delivery_pending_posting', v_invoice_status = 'draft',
    'message', CASE WHEN v_invoice_status = 'draft'
      THEN 'Quotation accepted and converted. The business must post the invoice before its official customer PDF can be dispatched.'
      ELSE 'Quotation accepted and invoice created.' END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_public_quotation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_public_quotation(text) TO anon, authenticated;

-- The public wrapper atomically writes one business notification for a first acceptance.
-- Repeated submissions of the same already-converted quotation remain idempotent.
CREATE OR REPLACE FUNCTION public.rpc_accept_public_quotation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_quotation_id uuid;
  v_invoice_id uuid;
  v_business_id uuid;
  v_quotation_number text;
  v_invoice_number text;
  v_customer_name text;
BEGIN
  IF nullif(btrim(coalesce(p_token,'')), '') IS NULL
     OR btrim(p_token) !~ '^[A-Fa-f0-9]{48,128}$' THEN
    RAISE EXCEPTION 'Quotation link is invalid or unavailable';
  END IF;

  v_result := public.accept_public_quotation(btrim(p_token));

  IF coalesce((v_result->>'accepted')::boolean, false)
     AND NOT coalesce((v_result->>'already_processed')::boolean, false) THEN
    v_quotation_id := nullif(v_result->>'quotation_id', '')::uuid;
    v_invoice_id := nullif(v_result->>'invoice_id', '')::uuid;
    v_invoice_number := coalesce(nullif(btrim(v_result->>'invoice_number'), ''), 'Invoice');

    SELECT q.business_id, q.quotation_number,
           coalesce(nullif(btrim(c.legal_name), ''), nullif(btrim(c.display_name), ''), 'Customer')
      INTO v_business_id, v_quotation_number, v_customer_name
    FROM public.quotations q
    JOIN public.customers c
      ON c.id = q.customer_id AND c.business_id = q.business_id
    WHERE q.id = v_quotation_id
      AND q.invoice_id = v_invoice_id;

    IF v_business_id IS NOT NULL AND v_invoice_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        business_id, type, title, message, data, is_read, created_at
      ) VALUES (
        v_business_id,
        'quotation_accepted',
        'Quotation Accepted',
        'Customer ' || v_customer_name || ' accepted Quotation ' || v_quotation_number
          || '. Tax Invoice ' || v_invoice_number || ' generated.',
        jsonb_build_object('quotation_id', v_quotation_id, 'invoice_id', v_invoice_id),
        false,
        now()
      );
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_accept_public_quotation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_accept_public_quotation(text) TO anon, authenticated;

-- Add a product/service name and UNIT to the existing public quotation payload so
-- customer pages can render the same six-column item contract as invoices.
DO $patch_public_quotation_items$
DECLARE
  v_target regprocedure := 'public.get_public_quotation(text)'::regprocedure;
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(v_target) INTO v_definition;

  IF position('''item_name''' IN v_definition) = 0 THEN
    v_old := $old$          'description', qi.description,
          'quantity', qi.quantity,
          'unit_price', qi.unit_price,
          'discount_type', qi.discount_type,
          'discount_value', qi.discount_value,
          'tax_rate', coalesce(tr.rate, 0)
$old$;
    v_new := $new$          'item_name', ps.name,
          'name', coalesce(ps.name, qi.description),
          'unit', ps.unit,
          'description', qi.description,
          'quantity', qi.quantity,
          'unit_price', qi.unit_price,
          'discount_type', qi.discount_type,
          'discount_value', qi.discount_value,
          'tax_rate', coalesce(tr.rate, 0)
$new$;
    IF position(v_old IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Quotation item payload patch aborted: expected item JSON was not found';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);

    v_old := $old$      FROM public.quotation_items qi
      LEFT JOIN public.tax_rates tr ON tr.id = qi.tax_rate_id
      WHERE qi.quotation_id = q.id$old$;
    v_new := $new$      FROM public.quotation_items qi
      LEFT JOIN public.tax_rates tr ON tr.id = qi.tax_rate_id
      LEFT JOIN public.products_services ps
        ON ps.id = qi.product_service_id AND ps.business_id = q.business_id
      WHERE qi.quotation_id = q.id$new$;
    IF position(v_old IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Quotation item payload patch aborted: expected item join was not found';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);
  END IF;

  IF position('''item_name''' IN v_definition) = 0
     OR position('ps.unit' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Quotation item payload patch aborted: name/unit checks failed';
  END IF;

  EXECUTE v_definition;
END;
$patch_public_quotation_items$;

COMMIT;
