BEGIN;

-- Public acceptance reuses the established, transactionally locked conversion engine.
-- A named RPC contract is provided for public clients without duplicating invoice creation.
CREATE OR REPLACE FUNCTION public.rpc_accept_public_quotation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private, pg_temp
AS $$
BEGIN
  IF nullif(btrim(coalesce(p_token,'')), '') IS NULL
     OR btrim(p_token) !~ '^[A-Fa-f0-9]{48,128}$' THEN
    RAISE EXCEPTION 'Quotation link is invalid or unavailable';
  END IF;
  RETURN public.accept_public_quotation(btrim(p_token));
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_accept_public_quotation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_accept_public_quotation(text) TO anon, authenticated;

-- Keep expired SENT quotations viewable so the customer can see the expiry date and
-- contact the business. The actual acceptance RPC still rejects expired quotations.
-- Add settlement details to the canonical public quotation payload using the existing
-- per-document mapping, business defaults, and active account fallback.
DO $patch_public_quotation_view$
DECLARE
  v_target regprocedure := 'public.get_public_quotation(text)'::regprocedure;
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(v_target) INTO v_definition;

  v_old := $old$  IF q.status <> 'converted'
     AND q.valid_until IS NOT NULL
     AND q.valid_until < current_date
     AND q.status <> 'accepted' THEN
    RAISE EXCEPTION 'Quotation has expired';
  END IF;$old$;
  IF length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) THEN
    RAISE EXCEPTION 'Public quotation view patch aborted: expiry guard not found exactly once';
  END IF;
  v_definition := replace(v_definition,v_old,'');

  v_old := $old$    'invoice_status', linked_invoice.status::text,
    'accepted_at', q.accepted_at,$old$;
  IF length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) THEN
    RAISE EXCEPTION 'Public quotation view patch aborted: JSON payment insertion point not found exactly once';
  END IF;
  v_new := $new$    'invoice_status', linked_invoice.status::text,
    'currency_code', q.currency_code,
    'upi_id', CASE
      WHEN coalesce(dps.payment_qr_enabled, true)
      THEN coalesce(nullif(btrim(dps.upi_id), ''), nullif(btrim(quote_bank.metadata->>'upi_id'), ''))
      ELSE NULL
    END,
    'payment_qr_enabled', coalesce(dps.payment_qr_enabled, true),
    'bank', CASE WHEN quote_bank.id IS NOT NULL THEN jsonb_build_object(
      'name', quote_bank.name,
      'institution_name', quote_bank.institution_name,
      'account_holder_name', quote_bank.account_holder_name,
      'account_number', quote_bank.account_number,
      'account_last4', quote_bank.account_last4,
      'ifsc_code', quote_bank.ifsc_code,
      'branch_name', quote_bank.branch_name,
      'upi_id', CASE
        WHEN coalesce(dps.payment_qr_enabled, true)
        THEN coalesce(nullif(btrim(dps.upi_id), ''), nullif(btrim(quote_bank.metadata->>'upi_id'), ''))
        ELSE NULL
      END
    ) ELSE NULL END,
    'accepted_at', q.accepted_at,$new$;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := $old$  LEFT JOIN public.invoices linked_invoice
    ON linked_invoice.id = q.invoice_id
   AND linked_invoice.business_id = q.business_id
  WHERE c.id = q.customer_id AND c.business_id = q.business_id;$old$;
  IF length(v_definition)-length(replace(v_definition,v_old,'')) <> length(v_old) THEN
    RAISE EXCEPTION 'Public quotation view patch aborted: tenant-scoped join point not found exactly once';
  END IF;
  v_new := $new$  LEFT JOIN public.invoices linked_invoice
    ON linked_invoice.id = q.invoice_id
   AND linked_invoice.business_id = q.business_id
  LEFT JOIN public.document_payment_settings dps
    ON dps.business_id = q.business_id
  LEFT JOIN public.business_settings bs
    ON bs.business_id = q.business_id
  LEFT JOIN LATERAL (
    SELECT ba.id, ba.name, ba.institution_name, ba.account_holder_name, ba.account_number,
           ba.account_last4, ba.ifsc_code, ba.branch_name, ba.metadata
    FROM public.bank_accounts ba
    LEFT JOIN public.business_document_bank_accounts dbba
      ON dbba.bank_account_id = ba.id
     AND dbba.business_id = q.business_id
     AND dbba.document_type = 'quotation'
    WHERE ba.business_id = q.business_id
      AND ba.is_active = true
    ORDER BY
      (dbba.bank_account_id IS NOT NULL) DESC,
      dbba.display_order ASC NULLS LAST,
      (ba.id = coalesce(dps.default_bank_account_id, bs.default_bank_account_id)) DESC,
      ba.is_primary DESC,
      ba.created_at ASC
    LIMIT 1
  ) quote_bank ON true
  WHERE c.id = q.customer_id AND c.business_id = q.business_id;$new$;
  v_definition := replace(v_definition,v_old,v_new);

  IF position('business_document_bank_accounts' IN v_definition)=0
     OR position('payment_qr_enabled' IN v_definition)=0
     OR position('currency_code' IN v_definition)=0 THEN
    RAISE EXCEPTION 'Public quotation view patch aborted: payment payload assertions failed';
  END IF;
  EXECUTE v_definition;
END;
$patch_public_quotation_view$;

COMMIT;
