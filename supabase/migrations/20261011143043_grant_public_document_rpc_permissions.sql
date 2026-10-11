BEGIN;

-- Public document RPCs are bearer-token readers. The RPC implementations
-- validate opaque public invoice/quotation tokens before returning document
-- data. Grant only the explicit token retrieval function family, rather than
-- changing default privileges for arbitrary functions in public.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS func_signature
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'get_public_invoice',
        'get_public_quote',
        'get_public_quotation',
        'get_public_receipt',
        'get_public_delivery_challan',
        'get_public_document'
      )
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO anon, authenticated',
      r.func_signature
    );
  END LOOP;
END
$$;

COMMIT;
