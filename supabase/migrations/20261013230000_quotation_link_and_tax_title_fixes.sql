BEGIN;

-- Converted quotations remain publicly viewable/readable as historical sales
-- documents. Expiry prevents a NEW acceptance, not sharing an already accepted
-- or converted quotation.
DO $fix_converted_quotation_public_link$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef('public.get_public_document_link(text, uuid)'::regprocedure);
  v_old := $old$
    IF v_status NOT IN ('sent', 'accepted')
       OR (v_valid_until IS NOT NULL AND v_valid_until < current_date AND v_status <> 'accepted') THEN
      RAISE EXCEPTION 'Quotation must be sent and unexpired before public sharing';
    END IF;
$old$;
  v_new := $new$
    IF v_status NOT IN ('sent', 'accepted', 'converted')
       OR (v_valid_until IS NOT NULL AND v_valid_until < current_date AND v_status NOT IN ('accepted', 'converted')) THEN
      RAISE EXCEPTION 'Quotation must be issued and available before public sharing';
    END IF;
$new$;

  IF position(v_new IN v_definition) = 0 THEN
    IF position(v_old IN v_definition) = 0 THEN
      RAISE EXCEPTION 'get_public_document_link quotation status guard has changed; refusing unverified patch';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);
    EXECUTE v_definition;
  END IF;
END;
$fix_converted_quotation_public_link$;

-- Public invoices must carry the registration profile needed to choose the
-- correct heading. Never expose stale legacy tax IDs when the business is
-- explicitly configured as non-GST/unregistered.
DO $fix_public_invoice_tax_profile$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef('mm_private.get_public_invoice_by_token(text)'::regprocedure);
  v_old := $old$'tax_registration_number', b.tax_registration_number$old$;
  v_new := $new$'tax_registration_number',
      CASE
        WHEN upper(coalesce((SELECT tp.gst_registration_type
                               FROM public.business_tax_profiles tp
                              WHERE tp.business_id = i.business_id), 'NONE'))
             IN ('NONE', 'UNREGISTERED', 'NON_GST', 'NOT_REGISTERED')
          THEN NULL
        ELSE coalesce(
          (SELECT nullif(btrim(tp.gstin), '')
             FROM public.business_tax_profiles tp
            WHERE tp.business_id = i.business_id),
          b.tax_registration_number
        )
      END,
    'gst_registration_type',
      (SELECT tp.gst_registration_type
         FROM public.business_tax_profiles tp
        WHERE tp.business_id = i.business_id)$new$;

  IF position(v_new IN v_definition) = 0 THEN
    IF position(v_old IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Public invoice tax-profile JSON anchor has changed; refusing unverified patch';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);
    EXECUTE v_definition;
  END IF;
END;
$fix_public_invoice_tax_profile$;

COMMIT;
