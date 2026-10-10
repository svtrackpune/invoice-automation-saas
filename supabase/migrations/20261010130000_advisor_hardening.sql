BEGIN;

-- SEC-001: pin every public SECURITY DEFINER routine to a deterministic path.
-- References into mm_private must remain schema-qualified in function bodies.
DO $pin_public_security_definer_paths$
DECLARE
  routine record;
BEGIN
  FOR routine IN
    SELECT p.oid, p.prokind, n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prokind IN ('f', 'p')
    ORDER BY p.proname, p.oid
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I(%s) SET search_path = public, pg_temp',
      CASE WHEN routine.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
      routine.nspname,
      routine.proname,
      routine.identity_args
    );
  END LOOP;
END;
$pin_public_security_definer_paths$;

-- Fail the migration if any public SECURITY DEFINER routine was missed.
DO $verify_public_security_definer_paths$
DECLARE
  v_unpinned integer;
BEGIN
  SELECT count(*)
    INTO v_unpinned
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND p.prokind IN ('f', 'p')
     AND NOT EXISTS (
       SELECT 1
         FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS setting
        WHERE setting = 'search_path=public, pg_temp'
     );

  IF v_unpinned > 0 THEN
    RAISE EXCEPTION 'SEC-001 failed: % public SECURITY DEFINER routines have an unexpected search_path', v_unpinned;
  END IF;
END;
$verify_public_security_definer_paths$;

-- PERF-001: index only foreign keys verified to be missing a usable leading
-- index on production. Existing equivalent indexes remain untouched.
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_by_fk
  ON public.inventory_movements (created_by);

CREATE INDEX IF NOT EXISTS idx_delivery_challans_converted_invoice_fk
  ON public.delivery_challans (converted_invoice_id);

CREATE INDEX IF NOT EXISTS idx_delivery_challans_created_by_fk
  ON public.delivery_challans (created_by);

-- Keep the previous advisor hardening controls: public tokens are issued only
-- by the token-based public retrieval flow, and trigger-only routines are not RPCs.
REVOKE ALL ON FUNCTION public.get_public_invoice_share_token(uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.guard_bank_reconciliation_rule_target_account()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.prevent_locked_reconciliation_mutation()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.sync_bank_transaction_identity()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.reverse_locked_bank_reconciliation(uuid, uuid, text, date)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.reverse_locked_bank_reconciliation(uuid, uuid, text, date)
  TO authenticated;

COMMIT;
