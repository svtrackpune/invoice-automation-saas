BEGIN;

-- Receipt delivery is a notification concern, not an accounting concern.
-- A receipt insert may enqueue delivery jobs, but delivery failure must never
-- roll back the payment/receipt transaction.

ALTER TABLE public.notification_jobs
  DROP CONSTRAINT IF EXISTS notification_jobs_channel_check;

ALTER TABLE public.notification_jobs
  ADD CONSTRAINT notification_jobs_channel_check
  CHECK (channel IN ('email','whatsapp','sms','telegram'));

ALTER TABLE public.notification_delivery_evidence
  DROP CONSTRAINT IF EXISTS notification_delivery_evidence_channel_check;

ALTER TABLE public.notification_delivery_evidence
  ADD CONSTRAINT notification_delivery_evidence_channel_check
  CHECK (channel IN ('email','whatsapp','sms','telegram','push'));

ALTER TABLE public.business_preferences
  ADD COLUMN IF NOT EXISTS notification_telegram_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS telegram_chat_id text;

CREATE INDEX IF NOT EXISTS idx_customers_business_telegram_chat
  ON public.customers(business_id, telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._issue_receipt_access_token(
  p_receipt_id uuid,
  p_purpose text DEFAULT 'customer_download'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
DECLARE
  r public.receipts%rowtype;
  token_value text;
  token_hash text;
  access_id uuid;
  expires_value timestamptz;
BEGIN
  IF p_purpose NOT IN ('customer_download','whatsapp_delivery') THEN
    RAISE EXCEPTION 'Unsupported receipt access purpose.';
  END IF;

  SELECT *
  INTO r
  FROM public.receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  token_value := encode(gen_random_bytes(32), 'hex');
  token_hash := encode(digest(token_value, 'sha256'), 'hex');
  expires_value := CASE
    WHEN p_purpose = 'whatsapp_delivery' THEN now() + interval '30 minutes'
    ELSE now() + interval '5 years'
  END;

  INSERT INTO public.receipt_access_tokens(
    business_id, receipt_id, purpose, token_hash, expires_at
  )
  VALUES(
    r.business_id, r.id, p_purpose, token_hash, expires_value
  )
  RETURNING id INTO access_id;

  RETURN jsonb_build_object(
    'access_id', access_id,
    'receipt_id', r.id,
    'receipt_number', r.receipt_number,
    'token', token_value,
    'expires_at', expires_value
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_receipt_access_token(
  p_receipt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
DECLARE
  r public.receipts%rowtype;
BEGIN
  SELECT *
  INTO r
  FROM public.receipts
  WHERE id = p_receipt_id;

  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  IF NOT (
    mm_private.has_business_permission(r.business_id, 'sales.view')
    OR mm_private.has_business_permission(r.business_id, 'payments.receive')
    OR mm_private.has_business_permission(r.business_id, 'sales.create')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN public._issue_receipt_access_token(p_receipt_id, 'customer_download');
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_receipt_delivery_notifications(
  p_receipt_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
DECLARE
  r public.receipts%rowtype;
  c public.customers%rowtype;
  b public.business_preferences%rowtype;
  biz public.businesses%rowtype;
  access jsonb;
  token text;
  action_url text;
  body text;
  queued integer := 0;
  v_rows integer := 0;
BEGIN
  SELECT * INTO r
  FROM public.receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  IF r.customer_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT * INTO c
  FROM public.customers
  WHERE id = r.customer_id
    AND business_id = r.business_id
    AND is_active;

  IF c.id IS NULL OR NOT coalesce(c.notify_customer, true) THEN
    RETURN 0;
  END IF;

  SELECT * INTO biz
  FROM public.businesses
  WHERE id = r.business_id;

  SELECT * INTO b
  FROM public.business_preferences
  WHERE business_id = r.business_id;

  access := public._issue_receipt_access_token(r.id, 'customer_download');
  token := access->>'token';
  action_url := '/api/receipts/pdf?token=' || token;
  body := 'Your payment receipt ' || r.receipt_number || ' from ' ||
          coalesce(biz.name, 'Business') || ' is ready.';

  IF coalesce(b.notification_email_enabled, true)
     AND nullif(trim(coalesce(c.email,'')), '') IS NOT NULL THEN
    INSERT INTO public.notification_jobs(
      business_id, customer_id, invoice_id, channel, notification_type,
      recipient, subject, message, action_url, scheduled_for, metadata
    )
    VALUES(
      r.business_id, r.customer_id,
      (SELECT invoice_id FROM public.payments WHERE id = r.payment_id),
      'email', 'receipt',
      trim(c.email),
      'Payment receipt · ' || r.receipt_number,
      body,
      action_url,
      now(),
      jsonb_build_object(
        'receipt_id', r.id,
        'receipt_number', r.receipt_number,
        'attachment_type', 'receipt_pdf',
        'attachment_filename', 'receipt-' || r.receipt_number || '.pdf',
        'idempotency_key', 'receipt:' || r.id || ':email:v1'
      )
    )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    queued := queued + v_rows;
  END IF;

  IF coalesce(b.notification_whatsapp_enabled, true)
     AND nullif(trim(coalesce(c.phone,'')), '') IS NOT NULL THEN
    INSERT INTO public.notification_jobs(
      business_id, customer_id, invoice_id, channel, notification_type,
      recipient, subject, message, action_url, scheduled_for, metadata
    )
    VALUES(
      r.business_id, r.customer_id,
      (SELECT invoice_id FROM public.payments WHERE id = r.payment_id),
      'whatsapp', 'receipt',
      trim(c.phone),
      NULL,
      body,
      action_url,
      now(),
      jsonb_build_object(
        'receipt_id', r.id,
        'receipt_number', r.receipt_number,
        'attachment_type', 'receipt_pdf',
        'attachment_filename', 'receipt-' || r.receipt_number || '.pdf',
        'idempotency_key', 'receipt:' || r.id || ':whatsapp:v1'
      )
    )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    queued := queued + v_rows;
  END IF;

  IF coalesce(b.notification_sms_enabled, false)
     AND nullif(trim(coalesce(c.phone,'')), '') IS NOT NULL THEN
    INSERT INTO public.notification_jobs(
      business_id, customer_id, invoice_id, channel, notification_type,
      recipient, subject, message, action_url, scheduled_for, metadata
    )
    VALUES(
      r.business_id, r.customer_id,
      (SELECT invoice_id FROM public.payments WHERE id = r.payment_id),
      'sms', 'receipt',
      trim(c.phone),
      NULL,
      body,
      action_url,
      now(),
      jsonb_build_object(
        'receipt_id', r.id,
        'receipt_number', r.receipt_number,
        'delivery_format', 'link',
        'idempotency_key', 'receipt:' || r.id || ':sms:v1'
      )
    )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    queued := queued + v_rows;
  END IF;

  IF coalesce(b.notification_telegram_enabled, false)
     AND nullif(trim(coalesce(c.telegram_chat_id,'')), '') IS NOT NULL THEN
    INSERT INTO public.notification_jobs(
      business_id, customer_id, invoice_id, channel, notification_type,
      recipient, subject, message, action_url, scheduled_for, metadata
    )
    VALUES(
      r.business_id, r.customer_id,
      (SELECT invoice_id FROM public.payments WHERE id = r.payment_id),
      'telegram', 'receipt',
      trim(c.telegram_chat_id),
      'Payment receipt · ' || r.receipt_number,
      body,
      action_url,
      now(),
      jsonb_build_object(
        'receipt_id', r.id,
        'receipt_number', r.receipt_number,
        'attachment_type', 'receipt_pdf',
        'attachment_filename', 'receipt-' || r.receipt_number || '.pdf',
        'idempotency_key', 'receipt:' || r.id || ':telegram:v1'
      )
    )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    queued := queued + v_rows;
  END IF;

  RETURN queued;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_enqueue_receipt_delivery_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
BEGIN
  BEGIN
    PERFORM public.enqueue_receipt_delivery_notifications(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Never block the financial transaction because a notification queue
    -- operation failed. The payment/receipt remains the accounting source.
    RAISE LOG 'Moneymatters receipt delivery enqueue failed for receipt %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_receipt_delivery_notifications ON public.receipts;
CREATE TRIGGER trg_enqueue_receipt_delivery_notifications
AFTER INSERT ON public.receipts
FOR EACH ROW
EXECUTE FUNCTION public.trg_enqueue_receipt_delivery_notifications();

REVOKE ALL ON FUNCTION public._issue_receipt_access_token(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_receipt_access_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_receipt_access_token(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid) TO authenticated;

COMMIT;
