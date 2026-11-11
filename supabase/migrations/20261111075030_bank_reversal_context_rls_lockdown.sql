BEGIN;

-- Internal transaction-scoped context for the audited bank-reconciliation
-- reversal path only. This table is not a user-facing company data table.
-- No client RLS policies are intentionally defined.
REVOKE ALL ON TABLE mm_private.bank_reversal_context
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE mm_private.bank_reversal_context
  ENABLE ROW LEVEL SECURITY;

-- Keep FORCE disabled: the table owner (postgres) must continue to access this
-- internal guard row from the SECURITY DEFINER reversal RPC and trigger.
ALTER TABLE mm_private.bank_reversal_context
  NO FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE mm_private.bank_reversal_context IS
  'Internal transaction-scoped bank reversal guard. RLS is enabled with no client policies by design; direct client/API table privileges are revoked. Access is limited to postgres-owned SECURITY DEFINER reversal and trigger routines. Do not FORCE RLS or grant direct client access.';

DO $hardening_check$
DECLARE
  v_table_owner oid;
  v_reversal_owner oid;
  v_trigger_owner oid;
  v_reversal_definer boolean;
  v_trigger_definer boolean;
  v_reversal_source text;
  v_rls_enabled boolean;
  v_force_rls boolean;
BEGIN
  SELECT c.relowner, c.relrowsecurity, c.relforcerowsecurity
    INTO v_table_owner, v_rls_enabled, v_force_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'mm_private'
    AND c.relname = 'bank_reversal_context'
    AND c.relkind = 'r';

  IF v_table_owner IS NULL THEN
    RAISE EXCEPTION 'mm_private.bank_reversal_context is missing';
  END IF;
  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'RLS was not enabled on bank_reversal_context';
  END IF;
  IF v_force_rls THEN
    RAISE EXCEPTION 'FORCE RLS must remain disabled for the postgres-owned internal guard path';
  END IF;

  SELECT p.proowner, p.prosecdef, lower(p.prosrc)
    INTO v_reversal_owner, v_reversal_definer, v_reversal_source
  FROM pg_proc p
  WHERE p.oid = to_regprocedure(
    'public.reverse_locked_bank_reconciliation(uuid,uuid,text,date)'
  );

  IF v_reversal_owner IS NULL
     OR NOT v_reversal_definer
     OR v_reversal_owner <> v_table_owner THEN
    RAISE EXCEPTION 'Bank reversal RPC must remain SECURITY DEFINER and owned by the internal table owner';
  END IF;

  IF position('mm_private.has_business_permission' IN v_reversal_source) = 0
     OR position('accounting.adjust' IN v_reversal_source) = 0 THEN
    RAISE EXCEPTION 'Bank reversal RPC no longer enforces the business-scoped accounting.adjust permission';
  END IF;

  SELECT p.proowner, p.prosecdef
    INTO v_trigger_owner, v_trigger_definer
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.prevent_locked_reconciliation_mutation()');

  IF v_trigger_owner IS NULL
     OR NOT v_trigger_definer
     OR v_trigger_owner <> v_table_owner THEN
    RAISE EXCEPTION 'Locked-reconciliation guard trigger must remain SECURITY DEFINER and owned by the internal table owner';
  END IF;

  IF has_table_privilege('anon', 'mm_private.bank_reversal_context', 'SELECT')
     OR has_table_privilege('anon', 'mm_private.bank_reversal_context', 'INSERT')
     OR has_table_privilege('anon', 'mm_private.bank_reversal_context', 'UPDATE')
     OR has_table_privilege('anon', 'mm_private.bank_reversal_context', 'DELETE')
     OR has_table_privilege('authenticated', 'mm_private.bank_reversal_context', 'SELECT')
     OR has_table_privilege('authenticated', 'mm_private.bank_reversal_context', 'INSERT')
     OR has_table_privilege('authenticated', 'mm_private.bank_reversal_context', 'UPDATE')
     OR has_table_privilege('authenticated', 'mm_private.bank_reversal_context', 'DELETE')
     OR has_table_privilege('service_role', 'mm_private.bank_reversal_context', 'SELECT')
     OR has_table_privilege('service_role', 'mm_private.bank_reversal_context', 'INSERT')
     OR has_table_privilege('service_role', 'mm_private.bank_reversal_context', 'UPDATE')
     OR has_table_privilege('service_role', 'mm_private.bank_reversal_context', 'DELETE') THEN
    RAISE EXCEPTION 'Direct API/client privileges remain on bank_reversal_context';
  END IF;
END;
$hardening_check$;

COMMIT;
