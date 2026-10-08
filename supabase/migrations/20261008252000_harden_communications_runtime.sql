BEGIN;

-- Harden customer routing against schema drift: notification feature flags live
-- in business_preferences, not businesses.
CREATE OR REPLACE FUNCTION mm_private.resolve_customer_notification_route(
  p_business_id uuid,
  p_customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,mm_private,pg_temp
AS $function$
DECLARE
  c public.customers%rowtype;
  bp public.business_preferences%rowtype;
  ch text;
  target text;
  pref text;
  routes text[];
  conn boolean;
  biz_ok boolean;
BEGIN
  IF auth.role() NOT IN ('service_role','postgres')
     AND NOT mm_private.has_business_permission(p_business_id,'sales.create',auth.uid())
  THEN
    RAISE EXCEPTION 'Access denied' USING errcode='42501';
  END IF;

  SELECT * INTO c
  FROM public.customers
  WHERE id=p_customer_id
    AND business_id=p_business_id
    AND is_active
  FOR SHARE;

  IF c.id IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;

  SELECT * INTO bp
  FROM public.business_preferences
  WHERE business_id=p_business_id;

  pref := coalesce(c.preferred_channel::text,'whatsapp');
  routes := ARRAY[pref,'whatsapp','email','sms','telegram'];

  FOREACH ch IN ARRAY routes LOOP
    IF ch='whatsapp' THEN target := nullif(btrim(coalesce(c.phone,'')),'');
    ELSIF ch='sms' THEN target := nullif(btrim(coalesce(c.alternate_phone,c.phone,'')),'');
    ELSIF ch='email' THEN target := nullif(btrim(coalesce(c.email,'')),'');
    ELSE target := nullif(btrim(coalesce(c.telegram_chat_id,'')),'');
    END IF;

    IF target IS NULL THEN CONTINUE; END IF;

    biz_ok := CASE ch
      WHEN 'whatsapp' THEN coalesce(bp.notification_whatsapp_enabled,true)
      WHEN 'email' THEN coalesce(bp.notification_email_enabled,true)
      WHEN 'sms' THEN coalesce(bp.notification_sms_enabled,false)
      WHEN 'telegram' THEN coalesce(bp.notification_telegram_enabled,true)
      ELSE false
    END;

    IF NOT biz_ok THEN CONTINUE; END IF;

    SELECT EXISTS(
      SELECT 1
      FROM public.business_notification_connections nc
      WHERE nc.business_id=p_business_id
        AND nc.channel=ch
        AND nc.enabled=true
        AND nc.health_status<>'failing'
        AND nc.secret_ref IS NOT NULL
    ) INTO conn;

    IF conn THEN
      RETURN jsonb_build_object('automated',true,'channel',ch,'recipient',target);
    END IF;
  END LOOP;

  target := CASE pref
    WHEN 'whatsapp' THEN nullif(btrim(coalesce(c.phone,'')),'')
    WHEN 'sms' THEN nullif(btrim(coalesce(c.alternate_phone,c.phone,'')),'')
    WHEN 'email' THEN nullif(btrim(coalesce(c.email,'')),'')
    ELSE nullif(btrim(coalesce(c.telegram_chat_id,'')),'')
  END;

  IF target IS NULL THEN
    target := coalesce(
      nullif(btrim(coalesce(c.phone,'')),''),
      nullif(btrim(coalesce(c.email,'')),''),
      nullif(btrim(coalesce(c.telegram_chat_id,'')),'')
    );
  END IF;

  RETURN jsonb_build_object(
    'automated',false,
    'fallback_available',target IS NOT NULL,
    'channel',pref,
    'recipient',target
  );
END;
$function$;

REVOKE ALL ON FUNCTION mm_private.resolve_customer_notification_route(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mm_private.resolve_customer_notification_route(uuid,uuid)
  TO service_role;

-- Supabase hosted Edge Functions cannot establish SMTP connections on ports 25/587.
-- Reject those ports at the tenant connection boundary instead of allowing a
-- configuration that will fail only at delivery time.
CREATE OR REPLACE FUNCTION mm_private.guard_hosted_smtp_port()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public,pg_temp
AS $function$
DECLARE
  port_value integer;
BEGIN
  IF NEW.provider='smtp' THEN
    port_value := coalesce((NEW.config->>'port')::integer,465);
    IF port_value IN (25,587) THEN
      RAISE EXCEPTION
        'SMTP port % is not permitted by Supabase hosted Edge Functions; use port 465 or another permitted relay port.',
        port_value
        USING errcode='22023';
    END IF;
    IF port_value < 1 OR port_value > 65535 THEN
      RAISE EXCEPTION 'SMTP port must be between 1 and 65535.'
        USING errcode='22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_hosted_smtp_port
  ON public.business_notification_connections;
CREATE TRIGGER trg_guard_hosted_smtp_port
BEFORE INSERT OR UPDATE ON public.business_notification_connections
FOR EACH ROW
EXECUTE FUNCTION mm_private.guard_hosted_smtp_port();

COMMIT;
