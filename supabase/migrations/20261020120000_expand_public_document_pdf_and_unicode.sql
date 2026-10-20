BEGIN;

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS public_share_token text;
ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS public_share_token text;

CREATE UNIQUE INDEX IF NOT EXISTS bills_public_share_token_uidx
  ON public.bills(public_share_token)
  WHERE public_share_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_public_share_token_uidx
  ON public.credit_notes(public_share_token)
  WHERE public_share_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_public_document_link(
  p_document_type text,
  p_document_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, mm_private, extensions, pg_temp
AS $function$
DECLARE
  t text := lower(btrim(coalesce(p_document_type, '')));
  v_business_id uuid;
  v_status text;
  v_document_kind text;
  v_valid_until date;
  v_token text;
  v_number text;
  v_access jsonb;
  v_path text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'Document ID is required' USING errcode = '22023';
  END IF;

  IF t = 'tax_invoice' THEN t := 'invoice'; END IF;
  IF t = 'quote' THEN t := 'quotation'; END IF;
  IF t IN ('delivery_challan', 'challan') THEN t := 'challan'; END IF;
  IF t NOT IN ('invoice', 'quotation', 'receipt', 'challan', 'purchase_order', 'credit_note', 'cash_bill') THEN
    RAISE EXCEPTION 'Unsupported public document type' USING errcode = '22023';
  END IF;

  IF t IN ('invoice', 'cash_bill') THEN
    SELECT business_id, status::text, invoice_number, public_share_token, document_kind
      INTO v_business_id, v_status, v_number, v_token, v_document_kind
      FROM public.invoices WHERE id = p_document_id;
    IF v_business_id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF t = 'cash_bill' AND v_document_kind IS DISTINCT FROM 'cash_bill' THEN
      RAISE EXCEPTION 'Cash bill not found';
    END IF;
    IF t = 'invoice' AND v_document_kind = 'cash_bill' THEN
      RAISE EXCEPTION 'Cash bill must use the cash_bill document type';
    END IF;
    IF NOT mm_private.has_business_permission(v_business_id, 'sales.create', auth.uid()) THEN
      RAISE EXCEPTION 'Access denied' USING errcode = '42501';
    END IF;
    IF v_status NOT IN ('sent', 'partially_paid', 'paid') THEN
      RAISE EXCEPTION 'Invoice must be issued before public sharing';
    END IF;
    IF v_token IS NULL OR btrim(v_token) = '' THEN
      UPDATE public.invoices
         SET public_share_token = encode(extensions.gen_random_bytes(32), 'hex')
       WHERE id = p_document_id AND business_id = v_business_id
         AND coalesce(btrim(public_share_token), '') = '';
      SELECT public_share_token INTO v_token FROM public.invoices
       WHERE id = p_document_id AND business_id = v_business_id;
    END IF;
    IF v_token IS NULL OR v_token !~ '^[A-Fa-f0-9]{48,128}$' THEN
      RAISE EXCEPTION 'Invoice public token could not be issued';
    END IF;
    v_path := CASE WHEN t = 'cash_bill'
      THEN '/api/public-documents/pdf?type=cash_bill&token=' || v_token
      ELSE '/invoice/' || v_token END;

  ELSIF t = 'quotation' THEN
    SELECT business_id, status, valid_until, quotation_number, public_accept_token
      INTO v_business_id, v_status, v_valid_until, v_number, v_token
      FROM public.quotations WHERE id = p_document_id;
    IF v_business_id IS NULL THEN RAISE EXCEPTION 'Quotation not found'; END IF;
    IF NOT mm_private.has_business_permission(v_business_id, 'sales.create', auth.uid()) THEN
      RAISE EXCEPTION 'Access denied' USING errcode = '42501';
    END IF;
    IF v_status NOT IN ('sent', 'accepted', 'converted')
       OR (v_valid_until IS NOT NULL AND v_valid_until < current_date AND v_status NOT IN ('accepted', 'converted')) THEN
      RAISE EXCEPTION 'Quotation must be issued and available before public sharing';
    END IF;
    IF v_token IS NULL OR btrim(v_token) = '' THEN
      UPDATE public.quotations
         SET public_accept_token = encode(extensions.gen_random_bytes(32), 'hex')
       WHERE id = p_document_id AND business_id = v_business_id
         AND coalesce(btrim(public_accept_token), '') = '';
      SELECT public_accept_token INTO v_token FROM public.quotations
       WHERE id = p_document_id AND business_id = v_business_id;
    END IF;
    IF v_token IS NULL OR v_token !~ '^[A-Fa-f0-9]{48,128}$' THEN
      RAISE EXCEPTION 'Quotation public token could not be issued';
    END IF;
    v_path := '/quote/' || v_token;

  ELSIF t = 'challan' THEN
    SELECT business_id, status, challan_number, public_share_token
      INTO v_business_id, v_status, v_number, v_token
      FROM public.delivery_challans WHERE id = p_document_id;
    IF v_business_id IS NULL THEN RAISE EXCEPTION 'Delivery challan not found'; END IF;
    IF NOT mm_private.has_business_permission(v_business_id, 'sales.create', auth.uid()) THEN
      RAISE EXCEPTION 'Access denied' USING errcode = '42501';
    END IF;
    IF v_status IN ('draft', 'void', 'cancelled', 'deleted') THEN
      RAISE EXCEPTION 'Delivery challan is not available for public sharing';
    END IF;
    IF v_token IS NULL OR btrim(v_token) = '' THEN
      UPDATE public.delivery_challans
         SET public_share_token = encode(extensions.gen_random_bytes(32), 'hex')
       WHERE id = p_document_id AND business_id = v_business_id
         AND coalesce(btrim(public_share_token), '') = '';
      SELECT public_share_token INTO v_token FROM public.delivery_challans
       WHERE id = p_document_id AND business_id = v_business_id;
    END IF;
    IF v_token IS NULL OR v_token !~ '^[A-Fa-f0-9]{48,128}$' THEN
      RAISE EXCEPTION 'Delivery challan public token could not be issued';
    END IF;
    v_path := '/delivery-challan/' || v_token;

  ELSIF t = 'purchase_order' THEN
    SELECT business_id, coalesce(nullif(po_status, ''), status::text), bill_number, public_share_token
      INTO v_business_id, v_status, v_number, v_token
      FROM public.bills WHERE id = p_document_id AND is_purchase_order = true;
    IF v_business_id IS NULL THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
    IF NOT mm_private.has_business_permission(v_business_id, 'purchases.manage', auth.uid()) THEN
      RAISE EXCEPTION 'Access denied' USING errcode = '42501';
    END IF;
    IF v_status IN ('draft', 'void', 'cancelled', 'deleted') THEN
      RAISE EXCEPTION 'Purchase order must be sent or approved before public sharing';
    END IF;
    IF v_token IS NULL OR btrim(v_token) = '' THEN
      UPDATE public.bills SET public_share_token = encode(extensions.gen_random_bytes(32), 'hex')
       WHERE id = p_document_id AND business_id = v_business_id AND is_purchase_order = true
         AND coalesce(btrim(public_share_token), '') = '';
      SELECT public_share_token INTO v_token FROM public.bills
       WHERE id = p_document_id AND business_id = v_business_id AND is_purchase_order = true;
    END IF;
    IF v_token IS NULL OR v_token !~ '^[A-Fa-f0-9]{48,128}$' THEN
      RAISE EXCEPTION 'Purchase order public token could not be issued';
    END IF;
    v_path := '/api/public-documents/pdf?type=purchase_order&token=' || v_token;

  ELSIF t = 'credit_note' THEN
    SELECT business_id, status, credit_note_number, public_share_token
      INTO v_business_id, v_status, v_number, v_token
      FROM public.credit_notes WHERE id = p_document_id;
    IF v_business_id IS NULL THEN RAISE EXCEPTION 'Credit note not found'; END IF;
    IF NOT mm_private.has_business_permission(v_business_id, 'sales.create', auth.uid()) THEN
      RAISE EXCEPTION 'Access denied' USING errcode = '42501';
    END IF;
    IF v_status NOT IN ('posted', 'issued', 'sent') THEN
      RAISE EXCEPTION 'Credit note must be posted before public sharing';
    END IF;
    IF v_token IS NULL OR btrim(v_token) = '' THEN
      UPDATE public.credit_notes SET public_share_token = encode(extensions.gen_random_bytes(32), 'hex')
       WHERE id = p_document_id AND business_id = v_business_id
         AND coalesce(btrim(public_share_token), '') = '';
      SELECT public_share_token INTO v_token FROM public.credit_notes
       WHERE id = p_document_id AND business_id = v_business_id;
    END IF;
    IF v_token IS NULL OR v_token !~ '^[A-Fa-f0-9]{48,128}$' THEN
      RAISE EXCEPTION 'Credit note public token could not be issued';
    END IF;
    v_path := '/api/public-documents/pdf?type=credit_note&token=' || v_token;

  ELSE
    SELECT business_id, receipt_number INTO v_business_id, v_number
      FROM public.receipts WHERE id = p_document_id;
    IF v_business_id IS NULL THEN RAISE EXCEPTION 'Receipt not found'; END IF;
    IF NOT mm_private.has_business_permission(v_business_id, 'sales.create', auth.uid()) THEN
      RAISE EXCEPTION 'Access denied' USING errcode = '42501';
    END IF;
    v_access := public.create_public_receipt_link(p_document_id);
    v_path := v_access->>'path';
    IF v_path IS NULL OR v_path !~ '^/receipt/[A-Fa-f0-9]{48,128}$' THEN
      RAISE EXCEPTION 'Receipt public token could not be issued';
    END IF;
  END IF;

  IF v_path IS NULL OR v_path ~ '^/next-workspace/' THEN
    RAISE EXCEPTION 'Invalid public document path';
  END IF;

  RETURN jsonb_build_object('path', v_path, 'document_type', t, 'document_number', v_number);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_document_link(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_document_link(text, uuid) TO authenticated;

COMMIT;
