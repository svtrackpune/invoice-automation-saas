BEGIN;

-- Search-path hardening for SECURITY DEFINER functions and procedures.
-- Preserve each routine's established schemas to avoid changing resolution of
-- application helpers; append pg_temp last so temporary objects cannot shadow
-- trusted objects. A deliberately empty search_path remains empty: those
-- routines are schema-qualified and changing them would broaden their lookup.
--
-- First qualify the one SECURITY DEFINER routine that creates a temporary
-- allocation table but references it by an unqualified name. Once pg_temp is
-- deliberately last, the temp relation must be referenced explicitly.
DO $vendor_payment_temp_table$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'allocate_vendor_payment'
    AND pg_get_function_identity_arguments(p.oid) =
        'p_payment_id uuid, p_allocations jsonb'
    AND p.prosecdef
  LIMIT 1;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Expected SECURITY DEFINER function public.allocate_vendor_payment(uuid, jsonb) was not found';
  END IF;

  IF position('pg_temp._vendor_payment_target_allocations' IN v_definition) = 0 THEN
    IF position('_vendor_payment_target_allocations' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Expected temporary allocation table reference was not found in public.allocate_vendor_payment';
    END IF;

    EXECUTE replace(
      v_definition,
      '_vendor_payment_target_allocations',
      'pg_temp._vendor_payment_target_allocations'
    );
  END IF;
END;
$vendor_payment_temp_table$;

DO $security_definer_search_paths$
DECLARE
  fn record;
  v_current_path text;
  v_new_path text;
BEGIN
  FOR fn IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS routine_name,
      p.prokind,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments,
      (
        SELECT substring(cfg FROM length('search_path=') + 1)
        FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path=%'
        LIMIT 1
      ) AS current_path
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'mm_private')
      AND p.prosecdef
      AND p.prokind IN ('f', 'p')
  LOOP
    v_current_path := fn.current_path;

    -- Keep intentionally empty search paths intact. Such functions must use
    -- schema-qualified references and are more restrictive than public paths.
    IF v_current_path IN ('', '""') THEN
      CONTINUE;
    END IF;

    -- Idempotence: already-hardened paths have pg_temp explicitly last.
    IF v_current_path ~ '(^|,)[[:space:]]*pg_temp[[:space:]]*$' THEN
      CONTINUE;
    END IF;

    IF v_current_path IS NULL THEN
      IF fn.schema_name = 'mm_private' THEN
        v_new_path := 'public, mm_private, pg_temp';
      ELSE
        v_new_path := 'public, pg_temp';
      END IF;
    ELSE
      v_new_path := rtrim(v_current_path) || ', pg_temp';
    END IF;

    IF fn.prokind = 'p' THEN
      EXECUTE format(
        'ALTER PROCEDURE %I.%I(%s) SET search_path TO %L',
        fn.schema_name,
        fn.routine_name,
        fn.identity_arguments,
        v_new_path
      );
    ELSE
      EXECUTE format(
        'ALTER FUNCTION %I.%I(%s) SET search_path TO %L',
        fn.schema_name,
        fn.routine_name,
        fn.identity_arguments,
        v_new_path
      );
    END IF;
  END LOOP;
END;
$security_definer_search_paths$;

-- Postflight: all SECURITY DEFINER routines must have an explicitly pinned
-- path; non-empty paths must put pg_temp last. Explicitly empty paths remain
-- permitted for routines that qualify every object reference.
DO $security_definer_search_path_postflight$
DECLARE
  v_unsafe_count integer;
  v_temp_table_definition text;
BEGIN
  SELECT count(*)
    INTO v_unsafe_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'mm_private')
    AND p.prosecdef
    AND p.prokind IN ('f', 'p')
    AND (
      NOT EXISTS (
        SELECT 1
        FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path=%'
      )
      OR EXISTS (
        SELECT 1
        FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path=%'
          AND substring(cfg FROM length('search_path=') + 1) NOT IN ('', '""')
          AND substring(cfg FROM length('search_path=') + 1)
              !~ '(^|,)[[:space:]]*pg_temp[[:space:]]*$'
      )
    );

  IF v_unsafe_count > 0 THEN
    RAISE EXCEPTION 'SECURITY DEFINER search-path hardening incomplete: % routine(s) lack a safe pinned path', v_unsafe_count;
  END IF;

  SELECT pg_get_functiondef(p.oid)
    INTO v_temp_table_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'allocate_vendor_payment'
    AND pg_get_function_identity_arguments(p.oid) =
        'p_payment_id uuid, p_allocations jsonb'
    AND p.prosecdef
  LIMIT 1;

  IF v_temp_table_definition IS NULL
     OR position('pg_temp._vendor_payment_target_allocations' IN v_temp_table_definition) = 0
     OR v_temp_table_definition ~ '(^|[[:space:]])_vendor_payment_target_allocations([[:space:](;]|$)' THEN
    RAISE EXCEPTION 'SECURITY DEFINER temporary-table qualification check failed for public.allocate_vendor_payment';
  END IF;
END;
$security_definer_search_path_postflight$;

COMMIT;
