BEGIN;

-- Pillar 1: developer API keys + durable outbound webhook queue.
-- No banking/reconciliation objects are changed by this migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash char(64) NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_keys_name_chk CHECK (btrim(name) <> ''),
  CONSTRAINT api_keys_prefix_chk CHECK (key_prefix ~ '^mm_live_[A-Za-z0-9_-]{6,24}$'),
  CONSTRAINT api_keys_hash_chk CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT api_keys_scopes_chk CHECK (
    scopes <@ ARRAY[
      'invoices:read','invoices:write',
      'customers:read','customers:write',
      'inventory:read'
    ]::text[]
  ),
  CONSTRAINT api_keys_expiry_chk CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_uidx ON public.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS api_keys_business_idx ON public.api_keys(business_id,created_at DESC);
CREATE INDEX IF NOT EXISTS api_keys_active_idx ON public.api_keys(business_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_keys_member_select ON public.api_keys;
CREATE POLICY api_keys_member_select ON public.api_keys
FOR SELECT TO authenticated
USING (mm_private.has_business_permission(business_id,'integrations.manage'));
DROP POLICY IF EXISTS api_keys_member_insert ON public.api_keys;
CREATE POLICY api_keys_member_insert ON public.api_keys
FOR INSERT TO authenticated
WITH CHECK (
  mm_private.has_business_permission(business_id,'integrations.manage')
  AND created_by = auth.uid()
);
DROP POLICY IF EXISTS api_keys_member_update ON public.api_keys;
CREATE POLICY api_keys_member_update ON public.api_keys
FOR UPDATE TO authenticated
USING (mm_private.has_business_permission(business_id,'integrations.manage'))
WITH CHECK (mm_private.has_business_permission(business_id,'integrations.manage'));
REVOKE ALL ON TABLE public.api_keys FROM anon;
GRANT SELECT,INSERT,UPDATE ON TABLE public.api_keys TO authenticated;

CREATE TABLE IF NOT EXISTS public.webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_url text NOT NULL,
  secret text NOT NULL,
  subscribed_events text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_subscription_name_chk CHECK (btrim(name)<>''),
  CONSTRAINT webhook_subscription_url_chk CHECK (target_url ~ '^https://'),
  CONSTRAINT webhook_subscription_secret_chk CHECK (length(secret)>=32),
  CONSTRAINT webhook_subscription_events_chk CHECK (
    subscribed_events <@ ARRAY[
      'invoice.posted','payment.received','stock.threshold_breached'
    ]::text[]
  )
);

CREATE INDEX IF NOT EXISTS webhook_subscriptions_business_idx
  ON public.webhook_subscriptions(business_id,is_active);

ALTER TABLE public.webhook_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_subscriptions_member_select ON public.webhook_subscriptions;
CREATE POLICY webhook_subscriptions_member_select ON public.webhook_subscriptions
FOR SELECT TO authenticated
USING (mm_private.has_business_permission(business_id,'integrations.manage'));
DROP POLICY IF EXISTS webhook_subscriptions_member_insert ON public.webhook_subscriptions;
CREATE POLICY webhook_subscriptions_member_insert ON public.webhook_subscriptions
FOR INSERT TO authenticated
WITH CHECK (
  mm_private.has_business_permission(business_id,'integrations.manage')
  AND created_by = auth.uid()
);
DROP POLICY IF EXISTS webhook_subscriptions_member_update ON public.webhook_subscriptions;
CREATE POLICY webhook_subscriptions_member_update ON public.webhook_subscriptions
FOR UPDATE TO authenticated
USING (mm_private.has_business_permission(business_id,'integrations.manage'))
WITH CHECK (mm_private.has_business_permission(business_id,'integrations.manage'));
REVOKE ALL ON TABLE public.webhook_subscriptions FROM anon,authenticated;
GRANT SELECT (
  id,business_id,name,target_url,subscribed_events,is_active,created_by,created_at,updated_at
) ON public.webhook_subscriptions TO authenticated;

-- Do not expose webhook secrets through the Data API.
CREATE OR REPLACE VIEW public.webhook_subscriptions_safe
WITH (security_invoker=true)
AS
SELECT id,business_id,name,target_url,subscribed_events,is_active,created_by,created_at,updated_at
FROM public.webhook_subscriptions;

GRANT SELECT ON public.webhook_subscriptions_safe TO authenticated;

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  CONSTRAINT webhook_events_status_chk CHECK (status IN ('queued','processing','processed','failed')),
  CONSTRAINT webhook_events_type_chk CHECK (
    event_type IN ('invoice.posted','payment.received','stock.threshold_breached')
  )
);
CREATE INDEX IF NOT EXISTS webhook_events_queue_idx
  ON public.webhook_events(status,created_at);
