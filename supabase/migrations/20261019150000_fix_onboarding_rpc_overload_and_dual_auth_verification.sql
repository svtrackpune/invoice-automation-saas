-- Resolve the overloaded onboarding RPC and require dual verification for the first owner membership.
-- The old 17-argument implementation remains the core; the public 18-argument wrapper
-- becomes the single PostgREST-visible function and delegates to a differently named core.

DO $migration$
BEGIN
  IF to_regprocedure('public.create_business_for_current_user(text,public.business_type,character,character,boolean,text,text,boolean,boolean,boolean,uuid,uuid,text,jsonb,text,text,text)') IS NOT NULL
     AND to_regprocedure('public.create_business_for_current_user_core(text,public.business_type,character,character,boolean,text,text,boolean,boolean,boolean,uuid,uuid,text,jsonb,text,text,text)') IS NULL THEN
    EXECUTE 'ALTER FUNCTION public.create_business_for_current_user(text, public.business_type, character, character, boolean, text, text, boolean, boolean, boolean, uuid, uuid, text, jsonb, text, text, text) RENAME TO create_business_for_current_user_core';
  END IF;
END;
$migration$;

-- The renamed core is called only by the SECURITY DEFINER wrapper below.
REVOKE EXECUTE ON FUNCTION public.create_business_for_current_user_core(
  text, public.business_type, character, character, boolean, text, text,
  boolean, boolean, boolean, uuid, uuid, text, jsonb, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;

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

-- Only the first owner membership is gated, so existing workspaces and invited teammates
-- are not locked out. Supabase Auth is authoritative for both verification timestamps.
CREATE OR REPLACE FUNCTION public.enforce_dual_auth_for_first_workspace_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_email_confirmed_at timestamptz;
  v_phone_confirmed_at timestamptz;
BEGIN
  IF coalesce(NEW.role::text, '') <> 'owner' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = NEW.user_id AND om.is_active
  ) THEN
    RETURN NEW;
  END IF;

  SELECT u.email_confirmed_at, u.phone_confirmed_at
  INTO v_email_confirmed_at, v_phone_confirmed_at
  FROM auth.users u
  WHERE u.id = NEW.user_id;

  IF NOT FOUND OR v_email_confirmed_at IS NULL OR v_phone_confirmed_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'Verify both your email address and mobile number before launching your first workspace.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS organization_owner_requires_dual_verification ON public.organization_members;
CREATE TRIGGER organization_owner_requires_dual_verification
BEFORE INSERT OR UPDATE ON public.organization_members
FOR EACH ROW
EXECUTE FUNCTION public.enforce_dual_auth_for_first_workspace_owner();

REVOKE EXECUTE ON FUNCTION public.enforce_dual_auth_for_first_workspace_owner() FROM PUBLIC, anon, authenticated;
