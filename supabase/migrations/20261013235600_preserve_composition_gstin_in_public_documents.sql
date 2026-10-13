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
    RAISE EXCEPTION 'Expected composition GSTIN display anchor not found in %', p_signature;
  END IF;
  v_definition := replace(v_definition, p_old, p_new);
  EXECUTE v_definition;
END;
$patch$;

-- Composition-scheme sellers do not charge GST, but still have a registered
-- GSTIN and must be identifiable on the customer-facing Bill of Supply.
SELECT pg_temp.patch_function_definition(
  'mm_private.get_public_invoice_by_token(text)'::regprocedure,
  $old$IN ('REGULAR', 'CASUAL', 'NON_RESIDENT', 'SEZ')$old$,
  $new$IN ('REGULAR', 'CASUAL', 'NON_RESIDENT', 'SEZ', 'COMPOSITION')$new$
);

SELECT pg_temp.patch_function_definition(
  'mm_private.get_public_quotation_by_token(text)'::regprocedure,
  $old$IN ('REGULAR', 'CASUAL', 'NON_RESIDENT', 'SEZ')$old$,
  $new$IN ('REGULAR', 'CASUAL', 'NON_RESIDENT', 'SEZ', 'COMPOSITION')$new$
);

COMMIT;
