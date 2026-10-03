BEGIN;

-- Pin the SECURITY INVOKER/immutable fingerprint helper to trusted schemas.
-- This removes search_path ambiguity while preserving the existing function contract.
ALTER FUNCTION public.bank_transaction_fingerprint(uuid,uuid,date,numeric,text)
  SET search_path = pg_catalog, public, extensions;

COMMIT;
