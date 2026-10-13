BEGIN;

-- Non-Indian VAT/sales-tax modes require an explicit tax registration ID at
-- the database boundary, not just a legacy tax_settings.enabled flag.
CREATE OR REPLACE FUNCTION mm_private.business_tax_enabled(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'mm_private', 'pg_temp'
AS $function$
  SELECT coalesce((
    SELECT CASE
      WHEN upper(coalesce(b.country_code, 'IN')) = 'IN'
        THEN mm_private.has_valid_gst_registration(p_business_id)
      WHEN upper(coalesce(tp.tax_regime, 'NONE')) = 'GST'
        THEN mm_private.has_valid_gst_registration(p_business_id)
      WHEN upper(coalesce(tp.tax_regime, 'NONE')) IN ('VAT', 'SALES_TAX', 'OTHER')
        THEN nullif(btrim(coalesce(tp.tax_id, '')), '') IS NOT NULL
      ELSE false
    END
    FROM public.business_tax_profiles tp
    JOIN public.businesses b ON b.id = tp.business_id
    WHERE tp.business_id = p_business_id
  ), false);
$function$;

REVOKE ALL ON FUNCTION mm_private.business_tax_enabled(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
