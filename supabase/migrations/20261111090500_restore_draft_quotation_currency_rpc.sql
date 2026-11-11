BEGIN;

-- The quotation editor sets transaction currency after creating/updating a draft.
-- Keep this RPC isolated from the broader FX posting migration so production
-- receives only the missing draft-currency operation.
DO $preflight$
BEGIN
  IF to_regclass('public.quotations') IS NULL THEN
    RAISE EXCEPTION 'Required table public.quotations is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='quotations'
      AND column_name IN ('id','business_id','status','invoice_id','currency_code','updated_at')
    GROUP BY table_schema, table_name
    HAVING count(DISTINCT column_name)=6
  ) THEN
    RAISE EXCEPTION 'public.quotations is missing a required draft-currency column';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='mm_private'
      AND p.proname='has_business_permission'
      AND pg_catalog.pg_get_function_identity_arguments(p.oid)
          = 'p_business_id uuid, p_permission text, p_user_id uuid'
      AND p.pronargdefaults >= 1
  ) THEN
    RAISE EXCEPTION 'Required mm_private.has_business_permission helper/default user argument is missing';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.set_draft_quotation_currency(
  p_quotation_id uuid,
  p_currency_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  q public.quotations%rowtype;
  v_currency char(3) := upper(btrim(coalesce(p_currency_code,'')));
  v_can_create boolean;
  v_can_edit boolean;
BEGIN
  SELECT *
    INTO q
    FROM public.quotations
   WHERE id=p_quotation_id
   FOR UPDATE;

  IF q.id IS NULL THEN
    RAISE EXCEPTION 'Quotation not found';
  END IF;

  v_can_create := coalesce(
    mm_private.has_business_permission(q.business_id,'sales.create'),
    false
  );
  v_can_edit := coalesce(
    mm_private.has_business_permission(q.business_id,'sales.edit'),
    false
  );

  IF NOT (v_can_create OR v_can_edit) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF q.status <> 'draft' OR q.invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Transaction currency can only be changed while a quotation is a draft';
  END IF;

  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'A valid three-letter ISO currency code is required';
  END IF;

  UPDATE public.quotations
     SET currency_code=v_currency,
         updated_at=now()
   WHERE id=q.id
     AND status='draft'
     AND invoice_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation is no longer an editable draft';
  END IF;

  RETURN q.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_draft_quotation_currency(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_draft_quotation_currency(uuid,text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
