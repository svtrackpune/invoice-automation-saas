BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_public_document_dispatch(
  p_business_id uuid,
  p_document_type text,
  p_document_id uuid,
  p_receipt_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, mm_private, pg_temp
AS $function$
DECLARE
  t text := lower(btrim(coalesce(p_document_type, '')));
  v_business_id uuid;
  v_customer_id uuid;
  v_business_name text;
  v_customer_name text;
  v_business_tax_id text;
  v_customer_tax_id text;
  v_number text;
  v_date text;
  v_due_date text;
  v_valid_until text;
  v_status text;
  v_currency text := 'INR';
  v_total numeric := 0;
  v_paid numeric := 0;
  v_balance numeric := 0;
  v_notes text;
  v_public_token text;
  v_receipt_token text;
  v_access jsonb;
  v_public_path text;
  v_pdf_path text;
  r public.receipts%rowtype;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;

  IF t = 'reminder' THEN t := 'invoice'; END IF;
  IF t NOT IN ('invoice', 'quotation', 'challan', 'receipt') THEN
    RAISE EXCEPTION 'Unsupported public document type' USING errcode = '22023';
  END IF;

  IF t = 'invoice' THEN
    UPDATE public.invoices SET public_share_token = encode(extensions.gen_random_bytes(32), 'hex')
     WHERE id = p_document_id AND business_id = p_business_id AND public_share_token IS NULL;
    SELECT i.business_id, i.customer_id, b.name, c.display_name, b.tax_registration_number, c.tax_id,
           i.invoice_number, i.invoice_date::text, i.due_date::text, NULL::text, i.status::text,
           i.currency_code, i.total, i.amount_paid, i.balance_due, i.notes, i.public_share_token
      INTO v_business_id, v_customer_id, v_business_name, v_customer_name, v_business_tax_id, v_customer_tax_id,
           v_number, v_date, v_due_date, v_valid_until, v_status,
           v_currency, v_total, v_paid, v_balance, v_notes, v_public_token
      FROM public.invoices i
      JOIN public.businesses b ON b.id = i.business_id
      JOIN public.customers c ON c.id = i.customer_id AND c.business_id = i.business_id
     WHERE i.id = p_document_id AND i.business_id = p_business_id;
    IF v_business_id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF v_status NOT IN ('sent', 'partially_paid', 'paid') THEN
      RAISE EXCEPTION 'Invoice must be issued before public sharing';
    END IF;
    IF v_public_token IS NULL THEN RAISE EXCEPTION 'Invoice public token could not be issued'; END IF;
    v_public_path := '/invoice/' || v_public_token;
    v_pdf_path := '/api/public-documents/pdf?type=invoice&token=' || v_public_token;

  ELSIF t = 'quotation' THEN
    UPDATE public.quotations SET public_accept_token = encode(extensions.gen_random_bytes(32), 'hex')
     WHERE id = p_document_id AND business_id = p_business_id AND public_accept_token IS NULL;
    SELECT q.business_id, q.customer_id, b.name, c.display_name, b.tax_registration_number, c.tax_id,
           q.quotation_number, q.quotation_date::text, NULL::text, q.valid_until::text, q.status,
           q.currency_code, q.total, 0::numeric, q.total, q.notes, q.public_accept_token
      INTO v_business_id, v_customer_id, v_business_name, v_customer_name, v_business_tax_id, v_customer_tax_id,
           v_number, v_date, v_due_date, v_valid_until, v_status,
           v_currency, v_total, v_paid, v_balance, v_notes, v_public_token
      FROM public.quotations q
      JOIN public.businesses b ON b.id = q.business_id
      JOIN public.customers c ON c.id = q.customer_id AND c.business_id = q.business_id
     WHERE q.id = p_document_id AND q.business_id = p_business_id;
    IF v_business_id IS NULL THEN RAISE EXCEPTION 'Quotation not found'; END IF;
    IF v_status NOT IN ('sent', 'accepted')
       OR (v_valid_until IS NOT NULL AND v_valid_until::date < current_date AND v_status <> 'accepted') THEN
      RAISE EXCEPTION 'Quotation is not available for public sharing';
    END IF;
    IF v_public_token IS NULL THEN RAISE EXCEPTION 'Quotation public token could not be issued'; END IF;
    v_public_path := '/quote/' || v_public_token;
    v_pdf_path := '/api/public-documents/pdf?type=quotation&token=' || v_public_token;

  ELSIF t = 'challan' THEN
    UPDATE public.delivery_challans SET public_share_token = encode(extensions.gen_random_bytes(32), 'hex')
     WHERE id = p_document_id AND business_id = p_business_id AND public_share_token IS NULL;
    SELECT d.business_id, d.customer_id, b.name, c.display_name, b.tax_registration_number, c.tax_id,
           d.challan_number, d.challan_date::text, NULL::text, NULL::text, d.status,
           'INR', d.total, 0::numeric, d.total, d.notes, d.public_share_token
      INTO v_business_id, v_customer_id, v_business_name, v_customer_name, v_business_tax_id, v_customer_tax_id,
           v_number, v_date, v_due_date, v_valid_until, v_status,
           v_currency, v_total, v_paid, v_balance, v_notes, v_public_token
      FROM public.delivery_challans d
      JOIN public.businesses b ON b.id = d.business_id
      JOIN public.customers c ON c.id = d.customer_id AND c.business_id = d.business_id
     WHERE d.id = p_document_id AND d.business_id = p_business_id;
    IF v_business_id IS NULL THEN RAISE EXCEPTION 'Delivery challan not found'; END IF;
    IF v_status IN ('draft', 'void', 'cancelled', 'deleted') THEN
      RAISE EXCEPTION 'Delivery challan is not available for public sharing';
    END IF;
    IF v_public_token IS NULL THEN RAISE EXCEPTION 'Delivery challan public token could not be issued'; END IF;
    v_public_path := '/delivery-challan/' || v_public_token;
    v_pdf_path := '/api/public-documents/pdf?type=challan&token=' || v_public_token;

  ELSE
    SELECT * INTO r
      FROM public.receipts
     WHERE id = p_document_id AND business_id = p_business_id;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Receipt not found'; END IF;

    -- Reuse a valid legacy receipt token when supplied by an existing queued
    -- job; otherwise mint a fresh opaque token. Only its SHA-256 digest is stored.
    IF nullif(btrim(coalesce(p_receipt_token, '')), '') IS NOT NULL THEN
      SELECT p_receipt_token INTO v_receipt_token
       FROM public.receipt_access_tokens rat
       WHERE rat.receipt_id = r.id
         AND rat.business_id = r.business_id
         AND rat.token_hash = encode(extensions.digest(p_receipt_token, 'sha256'), 'hex')
         AND rat.purpose IN ('customer_download', 'whatsapp_delivery')
         AND rat.revoked_at IS NULL
         AND (rat.expires_at IS NULL OR rat.expires_at > now())
       LIMIT 1;
    END IF;
    IF v_receipt_token IS NULL THEN
      v_access := public._issue_receipt_access_token(r.id, 'customer_download');
      v_receipt_token := v_access->>'token';
    END IF;

    SELECT r.business_id, r.customer_id, b.name, coalesce(c.display_name, c.legal_name, 'Customer'),
           b.tax_registration_number, c.tax_id, r.receipt_number, r.receipt_date::text,
           NULL::text, NULL::text, 'paid', coalesce(r.currency_code, 'INR'),
           r.amount, r.amount, coalesce(i.balance_due, 0), r.notes
      INTO v_business_id, v_customer_id, v_business_name, v_customer_name, v_business_tax_id, v_customer_tax_id,
           v_number, v_date, v_due_date, v_valid_until, v_status, v_currency,
           v_total, v_paid, v_balance, v_notes
      FROM public.receipts r
      JOIN public.businesses b ON b.id = r.business_id
      LEFT JOIN public.customers c ON c.id = r.customer_id AND c.business_id = r.business_id
      LEFT JOIN public.payments p ON p.id = r.payment_id AND p.business_id = r.business_id
      LEFT JOIN public.invoices i ON i.id = p.invoice_id AND i.business_id = r.business_id
     WHERE r.id = p_document_id AND r.business_id = p_business_id;
    v_public_path := '/receipt/' || v_receipt_token;
    v_pdf_path := '/api/receipts/pdf?token=' || v_receipt_token;
  END IF;

  RETURN jsonb_build_object(
    'document_type', t,
    'document_id', p_document_id,
    'document_number', v_number,
    'document_date', v_date,
    'due_date', v_due_date,
    'valid_until', v_valid_until,
    'status', v_status,
    'currency_code', coalesce(nullif(v_currency, ''), 'INR'),
    'total_amount', coalesce(v_total, 0),
    'amount_paid', coalesce(v_paid, 0),
    'balance_due', coalesce(v_balance, 0),
    'notes', v_notes,
    'business_id', v_business_id,
    'business_name', coalesce(v_business_name, 'Business'),
    'customer_name', coalesce(v_customer_name, 'Customer'),
    'business_tax_id', v_business_tax_id,
    'customer_tax_id', v_customer_tax_id,
    'public_path', v_public_path,
    'pdf_path', v_pdf_path
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_public_document_dispatch(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_public_document_dispatch(uuid, text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.dispatch_customer_document(
  p_business_id uuid,
  p_document_type text,
  p_document_id uuid,
  p_message text,
  p_subject text DEFAULT NULL,
  p_action_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, mm_private, pg_temp
AS $function$
DECLARE
  t text := lower(btrim(coalesce(p_document_type,'')));
  bid uuid;
  cid uuid;
  route jsonb;
  ch text;
  target text;
  jid uuid;
  v_token text;
  v_access jsonb;
  v_public_path text;
  v_status text;
  v_number text;
BEGIN
  IF auth.uid() IS NULL OR NOT mm_private.has_business_permission(p_business_id,'sales.create',auth.uid()) THEN
    RAISE EXCEPTION 'Access denied' USING errcode='42501';
  END IF;

  IF t IN ('invoice','reminder') THEN
    UPDATE public.invoices SET public_share_token=encode(extensions.gen_random_bytes(32),'hex')
      WHERE id=p_document_id AND business_id=p_business_id AND public_share_token IS NULL;
    SELECT business_id,customer_id,status::text,public_share_token,invoice_number
      INTO bid,cid,v_status,v_token,v_number
      FROM public.invoices WHERE id=p_document_id AND business_id=p_business_id;
    IF bid IS NULL OR v_status NOT IN ('sent','partially_paid','paid') THEN
      RAISE EXCEPTION 'Invoice must be issued before public sharing';
    END IF;
    v_public_path := '/invoice/'||v_token;

  ELSIF t='quotation' THEN
    UPDATE public.quotations SET status='sent',updated_at=now()
      WHERE id=p_document_id AND business_id=p_business_id AND status='draft';
    UPDATE public.quotations SET public_accept_token=encode(extensions.gen_random_bytes(32),'hex')
      WHERE id=p_document_id AND business_id=p_business_id AND public_accept_token IS NULL;
    SELECT business_id,customer_id,status,public_accept_token,quotation_number
      INTO bid,cid,v_status,v_token,v_number
      FROM public.quotations WHERE id=p_document_id AND business_id=p_business_id;
    IF bid IS NULL OR v_status NOT IN ('sent','accepted') THEN
      RAISE EXCEPTION 'Quotation must be sent before public sharing';
    END IF;
    IF EXISTS (SELECT 1 FROM public.quotations WHERE id=p_document_id AND valid_until < current_date AND status<>'accepted') THEN
      RAISE EXCEPTION 'Quotation has expired';
    END IF;
    v_public_path := '/quote/'||v_token;

  ELSIF t='challan' THEN
    UPDATE public.delivery_challans SET public_share_token=encode(extensions.gen_random_bytes(32),'hex')
      WHERE id=p_document_id AND business_id=p_business_id AND public_share_token IS NULL;
    SELECT business_id,customer_id,status,public_share_token,challan_number
      INTO bid,cid,v_status,v_token,v_number
      FROM public.delivery_challans WHERE id=p_document_id AND business_id=p_business_id;
    IF bid IS NULL OR v_status IN ('draft','void','cancelled','deleted') THEN
      RAISE EXCEPTION 'Delivery challan is not available for public sharing';
    END IF;
    v_public_path := '/delivery-challan/'||v_token;

  ELSIF t='receipt' THEN
    SELECT business_id,customer_id,receipt_number INTO bid,cid,v_number
      FROM public.receipts WHERE id=p_document_id AND business_id=p_business_id;
    IF bid IS NULL THEN RAISE EXCEPTION 'Receipt not found'; END IF;
    v_access := public._issue_receipt_access_token(p_document_id,'customer_download');
    v_token := v_access->>'token';
    v_public_path := '/receipt/'||v_token;

  ELSE
    RAISE EXCEPTION 'Unsupported document type';
  END IF;

  IF bid IS DISTINCT FROM p_business_id THEN RAISE EXCEPTION 'Document does not belong to selected business' USING errcode='42501'; END IF;
  IF cid IS NULL THEN RAISE EXCEPTION 'Document has no customer'; END IF;
  route := mm_private.resolve_customer_notification_route(p_business_id,cid);

  IF coalesce((route->>'automated')::boolean,false) THEN
    ch := route->>'channel';
    target := route->>'recipient';
    INSERT INTO public.notification_jobs(business_id,customer_id,invoice_id,channel,notification_type,recipient,subject,message,action_url,scheduled_for,metadata)
    VALUES(
      p_business_id,cid,CASE WHEN t IN ('invoice','reminder') THEN p_document_id ELSE NULL END,
      ch,t,target,p_subject,p_message,v_public_path,now(),
      jsonb_build_object('document_type',t,'document_id',p_document_id::text,'document_number',v_number,
        'idempotency_key','manual:'||p_document_id::text||':'||t||':'||ch,'public_document_path',v_public_path)
    )
    RETURNING id INTO jid;
    RETURN jsonb_build_object('queued',true,'job_id',jid,'channel',ch,'recipient',target,'action_url',v_public_path);
  END IF;

  ch := coalesce(route->>'channel','whatsapp');
  target := route->>'recipient';
  IF target IS NULL THEN RETURN jsonb_build_object('queued',false,'client_fallback',false,'reason','Customer has no usable communication destination','action_url',v_public_path); END IF;
  INSERT INTO public.communication_dispatch_logs(business_id,document_type,document_id,customer_id,channel,recipient_target,payload_content,dispatch_status,error_message)
  VALUES(p_business_id,t,p_document_id,cid,ch::public.communication_channel,target,p_message,'fallback_client','No healthy tenant provider is configured for the selected route.');
  RETURN jsonb_build_object('queued',false,'client_fallback',true,'channel',ch,'recipient',target,'message',p_message,'action_url',v_public_path);
END;
$function$;

REVOKE ALL ON FUNCTION public.dispatch_customer_document(uuid,text,uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_customer_document(uuid,text,uuid,text,text,text) TO authenticated;

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

  IF t IN ('tax_invoice', 'cash_bill') THEN t := 'invoice'; END IF;
  IF t = 'quote' THEN t := 'quotation'; END IF;
  IF t IN ('delivery_challan', 'challan') THEN t := 'challan'; END IF;
  IF t NOT IN ('invoice', 'quotation', 'receipt', 'challan') THEN
    RAISE EXCEPTION 'Unsupported public document type' USING errcode = '22023';
  END IF;

  IF t = 'invoice' THEN
    SELECT business_id, status::text, invoice_number, public_share_token
      INTO v_business_id, v_status, v_number, v_token
      FROM public.invoices WHERE id = p_document_id;
    IF v_business_id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
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
    v_path := '/invoice/' || v_token;

  ELSIF t = 'quotation' THEN
    SELECT business_id, status, valid_until, quotation_number, public_accept_token
      INTO v_business_id, v_status, v_valid_until, v_number, v_token
      FROM public.quotations WHERE id = p_document_id;
    IF v_business_id IS NULL THEN RAISE EXCEPTION 'Quotation not found'; END IF;
    IF NOT mm_private.has_business_permission(v_business_id, 'sales.create', auth.uid()) THEN
      RAISE EXCEPTION 'Access denied' USING errcode = '42501';
    END IF;
    IF v_status NOT IN ('sent', 'accepted')
       OR (v_valid_until IS NOT NULL AND v_valid_until < current_date AND v_status <> 'accepted') THEN
      RAISE EXCEPTION 'Quotation must be sent and unexpired before public sharing';
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