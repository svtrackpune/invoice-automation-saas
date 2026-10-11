BEGIN;

-- Keep configured UPI settings authoritative in the service-only dispatch
-- resolver. When a tenant disables its QR setting, no UPI intent is sent.
CREATE OR REPLACE FUNCTION public.resolve_public_document_dispatch(
  p_business_id uuid,
  p_document_type text,
  p_document_id uuid,
  p_receipt_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $function$
DECLARE
  v_result jsonb;
  v_type text := lower(btrim(coalesce(p_document_type,'')));
  v_upi_id text;
  v_payment_link text;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;

  v_result := public.resolve_public_document_dispatch_base(
    p_business_id, p_document_type, p_document_id, p_receipt_token
  );

  IF v_type = 'reminder' THEN
    v_type := 'invoice';
  END IF;

  IF v_type = 'invoice' THEN
    SELECT
      CASE WHEN coalesce(dps.payment_qr_enabled, true)
        THEN coalesce(nullif(btrim(dps.upi_id),''), nullif(btrim(ba.metadata->>'upi_id'),''))
        ELSE NULL END,
      nullif(btrim(i.payment_link),'')
      INTO v_upi_id, v_payment_link
    FROM public.invoices i
    LEFT JOIN public.document_payment_settings dps ON dps.business_id = i.business_id
    LEFT JOIN public.bank_accounts ba
      ON ba.id = i.payment_bank_account_id
     AND ba.business_id = i.business_id
     AND ba.is_active
    WHERE i.id = p_document_id
      AND i.business_id = p_business_id;

    RETURN v_result || jsonb_build_object(
      'upi_id', v_upi_id,
      'payment_link', v_payment_link
    );
  END IF;

  RETURN v_result || jsonb_build_object('upi_id', NULL, 'payment_link', NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_public_document_dispatch(uuid,text,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_public_document_dispatch(uuid,text,uuid,text)
  TO service_role;

COMMIT;
