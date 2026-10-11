BEGIN;

-- pgcrypto is installed in the extensions schema on this project. Qualify
-- gen_random_bytes explicitly because the SECURITY DEFINER function pins its
-- search_path to public, pg_temp.
CREATE OR REPLACE FUNCTION public._issue_receipt_access_token(
  p_receipt_id uuid,
  p_purpose text DEFAULT 'customer_download'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  token_value := encode(extensions.gen_random_bytes(32), 'hex');
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

-- CREATE OR REPLACE retains the existing owner and grants. Keep the token
-- issuer service-role-only; client-facing access continues through the signed
-- public route rather than a directly callable token-minting RPC.
REVOKE ALL ON FUNCTION public._issue_receipt_access_token(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._issue_receipt_access_token(uuid,text)
  TO service_role;

COMMIT;
