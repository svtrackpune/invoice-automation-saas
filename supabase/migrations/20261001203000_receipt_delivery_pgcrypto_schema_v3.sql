BEGIN;

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

  SELECT * INTO r
  FROM public.receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  token_value := encode(gen_random_bytes(32), 'hex');
  token_hash := encode(extensions.digest(token_value, 'sha256'), 'hex');
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

CREATE OR REPLACE FUNCTION public.sync_notification_delivery_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.notification_delivery_evidence (
    business_id, notification_job_id, channel,
    recipient, subject, message, content_hash, provider_message_id, status,
    queued_at, sent_at, metadata, created_at
  ) VALUES (
    NEW.business_id,
    NEW.id,
    NEW.channel,
    NEW.recipient,
    NEW.subject,
    NEW.message,
    encode(extensions.digest(coalesce(NEW.message,''), 'sha256'), 'hex'),
    NEW.provider_message_id,
    NEW.status,
    NEW.scheduled_for,
    NEW.sent_at,
    jsonb_build_object(
      'notification_type', NEW.notification_type,
      'action_url', NEW.action_url,
      'attempts', NEW.attempts,
      'last_error', NEW.last_error,
      'source', 'notification_jobs'
    ),
    coalesce(NEW.created_at, now())
  )
  ON CONFLICT (notification_job_id) WHERE notification_job_id IS NOT NULL
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
      WHEN EXCLUDED.status IN ('delivered','success')
        THEN coalesce(public.notification_delivery_evidence.delivered_at, now())
      ELSE public.notification_delivery_evidence.delivered_at
    END,
    failed_at = CASE
      WHEN EXCLUDED.status IN ('failed','error')
        THEN coalesce(public.notification_delivery_evidence.failed_at, now())
      ELSE public.notification_delivery_evidence.failed_at
    END,
    metadata = EXCLUDED.metadata;
  RETURN NEW;
END;
$function$;

COMMIT;
