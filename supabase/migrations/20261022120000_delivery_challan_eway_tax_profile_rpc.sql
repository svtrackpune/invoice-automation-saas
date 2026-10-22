BEGIN;

CREATE OR REPLACE FUNCTION public.get_delivery_challan_eway_tax_profile(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'mm_private', 'pg_temp'
AS $function$
DECLARE
  profile jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT (
    mm_private.has_business_permission(p_business_id, 'settings.manage', auth.uid())
    OR mm_private.has_business_permission(p_business_id, 'inventory.view', auth.uid())
    OR mm_private.has_business_permission(p_business_id, 'inventory.manage', auth.uid())
    OR mm_private.has_business_permission(p_business_id, 'invoices.view', auth.uid())
  ) THEN
    RAISE EXCEPTION 'Access denied: insufficient permission to view GST dispatch details';
  END IF;

  SELECT jsonb_build_object(
    'gstin', nullif(btrim(tp.gstin), ''),
    'tax_regime', coalesce(nullif(upper(btrim(tp.tax_regime)), ''), 'NONE'),
    'gst_registration_type', coalesce(nullif(upper(btrim(tp.gst_registration_type)), ''), 'NONE')
  )
  INTO profile
  FROM public.business_tax_profiles tp
  WHERE tp.business_id = p_business_id;

  RETURN coalesce(
    profile,
    jsonb_build_object('gstin', null, 'tax_regime', 'NONE', 'gst_registration_type', 'NONE')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_delivery_challan_eway_tax_profile(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_delivery_challan_eway_tax_profile(uuid) TO authenticated;

COMMIT;
