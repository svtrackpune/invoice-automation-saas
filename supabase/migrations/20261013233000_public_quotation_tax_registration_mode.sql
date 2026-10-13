BEGIN;

DO $public_quotation_tax_registration_mode$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef('mm_private.get_public_quotation_by_token(text)'::regprocedure);
  v_old := $old$'tax_registration_number',
        CASE WHEN coalesce(tp.gst_registration_type, 'NONE') = 'NONE'
          THEN NULL ELSE coalesce(tp.gstin, b.tax_registration_number) END$old$;
  v_new := $new$'tax_registration_number',
        CASE
          WHEN upper(coalesce(tp.gst_registration_type, 'NONE'))
               IN ('NONE', 'UNREGISTERED', 'NON_GST', 'NOT_REGISTERED')
            THEN NULL
          ELSE coalesce(nullif(btrim(tp.gstin), ''), b.tax_registration_number)
        END,
      'gst_registration_type', upper(coalesce(tp.gst_registration_type, 'NONE'))$new$;

  IF position(v_new IN v_definition) = 0 THEN
    IF position(v_old IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Public quotation tax registration JSON anchor changed; refusing unverified patch';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);
    EXECUTE v_definition;
  END IF;
END;
$public_quotation_tax_registration_mode$;

COMMIT;
