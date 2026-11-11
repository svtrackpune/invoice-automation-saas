BEGIN;

-- Remove two exact redundancies reported by the live Supabase performance
-- advisor. The preflight refuses to proceed if the canonical objects drift.
DO $cleanup_preflight$
DECLARE
  v_keep_policy_qual text;
  v_keep_policy_roles name[];
  v_keep_policy_cmd text;
  v_duplicate_policy_qual text;
  v_duplicate_policy_roles name[];
  v_duplicate_policy_cmd text;
  v_keep_index oid;
  v_duplicate_index oid;
  v_keep_index_definition text;
  v_duplicate_index_definition text;
BEGIN
  SELECT qual, roles, cmd
    INTO v_keep_policy_qual, v_keep_policy_roles, v_keep_policy_cmd
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'saas_entitlements'
     AND policyname = 'saas_entitlements_select';

  IF v_keep_policy_qual IS NULL
     OR v_keep_policy_cmd <> 'SELECT'
     OR NOT (v_keep_policy_roles @> ARRAY['authenticated'::name])
     OR position('mm_private.is_org_member' IN v_keep_policy_qual) = 0
     OR position('saas_entitlements.business_id' IN v_keep_policy_qual) = 0 THEN
    RAISE EXCEPTION 'Canonical saas_entitlements_select policy is missing or no longer enforces organization membership';
  END IF;

  SELECT qual, roles, cmd
    INTO v_duplicate_policy_qual, v_duplicate_policy_roles, v_duplicate_policy_cmd
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'saas_entitlements'
     AND policyname = 'saas_entitlements_member_select';

  IF v_duplicate_policy_qual IS NOT NULL
     AND (
       v_duplicate_policy_cmd <> 'SELECT'
       OR NOT (v_duplicate_policy_roles @> ARRAY['authenticated'::name])
       OR position('mm_private.is_org_member' IN v_duplicate_policy_qual) = 0
       OR position('saas_entitlements.business_id' IN v_duplicate_policy_qual) = 0
     ) THEN
    RAISE EXCEPTION 'Redundant saas_entitlements_member_select policy has drifted; refusing to remove it';
  END IF;

  v_keep_index := pg_catalog.to_regclass('public.quotations_public_accept_token_uidx');
  v_duplicate_index := pg_catalog.to_regclass('public.quotations_public_accept_token_dispatch_uidx');

  IF v_keep_index IS NULL THEN
    RAISE EXCEPTION 'Canonical quotations_public_accept_token_uidx is missing';
  END IF;

  IF v_duplicate_index IS NOT NULL THEN
    v_keep_index_definition := pg_catalog.pg_get_indexdef(v_keep_index);
    v_duplicate_index_definition := pg_catalog.pg_get_indexdef(v_duplicate_index);

    -- Index names are the only allowed difference. Preserve the canonical
    -- earlier index and remove the later dispatch duplicate only on an exact
    -- structural definition match.
    v_keep_index_definition := regexp_replace(
      v_keep_index_definition,
      '^CREATE UNIQUE INDEX [^ ]+',
      'CREATE UNIQUE INDEX __normalized__'
    );
    v_duplicate_index_definition := regexp_replace(
      v_duplicate_index_definition,
      '^CREATE UNIQUE INDEX [^ ]+',
      'CREATE UNIQUE INDEX __normalized__'
    );

    IF v_keep_index_definition IS DISTINCT FROM v_duplicate_index_definition THEN
      RAISE EXCEPTION 'Quotation accept-token indexes are no longer identical; refusing to drop either index';
    END IF;
  END IF;
END;
$cleanup_preflight$;

DROP POLICY IF EXISTS saas_entitlements_member_select ON public.saas_entitlements;
DROP INDEX IF EXISTS public.quotations_public_accept_token_dispatch_uidx;

COMMIT;
