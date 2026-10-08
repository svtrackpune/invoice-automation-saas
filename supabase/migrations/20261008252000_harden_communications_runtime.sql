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
CREATE OR REPLACE FUNCTION public.dispatch_customer_document(
  p_business_id uuid,
  p_document_type text,
  p_document_id uuid,
  p_message text,
  p_subject text DEFAULT NULL,
  p_action_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public,mm_private,pg_temp
AS $function$
DECLARE
  t text := lower(btrim(coalesce(p_document_type,'')));
  bid uuid;
  cid uuid;
  route jsonb;
  ch text;
  target text;
  jid uuid;
BEGIN
  IF auth.uid() IS NULL
     OR NOT mm_private.has_business_permission(p_business_id,'sales.create',auth.uid())
  THEN
    RAISE EXCEPTION 'Access denied' USING errcode='42501';
  END IF;

  IF t IN ('invoice','reminder') THEN
    SELECT business_id,customer_id INTO bid,cid FROM public.invoices WHERE id=p_document_id;
  ELSIF t='quotation' THEN
    SELECT business_id,customer_id INTO bid,cid FROM public.quotations WHERE id=p_document_id;
  ELSIF t='receipt' THEN
    SELECT business_id,customer_id INTO bid,cid FROM public.receipts WHERE id=p_document_id;
  ELSIF t='challan' THEN
    SELECT business_id,customer_id INTO bid,cid FROM public.delivery_challans WHERE id=p_document_id;
  ELSE
    RAISE EXCEPTION 'Unsupported document type';
  END IF;

  IF bid IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'Document does not belong to selected business' USING errcode='42501';
  END IF;
  IF cid IS NULL THEN RAISE EXCEPTION 'Document has no customer'; END IF;

  route := mm_private.resolve_customer_notification_route(p_business_id,cid);

  IF coalesce((route->>'automated')::boolean,false) THEN
    ch := route->>'channel';
    target := route->>'recipient';

    INSERT INTO public.notification_jobs(
      business_id,customer_id,invoice_id,channel,notification_type,recipient,
      subject,message,action_url,scheduled_for,metadata
    )
    VALUES(
      p_business_id,cid,
      CASE WHEN t IN ('invoice','reminder') THEN p_document_id ELSE NULL END,
      ch,t,target,p_subject,p_message,p_action_url,now(),
      jsonb_build_object(
        'document_type',t,
        'document_id',p_document_id::text,
        'idempotency_key','manual:'||p_document_id::text||':'||t||':'||ch
      )
    )
    RETURNING id INTO jid;

    RETURN jsonb_build_object(
      'queued',true,
      'job_id',jid,
      'channel',ch,
      'recipient',target
    );
  END IF;

  ch := coalesce(route->>'channel','whatsapp');
  target := route->>'recipient';

  IF target IS NULL THEN
    RETURN jsonb_build_object(
      'queued',false,
      'client_fallback',false,
      'reason','Customer has no usable communication destination'
    );
  END IF;

  INSERT INTO public.communication_dispatch_logs(
    business_id,document_type,document_id,customer_id,channel,
    recipient_target,payload_content,dispatch_status,error_message
  )
  VALUES(
    p_business_id,t,p_document_id,cid,
    ch::public.communication_channel,
    target,p_message,'fallback_client',
    'No healthy tenant provider is configured for the selected route.'
  );

  RETURN jsonb_build_object(
    'queued',false,
    'client_fallback',true,
    'channel',ch,
    'recipient',target,
    'message',p_message,
    'action_url',p_action_url
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dispatch_customer_document(uuid,text,uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dispatch_customer_document(uuid,text,uuid,text,text,text) TO authenticated;

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
