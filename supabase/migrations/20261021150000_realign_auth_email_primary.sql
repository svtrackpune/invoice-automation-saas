-- P0 auth realignment: email/OAuth identity is authoritative; phone is profile metadata only.
-- This migration is safe to reapply and targets the membership table used by production.

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
  IF coalesce(NEW.role::text, '') <> 'owner' THEN
    RETURN NEW;
  END IF;

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
      MESSAGE = 'Owner registration requires a verified email address or active social sign-in.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.check_organization_owner_verification()
  FROM PUBLIC, anon, authenticated;

DO $migration$
BEGIN
  IF to_regclass('public.business_memberships') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS organization_owner_requires_dual_verification ON public.business_memberships';
  END IF;

  IF to_regclass('public.organization_members') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS organization_owner_requires_dual_verification ON public.organization_members';
  END IF;

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

-- Keep the established onboarding RPC signature and permissions. The phone number is
-- supplied at signup via auth user metadata; it is copied only into this user's own
-- profile row, and a blank/unverified phone never blocks workspace provisioning.
CREATE OR REPLACE FUNCTION public.create_business_for_current_user(
  p_business_name text,
  p_business_type public.business_type DEFAULT 'sole_proprietorship'::public.business_type,
  p_country_code character DEFAULT 'IN'::bpchar,
  p_currency_code character DEFAULT 'INR'::bpchar,
  p_tax_enabled boolean DEFAULT true,
  p_tax_region text DEFAULT 'IN-MH'::text,
  p_tax_mode text DEFAULT NULL::text,
  p_notification_email boolean DEFAULT true,
  p_notification_whatsapp boolean DEFAULT true,
  p_notification_sms boolean DEFAULT false,
  p_category_id uuid DEFAULT NULL::uuid,
  p_subcategory_id uuid DEFAULT NULL::uuid,
  p_selling_model text DEFAULT NULL::text,
  p_sales_channels jsonb DEFAULT '[]'::jsonb,
  p_team_size text DEFAULT NULL::text,
  p_tax_state text DEFAULT NULL::text,
  p_gstin text DEFAULT NULL::text,
  p_feature_flags jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_business uuid;
  v_profile_phone text;
BEGIN
  v_business := public.create_business_for_current_user_core(
    p_business_name, p_business_type, p_country_code, p_currency_code,
    p_tax_enabled, p_tax_region, p_tax_mode, p_notification_email,
    p_notification_whatsapp, p_notification_sms, p_category_id,
    p_subcategory_id, p_selling_model, p_sales_channels, p_team_size,
    p_tax_state, p_gstin
  );

  UPDATE public.businesses
  SET feature_flags = coalesce(p_feature_flags, '{}'::jsonb),
      base_currency_code = upper(currency_code)
  WHERE id = v_business;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business provisioning did not return a persisted business';
  END IF;

  PERFORM public.seed_business_defaults(v_business);

  SELECT nullif(btrim(u.raw_user_meta_data->>'phone'), '')
  INTO v_profile_phone
  FROM auth.users AS u
  WHERE u.id = auth.uid();

  IF v_profile_phone IS NOT NULL THEN
    UPDATE public.user_profiles AS up
    SET phone = coalesce(nullif(btrim(up.phone), ''), v_profile_phone),
        updated_at = now()
    WHERE up.user_id = auth.uid()
      AND nullif(btrim(up.phone), '') IS NULL;
  END IF;

  RETURN v_business;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_business_for_current_user(
  text, public.business_type, character, character, boolean, text, text,
  boolean, boolean, boolean, uuid, uuid, text, jsonb, text, text, text, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business_for_current_user(
  text, public.business_type, character, character, boolean, text, text,
  boolean, boolean, boolean, uuid, uuid, text, jsonb, text, text, text, jsonb
) TO authenticated, service_role;

COMMIT;
