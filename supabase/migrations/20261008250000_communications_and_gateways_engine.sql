BEGIN;

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_type WHERE typname='communication_channel' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.communication_channel AS ENUM('whatsapp','email','sms','telegram');
  END IF;
END $$;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS preferred_channel public.communication_channel NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS alternate_phone TEXT;

CREATE TABLE IF NOT EXISTS public.business_communication_providers(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  wapi_enabled BOOLEAN NOT NULL DEFAULT FALSE,wapi_instance_id TEXT,wapi_base_url TEXT DEFAULT 'https://api.wapi.com/v1',wapi_api_token_ref UUID,
  sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,sms_provider TEXT NOT NULL DEFAULT 'generic_http' CHECK(sms_provider IN('fast2sms','msg91','textlocal','generic_http','twilio')),sms_sender_id TEXT,sms_endpoint_template TEXT,sms_dlt_invoice_te_id TEXT,sms_dlt_reminder_te_id TEXT,sms_api_key_ref UUID,
  telegram_enabled BOOLEAN NOT NULL DEFAULT FALSE,telegram_default_channel_id TEXT,telegram_bot_token_ref UUID,
  smtp_enabled BOOLEAN NOT NULL DEFAULT FALSE,smtp_host TEXT,smtp_port INT NOT NULL DEFAULT 587 CHECK(smtp_port BETWEEN 1 AND 65535),smtp_secure BOOLEAN NOT NULL DEFAULT TRUE,smtp_username TEXT,smtp_from_email TEXT,smtp_from_name TEXT,smtp_password_ref UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_biz_comm_provider UNIQUE(business_id)
);
ALTER TABLE public.business_communication_providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_communication_providers_manage ON public.business_communication_providers;
CREATE POLICY business_communication_providers_manage ON public.business_communication_providers FOR ALL TO authenticated
  USING(mm_private.has_business_permission(business_id,'settings.manage',auth.uid()))
  WITH CHECK(mm_private.has_business_permission(business_id,'settings.manage',auth.uid()));
REVOKE ALL ON public.business_communication_providers FROM anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.business_communication_providers TO authenticated;

