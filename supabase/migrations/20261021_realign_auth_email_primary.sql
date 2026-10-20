-- Email-primary authentication: mobile numbers are profile metadata, not an owner-verification factor.
-- Keep the existing first-owner safeguard and trust only Supabase Auth email confirmation or
-- server-managed OAuth provider metadata. No phone-confirmation timestamp is consulted.

BEGIN;

CREATE OR REPLACE FUNCTION public.check_organization_owner_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_verified boolean := false;
  v_has_existing_owner boolean := false;
BEGIN
  -- Only owner assignment is subject to the first-workspace identity check.
  IF coalesce(NEW.role::text, '') <> 'owner' THEN
    RETURN NEW;
  END IF;

  -- Preserve the existing-workspace path: require verification only when this user
  -- is becoming an owner for the first time in the active membership table.
  EXECUTE format(
    'SELECT EXISTS (
       SELECT 1 FROM public.%I om
       WHERE om.user_id = $1 AND om.is_active AND om.role::text = ''owner''
     )',
    TG_TABLE_NAME
  )
  INTO v_has_existing_owner
  USING NEW.user_id;

  IF coalesce(v_has_existing_owner, false) THEN
    RETURN NEW;
  END IF;

  SELECT (
    u.email_confirmed_at IS NOT NULL
    OR coalesce(u.raw_app_meta_data->>'provider', '') IN ('google', 'facebook', 'github')
    OR coalesce(u.raw_app_meta_data->'providers', '[]'::jsonb) ?| ARRAY['google', 'facebook', 'github']
  )
  INTO v_verified
  FROM auth.users AS u
  WHERE u.id = NEW.user_id;

  IF NOT FOUND OR NOT coalesce(v_verified, false) THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'Owner registration requires a confirmed email address or verified social login.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.check_organization_owner_verification()
  FROM PUBLIC, anon, authenticated;

DO $migration$
BEGIN
  -- Remove the legacy trigger from either historical membership table name, if present.
  IF to_regclass('public.business_memberships') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS organization_owner_requires_dual_verification ON public.business_memberships';
  END IF;

  IF to_regclass('public.organization_members') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS organization_owner_requires_dual_verification ON public.organization_members';
  END IF;

  -- The production schema currently uses organization_members. Keep a guarded fallback
  -- for installations whose active membership table still uses business_memberships.
  IF to_regclass('public.organization_members') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER organization_owner_requires_dual_verification
      BEFORE INSERT OR UPDATE ON public.organization_members
      FOR EACH ROW EXECUTE FUNCTION public.check_organization_owner_verification()';
  ELSIF to_regclass('public.business_memberships') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER organization_owner_requires_dual_verification
      BEFORE INSERT OR UPDATE ON public.business_memberships
      FOR EACH ROW EXECUTE FUNCTION public.check_organization_owner_verification()';
  ELSE
    RAISE EXCEPTION 'No supported owner membership table exists';
  END IF;
END;
$migration$;

COMMIT;
