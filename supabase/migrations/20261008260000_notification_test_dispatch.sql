-- Test-only notification queueing with a single-job worker dispatch path.
-- Secrets remain in Vault; this function never accepts or stores credentials.
CREATE OR REPLACE FUNCTION public.queue_notification_test(
  p_business_id uuid,
  p_channel text,
  p_recipient text,
  p_subject text DEFAULT NULL,
  p_message text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, mm_private, pg_temp
AS $function$
DECLARE
  v_channel text := lower(btrim(coalesce(p_channel,'')));
  v_recipient text := nullif(btrim(coalesce(p_recipient,'')),'');
  v_job_id uuid := gen_random_uuid();
  v_connection public.business_notification_connections%rowtype;
BEGIN
  IF auth.uid() IS NULL OR NOT mm_private.has_business_permission(p_business_id,'settings.manage',auth.uid()) THEN
    RAISE EXCEPTION 'Settings access denied' USING errcode='42501';
  END IF;
  IF v_channel NOT IN ('whatsapp','sms','telegram','email') THEN
    RAISE EXCEPTION 'Unsupported notification channel' USING errcode='22023';
  END IF;
  IF v_recipient IS NULL THEN
    RAISE EXCEPTION 'Test recipient is required' USING errcode='22023';
  END IF;

  SELECT *
  INTO v_connection
  FROM public.business_notification_connections
  WHERE business_id=p_business_id
    AND channel=v_channel
    AND enabled
    AND secret_ref IS NOT NULL
    AND health_status <> 'failing'
  ORDER BY priority, created_at
  LIMIT 1;

  IF v_connection.id IS NULL THEN
    RAISE EXCEPTION 'No active % notification connection is configured', v_channel;
  END IF;

  INSERT INTO public.notification_jobs(
    id,business_id,customer_id,invoice_id,channel,notification_type,recipient,subject,message,
    action_url,scheduled_for,sent_at,status,attempts,last_error,provider_message_id,metadata,
    created_at,updated_at,vendor_id,delivery_idempotency_key
  ) VALUES(
    v_job_id,p_business_id,NULL,NULL,v_channel,'manual_test',v_recipient,
    nullif(btrim(coalesce(p_subject,'')),''),
    coalesce(nullif(btrim(coalesce(p_message,'')),''),
      'Moneymatters connectivity test · '||initcap(v_channel)),
    NULL,now(),NULL,'queued',0,NULL,NULL,
    jsonb_build_object('test',true,'connection_id',v_connection.id,'provider',v_connection.provider),
    now(),now(),NULL,'manual-test:'||v_job_id::text
  );

  RETURN v_job_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.queue_notification_test(uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_notification_test(uuid,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_notification_job(p_job_id uuid)
RETURNS SETOF public.notification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, mm_private, pg_temp
AS $function$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode='42501';
  END IF;

  RETURN QUERY
  UPDATE public.notification_jobs
  SET status='processing', attempts=attempts+1, updated_at=now(), last_error=NULL
  WHERE id=p_job_id
    AND status='queued'
    AND scheduled_for<=now()
    AND attempts<5
  RETURNING *;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_notification_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_job(uuid) TO service_role;

-- The worker already supports SendGrid; keep the settings RPC contract aligned.
CREATE OR REPLACE FUNCTION public.save_business_notification_connection(
  p_business_id uuid, p_channel text, p_provider text, p_display_name text,
  p_connection_id uuid DEFAULT NULL, p_endpoint_url text DEFAULT NULL,
  p_external_instance_id text DEFAULT NULL, p_secret text DEFAULT NULL,
  p_sender text DEFAULT NULL, p_default_recipient text DEFAULT NULL,
  p_priority integer DEFAULT 1, p_failover_group text DEFAULT NULL,
  p_enabled boolean DEFAULT true, p_config jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, mm_private
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
    (v_channel='email' AND v_provider NOT IN ('resend','smtp','sendgrid')) OR
    (v_channel='sms' AND v_provider NOT IN ('twilio','fast2sms','msg91','textlocal','generic_http'))
  ) THEN
    RAISE EXCEPTION 'Provider is not valid for the selected notification channel';
  END IF;
  IF v_config ?| ARRAY['api_key','apikey','access_token','bot_token','auth_token','password','smtp_password','credential','secret'] THEN
    RAISE EXCEPTION 'Sensitive values must be stored in Supabase Vault, not connection config';
  END IF;
  IF p_priority IS NULL OR p_priority < 1 THEN RAISE EXCEPTION 'Connection priority must be positive'; END IF;

  IF p_connection_id IS NULL THEN
    INSERT INTO public.business_notification_connections(
      business_id, channel, provider, display_name, endpoint_url, external_instance_id,
      sender, default_recipient, priority, failover_group, enabled, config
    ) VALUES(
      p_business_id, v_channel, v_provider, v_name, nullif(btrim(p_endpoint_url), ''),
      nullif(btrim(p_external_instance_id), ''), nullif(btrim(p_sender), ''),
      nullif(btrim(p_default_recipient), ''), p_priority, nullif(btrim(p_failover_group), ''),
      coalesce(p_enabled, true), v_config
    ) RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_connection
    FROM public.business_notification_connections
    WHERE id=p_connection_id AND business_id=p_business_id
    FOR UPDATE;
    IF v_connection.id IS NULL THEN RAISE EXCEPTION 'Notification connection not found'; END IF;
    v_id:=v_connection.id; v_secret_ref:=v_connection.secret_ref;

    UPDATE public.business_notification_connections
    SET channel=v_channel, provider=v_provider, display_name=v_name,
        endpoint_url=nullif(btrim(p_endpoint_url), ''),
        external_instance_id=nullif(btrim(p_external_instance_id), ''),
        sender=nullif(btrim(p_sender), ''),
        default_recipient=nullif(btrim(p_default_recipient), ''),
        priority=p_priority, failover_group=nullif(btrim(p_failover_group), ''),
        enabled=coalesce(p_enabled,true), config=v_config, updated_at=now()
    WHERE id=v_id;
  END IF;

  IF v_secret IS NOT NULL THEN
    IF v_secret_ref IS NULL THEN
      v_secret_ref:=vault.create_secret(v_secret,'moneymatters-notification-'||v_id::text,'Moneymatters tenant notification credential');
    ELSE
      PERFORM vault.update_secret(v_secret_ref,v_secret,'moneymatters-notification-'||v_id::text,'Moneymatters tenant notification credential');
    END IF;
    UPDATE public.business_notification_connections
    SET secret_ref=v_secret_ref,last_error=NULL,health_status='healthy',updated_at=now()
    WHERE id=v_id;
  ELSIF v_secret_ref IS NULL THEN
    RAISE EXCEPTION 'A provider secret is required for a new notification connection';
  END IF;

  SELECT * INTO v_connection FROM public.business_notification_connections WHERE id=v_id;
  RETURN jsonb_build_object(
    'id',v_connection.id,'business_id',v_connection.business_id,'channel',v_connection.channel,
    'provider',v_connection.provider,'display_name',v_connection.display_name,'endpoint_url',v_connection.endpoint_url,
    'external_instance_id',v_connection.external_instance_id,'sender',v_connection.sender,
    'default_recipient',v_connection.default_recipient,'priority',v_connection.priority,
    'failover_group',v_connection.failover_group,'enabled',v_connection.enabled,
    'health_status',v_connection.health_status,'last_health_check_at',v_connection.last_health_check_at,
    'last_error',v_connection.last_error,'has_secret',v_connection.secret_ref IS NOT NULL,'config',v_connection.config
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_business_notification_connection(uuid,text,text,text,uuid,text,text,text,text,text,integer,text,boolean,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_business_notification_connection(uuid,text,text,text,uuid,text,text,text,text,text,integer,text,boolean,jsonb) TO authenticated;
