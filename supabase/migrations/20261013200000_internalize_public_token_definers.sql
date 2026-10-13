BEGIN;

-- Token-bearing public endpoints remain in public for PostgREST compatibility,
-- but they run as SECURITY INVOKER and delegate narrowly to token-validating
-- implementations in the non-exposed mm_private schema.
CREATE SCHEMA IF NOT EXISTS mm_private;
REVOKE CREATE ON SCHEMA mm_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA mm_private TO anon, authenticated;

DO $internalize_public_token_functions$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  -- Clone the conversion implementation into the private schema. The private
  -- acceptance RPC below calls this function as its owner.
  v_definition := pg_get_functiondef('public.accept_public_quotation(text)'::regprocedure);
  v_definition := replace(
    v_definition,
    'FUNCTION public.accept_public_quotation(',
    'FUNCTION mm_private.accept_public_quotation_by_token('
  );
  IF position('FUNCTION mm_private.accept_public_quotation_by_token(' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not internalize public.accept_public_quotation(text)';
  END IF;
  v_definition := regexp_replace(
    v_definition,
    'SET search_path TO [^' || chr(10) || ']+',
    'SET search_path TO ''pg_catalog'', ''mm_private'', ''public'', ''pg_temp''',
    'i'
  );
  EXECUTE v_definition;

  -- Clone invoice retrieval privately and add strict opaque-token validation.
  v_definition := pg_get_functiondef('public.get_public_invoice(text)'::regprocedure);
  v_definition := replace(
    v_definition,
    'FUNCTION public.get_public_invoice(',
    'FUNCTION mm_private.get_public_invoice_by_token('
  );
  IF position('FUNCTION mm_private.get_public_invoice_by_token(' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not internalize public.get_public_invoice(text)';
  END IF;

  v_old := $old$BEGIN
  SELECT *
    INTO i
  FROM public.invoices
  WHERE public_share_token = p_public_share_token;$old$;
  v_new := $new$BEGIN
  IF nullif(btrim(coalesce(p_public_share_token, '')), '') IS NULL
     OR btrim(p_public_share_token) !~ '^[A-Fa-f0-9]{48,128}$' THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  SELECT *
    INTO i
  FROM public.invoices
  WHERE public_share_token = btrim(p_public_share_token);$new$;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Invoice function changed; refusing to apply unverified token patch';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  v_definition := regexp_replace(
    v_definition,
    'SET search_path TO [^' || chr(10) || ']+',
    'SET search_path TO ''pg_catalog'', ''mm_private'', ''public'', ''pg_temp''',
    'i'
  );
  EXECUTE v_definition;

  -- Public quotation retrieval remains a token-scoped read-only endpoint.
  v_definition := pg_get_functiondef('public.get_public_quotation(text)'::regprocedure);
  v_definition := replace(
    v_definition,
    'FUNCTION public.get_public_quotation(',
    'FUNCTION mm_private.get_public_quotation_by_token('
  );
  IF position('FUNCTION mm_private.get_public_quotation_by_token(' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not internalize public.get_public_quotation(text)';
  END IF;
  v_definition := regexp_replace(
    v_definition,
    'SET search_path TO [^' || chr(10) || ']+',
    'SET search_path TO ''pg_catalog'', ''mm_private'', ''public'', ''pg_temp''',
    'i'
  );
  EXECUTE v_definition;

  -- Acceptance performs invoice conversion and a tenant-scoped notification
  -- insert. Move the privileged implementation out of the exposed schema.
  v_definition := pg_get_functiondef('public.rpc_accept_public_quotation(text)'::regprocedure);
  v_definition := replace(
    v_definition,
    'FUNCTION public.rpc_accept_public_quotation(',
    'FUNCTION mm_private.rpc_accept_public_quotation_by_token('
  );
  IF position('FUNCTION mm_private.rpc_accept_public_quotation_by_token(' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not internalize public.rpc_accept_public_quotation(text)';
  END IF;
  v_old := 'v_result := public.accept_public_quotation(btrim(p_token));';
  v_new := 'v_result := mm_private.accept_public_quotation_by_token(btrim(p_token));';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Acceptance RPC changed; refusing to redirect it to the private implementation';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  v_definition := regexp_replace(
    v_definition,
    'SET search_path TO [^' || chr(10) || ']+',
    'SET search_path TO ''pg_catalog'', ''mm_private'', ''public'', ''pg_temp''',
    'i'
  );
  EXECUTE v_definition;
END;
$internalize_public_token_functions$;

-- Public-facing contracts use invoker privileges and expose only their own
-- token-bound JSON payload. The privileged implementation is in mm_private,
-- which must remain absent from Supabase's exposed API schemas.
CREATE OR REPLACE FUNCTION public.get_public_invoice(p_public_share_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, mm_private, pg_temp
AS $function$
  SELECT mm_private.get_public_invoice_by_token(p_public_share_token);
$function$;

CREATE OR REPLACE FUNCTION public.get_public_quotation(p_public_accept_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, mm_private, pg_temp
AS $function$
  SELECT mm_private.get_public_quotation_by_token(p_public_accept_token);
$function$;

CREATE OR REPLACE FUNCTION public.rpc_accept_public_quotation(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, mm_private, pg_temp
AS $function$
  SELECT mm_private.rpc_accept_public_quotation_by_token(p_token);
$function$;

-- The old acceptance entry point is not a public API. Keep its signature for
-- dependency compatibility, but do not let API roles execute it directly.
ALTER FUNCTION public.accept_public_quotation(text) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.accept_public_quotation(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Public wrappers are intentionally executable by anonymous customers; their
-- implementation functions are not in an exposed schema.
REVOKE ALL ON FUNCTION public.get_public_invoice(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_invoice(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_quotation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_quotation(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_accept_public_quotation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_accept_public_quotation(text) TO anon, authenticated;

-- These grants are needed only because the public wrappers are invoker functions.
-- Do not add mm_private to the Supabase Data API's exposed schemas.
REVOKE ALL ON FUNCTION mm_private.accept_public_quotation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mm_private.accept_public_quotation_by_token(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION mm_private.get_public_invoice_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mm_private.get_public_invoice_by_token(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION mm_private.get_public_quotation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mm_private.get_public_quotation_by_token(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION mm_private.rpc_accept_public_quotation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mm_private.rpc_accept_public_quotation_by_token(text) TO anon, authenticated;

COMMIT;
