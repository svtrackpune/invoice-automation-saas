BEGIN;

-- Public acceptance is authorized by the existing high-entropy quotation token.
-- Conversion reuses the application's validated quotation-to-invoice RPC rather
-- than reimplementing item discounts, HSN/SAC checks, and invoice numbering.
CREATE OR REPLACE FUNCTION public.accept_public_quotation(
  p_public_accept_token text
)
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
    SELECT i.invoice_number, i.status::text
      INTO v_invoice_number, v_invoice_status
    FROM public.invoices i
    WHERE i.id = q.invoice_id AND i.business_id = q.business_id;

    RETURN jsonb_build_object(
      'accepted', true,
      'already_processed', true,
      'quotation_number', q.quotation_number,
      'invoice_id', q.invoice_id,
      'invoice_number', v_invoice_number,
      'invoice_status', v_invoice_status,
      'delivery_pending_posting', v_invoice_status = 'draft'
    );
  END IF;

  IF q.status NOT IN ('sent','accepted') THEN
    RAISE EXCEPTION 'Only a sent quotation can be accepted';
  END IF;

  IF q.status = 'sent' AND q.valid_until IS NOT NULL AND q.valid_until < current_date THEN
    RAISE EXCEPTION 'Quotation has expired';
  END IF;

  -- The stored creator must still retain permission to create sales documents.
  -- The public customer is not granted business membership or direct invoice RPCs.
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

  -- This trusted transaction-local identity is bound to the quotation's creator,
  -- after validating both the opaque customer token and the creator's current
  -- sales.create permission. It lets the established SECURITY DEFINER workflow
  -- retain its normal audit attribution and tenant-permission checks.
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

  SELECT i.invoice_number, i.status::text
    INTO v_invoice_number, v_invoice_status
  FROM public.invoices i
  WHERE i.id = v_invoice_id AND i.business_id = q.business_id;

  RETURN jsonb_build_object(
    'accepted', true,
    'already_processed', false,
    'quotation_number', q.quotation_number,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'invoice_status', v_invoice_status,
    'delivery_pending_posting', v_invoice_status = 'draft',
    'message', CASE WHEN v_invoice_status = 'draft'
      THEN 'Quotation accepted and converted. The business must post the invoice before its official customer PDF can be dispatched.'
      ELSE 'Quotation accepted and invoice created.' END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_public_quotation(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_public_quotation(text)
  TO anon, authenticated;

-- Once the invoice is posted, enqueue one attachment-bearing invoice delivery
-- per configured recipient channel. Draft invoices are never exposed or sent as
-- official tax invoices. The outbox's existing unique delivery key makes this
-- trigger idempotent across retries and repeated status updates.
CREATE OR REPLACE FUNCTION public.fn_enqueue_accepted_quotation_invoice_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $function$
DECLARE
  c public.customers%rowtype;
  prefs public.business_preferences%rowtype;
  v_channel text;
  v_recipient text;
  v_subject text;
  v_key text;
  v_message text;
  v_channels text[] := ARRAY[]::text[];
  v_invoice_url text;
  v_inserted integer;
BEGIN
  IF NEW.source_quotation_id IS NULL
     OR NEW.journal_entry_id IS NULL
     OR NEW.status::text NOT IN ('sent','partially_paid','paid') THEN
    RETURN NEW;
  END IF;

  -- Only process the first successful posting transition.
  IF TG_OP = 'UPDATE' AND OLD.journal_entry_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO c
  FROM public.customers
  WHERE id = NEW.customer_id
    AND business_id = NEW.business_id
    AND is_active;

  IF c.id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO prefs
  FROM public.business_preferences
  WHERE business_id = NEW.business_id;

  IF coalesce(prefs.notification_whatsapp_enabled, true)
     AND nullif(btrim(coalesce(c.phone,'')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = NEW.business_id AND nc.channel = 'whatsapp'
         AND nc.enabled AND nc.health_status <> 'failing'
     ) THEN
    v_channels := array_append(v_channels, 'whatsapp');
  END IF;

  IF coalesce(prefs.notification_email_enabled, true)
     AND nullif(btrim(coalesce(c.email,'')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = NEW.business_id AND nc.channel = 'email'
         AND nc.enabled AND nc.health_status <> 'failing'
     ) THEN
    v_channels := array_append(v_channels, 'email');
  END IF;

  IF coalesce(prefs.notification_sms_enabled, false)
     AND nullif(btrim(coalesce(c.phone,'')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = NEW.business_id AND nc.channel = 'sms'
         AND nc.enabled AND nc.health_status <> 'failing'
     ) THEN
    v_channels := array_append(v_channels, 'sms');
  END IF;

  IF coalesce(prefs.notification_telegram_enabled, false)
     AND nullif(btrim(coalesce(c.telegram_chat_id,'')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = NEW.business_id AND nc.channel = 'telegram'
         AND nc.enabled AND nc.health_status <> 'failing'
     ) THEN
    v_channels := array_append(v_channels, 'telegram');
  END IF;

  IF cardinality(v_channels) = 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.public_share_token IS NULL OR NEW.public_share_token !~ '^[A-Fa-f0-9]{48,128}$' THEN
    RAISE EXCEPTION 'Posted invoice is missing a valid public share token';
  END IF;

  v_invoice_url := '/invoice/' || NEW.public_share_token;
  v_message := 'Your accepted quotation has been converted to Tax Invoice ' ||
    NEW.invoice_number || '. Total: ' || NEW.currency_code::text || ' ' ||
    to_char(NEW.total, 'FM999,999,999,990.00') || '. Balance due: ' ||
    NEW.currency_code::text || ' ' || to_char(NEW.balance_due, 'FM999,999,999,990.00') || '.';

  FOREACH v_channel IN ARRAY v_channels LOOP
    v_recipient := CASE v_channel
      WHEN 'whatsapp' THEN btrim(c.phone)
      WHEN 'email' THEN btrim(c.email)
      WHEN 'sms' THEN btrim(c.phone)
      WHEN 'telegram' THEN btrim(c.telegram_chat_id)
      ELSE NULL
    END;
    v_subject := CASE WHEN v_channel IN ('email','telegram')
      THEN 'Tax Invoice ' || NEW.invoice_number ELSE NULL END;
    v_key := 'quotation-invoice:' || NEW.id::text || ':v1:' || v_channel;

    INSERT INTO public.notification_jobs(
      business_id, customer_id, invoice_id, channel, notification_type,
      recipient, subject, message, action_url, scheduled_for, metadata,
      delivery_idempotency_key
    )
    VALUES(
      NEW.business_id, NEW.customer_id, NEW.id, v_channel, 'invoice_created',
      v_recipient, v_subject, v_message, v_invoice_url, now(),
      jsonb_build_object(
        'document_type','invoice',
        'document_id',NEW.id::text,
        'document_number',NEW.invoice_number,
        'source_quotation_id',NEW.source_quotation_id,
        'idempotency_key',v_key,
        'delivery_idempotency_key',v_key,
        'attachment_type',CASE WHEN v_channel='sms' THEN 'public_pdf_link' ELSE 'invoice_pdf' END
      ),
      v_key
    )
    ON CONFLICT (business_id, delivery_idempotency_key)
      WHERE delivery_idempotency_key IS NOT NULL
    DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_enqueue_accepted_quotation_invoice_dispatch()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_enqueue_accepted_quotation_invoice_dispatch()
  TO service_role;

DROP TRIGGER IF EXISTS trg_accepted_quotation_invoice_dispatch ON public.invoices;
CREATE CONSTRAINT TRIGGER trg_accepted_quotation_invoice_dispatch
AFTER UPDATE ON public.invoices
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.fn_enqueue_accepted_quotation_invoice_dispatch();

COMMIT;
