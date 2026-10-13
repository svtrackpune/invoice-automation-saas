BEGIN;

-- Preserve the established attribution value used by the public token acceptance flow.
DO $audit_attribution$
DECLARE
  v_target regprocedure := 'public.accept_public_quotation(text)'::regprocedure;
  v_definition text;
  v_old text := $old$accepted_via = 'customer_web'$old$;
  v_new text := $new$accepted_via = 'public_link'$new$;
BEGIN
  SELECT pg_get_functiondef(v_target) INTO v_definition;
  IF position(v_old IN v_definition) > 0 THEN
    v_definition := replace(v_definition, v_old, v_new);
    EXECUTE v_definition;
  ELSIF position(v_new IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Quotation acceptance attribution was neither expected nor patched';
  END IF;
END;
$audit_attribution$;

COMMIT;