CREATE TABLE IF NOT EXISTS public.communication_dispatch_logs(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK(document_type IN('invoice','quotation','receipt','reminder','challan')),document_id UUID NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,channel public.communication_channel NOT NULL,
  recipient_target TEXT NOT NULL,payload_content TEXT NOT NULL,dispatch_status TEXT NOT NULL CHECK(dispatch_status IN('sent','failed','fallback_client')),
  error_message TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.communication_dispatch_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS communication_dispatch_logs_select ON public.communication_dispatch_logs;
CREATE POLICY communication_dispatch_logs_select ON public.communication_dispatch_logs FOR SELECT TO authenticated USING(mm_private.has_business_permission(business_id,'sales.view',auth.uid()));
REVOKE ALL ON public.communication_dispatch_logs FROM anon,authenticated;
GRANT SELECT ON public.communication_dispatch_logs TO authenticated;
CREATE INDEX IF NOT EXISTS communication_dispatch_logs_business_created_idx ON public.communication_dispatch_logs(business_id,created_at DESC);

ALTER TABLE public.business_notification_connections DROP CONSTRAINT IF EXISTS business_notification_connections_provider_check;
ALTER TABLE public.business_notification_connections ADD CONSTRAINT business_notification_connections_provider_check
CHECK(provider::text=ANY(ARRAY['wapi','telegram-bot','resend','smtp','sendgrid','twilio','fast2sms','msg91','textlocal','generic_http']));

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
    (v_channel='sms' AND v_provider NOT IN ('twilio','fast2sms','msg91','textlocal','generic_http'))
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


REVOKE ALL ON FUNCTION public.save_business_notification_connection(uuid,text,text,text,uuid,text,text,text,text,text,integer,text,boolean,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_business_notification_connection(uuid,text,text,text,uuid,text,text,text,text,text,integer,text,boolean,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_communication_dispatch_log(
  p_business_id uuid,p_document_type text,p_document_id uuid,p_customer_id uuid,p_channel text,
  p_recipient_target text,p_payload_content text,p_dispatch_status text,p_error_message text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,mm_private,pg_temp
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required' USING errcode='42501'; END IF;
  IF p_document_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.communication_dispatch_logs(
    business_id,document_type,document_id,customer_id,channel,recipient_target,payload_content,dispatch_status,error_message
  ) VALUES(p_business_id,p_document_type,p_document_id,p_customer_id,p_channel::public.communication_channel,p_recipient_target,p_payload_content,p_dispatch_status,p_error_message)
  RETURNING id INTO v_id;
  RETURN v_id;
END;$function$;
REVOKE ALL ON FUNCTION public.record_communication_dispatch_log(uuid,text,uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_communication_dispatch_log(uuid,text,uuid,uuid,text,text,text,text,text) TO service_role;

ALTER TABLE public.document_payment_settings
  ADD COLUMN IF NOT EXISTS razorpay_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS razorpay_key_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_secret_ref UUID,
  ADD COLUMN IF NOT EXISTS razorpay_webhook_secret_ref UUID,
  ADD COLUMN IF NOT EXISTS cashfree_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cashfree_app_id TEXT,
  ADD COLUMN IF NOT EXISTS cashfree_secret_ref UUID,
  ADD COLUMN IF NOT EXISTS cashfree_webhook_secret_ref UUID,
  ADD COLUMN IF NOT EXISTS stripe_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_publishable_key TEXT,
  ADD COLUMN IF NOT EXISTS stripe_secret_ref UUID,
  ADD COLUMN IF NOT EXISTS stripe_webhook_secret_ref UUID,
  ADD COLUMN IF NOT EXISTS gateway_convenience_fee_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE public.document_payment_settings DROP CONSTRAINT IF EXISTS document_payment_settings_gateway_provider_check;
ALTER TABLE public.document_payment_settings ADD CONSTRAINT document_payment_settings_gateway_provider_check
CHECK(payment_gateway_provider IS NULL OR payment_gateway_provider IN('razorpay','cashfree','stripe'));

CREATE OR REPLACE FUNCTION public.save_payment_settings(p_business_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp
AS $function$
DECLARE s public.document_payment_settings%rowtype; secret text; ref_id uuid; provider text:=nullif(lower(btrim(coalesce(p_payload->>'payment_gateway_provider',''))),''); bank_id uuid; fee numeric:=coalesce((p_payload->>'gateway_convenience_fee_pct')::numeric,0);
BEGIN
  IF auth.uid() IS NULL OR NOT mm_private.has_business_permission(p_business_id,'settings.manage',auth.uid()) THEN RAISE EXCEPTION 'permission denied' USING errcode='42501'; END IF;
  IF provider IS NOT NULL AND provider NOT IN('razorpay','cashfree','stripe') THEN RAISE EXCEPTION 'invalid payment gateway provider'; END IF;
  IF fee<0 OR fee>100 THEN RAISE EXCEPTION 'gateway convenience fee must be between 0 and 100'; END IF;
  IF nullif(p_payload->>'default_bank_account_id','') IS NOT NULL THEN bank_id:=(p_payload->>'default_bank_account_id')::uuid; END IF;
  IF bank_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.bank_accounts WHERE id=bank_id AND business_id=p_business_id AND is_active) THEN RAISE EXCEPTION 'invalid settlement bank account' USING errcode='23503'; END IF;
  SELECT * INTO s FROM public.document_payment_settings WHERE business_id=p_business_id FOR UPDATE;

  secret:=nullif(btrim(coalesce(p_payload->>'razorpay_key_secret','')),'');ref_id:=s.razorpay_secret_ref;
  IF secret IS NOT NULL THEN IF ref_id IS NULL THEN ref_id:=vault.create_secret(secret,'moneymatters-gateway-razorpay-'||p_business_id::text,'Razorpay API secret');ELSE PERFORM vault.update_secret(ref_id,secret,'moneymatters-gateway-razorpay-'||p_business_id::text,'Razorpay API secret');END IF;END IF;s.razorpay_secret_ref:=ref_id;
  secret:=nullif(btrim(coalesce(p_payload->>'razorpay_webhook_secret','')),'');ref_id:=s.razorpay_webhook_secret_ref;
  IF secret IS NOT NULL THEN IF ref_id IS NULL THEN ref_id:=vault.create_secret(secret,'moneymatters-gateway-razorpay-webhook-'||p_business_id::text,'Razorpay webhook secret');ELSE PERFORM vault.update_secret(ref_id,secret,'moneymatters-gateway-razorpay-webhook-'||p_business_id::text,'Razorpay webhook secret');END IF;END IF;s.razorpay_webhook_secret_ref:=ref_id;
  secret:=nullif(btrim(coalesce(p_payload->>'cashfree_secret_key','')),'');ref_id:=s.cashfree_secret_ref;
  IF secret IS NOT NULL THEN IF ref_id IS NULL THEN ref_id:=vault.create_secret(secret,'moneymatters-gateway-cashfree-'||p_business_id::text,'Cashfree API secret');ELSE PERFORM vault.update_secret(ref_id,secret,'moneymatters-gateway-cashfree-'||p_business_id::text,'Cashfree API secret');END IF;END IF;s.cashfree_secret_ref:=ref_id;
  secret:=nullif(btrim(coalesce(p_payload->>'cashfree_webhook_secret','')),'');ref_id:=s.cashfree_webhook_secret_ref;
  IF secret IS NOT NULL THEN IF ref_id IS NULL THEN ref_id:=vault.create_secret(secret,'moneymatters-gateway-cashfree-webhook-'||p_business_id::text,'Cashfree webhook secret');ELSE PERFORM vault.update_secret(ref_id,secret,'moneymatters-gateway-cashfree-webhook-'||p_business_id::text,'Cashfree webhook secret');END IF;END IF;s.cashfree_webhook_secret_ref:=ref_id;
  secret:=nullif(btrim(coalesce(p_payload->>'stripe_secret_key','')),'');ref_id:=s.stripe_secret_ref;
  IF secret IS NOT NULL THEN IF ref_id IS NULL THEN ref_id:=vault.create_secret(secret,'moneymatters-gateway-stripe-'||p_business_id::text,'Stripe API secret');ELSE PERFORM vault.update_secret(ref_id,secret,'moneymatters-gateway-stripe-'||p_business_id::text,'Stripe API secret');END IF;END IF;s.stripe_secret_ref:=ref_id;
  secret:=nullif(btrim(coalesce(p_payload->>'stripe_webhook_secret','')),'');ref_id:=s.stripe_webhook_secret_ref;
  IF secret IS NOT NULL THEN IF ref_id IS NULL THEN ref_id:=vault.create_secret(secret,'moneymatters-gateway-stripe-webhook-'||p_business_id::text,'Stripe webhook secret');ELSE PERFORM vault.update_secret(ref_id,secret,'moneymatters-gateway-stripe-webhook-'||p_business_id::text,'Stripe webhook secret');END IF;END IF;s.stripe_webhook_secret_ref:=ref_id;

  INSERT INTO public.document_payment_settings(
    business_id,upi_id,merchant_name,default_bank_account_id,enable_cash,enable_upi,enable_card,enable_credit,prefill_bill_amount,payment_qr_enabled,payment_instructions,qr_code_notes,
    payment_gateway_provider,payment_link_enabled,razorpay_enabled,razorpay_key_id,razorpay_secret_ref,razorpay_webhook_secret_ref,
    cashfree_enabled,cashfree_app_id,cashfree_secret_ref,cashfree_webhook_secret_ref,stripe_enabled,stripe_publishable_key,stripe_secret_ref,stripe_webhook_secret_ref,gateway_convenience_fee_pct,updated_at
  ) VALUES(
    p_business_id,nullif(btrim(coalesce(p_payload->>'upi_id','')),''),nullif(btrim(coalesce(p_payload->>'merchant_name','')),''),bank_id,
    coalesce((p_payload->>'enable_cash')::boolean,true),coalesce((p_payload->>'enable_upi')::boolean,true),coalesce((p_payload->>'enable_card')::boolean,true),coalesce((p_payload->>'enable_credit')::boolean,true),
    coalesce((p_payload->>'prefill_bill_amount')::boolean,true),coalesce((p_payload->>'payment_qr_enabled')::boolean,true),nullif(btrim(coalesce(p_payload->>'payment_instructions','')),''),nullif(btrim(coalesce(p_payload->>'qr_code_notes','')),''),
    provider,coalesce((p_payload->>'payment_link_enabled')::boolean,false),coalesce((p_payload->>'razorpay_enabled')::boolean,false),nullif(btrim(coalesce(p_payload->>'razorpay_key_id','')),''),s.razorpay_secret_ref,s.razorpay_webhook_secret_ref,
    coalesce((p_payload->>'cashfree_enabled')::boolean,false),nullif(btrim(coalesce(p_payload->>'cashfree_app_id','')),''),s.cashfree_secret_ref,s.cashfree_webhook_secret_ref,
    coalesce((p_payload->>'stripe_enabled')::boolean,false),nullif(btrim(coalesce(p_payload->>'stripe_publishable_key','')),''),s.stripe_secret_ref,s.stripe_webhook_secret_ref,fee,now()
  )
  ON CONFLICT(business_id) DO UPDATE SET
    upi_id=excluded.upi_id,merchant_name=excluded.merchant_name,default_bank_account_id=excluded.default_bank_account_id,enable_cash=excluded.enable_cash,enable_upi=excluded.enable_upi,enable_card=excluded.enable_card,enable_credit=excluded.enable_credit,prefill_bill_amount=excluded.prefill_bill_amount,payment_qr_enabled=excluded.payment_qr_enabled,payment_instructions=excluded.payment_instructions,qr_code_notes=excluded.qr_code_notes,payment_gateway_provider=excluded.payment_gateway_provider,payment_link_enabled=excluded.payment_link_enabled,
    razorpay_enabled=excluded.razorpay_enabled,razorpay_key_id=excluded.razorpay_key_id,razorpay_secret_ref=excluded.razorpay_secret_ref,razorpay_webhook_secret_ref=excluded.razorpay_webhook_secret_ref,
    cashfree_enabled=excluded.cashfree_enabled,cashfree_app_id=excluded.cashfree_app_id,cashfree_secret_ref=excluded.cashfree_secret_ref,cashfree_webhook_secret_ref=excluded.cashfree_webhook_secret_ref,
    stripe_enabled=excluded.stripe_enabled,stripe_publishable_key=excluded.stripe_publishable_key,stripe_secret_ref=excluded.stripe_secret_ref,stripe_webhook_secret_ref=excluded.stripe_webhook_secret_ref,gateway_convenience_fee_pct=excluded.gateway_convenience_fee_pct,updated_at=now();
  RETURN public.get_payment_settings(p_business_id);
END;$function$;

CREATE OR REPLACE FUNCTION public.get_payment_settings(p_business_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp
AS $function$
DECLARE v jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT mm_private.has_business_permission(p_business_id,'settings.manage',auth.uid()) THEN RAISE EXCEPTION 'permission denied' USING errcode='42501'; END IF;
 SELECT jsonb_build_object('business_id',b.id,'upi_id',coalesce(s.upi_id,''),'merchant_name',coalesce(s.merchant_name,b.legal_name,b.name,''),'default_bank_account_id',s.default_bank_account_id,
 'enable_cash',coalesce(s.enable_cash,true),'enable_upi',coalesce(s.enable_upi,true),'enable_card',coalesce(s.enable_card,true),'enable_credit',coalesce(s.enable_credit,true),'prefill_bill_amount',coalesce(s.prefill_bill_amount,true),
 'payment_qr_enabled',coalesce(s.payment_qr_enabled,true),'payment_instructions',coalesce(s.payment_instructions,''),'qr_code_notes',coalesce(s.qr_code_notes,''),'payment_gateway_provider',s.payment_gateway_provider,'payment_link_enabled',coalesce(s.payment_link_enabled,false),
 'razorpay_enabled',coalesce(s.razorpay_enabled,false),'razorpay_key_id',coalesce(s.razorpay_key_id,''),'razorpay_credentials_configured',s.razorpay_secret_ref IS NOT NULL,'razorpay_webhook_configured',s.razorpay_webhook_secret_ref IS NOT NULL,
 'cashfree_enabled',coalesce(s.cashfree_enabled,false),'cashfree_app_id',coalesce(s.cashfree_app_id,''),'cashfree_credentials_configured',s.cashfree_secret_ref IS NOT NULL,'cashfree_webhook_configured',s.cashfree_webhook_secret_ref IS NOT NULL,
 'stripe_enabled',coalesce(s.stripe_enabled,false),'stripe_publishable_key',coalesce(s.stripe_publishable_key,''),'stripe_credentials_configured',s.stripe_secret_ref IS NOT NULL,'stripe_webhook_configured',s.stripe_webhook_secret_ref IS NOT NULL,
 'gateway_convenience_fee_pct',coalesce(s.gateway_convenience_fee_pct,0)) INTO v
 FROM public.businesses b LEFT JOIN public.document_payment_settings s ON s.business_id=b.id WHERE b.id=p_business_id;
 IF v IS NULL THEN RAISE EXCEPTION 'business not found' USING errcode='P0002'; END IF; RETURN v;
END;$function$;

CREATE OR REPLACE FUNCTION public.resolve_payment_gateway_credentials(p_business_id uuid,p_provider text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp
AS $function$
DECLARE s public.document_payment_settings%rowtype;provider text:=lower(btrim(coalesce(p_provider,'')));secret text;webhook text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required' USING errcode='42501'; END IF;
 SELECT * INTO s FROM public.document_payment_settings WHERE business_id=p_business_id;
 IF s.business_id IS NULL THEN RAISE EXCEPTION 'Payment settings not configured'; END IF;
 IF provider='razorpay' THEN SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE id=s.razorpay_secret_ref;SELECT decrypted_secret INTO webhook FROM vault.decrypted_secrets WHERE id=s.razorpay_webhook_secret_ref;RETURN jsonb_build_object('provider',provider,'enabled',s.razorpay_enabled,'key_id',s.razorpay_key_id,'secret',secret,'webhook_secret',webhook);
 ELSIF provider='cashfree' THEN SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE id=s.cashfree_secret_ref;SELECT decrypted_secret INTO webhook FROM vault.decrypted_secrets WHERE id=s.cashfree_webhook_secret_ref;RETURN jsonb_build_object('provider',provider,'enabled',s.cashfree_enabled,'app_id',s.cashfree_app_id,'secret',secret,'webhook_secret',webhook);
 ELSIF provider='stripe' THEN SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE id=s.stripe_secret_ref;SELECT decrypted_secret INTO webhook FROM vault.decrypted_secrets WHERE id=s.stripe_webhook_secret_ref;RETURN jsonb_build_object('provider',provider,'enabled',s.stripe_enabled,'publishable_key',s.stripe_publishable_key,'secret',secret,'webhook_secret',webhook);
 END IF;RAISE EXCEPTION 'Unsupported payment provider';
END;$function$;
REVOKE ALL ON FUNCTION public.resolve_payment_gateway_credentials(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_payment_gateway_credentials(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION mm_private.resolve_customer_notification_route(p_business_id uuid,p_customer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,mm_private,pg_temp
AS $function$
DECLARE c public.customers%rowtype;b public.businesses%rowtype;ch text;target text;pref text;routes text[];conn boolean;biz_ok boolean;
BEGIN
 IF auth.role() NOT IN('service_role','postgres') AND NOT mm_private.has_business_permission(p_business_id,'sales.create',auth.uid()) THEN RAISE EXCEPTION 'Access denied' USING errcode='42501'; END IF;
 SELECT * INTO c FROM public.customers WHERE id=p_customer_id AND business_id=p_business_id AND is_active FOR SHARE;IF c.id IS NULL THEN RAISE EXCEPTION 'Customer not found';END IF;
 SELECT * INTO b FROM public.businesses WHERE id=p_business_id;pref:=coalesce(c.preferred_channel::text,'whatsapp');routes:=ARRAY[pref,'whatsapp','email','sms','telegram'];
 FOREACH ch IN ARRAY routes LOOP
  IF ch='whatsapp' THEN target:=nullif(btrim(coalesce(c.phone,'')),'');ELSIF ch='sms' THEN target:=nullif(btrim(coalesce(c.alternate_phone,c.phone,'')),'');ELSIF ch='email' THEN target:=nullif(btrim(coalesce(c.email,'')),'');ELSE target:=nullif(btrim(coalesce(c.telegram_chat_id,'')),'');END IF;
  IF target IS NULL THEN CONTINUE;END IF;
  biz_ok:=CASE ch WHEN 'whatsapp' THEN coalesce(b.notification_whatsapp_enabled,true) WHEN 'email' THEN coalesce(b.notification_email_enabled,true) WHEN 'sms' THEN coalesce(b.notification_sms_enabled,false) WHEN 'telegram' THEN coalesce(b.notification_telegram_enabled,true) ELSE false END;
  IF NOT biz_ok THEN CONTINUE;END IF;
  SELECT EXISTS(SELECT 1 FROM public.business_notification_connections nc WHERE nc.business_id=p_business_id AND nc.channel=ch AND nc.enabled AND nc.health_status<>'failing' AND nc.secret_ref IS NOT NULL) INTO conn;
  IF conn THEN RETURN jsonb_build_object('automated',true,'channel',ch,'recipient',target);END IF;
 END LOOP;
 target:=CASE pref WHEN 'whatsapp' THEN nullif(btrim(coalesce(c.phone,'')),'') WHEN 'sms' THEN nullif(btrim(coalesce(c.alternate_phone,c.phone,'')),'') WHEN 'email' THEN nullif(btrim(coalesce(c.email,'')),'') ELSE nullif(btrim(coalesce(c.telegram_chat_id,'')),'') END;
 IF target IS NULL THEN target:=coalesce(nullif(btrim(coalesce(c.phone,'')),''),nullif(btrim(coalesce(c.email,'')),''),nullif(btrim(coalesce(c.telegram_chat_id,'')),'') );END IF;
 RETURN jsonb_build_object('automated',false,'fallback_available',target IS NOT NULL,'channel',pref,'recipient',target);
END;$function$;
REVOKE ALL ON FUNCTION mm_private.resolve_customer_notification_route(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.dispatch_customer_document(p_business_id uuid,p_document_type text,p_document_id uuid,p_message text,p_subject text DEFAULT NULL,p_action_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,mm_private,pg_temp
AS $function$
DECLARE t text:=lower(btrim(coalesce(p_document_type,'')));bid uuid;cid uuid;route jsonb;ch text;target text;jid uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT mm_private.has_business_permission(p_business_id,'sales.create',auth.uid()) THEN RAISE EXCEPTION 'Access denied' USING errcode='42501';END IF;
 IF t IN('invoice','reminder') THEN SELECT business_id,customer_id INTO bid,cid FROM public.invoices WHERE id=p_document_id;ELSIF t='quotation' THEN SELECT business_id,customer_id INTO bid,cid FROM public.quotations WHERE id=p_document_id;ELSIF t='receipt' THEN SELECT business_id,customer_id INTO bid,cid FROM public.receipts WHERE id=p_document_id;ELSIF t='challan' THEN SELECT business_id,customer_id INTO bid,cid FROM public.delivery_challans WHERE id=p_document_id;ELSE RAISE EXCEPTION 'Unsupported document type';END IF;
 IF bid IS DISTINCT FROM p_business_id THEN RAISE EXCEPTION 'Document does not belong to selected business' USING errcode='42501';END IF;
 IF cid IS NULL THEN RAISE EXCEPTION 'Document has no customer';END IF;
 route:=mm_private.resolve_customer_notification_route(p_business_id,cid);
 IF coalesce((route->>'automated')::boolean,false) THEN
  ch:=route->>'channel';target:=route->>'recipient';
  INSERT INTO public.notification_jobs(business_id,customer_id,invoice_id,channel,notification_type,recipient,subject,message,action_url,scheduled_for,metadata)
  VALUES(p_business_id,cid,CASE WHEN t IN('invoice','reminder') THEN p_document_id ELSE NULL END,ch,t,target,p_subject,p_message,p_action_url,now(),jsonb_build_object('document_type',t,'document_id',p_document_id::text,'idempotency_key','manual:'||p_document_id::text||':'||t||':'||ch)) RETURNING id INTO jid;
  RETURN jsonb_build_object('queued',true,'job_id',jid,'channel',ch,'recipient',target);
 END IF;
 ch:=coalesce(route->>'channel','whatsapp');target:=route->>'recipient';
 IF target IS NULL THEN RETURN jsonb_build_object('queued',false,'client_fallback',false,'reason','Customer has no usable communication destination');END IF;
 INSERT INTO public.communication_dispatch_logs(business_id,document_type,document_id,customer_id,channel,recipient_target,payload_content,dispatch_status,error_message)
 VALUES(p_business_id,t,p_document_id,cid,ch,target,p_message,'fallback_client','No healthy tenant provider is configured for the selected route.');
 RETURN jsonb_build_object('queued',false,'client_fallback',true,'channel',ch,'recipient',target,'message',p_message,'action_url',p_action_url);
END;$function$;
REVOKE ALL ON FUNCTION public.dispatch_customer_document(uuid,text,uuid,text,text,text) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.dispatch_customer_document(uuid,text,uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_receipt_delivery_notifications(p_receipt_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,mm_private,pg_temp
AS $function$
DECLARE r public.receipts%rowtype;c public.customers%rowtype;route jsonb;ch text;target text;invoice_id uuid;token text;action_url text;body text;access jsonb;n int:=0;
BEGIN
 SELECT * INTO r FROM public.receipts WHERE id=p_receipt_id FOR UPDATE;IF r.id IS NULL OR r.customer_id IS NULL THEN RETURN 0;END IF;
 SELECT * INTO c FROM public.customers WHERE id=r.customer_id AND business_id=r.business_id AND is_active;IF c.id IS NULL OR NOT coalesce(c.receipt_delivery_enabled,true) THEN RETURN 0;END IF;
 SELECT p.invoice_id INTO invoice_id FROM public.payments p WHERE p.id=r.payment_id AND p.business_id=r.business_id;
 access:=public._issue_receipt_access_token(r.id,'customer_download');token:=access->>'token';action_url:='/api/receipts/pdf?token='||token;
 body:='Your payment receipt '||r.receipt_number||' from '||(SELECT coalesce(name,legal_name,'Business') FROM public.businesses WHERE id=r.business_id)||' is ready.';
 route:=mm_private.resolve_customer_notification_route(r.business_id,r.customer_id);IF NOT coalesce((route->>'automated')::boolean,false) THEN RETURN 0;END IF;
 ch:=route->>'channel';target:=route->>'recipient';
 INSERT INTO public.notification_jobs(business_id,customer_id,invoice_id,channel,notification_type,recipient,subject,message,action_url,scheduled_for,metadata,delivery_idempotency_key)
 VALUES(r.business_id,r.customer_id,invoice_id,ch,'receipt',target,CASE WHEN ch IN('email','telegram') THEN 'Payment receipt · '||r.receipt_number ELSE NULL END,body,action_url,now(),jsonb_build_object('receipt_id',r.id,'receipt_number',r.receipt_number,'document_type','receipt','document_id',r.id::text,'idempotency_key','receipt:'||r.id::text||':v4','delivery_idempotency_key','receipt:'||r.id::text||':v4'),'receipt:'||r.id::text||':v4')
 ON CONFLICT(business_id,delivery_idempotency_key) DO NOTHING;GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END;$function$;
REVOKE ALL ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid) FROM public,anon;GRANT EXECUTE ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_gateway_payment(
  p_provider text,
  p_provider_link_id text,
  p_provider_transaction_id text,
  p_event_id text,
  p_gross_amount numeric,
  p_fee_amount numeric DEFAULT 0,
  p_net_amount numeric DEFAULT NULL,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','mm_private'
AS $function$
DECLARE
  v_provider text := lower(btrim(coalesce(p_provider,'')));
  v_link public.payment_links%rowtype;
  v_inv public.invoices%rowtype;
  v_payment uuid;
  v_receipt uuid;
  v_entry uuid;
  v_ar uuid;
  v_account uuid;
  v_fee_account uuid;
  v_allocated numeric;
  v_receipt_number text;
  v_net_amount numeric;
BEGIN
  IF v_provider NOT IN ('razorpay','cashfree','stripe','payable','manual') THEN
    RAISE EXCEPTION 'Unsupported payment provider: %', v_provider;
  END IF;

  IF nullif(trim(p_provider_link_id),'') IS NULL THEN
    RAISE EXCEPTION 'Provider link id is required';
  END IF;

  IF nullif(trim(p_provider_transaction_id),'') IS NULL THEN
    RAISE EXCEPTION 'Provider transaction id is required';
  END IF;

  IF nullif(trim(p_event_id),'') IS NULL THEN
    RAISE EXCEPTION 'Provider event id is required';
  END IF;

  IF p_gross_amount IS NULL OR p_gross_amount <= 0 THEN
    RAISE EXCEPTION 'Gateway gross amount must be greater than zero';
  END IF;

  IF p_fee_amount IS NULL OR p_fee_amount < 0 THEN
    RAISE EXCEPTION 'Gateway fee amount cannot be negative';
  END IF;

  v_net_amount := coalesce(p_net_amount, p_gross_amount - p_fee_amount);

  IF v_net_amount <= 0 THEN
    RAISE EXCEPTION 'Gateway net amount must be greater than zero';
  END IF;

  IF abs((p_gross_amount - p_fee_amount) - v_net_amount) > 0.000001 THEN
    RAISE EXCEPTION 'Gateway gross, fee and net amounts do not reconcile';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(
      'gateway-transaction:' || v_provider || ':' || p_provider_transaction_id
    )
  );

  SELECT id
  INTO v_payment
  FROM public.payments
  WHERE gateway_transaction_id = p_provider_transaction_id
  LIMIT 1;

  IF v_payment IS NOT NULL THEN
    SELECT id
    INTO v_receipt
    FROM public.receipts
    WHERE payment_id = v_payment
    LIMIT 1;

    RETURN coalesce(v_receipt, v_payment);
  END IF;

  SELECT *
  INTO v_link
  FROM public.payment_links
  WHERE lower(provider) = v_provider
    AND provider_link_id = p_provider_link_id
  FOR UPDATE;

  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Payment link not found for provider % and link %',
      v_provider, p_provider_link_id;
  END IF;

  SELECT *
  INTO v_inv
  FROM public.invoices
  WHERE id = v_link.invoice_id
    AND business_id = v_link.business_id
  FOR UPDATE;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_inv.status = 'void' THEN
    RAISE EXCEPTION 'Cannot record payment for void invoice';
  END IF;

  IF v_inv.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Invoice must be posted before gateway payment';
  END IF;

  IF upper(v_link.currency_code) IS DISTINCT FROM upper(v_inv.currency_code) THEN
    RAISE EXCEPTION 'Payment link currency does not match invoice currency';
  END IF;

  IF p_gross_amount > greatest(v_inv.balance_due,0) THEN
    RAISE EXCEPTION 'Payment exceeds invoice balance';
  END IF;

  SELECT id
  INTO v_account
  FROM public.accounts
  WHERE business_id = v_link.business_id
    AND code = '1010'
    AND is_active
  LIMIT 1;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Gateway payment account is missing';
  END IF;

  SELECT id
  INTO v_ar
  FROM public.accounts
  WHERE business_id = v_link.business_id
    AND code = '1100'
    AND is_active
  LIMIT 1;

  IF v_ar IS NULL THEN
    RAISE EXCEPTION 'Accounts receivable account is missing';
  END IF;

  IF p_fee_amount > 0 THEN
    SELECT id
    INTO v_fee_account
    FROM public.accounts
    WHERE business_id = v_link.business_id
      AND code = '6200'
      AND is_active
      AND lower(account_type::text) = 'expense'
    LIMIT 1;

    IF v_fee_account IS NULL THEN
      RAISE EXCEPTION 'Payment processing fee expense account is missing';
    END IF;
  END IF;

  INSERT INTO public.payments(
    business_id,
    direction,
    customer_id,
    invoice_id,
    account_id,
    amount,
    currency_code,
    payment_date,
    method,
    reference,
    gateway_transaction_id,
    notes,
    created_by
  )
  VALUES(
    v_link.business_id,
    'inbound',
    v_inv.customer_id,
    v_inv.id,
    v_account,
    p_gross_amount,
    v_inv.currency_code,
    p_payment_date,
    'payment_gateway'::public.payment_method,
    coalesce(p_provider_transaction_id,p_event_id),
    p_provider_transaction_id,
    coalesce(
      p_notes,
      'Gateway payment: ' || v_provider
        || CASE WHEN p_fee_amount > 0
                THEN ' (fee ' || p_fee_amount || ')'
                ELSE ''
           END
    ),
    NULL
  )
  RETURNING id INTO v_payment;

  INSERT INTO public.payment_allocations(
    business_id,
    payment_id,
    invoice_id,
    amount,
    currency_code
  )
  VALUES(
    v_link.business_id,
    v_payment,
    v_inv.id,
    p_gross_amount,
    v_inv.currency_code
  );

  PERFORM pg_advisory_xact_lock(
    hashtext('journal-entry-number:' || v_link.business_id::text)
  );

  INSERT INTO public.journal_entries(
    business_id,
    entry_number,
    entry_date,
    description,
    source_type,
    source_id,
    status,
    posted_at,
    posted_by,
    created_by,
    currency_code,
    total_debit,
    total_credit,
    is_system_generated
  )
  VALUES(
    v_link.business_id,
    (
      SELECT coalesce(max(entry_number),0) + 1
      FROM public.journal_entries
      WHERE business_id = v_link.business_id
    ),
    p_payment_date,
    'Gateway payment for invoice ' || v_inv.invoice_number,
    'payment',
    v_payment,
    'posted',
    now(),
    NULL,
    NULL,
    v_inv.currency_code,
    p_gross_amount,
    p_gross_amount,
    true
  )
  RETURNING id INTO v_entry;

  IF p_fee_amount > 0 THEN
    INSERT INTO public.journal_lines(
      journal_entry_id,
      account_id,
      description,
      debit,
      credit,
      currency_code,
      entity_type,
      entity_id
    )
    VALUES(
      v_entry,
      v_account,
      'Gateway settlement received',
      v_net_amount,
      0,
      v_inv.currency_code,
      'customer',
      v_inv.customer_id
    ),
    (
      v_entry,
      v_fee_account,
      'Payment processing fee',
      p_fee_amount,
      0,
      v_inv.currency_code,
      'customer',
      v_inv.customer_id
    ),
    (
      v_entry,
      v_ar,
      'Receivable settlement',
      0,
      p_gross_amount,
      v_inv.currency_code,
      'customer',
      v_inv.customer_id
    );
  ELSE
    INSERT INTO public.journal_lines(
      journal_entry_id,
      account_id,
      description,
      debit,
      credit,
      currency_code,
      entity_type,
      entity_id
    )
    VALUES(
      v_entry,
      v_account,
      'Gateway customer payment',
      p_gross_amount,
      0,
      v_inv.currency_code,
      'customer',
      v_inv.customer_id
    ),
    (
      v_entry,
      v_ar,
      'Receivable settlement',
      0,
      p_gross_amount,
      v_inv.currency_code,
      'customer',
      v_inv.customer_id
    );
  END IF;

  PERFORM public.validate_journal_entry_balance(v_entry);

  UPDATE public.payments
  SET journal_entry_id = v_entry
  WHERE id = v_payment;

  SELECT coalesce(sum(pa.amount),0)
  INTO v_allocated
  FROM public.payment_allocations pa
  WHERE pa.invoice_id = v_inv.id
    AND upper(pa.currency_code) = upper(v_inv.currency_code);

  UPDATE public.invoices
  SET amount_paid = v_allocated,
      balance_due = greatest(total - v_allocated,0),
      status = CASE
        WHEN v_allocated >= total THEN 'paid'::invoice_status
        WHEN v_allocated > 0 AND due_date < current_date THEN 'overdue'::invoice_status
        WHEN v_allocated > 0 THEN 'partially_paid'::invoice_status
        WHEN due_date < current_date THEN 'overdue'::invoice_status
        ELSE 'sent'::invoice_status
      END,
      updated_at = now()
  WHERE id = v_inv.id;

  v_receipt_number := public.next_document_number(
    v_link.business_id,
    'receipt'
  );

  INSERT INTO public.receipts(
    business_id,
    customer_id,
    payment_id,
    receipt_number,
    receipt_date,
    amount,
    currency_code,
    payment_method,
    reference_number,
    notes,
    created_by
  )
  VALUES(
    v_link.business_id,
    v_inv.customer_id,
    v_payment,
    v_receipt_number,
    p_payment_date,
    p_gross_amount,
    v_inv.currency_code,
    'payment_gateway',
    p_provider_transaction_id,
    p_notes,
    NULL
  )
  RETURNING id INTO v_receipt;

  RETURN v_receipt;
END;
$function$;


COMMIT;