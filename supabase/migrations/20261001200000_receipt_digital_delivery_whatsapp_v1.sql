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

CREATE INDEX IF NOT EXISTS idx_receipt_access_tokens_hash
  ON public.receipt_access_tokens(token_hash);

ALTER TABLE public.receipt_access_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receipt_access_tokens_select_none ON public.receipt_access_tokens;
DROP POLICY IF EXISTS receipt_access_tokens_insert_none ON public.receipt_access_tokens;
DROP POLICY IF EXISTS receipt_access_tokens_update_none ON public.receipt_access_tokens;
DROP POLICY IF EXISTS receipt_access_tokens_delete_none ON public.receipt_access_tokens;

CREATE TABLE IF NOT EXISTS public.receipt_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel = 'whatsapp'),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','submitted','delivered','failed')),
  recipient_last4 text,
  provider_message_id text,
  error_message text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  delivered_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_receipt_delivery_attempts_receipt
  ON public.receipt_delivery_attempts(receipt_id, channel, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receipt_delivery_attempts_provider_message
  ON public.receipt_delivery_attempts(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.receipt_delivery_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receipt_delivery_attempts_select_none ON public.receipt_delivery_attempts;
DROP POLICY IF EXISTS receipt_delivery_attempts_insert_none ON public.receipt_delivery_attempts;
DROP POLICY IF EXISTS receipt_delivery_attempts_update_none ON public.receipt_delivery_attempts;
DROP POLICY IF EXISTS receipt_delivery_attempts_delete_none ON public.receipt_delivery_attempts;

CREATE OR REPLACE FUNCTION public.create_receipt_access_token(
  p_receipt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
DECLARE
  receipt_row public.receipts%rowtype;
  token_value text;
  token_hash text;
  access_id uuid;
  expires_value timestamptz := now() + interval '5 years';
BEGIN
  SELECT r.*
  INTO receipt_row
  FROM public.receipts r
  WHERE r.id = p_receipt_id
  FOR UPDATE;

  IF receipt_row.id IS NULL THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  IF NOT (
    mm_private.has_business_permission(receipt_row.business_id, 'sales.view')
    OR mm_private.has_business_permission(receipt_row.business_id, 'payments.receive')
    OR mm_private.has_business_permission(receipt_row.business_id, 'sales.create')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  token_value := encode(gen_random_bytes(32), 'hex');
  token_hash := encode(digest(token_value, 'sha256'), 'hex');

  INSERT INTO public.receipt_access_tokens(
    business_id, receipt_id, purpose, token_hash, expires_at
  )
  VALUES(
    receipt_row.business_id, receipt_row.id, 'customer_download', token_hash, expires_value
  )
  RETURNING id INTO access_id;

  RETURN jsonb_build_object(
    'access_id', access_id,
    'receipt_id', receipt_row.id,
    'receipt_number', receipt_row.receipt_number,
    'token', token_value,
    'expires_at', expires_value
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_receipt_whatsapp_delivery(
  p_receipt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
DECLARE
  receipt_row public.receipts%rowtype;
  customer_row public.customers%rowtype;
  token_value text;
  token_hash text;
  token_id uuid;
  delivery_id uuid;
  expires_value timestamptz := now() + interval '30 minutes';
  clean_phone text;
BEGIN
  SELECT r.*
  INTO receipt_row
  FROM public.receipts r
  WHERE r.id = p_receipt_id
  FOR UPDATE;

  IF receipt_row.id IS NULL THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  IF NOT (
    mm_private.has_business_permission(receipt_row.business_id, 'sales.view')
    OR mm_private.has_business_permission(receipt_row.business_id, 'payments.receive')
    OR mm_private.has_business_permission(receipt_row.business_id, 'sales.create')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF receipt_row.customer_id IS NULL THEN
    RETURN jsonb_build_object(
      'enabled', false,
      'reason', 'no_customer',
      'receipt_id', receipt_row.id,
      'receipt_number', receipt_row.receipt_number
    );
  END IF;

  SELECT *
  INTO customer_row
  FROM public.customers c
  WHERE c.id = receipt_row.customer_id
    AND c.business_id = receipt_row.business_id;

  IF customer_row.id IS NULL THEN
    RAISE EXCEPTION 'Receipt customer could not be resolved for the same business.';
  END IF;

  clean_phone := nullif(trim(coalesce(customer_row.phone, '')), '');

  IF clean_phone IS NULL THEN
    RETURN jsonb_build_object(
      'enabled', false,
      'reason', 'no_mobile',
      'receipt_id', receipt_row.id,
      'receipt_number', receipt_row.receipt_number,
      'customer_name', customer_row.display_name
    );
  END IF;

  token_value := encode(gen_random_bytes(32), 'hex');
  token_hash := encode(digest(token_value, 'sha256'), 'hex');

  INSERT INTO public.receipt_access_tokens(
    business_id, receipt_id, purpose, token_hash, expires_at
  )
  VALUES(
    receipt_row.business_id, receipt_row.id, 'whatsapp_delivery', token_hash, expires_value
  )
  RETURNING id INTO token_id;

  INSERT INTO public.receipt_delivery_attempts(
    business_id, receipt_id, channel, status, recipient_last4, attempt_count, created_by
  )
  VALUES(
    receipt_row.business_id,
    receipt_row.id,
    'whatsapp',
    'queued',
    right(regexp_replace(clean_phone, '\\D', '', 'g'), 4),
    0,
    auth.uid()
  )
  RETURNING id INTO delivery_id;

  RETURN jsonb_build_object(
    'enabled', true,
    'delivery_id', delivery_id,
    'token_id', token_id,
    'receipt_id', receipt_row.id,
    'receipt_number', receipt_row.receipt_number,
    'customer_name', customer_row.display_name,
    'customer_phone', clean_phone,
    'token', token_value,
    'expires_at', expires_value
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_receipt_access_token(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_receipt_access_token(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.prepare_receipt_whatsapp_delivery(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.prepare_receipt_whatsapp_delivery(uuid) TO authenticated;

COMMIT;
