BEGIN;

CREATE TABLE IF NOT EXISTS public.business_notification_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel varchar(20) NOT NULL CHECK (channel IN ('whatsapp','telegram','email','sms')),
  provider varchar(30) NOT NULL CHECK (provider IN ('wapi','telegram-bot','resend','smtp','twilio')),
  display_name text NOT NULL,
  endpoint_url text,
  external_instance_id text,
  secret_ref uuid,
  sender text,
  default_recipient text,
  priority integer NOT NULL DEFAULT 1 CHECK (priority > 0),
  failover_group text,
  enabled boolean NOT NULL DEFAULT true,
  health_status varchar(20) NOT NULL DEFAULT 'healthy'
    CHECK (health_status IN ('healthy','degraded','failing')),
  last_health_check_at timestamptz,
  last_error text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_business_notification_connection
    UNIQUE (business_id, channel, provider, display_name),
  CONSTRAINT business_notification_connection_secret_config_chk
    CHECK (
      NOT (
        config ?| ARRAY[
          'api_key','apikey','access_token','bot_token','auth_token',
          'password','smtp_password','credential','secret'
        ]
      )
    )
);

CREATE INDEX IF NOT EXISTS business_notification_connections_route_idx
  ON public.business_notification_connections(
    business_id, channel, enabled, health_status, priority, updated_at DESC
  );

CREATE INDEX IF NOT EXISTS business_notification_connections_instance_idx
  ON public.business_notification_connections(
    business_id, channel, external_instance_id
  )
  WHERE external_instance_id IS NOT NULL;

ALTER TABLE public.business_notification_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_notification_connections_select ON public.business_notification_connections;
DROP POLICY IF EXISTS business_notification_connections_insert ON public.business_notification_connections;
DROP POLICY IF EXISTS business_notification_connections_update ON public.business_notification_connections;
DROP POLICY IF EXISTS business_notification_connections_delete ON public.business_notification_connections;

CREATE POLICY business_notification_connections_select
  ON public.business_notification_connections FOR SELECT TO authenticated
  USING (mm_private.has_business_permission(business_id, 'settings.manage'));

CREATE POLICY business_notification_connections_insert
  ON public.business_notification_connections FOR INSERT TO authenticated
  WITH CHECK (mm_private.has_business_permission(business_id, 'settings.manage'));

CREATE POLICY business_notification_connections_update
  ON public.business_notification_connections FOR UPDATE TO authenticated
  USING (mm_private.has_business_permission(business_id, 'settings.manage'))
  WITH CHECK (mm_private.has_business_permission(business_id, 'settings.manage'));

CREATE POLICY business_notification_connections_delete
  ON public.business_notification_connections FOR DELETE TO authenticated
  USING (mm_private.has_business_permission(business_id, 'settings.manage'));

REVOKE INSERT, UPDATE, DELETE ON public.business_notification_connections FROM anon, authenticated;
GRANT SELECT ON public.business_notification_connections TO authenticated;

