BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.receipt_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('customer_download','whatsapp_delivery')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipt_access_tokens_receipt
  ON public.receipt_access_tokens(receipt_id, purpose, created_at DESC);

ALTER TABLE public.receipt_access_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receipt_access_tokens_select_none ON public.receipt_access_tokens;
DROP POLICY IF EXISTS receipt_access_tokens_insert_none ON public.receipt_access_tokens;
DROP POLICY IF EXISTS receipt_access_tokens_update_none ON public.receipt_access_tokens;
DROP POLICY IF EXISTS receipt_access_tokens_delete_none ON public.receipt_access_tokens;

CREATE OR REPLACE FUNCTION public.create_receipt_access_token(p_receipt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
DECLARE
  r public.receipts%rowtype;
  token_value text;
  expires_value timestamptz := now() + interval '5 years';
  access_id uuid;
BEGIN
  SELECT * INTO r
  FROM public.receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

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

  token_value := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.receipt_access_tokens(
    business_id, receipt_id, purpose, token_hash, expires_at
  )
  VALUES(
    r.business_id,
    r.id,
    'customer_download',
    encode(digest(token_value, 'sha256'), 'hex'),
    expires_value
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

CREATE OR REPLACE FUNCTION public.queue_receipt_notification(
  p_receipt_id uuid,
  p_channel text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
DECLARE
  r public.receipts%rowtype;
  c public.customers%rowtype;
  i public.invoices%rowtype;
  channel_name text := lower(trim(p_channel));
  recipient_value text;
  token_value text;
  action_path text;
  job_id uuid;
  message_value text;
  subject_value text;
  token_expires timestamptz := now() + interval '5 years';
BEGIN
  IF channel_name NOT IN ('email','whatsapp','sms','telegram') THEN
    RAISE EXCEPTION 'Unsupported receipt delivery channel.';
  END IF;

  SELECT * INTO r
  FROM public.receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

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

  SELECT * INTO c
  FROM public.customers
  WHERE id = r.customer_id
    AND business_id = r.business_id
    AND is_active;

  IF c.id IS NULL THEN
    RAISE EXCEPTION 'Receipt customer could not be resolved.';
  END IF;

  IF NOT coalesce(c.receipt_delivery_enabled, true) THEN
    RAISE EXCEPTION 'Receipt delivery is disabled for this customer.';
  END IF;

  recipient_value := CASE channel_name
    WHEN 'email' THEN nullif(trim(coalesce(c.email,'')), '')
    WHEN 'whatsapp' THEN nullif(trim(coalesce(c.phone,'')), '')
    WHEN 'sms' THEN nullif(trim(coalesce(c.phone,'')), '')
    WHEN 'telegram' THEN nullif(trim(coalesce(c.telegram_chat_id,'')), '')
  END;

  IF recipient_value IS NULL THEN
    RAISE EXCEPTION 'Customer does not have a destination for %.', channel_name;
  END IF;

  SELECT i.* INTO i
  FROM public.invoices i
  JOIN public.payments p ON p.invoice_id = i.id AND p.id = r.payment_id AND p.business_id = r.business_id
  WHERE i.business_id = r.business_id
  LIMIT 1;

  token_value := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.receipt_access_tokens(
    business_id, receipt_id, purpose, token_hash, expires_at
  )
  VALUES(
    r.business_id,
    r.id,
    'customer_download',
    encode(digest(token_value, 'sha256'), 'hex'),
    token_expires
  );

  action_path := '/api/receipts/pdf?token=' || token_value;
  message_value := 'Your payment receipt ' || r.receipt_number ||
    ' is ready. Amount received: ' || coalesce(r.amount,0) || ' ' ||
    coalesce(r.currency_code,'INR') || '. Retain it for warranty or guarantee purposes.';
  subject_value := 'Payment receipt · ' || r.receipt_number;

  INSERT INTO public.notification_jobs(
    business_id,
    customer_id,
    invoice_id,
    channel,
    notification_type,
    recipient,
    subject,
    message,
    action_url,
    scheduled_for,
    status,
    attempts,
    metadata
  )
  VALUES(
    r.business_id,
    r.customer_id,
    i.id,
    channel_name,
    'receipt',
    recipient_value,
    CASE WHEN channel_name IN ('email','sms') THEN subject_value ELSE NULL END,
    message_value,
    action_path,
    now(),
    'queued',
    0,
    jsonb_build_object(
      'receipt_id', r.id,
      'receipt_number', r.receipt_number,
      'payment_id', r.payment_id,
      'attachment_type', CASE WHEN channel_name IN ('email','whatsapp','telegram') THEN 'receipt_pdf' ELSE 'receipt_link' END,
      'attachment_filename', 'receipt-' || regexp_replace(r.receipt_number, '[^a-zA-Z0-9._-]+', '-', 'g') || '.pdf',
      'idempotency_key', 'receipt:' || r.id::text || ':' || channel_name
    )
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO job_id;

  RETURN jsonb_build_object(
    'queued', job_id IS NOT NULL,
    'job_id', job_id,
    'receipt_id', r.id,
    'receipt_number', r.receipt_number,
    'channel', channel_name,
    'recipient', recipient_value
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.queue_receipt_whatsapp_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
DECLARE
  c public.customers%rowtype;
  token_value text;
  token_expires timestamptz := now() + interval '5 years';
BEGIN
  SELECT * INTO c
  FROM public.customers
  WHERE id = NEW.customer_id
    AND business_id = NEW.business_id
    AND is_active;

  IF c.id IS NULL
     OR NOT coalesce(c.receipt_delivery_enabled, true)
     OR NOT coalesce(c.notify_customer, true)
     OR nullif(trim(coalesce(c.phone,'')), '') IS NULL THEN
    RETURN NEW;
  END IF;

  token_value := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.receipt_access_tokens(
    business_id, receipt_id, purpose, token_hash, expires_at
  )
  VALUES(
    NEW.business_id,
    NEW.id,
    'whatsapp_delivery',
    encode(digest(token_value, 'sha256'), 'hex'),
    token_expires
  );

  INSERT INTO public.notification_jobs(
    business_id,
    customer_id,
    invoice_id,
    channel,
    notification_type,
    recipient,
    subject,
    message,
    action_url,
    scheduled_for,
    status,
    attempts,
    metadata
  )
  SELECT
    NEW.business_id,
    NEW.customer_id,
    p.invoice_id,
    'whatsapp',
    'receipt',
    trim(c.phone),
    NULL,
    'Your payment receipt ' || NEW.receipt_number ||
      ' is ready. Amount received: ' || coalesce(NEW.amount,0) || ' ' ||
      coalesce(NEW.currency_code,'INR') || '. Retain it for warranty or guarantee purposes.',
    '/api/receipts/pdf?token=' || token_value,
    now(),
    'queued',
    0,
    jsonb_build_object(
      'receipt_id', NEW.id,
      'receipt_number', NEW.receipt_number,
      'payment_id', NEW.payment_id,
      'attachment_type', 'receipt_pdf',
      'attachment_filename', 'receipt-' || regexp_replace(NEW.receipt_number, '[^a-zA-Z0-9._-]+', '-', 'g') || '.pdf',
      'idempotency_key', 'receipt:' || NEW.id::text || ':whatsapp'
    )
  FROM public.payments p
  WHERE p.id = NEW.payment_id
    AND p.business_id = NEW.business_id
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_queue_receipt_whatsapp_on_insert ON public.receipts;
CREATE TRIGGER trg_queue_receipt_whatsapp_on_insert
AFTER INSERT ON public.receipts
FOR EACH ROW
EXECUTE FUNCTION public.queue_receipt_whatsapp_on_insert();

REVOKE ALL ON FUNCTION public.create_receipt_access_token(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_receipt_access_token(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.queue_receipt_notification(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.queue_receipt_notification(uuid,text) TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('moneymatters-notification-worker')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='moneymatters-notification-worker');

SELECT cron.schedule(
  'moneymatters-notification-worker',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := 'https://qpczmbvqflaqwvyphepf.supabase.co/functions/v1/process-notifications',
      body := jsonb_build_object('source','pg_cron','triggered_at',now()),
      headers := jsonb_build_object('Content-Type','application/json'),
      timeout_milliseconds := 10000
    );
  $$
);

COMMIT;
