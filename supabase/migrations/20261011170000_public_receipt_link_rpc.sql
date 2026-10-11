BEGIN;

-- Receipt share links are opaque, short-lived bearer tokens. The raw token is
-- returned once to an authorized business user; only its hash is stored.
CREATE OR REPLACE FUNCTION public.create_public_receipt_link(p_receipt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, mm_private, pg_temp
AS $function$
DECLARE
  v_business_id uuid;
  v_access jsonb;
  v_token text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode='42501';
  END IF;

  SELECT business_id INTO v_business_id
  FROM public.receipts
  WHERE id = p_receipt_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  IF NOT mm_private.has_business_permission(v_business_id, 'sales.create', auth.uid()) THEN
    RAISE EXCEPTION 'Access denied' USING errcode='42501';
  END IF;

  v_access := public._issue_receipt_access_token(p_receipt_id, 'customer_download');
  v_token := v_access->>'token';

  IF v_token IS NULL OR v_token !~ '^[A-Fa-f0-9]{48,128}$' THEN
    RAISE EXCEPTION 'Receipt share token could not be issued';
  END IF;

  RETURN jsonb_build_object(
    'path', '/receipt/' || v_token,
    'expires_at', v_access->>'expires_at'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_public_receipt_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_public_receipt_link(uuid) TO authenticated;

COMMIT;
