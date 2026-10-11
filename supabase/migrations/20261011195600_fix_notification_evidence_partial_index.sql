BEGIN;

-- The audit evidence index is partial, so PostgreSQL needs its predicate
-- in the ON CONFLICT target. Otherwise this AFTER INSERT/UPDATE trigger fails
-- every notification_jobs insert with "no unique or exclusion constraint".
CREATE OR REPLACE FUNCTION public.sync_notification_delivery_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt_no integer := greatest(coalesce((NEW.metadata->>'delivery_attempt')::integer, 1), 1);
BEGIN
  INSERT INTO public.notification_delivery_evidence(
    business_id, notification_job_id, channel, recipient, subject, message,
    content_hash, provider_message_id, status, queued_at, sent_at, metadata,
    created_at, attempt_no
  )
  VALUES(
    NEW.business_id, NEW.id, NEW.channel, NEW.recipient, NEW.subject, NEW.message,
    encode(extensions.digest(coalesce(NEW.message,''), 'sha256'), 'hex'),
    NEW.provider_message_id, NEW.status, NEW.scheduled_for, NEW.sent_at,
    jsonb_build_object(
      'notification_type', NEW.notification_type,
      'action_url', NEW.action_url,
      'delivery_idempotency_key', NEW.delivery_idempotency_key,
      'delivery_attempt', v_attempt_no,
      'attempts', NEW.attempts,
      'last_error', NEW.last_error,
      'source', 'notification_jobs'
    ),
    coalesce(NEW.created_at, now()), v_attempt_no
  )
  ON CONFLICT (notification_job_id, attempt_no)
    WHERE notification_job_id IS NOT NULL
  DO UPDATE SET
    channel = EXCLUDED.channel,
    recipient = EXCLUDED.recipient,
    subject = EXCLUDED.subject,
    message = EXCLUDED.message,
    content_hash = EXCLUDED.content_hash,
    provider_message_id = EXCLUDED.provider_message_id,
    status = EXCLUDED.status,
    queued_at = EXCLUDED.queued_at,
    sent_at = EXCLUDED.sent_at,
    delivered_at = CASE
      WHEN EXCLUDED.status IN ('delivered','success','sent')
        THEN coalesce(public.notification_delivery_evidence.delivered_at, now())
      ELSE public.notification_delivery_evidence.delivered_at
    END,
    metadata = EXCLUDED.metadata;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_notification_delivery_evidence()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_notification_delivery_evidence()
  TO service_role;


