BEGIN;

-- The existing quotations_accepted_via_check permits only customer_web/internal.
-- Use the established customer_web value for the public token acceptance path.
DO $patch$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_get_functiondef(
    'public.accept_public_quotation(text)'::regprocedure
  );
  IF strpos(v_definition, '''public_link''') = 0 THEN
    RAISE EXCEPTION 'Expected public_link acceptance marker was not found';
  END IF;
  v_definition := replace(v_definition, '''public_link''', '''customer_web''');
  EXECUTE v_definition;
END
$patch$;

REVOKE ALL ON FUNCTION public.accept_public_quotation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_public_quotation(text) TO anon, authenticated;

COMMIT;
