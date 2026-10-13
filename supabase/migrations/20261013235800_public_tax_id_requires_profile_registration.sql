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
    RAISE EXCEPTION 'Expected public tax ID anchor not found in %', p_signature;
  END IF;
  v_definition := replace(v_definition, p_old, p_new);
  EXECUTE v_definition;
END;
$patch$;

-- Legacy businesses.tax_registration_number may contain a PAN or other ID.
-- Public customer documents treat VAT/sales-tax registration as configured
-- only when the dedicated business_tax_profiles.tax_id field is present.
SELECT pg_temp.patch_function_definition(
  'mm_private.get_public_invoice_by_token(text)'::regprocedure,
  $old$THEN nullif(btrim(coalesce(
            (SELECT tp.tax_id FROM public.business_tax_profiles tp WHERE tp.business_id = i.business_id),
            b.tax_registration_number
          )), '')$old$,
  $new$THEN nullif(btrim((SELECT tp.tax_id FROM public.business_tax_profiles tp WHERE tp.business_id = i.business_id)), '')$new$
);

SELECT pg_temp.patch_function_definition(
  'mm_private.get_public_quotation_by_token(text)'::regprocedure,
  $old$THEN nullif(btrim(coalesce(tp.tax_id, b.tax_registration_number)), '')$old$,
  $new$THEN nullif(btrim(tp.tax_id), '')$new$
);

DROP FUNCTION pg_temp.patch_function_definition(regprocedure,text,text);

COMMIT;