CREATE INDEX IF NOT EXISTS webhook_events_business_idx
  ON public.webhook_events(business_id,created_at DESC);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.webhook_events FROM anon,authenticated;

CREATE TABLE IF NOT EXISTS public.webhook_delivery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.webhook_subscriptions(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.webhook_events(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  target_url text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued',
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  request_timestamp bigint,
  signature text,
  response_status integer,
  response_body text,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_delivery_status_chk CHECK (status IN ('queued','processing','delivered','failed')),
  CONSTRAINT webhook_delivery_attempt_chk CHECK (attempt >= 0 AND attempt <= 5)
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_delivery_event_uidx
  ON public.webhook_delivery_logs(subscription_id,event_id);
CREATE INDEX IF NOT EXISTS webhook_delivery_queue_idx
  ON public.webhook_delivery_logs(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS webhook_delivery_business_idx
  ON public.webhook_delivery_logs(business_id,created_at DESC);

ALTER TABLE public.webhook_delivery_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.webhook_delivery_logs FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_webhook_event(
  p_business_id uuid,p_event_type text,p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,mm_private
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_event_type NOT IN ('invoice.posted','payment.received','stock.threshold_breached') THEN
    RAISE EXCEPTION 'Unsupported webhook event type';
  END IF;

  INSERT INTO public.webhook_events(business_id,event_type,payload)
  VALUES(p_business_id,p_event_type,coalesce(p_payload,'{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_webhook_event(uuid,text,jsonb)
FROM public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.materialize_webhook_deliveries(p_limit integer DEFAULT 25)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,mm_private
AS $$
DECLARE
  e record;
  s record;
  v_count integer := 0;
BEGIN
  FOR e IN
    WITH claim AS (
      SELECT id FROM public.webhook_events
      WHERE status='queued'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT greatest(1,least(p_limit,100))
    )
    UPDATE public.webhook_events we
    SET status='processing'
    FROM claim c
    WHERE we.id=c.id
    RETURNING we.*
  LOOP
    FOR s IN
      SELECT * FROM public.webhook_subscriptions
      WHERE business_id=e.business_id
        AND is_active
        AND e.event_type = ANY(subscribed_events)
    LOOP
      INSERT INTO public.webhook_delivery_logs(
        subscription_id,event_id,business_id,event_type,target_url,payload
      )
      VALUES(s.id,e.id,e.business_id,e.event_type,s.target_url,e.payload)
      ON CONFLICT(subscription_id,event_id) DO NOTHING;
      v_count := v_count + 1;
    END LOOP;

    UPDATE public.webhook_events
    SET status='processed',processed_at=now()
    WHERE id=e.id;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_webhook_deliveries(p_limit integer DEFAULT 25)
RETURNS TABLE(
  id uuid,subscription_id uuid,event_id uuid,business_id uuid,event_type text,
  target_url text,secret text,payload jsonb,attempt integer
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,mm_private
AS $$
BEGIN
  RETURN QUERY
  WITH claim AS (
    SELECT w.id
    FROM public.webhook_delivery_logs w
    WHERE w.status='queued'
      AND w.next_attempt_at<=now()
    ORDER BY w.next_attempt_at,w.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1,least(p_limit,100))
  ), bumped AS (
    UPDATE public.webhook_delivery_logs w
    SET attempt=w.attempt+1,status='processing',updated_at=now()
    FROM claim c
    WHERE w.id=c.id AND w.attempt < 5
    RETURNING w.*
  )
  SELECT b.id,b.subscription_id,b.event_id,b.business_id,b.event_type,
         b.target_url,s.secret,b.payload,b.attempt
  FROM bumped b
  JOIN public.webhook_subscriptions s ON s.id=b.subscription_id
  WHERE s.is_active;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_webhook_deliveries(integer)
FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_webhook_deliveries(integer)
FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_webhook_deliveries(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_webhook_deliveries(integer) TO service_role;

-- External-API mutation bridge. It preserves the existing financial RPC
-- and authorization path by executing it with the API key creator as actor.
CREATE OR REPLACE FUNCTION public.api_create_invoice_from_items(
  p_api_key_hash text,
  p_business_id uuid,
  p_customer_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_items jsonb,
  p_invoice_discount_type text DEFAULT NULL,
  p_invoice_discount_value numeric DEFAULT 0,
  p_notes text DEFAULT NULL,
  p_terms text DEFAULT NULL,
  p_post boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,mm_private
AS $$
DECLARE
  k public.api_keys%rowtype;
  v_invoice uuid;
BEGIN
  SELECT * INTO k
  FROM public.api_keys
  WHERE key_hash=lower(btrim(p_api_key_hash))
    AND business_id=p_business_id
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at>now())
  FOR UPDATE;

  IF k.id IS NULL THEN RAISE EXCEPTION 'Invalid or expired API key'; END IF;
  IF NOT ('invoices:write'=ANY(k.scopes)) THEN RAISE EXCEPTION 'API key lacks invoices:write scope'; END IF;
  IF k.created_by IS NULL THEN RAISE EXCEPTION 'API key actor is not available'; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.businesses b
    JOIN public.organization_members om ON om.organization_id=b.organization_id
    WHERE b.id=p_business_id AND om.user_id=k.created_by AND om.is_active
  ) THEN
    RAISE EXCEPTION 'API key actor is no longer a business member';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',k.created_by::text,true);

  v_invoice := public.create_invoice_from_items(
    p_business_id,p_customer_id,p_invoice_date,p_due_date,p_items,
    p_invoice_discount_type,p_invoice_discount_value,p_notes,p_terms
  );

  IF p_post THEN
    PERFORM public.post_invoice(v_invoice,NULL);
  END IF;

  UPDATE public.api_keys SET last_used_at=now(),updated_at=now() WHERE id=k.id;
  RETURN v_invoice;
END;
$$;

REVOKE ALL ON FUNCTION public.api_create_invoice_from_items(
  text,uuid,uuid,date,date,jsonb,text,numeric,text,text,boolean
) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_invoice_from_items(
  text,uuid,uuid,date,date,jsonb,text,numeric,text,text,boolean
) TO service_role;

-- Non-financial customer write bridge for API keys. The route validates shape;
-- this function enforces tenant and key scope at the database boundary.
CREATE OR REPLACE FUNCTION public.api_create_customer(
  p_api_key_hash text,p_business_id uuid,p_customer jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,mm_private
AS $$
DECLARE k public.api_keys%rowtype; v_customer uuid;
BEGIN
  SELECT * INTO k FROM public.api_keys
  WHERE key_hash=lower(btrim(p_api_key_hash))
    AND business_id=p_business_id AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at>now())
  FOR UPDATE;
  IF k.id IS NULL THEN RAISE EXCEPTION 'Invalid or expired API key'; END IF;
  IF NOT ('customers:write'=ANY(k.scopes)) THEN RAISE EXCEPTION 'API key lacks customers:write scope'; END IF;
  IF k.created_by IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.businesses b
    JOIN public.organization_members om ON om.organization_id=b.organization_id
    WHERE b.id=p_business_id AND om.user_id=k.created_by AND om.is_active
  ) THEN RAISE EXCEPTION 'API key actor is no longer a business member'; END IF;

  PERFORM set_config('request.jwt.claim.sub',k.created_by::text,true);

  INSERT INTO public.customers(
    business_id,display_name,legal_name,email,phone,tax_id,tax_id_type,
    billing_address,shipping_address,credit_limit,payment_terms,notes,is_active
  )
  VALUES(
    p_business_id,
    nullif(btrim(p_customer->>'display_name'),''),
    nullif(btrim(p_customer->>'legal_name'),''),
    nullif(btrim(p_customer->>'email'),''),
    nullif(btrim(p_customer->>'phone'),''),
    nullif(btrim(p_customer->>'tax_id'),''),
    nullif(btrim(p_customer->>'tax_id_type'),''),
    coalesce(p_customer->'billing_address','{}'::jsonb),
    coalesce(p_customer->'shipping_address','{}'::jsonb),
    coalesce((p_customer->>'credit_limit')::numeric,0),
    nullif(btrim(p_customer->>'payment_terms'),''),
    nullif(btrim(p_customer->>'notes'),''),
    true
  )
  RETURNING id INTO v_customer;

  UPDATE public.api_keys SET last_used_at=now(),updated_at=now() WHERE id=k.id;
  RETURN v_customer;
END;
$$;

REVOKE ALL ON FUNCTION public.api_create_customer(text,uuid,jsonb)
FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_customer(text,uuid,jsonb) TO service_role;

-- Trigger-only hooks intentionally swallow failures so webhook infrastructure
-- can never roll back a financial posting.
CREATE OR REPLACE FUNCTION public.trg_webhook_invoice_posted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
BEGIN
  IF NEW.journal_entry_id IS NOT NULL AND OLD.journal_entry_id IS NULL THEN
    BEGIN
      PERFORM public.enqueue_webhook_event(
        NEW.business_id,'invoice.posted',
        jsonb_build_object(
          'invoice_id',NEW.id,
          'invoice_number',NEW.invoice_number,
          'customer_id',NEW.customer_id,
          'total',NEW.total,
          'currency_code',NEW.currency_code
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Webhook invoice.posted enqueue failed: %',SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_webhook_invoice_posted ON public.invoices;
CREATE TRIGGER trg_webhook_invoice_posted
AFTER UPDATE OF journal_entry_id ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_webhook_invoice_posted();

CREATE OR REPLACE FUNCTION public.trg_webhook_payment_received()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
BEGIN
  IF NEW.direction='inbound' THEN
    BEGIN
      PERFORM public.enqueue_webhook_event(
        NEW.business_id,'payment.received',
        jsonb_build_object(
          'payment_id',NEW.id,
          'invoice_id',NEW.invoice_id,
          'customer_id',NEW.customer_id,
          'amount',NEW.amount,
          'currency_code',NEW.currency_code,
          'payment_method',NEW.method,
          'payment_date',NEW.payment_date
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Webhook payment.received enqueue failed: %',SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_webhook_payment_received ON public.payments;
CREATE TRIGGER trg_webhook_payment_received
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.trg_webhook_payment_received();

CREATE OR REPLACE FUNCTION public.trg_webhook_stock_threshold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,mm_private AS $$
DECLARE p public.products_services%rowtype;
BEGIN
  IF NEW.quantity_on_hand IS NOT DISTINCT FROM OLD.quantity_on_hand
     OR NEW.quantity_on_hand > OLD.quantity_on_hand THEN
    RETURN NEW;
  END IF;

  SELECT * INTO p FROM public.products_services
  WHERE id=NEW.product_service_id AND business_id=NEW.business_id AND is_active;

  IF p.id IS NULL OR NOT p.inventory_tracked THEN RETURN NEW; END IF;

  IF p.reorder_level > 0
     AND OLD.quantity_on_hand > p.reorder_level
     AND NEW.quantity_on_hand <= p.reorder_level THEN
    BEGIN
      PERFORM public.enqueue_webhook_event(
        NEW.business_id,'stock.threshold_breached',
        jsonb_build_object(
          'product_service_id',NEW.product_service_id,
          'location_id',NEW.location_id,
          'quantity_on_hand',NEW.quantity_on_hand,
          'reorder_level',p.reorder_level
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Webhook stock.threshold_breached enqueue failed: %',SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_webhook_stock_threshold ON public.inventory_balances;
CREATE TRIGGER trg_webhook_stock_threshold
AFTER UPDATE OF quantity_on_hand ON public.inventory_balances
FOR EACH ROW EXECUTE FUNCTION public.trg_webhook_stock_threshold();

REVOKE ALL ON FUNCTION public.trg_webhook_invoice_posted() FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.trg_webhook_payment_received() FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.trg_webhook_stock_threshold() FROM public,anon,authenticated;

-- Explicitly document the public API surface for tooling/QA.
CREATE TABLE IF NOT EXISTS public.saas_entitlements (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_code text NOT NULL DEFAULT 'starter',
  api_enabled boolean NOT NULL DEFAULT false,
  e_invoicing_enabled boolean NOT NULL DEFAULT false,
  offline_pos_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.saas_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saas_entitlements_member_select ON public.saas_entitlements;
CREATE POLICY saas_entitlements_member_select ON public.saas_entitlements
FOR SELECT TO authenticated
USING (mm_private.is_org_member((SELECT organization_id FROM public.businesses WHERE id=saas_entitlements.business_id)));
REVOKE INSERT,UPDATE,DELETE ON public.saas_entitlements FROM anon,authenticated;
GRANT SELECT ON public.saas_entitlements TO authenticated;

INSERT INTO public.saas_entitlements(business_id)
SELECT id FROM public.businesses
ON CONFLICT (business_id) DO NOTHING;


-- Small authenticated wrapper keeps the established mm_private permission engine
-- usable from the application layer without exposing the private schema.
CREATE OR REPLACE FUNCTION public.has_my_business_permission(
  p_business_id uuid,p_permission text
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,mm_private
AS $
  SELECT mm_private.has_business_permission(p_business_id,p_permission,auth.uid());
$;
REVOKE ALL ON FUNCTION public.has_my_business_permission(uuid,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.has_my_business_permission(uuid,text) TO authenticated;

COMMIT;