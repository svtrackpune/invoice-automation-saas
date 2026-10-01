BEGIN;

-- Authoritative receipt-delivery control.
-- Every inbound payment that creates a receipt reaches the receipt AFTER INSERT
-- trigger. Delivery is queued independently of accounting success/failure.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS receipt_delivery_enabled boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.enqueue_receipt_delivery_notifications(
  p_receipt_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, mm_private
AS $function$
DECLARE
  r public.receipts%rowtype;
  c public.customers%rowtype;
  b public.business_preferences%rowtype;
  biz public.businesses%rowtype;
  access jsonb;
  token text;
  action_url text;
  body text;
  invoice_id uuid;
  selected_channel text;
  selected_recipient text;
  selected_subject text;
  selected_metadata jsonb;
  queued integer := 0;
BEGIN
  SELECT * INTO r
  FROM public.receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;

  IF r.customer_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT * INTO c
  FROM public.customers
  WHERE id = r.customer_id
    AND business_id = r.business_id
    AND is_active;

  IF c.id IS NULL OR NOT coalesce(c.receipt_delivery_enabled, true) THEN
    RETURN 0;
  END IF;

  SELECT * INTO biz
  FROM public.businesses
  WHERE id = r.business_id;

  SELECT * INTO b
  FROM public.business_preferences
  WHERE business_id = r.business_id;

  SELECT p.invoice_id
  INTO invoice_id
  FROM public.payments p
  WHERE p.id = r.payment_id
    AND p.business_id = r.business_id;

  access := public._issue_receipt_access_token(r.id, 'customer_download');
  token := access->>'token';
  action_url := '/api/receipts/pdf?token=' || token;
  body := 'Your payment receipt ' || r.receipt_number || ' from ' ||
          coalesce(biz.name, 'Business') || ' is ready.';

  -- One automatic delivery route per receipt event.
  -- WhatsApp is primary whenever the customer supplied a phone number and
  -- the business has enabled WhatsApp. Email, SMS and Telegram are
  -- deterministic fallbacks when their destinations are available.
  IF coalesce(b.notification_whatsapp_enabled, true)
     AND nullif(trim(coalesce(c.phone,'')), '') IS NOT NULL THEN
    selected_channel := 'whatsapp';
    selected_recipient := trim(c.phone);
    selected_subject := NULL;
    selected_metadata := jsonb_build_object(
      'receipt_id', r.id,
      'receipt_number', r.receipt_number,
      'attachment_type', 'receipt_pdf',
      'attachment_filename', 'receipt-' || r.receipt_number || '.pdf',
      'idempotency_key', 'receipt:' || r.id || ':whatsapp:v2'
    );
  ELSIF coalesce(b.notification_email_enabled, true)
     AND nullif(trim(coalesce(c.email,'')), '') IS NOT NULL THEN
    selected_channel := 'email';
    selected_recipient := trim(c.email);
    selected_subject := 'Payment receipt · ' || r.receipt_number;
    selected_metadata := jsonb_build_object(
      'receipt_id', r.id,
      'receipt_number', r.receipt_number,
      'attachment_type', 'receipt_pdf',
      'attachment_filename', 'receipt-' || r.receipt_number || '.pdf',
      'idempotency_key', 'receipt:' || r.id || ':email:v2'
    );
  ELSIF coalesce(b.notification_sms_enabled, false)
     AND nullif(trim(coalesce(c.phone,'')), '') IS NOT NULL THEN
    selected_channel := 'sms';
    selected_recipient := trim(c.phone);
    selected_subject := NULL;
    selected_metadata := jsonb_build_object(
      'receipt_id', r.id,
      'receipt_number', r.receipt_number,
      'delivery_format', 'link',
      'idempotency_key', 'receipt:' || r.id || ':sms:v2'
    );
  ELSIF coalesce(b.notification_telegram_enabled, false)
     AND nullif(trim(coalesce(c.telegram_chat_id,'')), '') IS NOT NULL THEN
    selected_channel := 'telegram';
    selected_recipient := trim(c.telegram_chat_id);
    selected_subject := 'Payment receipt · ' || r.receipt_number;
    selected_metadata := jsonb_build_object(
      'receipt_id', r.id,
      'receipt_number', r.receipt_number,
      'attachment_type', 'receipt_pdf',
      'attachment_filename', 'receipt-' || r.receipt_number || '.pdf',
      'idempotency_key', 'receipt:' || r.id || ':telegram:v2'
    );
  ELSE
    RETURN 0;
  END IF;

  INSERT INTO public.notification_jobs(
    business_id,
    customer_id,
    invoice_id,
    channel,
    notification_type,
    recipient,
    subject,
    message,
    action_url,
    scheduled_for,
    metadata
  )
  VALUES(
    r.business_id,
    r.customer_id,
    invoice_id,
    selected_channel,
    'receipt',
    selected_recipient,
    selected_subject,
    body,
    action_url,
    now(),
    selected_metadata
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS queued = ROW_COUNT;
  RETURN queued;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid) TO authenticated;

COMMENT ON FUNCTION public.enqueue_receipt_delivery_notifications(uuid) IS
'Queues one digital receipt delivery for every eligible inbound-payment receipt. Cash & Carry and regular invoice/gateway receipts share this route. Delivery is independent from accounting.';

COMMIT;
