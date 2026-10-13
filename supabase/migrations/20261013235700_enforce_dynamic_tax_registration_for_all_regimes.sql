BEGIN;

CREATE FUNCTION pg_temp.patch_function_definition(
  p_signature regprocedure,
  p_old text,
  p_new text
) RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'mm_private', 'pg_temp'
AS $patch$
DECLARE
  v_definition text := pg_get_functiondef(p_signature);
BEGIN
  IF position(p_new IN v_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(p_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Expected dynamic tax registration guard not found in %', p_signature;
  END IF;
  v_definition := replace(v_definition, p_old, p_new);
  EXECUTE v_definition;
END;
$patch$;

-- Apply the same tax-profile gate to the authenticated and API-key dynamic
-- invoice RPCs. This protects non-Indian VAT/sales-tax as well as Indian GST,
-- even when a caller bypasses the app's applyDynamicTax server helper.
SELECT pg_temp.patch_function_definition(
  'public.create_invoice_with_dynamic_tax(uuid,uuid,date,date,jsonb,text,text,text,boolean)'::regprocedure,
  $old$IF upper(coalesce((SELECT country_code FROM public.businesses WHERE id=p_business_id), 'IN')) = 'IN'
       AND NOT mm_private.has_valid_gst_registration(p_business_id)
       AND (
         v_tax > 0
         OR EXISTS ($old$,
  $new$IF NOT mm_private.business_tax_enabled(p_business_id)
       AND (
         v_tax > 0
         OR jsonb_array_length(v_meta) > 0
         OR nullif(v_item->>'tax_rule_id','') IS NOT NULL
         OR EXISTS ($new$
);
SELECT pg_temp.patch_function_definition(
  'public.create_invoice_with_dynamic_tax(uuid,uuid,uuid,date,date,jsonb,text,text,text,boolean)'::regprocedure,
  $old$IF upper(coalesce((SELECT country_code FROM public.businesses WHERE id=p_business_id), 'IN')) = 'IN'
       AND NOT mm_private.has_valid_gst_registration(p_business_id)
       AND (
         v_tax > 0
         OR EXISTS ($old$,
  $new$IF NOT mm_private.business_tax_enabled(p_business_id)
       AND (
         v_tax > 0
         OR jsonb_array_length(v_meta) > 0
         OR nullif(v_item->>'tax_rule_id','') IS NOT NULL
         OR EXISTS ($new$
);
SELECT pg_temp.patch_function_definition(
  'public.api_create_invoice_with_dynamic_tax(text,uuid,uuid,date,date,jsonb,text,text,text,boolean)'::regprocedure,
  $old$IF upper(coalesce((SELECT country_code FROM public.businesses WHERE id=p_business_id), 'IN')) = 'IN'
       AND NOT mm_private.has_valid_gst_registration(p_business_id)
       AND (
         v_tax > 0
         OR EXISTS ($old$,
  $new$IF NOT mm_private.business_tax_enabled(p_business_id)
       AND (
         v_tax > 0
         OR jsonb_array_length(v_meta) > 0
         OR nullif(v_item->>'tax_rule_id','') IS NOT NULL
         OR EXISTS ($new$
);

DROP FUNCTION pg_temp.patch_function_definition(regprocedure,text,text);

COMMIT;