CREATE OR REPLACE FUNCTION public.save_business_notification_connection(
  p_business_id uuid,
  p_channel text,
  p_provider text,
  p_display_name text,
  p_connection_id uuid DEFAULT NULL,
  p_endpoint_url text DEFAULT NULL,
  p_external_instance_id text DEFAULT NULL,
  p_secret text DEFAULT NULL,
  p_sender text DEFAULT NULL,
  p_default_recipient text DEFAULT NULL,
  p_priority integer DEFAULT 1,
  p_failover_group text DEFAULT NULL,
  p_enabled boolean DEFAULT true,
  p_config jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
DECLARE
  v_id uuid;
  v_secret_ref uuid;
  v_connection public.business_notification_connections%rowtype;
  v_channel text := lower(trim(coalesce(p_channel,'')));
  v_provider text := lower(trim(coalesce(p_provider,'')));
  v_name text := nullif(btrim(coalesce(p_display_name,'')), '');
  v_secret text := nullif(btrim(coalesce(p_secret,'')), '');
  v_config jsonb := coalesce(p_config, '{}'::jsonb);
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id, 'settings.manage') THEN
    RAISE EXCEPTION 'Settings access denied';
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Connection display name is required'; END IF;
  IF v_channel NOT IN ('whatsapp','telegram','email','sms') THEN RAISE EXCEPTION 'Unsupported notification channel'; END IF;

  IF (
    (v_channel='whatsapp' AND v_provider<>'wapi') OR
    (v_channel='telegram' AND v_provider<>'telegram-bot') OR
    (v_channel='email' AND v_provider NOT IN ('resend','smtp')) OR
    (v_channel='sms' AND v_provider<>'twilio')
  ) THEN
    RAISE EXCEPTION 'Provider is not valid for the selected notification channel';
  END IF;

  IF v_config ?| ARRAY[
    'api_key','apikey','access_token','bot_token','auth_token',
    'password','smtp_password','credential','secret'
  ] THEN
    RAISE EXCEPTION 'Sensitive values must be stored in Supabase Vault, not connection config';
  END IF;

  IF p_priority IS NULL OR p_priority < 1 THEN RAISE EXCEPTION 'Connection priority must be positive'; END IF;

  IF p_connection_id IS NULL THEN
    INSERT INTO public.business_notification_connections(
      business_id, channel, provider, display_name,
      endpoint_url, external_instance_id, sender, default_recipient,
      priority, failover_group, enabled, config
    )
    VALUES(
      p_business_id, v_channel, v_provider, v_name,
      nullif(btrim(p_endpoint_url), ''),
      nullif(btrim(p_external_instance_id), ''),
      nullif(btrim(p_sender), ''),
      nullif(btrim(p_default_recipient), ''),
      p_priority, nullif(btrim(p_failover_group), ''),
      coalesce(p_enabled, true), v_config
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_connection
    FROM public.business_notification_connections
    WHERE id = p_connection_id AND business_id = p_business_id
    FOR UPDATE;

    IF v_connection.id IS NULL THEN RAISE EXCEPTION 'Notification connection not found'; END IF;
    v_id := v_connection.id;
    v_secret_ref := v_connection.secret_ref;

    UPDATE public.business_notification_connections
    SET channel = v_channel,
        provider = v_provider,
        display_name = v_name,
        endpoint_url = nullif(btrim(p_endpoint_url), ''),
        external_instance_id = nullif(btrim(p_external_instance_id), ''),
        sender = nullif(btrim(p_sender), ''),
        default_recipient = nullif(btrim(p_default_recipient), ''),
        priority = p_priority,
        failover_group = nullif(btrim(p_failover_group), ''),
        enabled = coalesce(p_enabled, true),
        config = v_config,
        updated_at = now()
    WHERE id = v_id;
  END IF;

  IF v_secret IS NOT NULL THEN
    IF v_secret_ref IS NULL THEN
      v_secret_ref := vault.create_secret(
        v_secret,
        'moneymatters-notification-' || v_id::text,
        'Moneymatters tenant notification credential'
      );
    ELSE
      PERFORM vault.update_secret(
        v_secret_ref,
        v_secret,
        'moneymatters-notification-' || v_id::text,
        'Moneymatters tenant notification credential'
      );
    END IF;

    UPDATE public.business_notification_connections
    SET secret_ref = v_secret_ref, last_error = NULL, health_status = 'healthy', updated_at = now()
    WHERE id = v_id;
  ELSIF v_secret_ref IS NULL THEN
    RAISE EXCEPTION 'A provider secret is required for a new notification connection';
  END IF;

  SELECT * INTO v_connection FROM public.business_notification_connections WHERE id = v_id;

  RETURN jsonb_build_object(
    'id', v_connection.id,
    'business_id', v_connection.business_id,
    'channel', v_connection.channel,
    'provider', v_connection.provider,
    'display_name', v_connection.display_name,
    'endpoint_url', v_connection.endpoint_url,
    'external_instance_id', v_connection.external_instance_id,
    'sender', v_connection.sender,
    'default_recipient', v_connection.default_recipient,
    'priority', v_connection.priority,
    'failover_group', v_connection.failover_group,
    'enabled', v_connection.enabled,
    'health_status', v_connection.health_status,
    'last_health_check_at', v_connection.last_health_check_at,
    'last_error', v_connection.last_error,
    'has_secret', v_connection.secret_ref IS NOT NULL,
    'config', v_connection.config
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_business_notification_connection(uuid,text,text,text,uuid,text,text,text,text,text,integer,text,boolean,jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_business_notification_connection(uuid,text,text,text,uuid,text,text,text,text,text,integer,text,boolean,jsonb)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_business_notification_connection(
  p_business_id uuid,
  p_channel text,
  p_external_instance_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_connection public.business_notification_connections%rowtype;
  v_secret text;
BEGIN
  SELECT c.* INTO v_connection
  FROM public.business_notification_connections c
  WHERE c.business_id = p_business_id
    AND c.channel = lower(trim(p_channel))
    AND c.enabled
    AND c.health_status <> 'failing'
    AND (p_external_instance_id IS NULL OR c.external_instance_id = p_external_instance_id)
  ORDER BY c.priority, c.updated_at DESC
  LIMIT 1;

  IF v_connection.id IS NULL THEN RETURN NULL; END IF;

  IF v_connection.secret_ref IS NOT NULL THEN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE id = v_connection.secret_ref;
  END IF;

  RETURN jsonb_build_object(
    'id', v_connection.id,
    'business_id', v_connection.business_id,
    'channel', v_connection.channel,
    'provider', v_connection.provider,
    'display_name', v_connection.display_name,
    'endpoint_url', v_connection.endpoint_url,
    'external_instance_id', v_connection.external_instance_id,
    'secret_ref', v_connection.secret_ref,
    'secret', v_secret,
    'sender', v_connection.sender,
    'default_recipient', v_connection.default_recipient,
    'priority', v_connection.priority,
    'failover_group', v_connection.failover_group,
    'enabled', v_connection.enabled,
    'health_status', v_connection.health_status,
    'config', v_connection.config
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_business_notification_connection(uuid,text,text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_business_notification_connection(uuid,text,text) TO service_role;

ALTER TABLE public.notification_jobs ADD COLUMN IF NOT EXISTS delivery_idempotency_key text;

UPDATE public.notification_jobs
SET delivery_idempotency_key = coalesce(nullif(metadata->>'idempotency_key',''), 'notification-job:' || id::text)
WHERE delivery_idempotency_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notification_jobs_delivery_idempotency_uidx
  ON public.notification_jobs(business_id, delivery_idempotency_key)
  WHERE delivery_idempotency_key IS NOT NULL;

ALTER TABLE public.notification_delivery_evidence
  ADD COLUMN IF NOT EXISTS attempt_no integer NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS public.notification_delivery_evidence_job_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS notification_delivery_evidence_job_attempt_uidx
  ON public.notification_delivery_evidence(notification_job_id, attempt_no)
  WHERE notification_job_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_notification_delivery_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_attempt_no integer := greatest(coalesce((NEW.metadata->>'delivery_attempt')::integer, 1), 1);
BEGIN
  INSERT INTO public.notification_delivery_evidence(
    business_id, notification_job_id, channel, recipient, subject, message,
    content_hash, provider_message_id, status, queued_at, sent_at, metadata, created_at, attempt_no
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
  ON CONFLICT(notification_job_id, attempt_no) DO UPDATE SET
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

DROP TRIGGER IF EXISTS notification_jobs_sync_delivery_evidence ON public.notification_jobs;
DROP TRIGGER IF EXISTS trg_sync_notification_delivery_evidence ON public.notification_jobs;
CREATE TRIGGER notification_jobs_sync_delivery_evidence
AFTER INSERT OR UPDATE ON public.notification_jobs
FOR EACH ROW EXECUTE FUNCTION public.sync_notification_delivery_evidence();

CREATE OR REPLACE FUNCTION public.enqueue_receipt_delivery_notifications(p_receipt_id uuid)
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
  invoice_id uuid;
  selected_channel text;
  selected_recipient text;
  selected_subject text;
  delivery_key text;
  selected_metadata jsonb;
  queued integer := 0;
BEGIN
  SELECT * INTO r FROM public.receipts WHERE id = p_receipt_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Receipt not found'; END IF;
  IF r.customer_id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO c FROM public.customers
  WHERE id = r.customer_id AND business_id = r.business_id AND is_active;
  IF c.id IS NULL OR NOT coalesce(c.receipt_delivery_enabled, true) THEN RETURN 0; END IF;

  SELECT * INTO biz FROM public.businesses WHERE id = r.business_id;
  SELECT * INTO b FROM public.business_preferences WHERE business_id = r.business_id;
  SELECT p.invoice_id INTO invoice_id
  FROM public.payments p WHERE p.id = r.payment_id AND p.business_id = r.business_id;

  access := public._issue_receipt_access_token(r.id, 'customer_download');
  token := access->>'token';
  action_url := '/api/receipts/pdf?token=' || token;
  body := 'Your payment receipt ' || r.receipt_number || ' from ' || coalesce(biz.name, 'Business') || ' is ready.';
  delivery_key := 'receipt:' || r.id::text || ':v3';

  IF coalesce(b.notification_whatsapp_enabled, true)
     AND nullif(trim(coalesce(c.phone,'')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = r.business_id AND nc.channel = 'whatsapp'
         AND nc.provider = 'wapi' AND nc.enabled AND nc.health_status <> 'failing'
     ) THEN
    selected_channel := 'whatsapp';
    selected_recipient := trim(c.phone);
    selected_subject := NULL;
  ELSIF coalesce(b.notification_email_enabled, true)
     AND nullif(trim(coalesce(c.email,'')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = r.business_id AND nc.channel = 'email'
         AND nc.enabled AND nc.health_status <> 'failing'
     ) THEN
    selected_channel := 'email';
    selected_recipient := trim(c.email);
    selected_subject := 'Payment receipt · ' || r.receipt_number;
  ELSIF coalesce(b.notification_sms_enabled, false)
     AND nullif(trim(coalesce(c.phone,'')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = r.business_id AND nc.channel = 'sms'
         AND nc.enabled AND nc.health_status <> 'failing'
     ) THEN
    selected_channel := 'sms';
    selected_recipient := trim(c.phone);
    selected_subject := NULL;
  ELSIF coalesce(b.notification_telegram_enabled, false)
     AND nullif(trim(coalesce(c.telegram_chat_id,'')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_notification_connections nc
       WHERE nc.business_id = r.business_id AND nc.channel = 'telegram'
         AND nc.provider = 'telegram-bot' AND nc.enabled AND nc.health_status <> 'failing'
     ) THEN
    selected_channel := 'telegram';
    selected_recipient := trim(c.telegram_chat_id);
    selected_subject := 'Payment receipt · ' || r.receipt_number;
  ELSE
    RETURN 0;
  END IF;

  selected_metadata := jsonb_build_object(
    'receipt_id', r.id,
    'receipt_number', r.receipt_number,
    'attachment_type', 'receipt_pdf',
    'attachment_filename', 'receipt-' || r.receipt_number || '.pdf',
    'idempotency_key', delivery_key,
    'delivery_idempotency_key', delivery_key,
    'delivery_attempt', 1,
    'attempted_channels', jsonb_build_array(selected_channel)
  );

  INSERT INTO public.notification_jobs(
    business_id, customer_id, invoice_id, channel, notification_type,
    recipient, subject, message, action_url, scheduled_for, metadata, delivery_idempotency_key
  )
  VALUES(
    r.business_id, r.customer_id, invoice_id, selected_channel, 'receipt',
    selected_recipient, selected_subject, body, action_url, now(), selected_metadata, delivery_key
  )
  ON CONFLICT(business_id, delivery_idempotency_key) DO NOTHING;

  GET DIAGNOSTICS queued = ROW_COUNT;
  RETURN queued;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid) TO authenticated;

COMMENT ON TABLE public.business_notification_connections IS
  'Tenant-scoped notification channels. Sensitive credentials are stored only in Supabase Vault and referenced by secret_ref.';

COMMIT;