-- Also ensure a hashed public receipt token is issued even for receipts with no
-- customer contact or enabled channel. Outbox failure must not be the reason a
-- financial receipt lacks its token; callers may reissue later as needed.
CREATE OR REPLACE FUNCTION public.enqueue_receipt_delivery_notifications(
  p_receipt_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $function$
DECLARE
  r public.receipts%rowtype;
  c public.customers%rowtype;
  biz public.businesses%rowtype;
  prefs public.business_preferences%rowtype;
  v_access jsonb;
  v_token text;
  v_action_url text;
  v_outstanding numeric(15,2) := 0;
  v_invoice_id uuid;
  v_channel text;
  v_recipient text;
  v_subject text;
  v_body text;
  v_delivery_key text;
  v_metadata jsonb;
  v_inserted integer := 0;
  v_total_inserted integer := 0;
  v_channels text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO r
  FROM public.receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  v_access := public._issue_receipt_access_token(r.id, 'customer_download');
  v_token := v_access->>'token';
  IF v_token IS NULL OR v_token !~ '^[A-Fa-f0-9]{48,128}  IF r.customer_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT * INTO c
  FROM public.customers
  WHERE id = r.customer_id
    AND business_id = r.business_id
    AND is_active;

  IF c.id IS NULL OR NOT coalesce(c.receipt_delivery_enabled, true) THEN
    RETURN 0;
  END IF;

  SELECT * INTO biz FROM public.businesses WHERE id = r.business_id;
  SELECT * INTO prefs FROM public.business_preferences WHERE business_id = r.business_id;

  SELECT p.invoice_id INTO v_invoice_id
  FROM public.payments p
  WHERE p.id = r.payment_id
    AND p.business_id = r.business_id;

  v_outstanding := public.fn_get_customer_outstanding_balance(r.business_id, r.customer_id);

  IF coalesce(prefs.notification_whatsapp_enabled, true)
     AND nullif(trim(coalesce(c.phone, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = r.business_id
         AND nc.channel = 'whatsapp'
         AND nc.enabled
         AND nc.health_status <> 'failing'
     ) THEN
    v_channels := array_append(v_channels, 'whatsapp');
  END IF;

  IF coalesce(prefs.notification_email_enabled, true)
     AND nullif(trim(coalesce(c.email, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = r.business_id
         AND nc.channel = 'email'
         AND nc.enabled
         AND nc.health_status <> 'failing'
     ) THEN
    v_channels := array_append(v_channels, 'email');
  END IF;

  IF coalesce(prefs.notification_sms_enabled, false)
     AND nullif(trim(coalesce(c.phone, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = r.business_id
         AND nc.channel = 'sms'
         AND nc.enabled
         AND nc.health_status <> 'failing'
     ) THEN
    v_channels := array_append(v_channels, 'sms');
  END IF;

  IF coalesce(prefs.notification_telegram_enabled, false)
     AND nullif(trim(coalesce(c.telegram_chat_id, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = r.business_id
         AND nc.channel = 'telegram'
         AND nc.enabled
         AND nc.health_status <> 'failing'
     ) THEN
    v_channels := array_append(v_channels, 'telegram');
  END IF;

  IF cardinality(v_channels) = 0 THEN
    RETURN 0;
  END IF;

  v_body := 'Your payment receipt ' || r.receipt_number || ' from ' ||
    coalesce(biz.legal_name, biz.name, 'Business') || ' is ready. Customer outstanding balance: ' ||
    'INR ' || to_char(v_outstanding, 'FM999,999,999,990.00') || '.';

  FOREACH v_channel IN ARRAY v_channels LOOP
    v_recipient := CASE v_channel
      WHEN 'whatsapp' THEN trim(c.phone)
      WHEN 'email' THEN trim(c.email)
      WHEN 'sms' THEN trim(c.phone)
      WHEN 'telegram' THEN trim(c.telegram_chat_id)
      ELSE NULL
    END;
    v_subject := CASE
      WHEN v_channel IN ('email', 'telegram') THEN 'Payment receipt · ' || r.receipt_number
      ELSE NULL
    END;
    v_delivery_key := 'receipt:' || r.id::text || ':v5:' || v_channel;
    v_metadata := jsonb_build_object(
      'receipt_id', r.id,
      'receipt_number', r.receipt_number,
      'document_type', 'receipt',
      'document_id', r.id::text,
      'attachment_type', CASE WHEN v_channel = 'sms' THEN 'public_pdf_link' ELSE 'receipt_pdf' END,
      'attachment_filename', 'Receipt_' || r.receipt_number || '.pdf',
      'customer_outstanding_balance', v_outstanding,
      'idempotency_key', v_delivery_key,
      'delivery_idempotency_key', v_delivery_key,
      'attempted_channels', jsonb_build_array(v_channel),
      'delivery_attempt', 1
    );

    BEGIN
      INSERT INTO public.notification_jobs(
        business_id, customer_id, invoice_id, channel, notification_type,
        recipient, subject, message, action_url, scheduled_for, metadata,
        delivery_idempotency_key
      )
      VALUES(
        r.business_id, r.customer_id, v_invoice_id, v_channel, 'receipt',
        v_recipient, v_subject, v_body, v_action_url, now(), v_metadata,
        v_delivery_key
      );
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
    EXCEPTION WHEN unique_violation THEN
      -- Treat only a duplicate of this exact logical delivery as idempotent;
      -- do not hide a different integrity failure from the receipt transaction.
      IF EXISTS (
        SELECT 1
        FROM public.notification_jobs existing_job
        WHERE existing_job.business_id = r.business_id
          AND existing_job.delivery_idempotency_key = v_delivery_key
      ) THEN
        v_inserted := 0;
      ELSE
        RAISE;
      END IF;
    END;
    v_total_inserted := v_total_inserted + v_inserted;
  END LOOP;

  RETURN v_total_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid)
  TO service_role;

COMMIT;
