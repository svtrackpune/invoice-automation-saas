BEGIN;

CREATE OR REPLACE FUNCTION public.set_invoice_buyer_reference(
  p_invoice_id uuid,
  p_buyer_reference text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,mm_private
AS $fn$
DECLARE v_business_id uuid;
BEGIN
  SELECT business_id INTO v_business_id FROM public.invoices WHERE id=p_invoice_id;
  IF v_business_id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT (
    mm_private.has_business_permission(v_business_id,'sales.create')
    OR mm_private.has_business_permission(v_business_id,'accounting.adjust')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_buyer_reference IS NOT NULL AND (btrim(p_buyer_reference)='' OR length(btrim(p_buyer_reference))>70) THEN
    RAISE EXCEPTION 'Buyer reference must be 1-70 characters when provided.';
  END IF;
  UPDATE public.invoices
  SET buyer_reference=nullif(btrim(p_buyer_reference),''),
      updated_at=now()
  WHERE id=p_invoice_id AND business_id=v_business_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.set_invoice_buyer_reference(uuid,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.set_invoice_buyer_reference(uuid,text) TO authenticated;

COMMIT;