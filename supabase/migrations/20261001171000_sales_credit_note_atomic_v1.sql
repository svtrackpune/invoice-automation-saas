BEGIN;

CREATE OR REPLACE FUNCTION public.create_and_post_credit_note(
  p_business_id uuid,
  p_customer_id uuid,
  p_invoice_id uuid,
  p_credit_note_date date,
  p_reason text,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private AS $$
DECLARE
  v_credit_note_id uuid;
BEGIN
  IF NOT mm_private.has_business_permission(p_business_id,'sales.create')
     OR NOT mm_private.has_business_permission(p_business_id,'accounting.post') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_credit_note_id:=public.create_credit_note(
    p_business_id,
    p_customer_id,
    p_invoice_id,
    p_credit_note_date,
    p_reason,
    p_items,
    p_notes
  );

  PERFORM public.post_credit_note(v_credit_note_id,p_location_id);

  RETURN v_credit_note_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_and_post_credit_note(uuid,uuid,uuid,date,text,jsonb,text,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.create_and_post_credit_note(uuid,uuid,uuid,date,text,jsonb,text,uuid) TO authenticated;

COMMIT;