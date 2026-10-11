BEGIN;

-- When a merchant presses "Send document" on a draft quotation, that action is
-- the transition into its sent lifecycle. Public retrieval remains restricted
-- to sent/accepted records; invoice posting is intentionally not automated here.
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
    v_public_path := '/challan/'||v_token;

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

COMMIT;
